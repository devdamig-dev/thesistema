import { createHash, randomUUID } from "node:crypto";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { FudoApiError, FudoClient, type FudoCredentials, type FudoReadResourceStatus } from "./client";
import { encryptFudoCredentials, decryptFudoCredentials } from "./crypto";
import { FUDO_SYNC_PAGE_SIZE, FUDO_SYNC_RESOURCES, nextFudoPage, parseFudoPage } from "./snapshot";
import { runFudoReadBatch } from "./read-batch";

export type FudoActionResult = { ok: true; message: string } | { ok: false; code: string; message: string };
export type FudoResourcePreflight = {
  ok: boolean;
  message: string;
  checks: FudoReadResourceStatus[];
};
export type FudoSyncRunView = {
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "partial" | "failed";
  counts: Record<string, number>;
  errorCode: string | null;
};

export type FudoConnectionView = {
  configured: boolean;
  /** Opaque per-tenant, per-generation, per-test revision for ephemeral UI probes. */
  connectionRevision: string | null;
  status: "disconnected" | "connected" | "error";
  lastTestedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastErrorCode: string | null;
  lastCounts: Record<string, number>;
  importedCounts: Record<string, number>;
  /** Counts marked with the resource's current stable cycle UUID (null for legacy progress). */
  seenThisCycleCounts: Record<string, number | null>;
  /** Only populated after the resource's full scan is complete; these are POSSIBLE provider removals. */
  possiblyMissingCounts: Record<string, number | null>;
  /** Next read page per resource: null = not started, 0 = completed, >0 = pending. */
  nextPages: Record<string, number | null>;
  recentRuns: FudoSyncRunView[];
};

type Actor = { businessId: string; userId: string };
const fail = (code: string, message: string): FudoActionResult => ({ ok: false, code, message });
const UNKNOWN = "No pudimos completar la operación. Verificá la configuración y reintentá.";

function safeFailure(error: unknown): FudoActionResult {
  if (error instanceof FudoApiError) {
    const messages: Record<string, string> = {
      invalid_credentials: "Fudo rechazó las credenciales o el token. Revisá la API Key y API Secret.",
      forbidden: "El usuario de Fudo no tiene permisos para acceder al recurso solicitado.",
      rate_limited: "Fudo está limitando las consultas. Esperá y reintentá.",
      provider_unavailable: "No pudimos contactar la API de Fudo. Reintentá más tarde.",
      api_unavailable: "El endpoint no está disponible. Revisá que la API Pública General de Fudo esté habilitada en Plan Pro.",
      invalid_response: "La API de Fudo devolvió un formato inesperado. Revisá la versión de la integración.",
    };
    return fail(error.code, messages[error.code] ?? UNKNOWN);
  }
  if (error instanceof Error && error.message === "fudo_encryption_unavailable") {
    return fail("server_unconfigured", "La conexión segura todavía no está habilitada en GastroPilot.");
  }
  if (error instanceof Error && error.message === "fudo_actor_revoked") {
    return fail("forbidden", "Tu acceso al negocio cambió durante la sincronización. Volvé a ingresar.");
  }
  if (error instanceof Error && error.message === "fudo_ciphertext_invalid") {
    return fail("invalid_stored_credentials", "No se pudo leer la conexión cifrada. Volvé a vincular Fudo.");
  }
  if (error instanceof Error && /^invalid_fudo_|^fudo_record_too_large$/.test(error.message)) {
    return fail("invalid_response", "La API de Fudo devolvió registros incompatibles con la importación segura.");
  }
  return fail("operation_failed", UNKNOWN);
}

/** Rechecks tenant membership in privileged queries. No businessId is accepted from the browser. */
async function authorize(): Promise<{ actor: Actor; db: any } | null> {
  if (!isDatabaseMode()) return null;
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId || !["owner", "admin"].includes(ctx.role)) return null;
  const db = createSupabaseAdminClient() as any;
  const [membership, profile] = await Promise.all([
    db.from("business_members").select("id")
      .eq("business_id", ctx.businessId).eq("user_id", ctx.userId).in("role", ["owner", "admin"]).maybeSingle(),
    db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle(),
  ]);
  if (membership.error || !membership.data || profile.error || profile.data?.active !== true) return null;
  return { actor: { businessId: ctx.businessId, userId: ctx.userId }, db };
}

/** Provider requests can outlive a role revocation or an active tenant switch. */
async function isStillAuthorized(actor: Actor): Promise<boolean> {
  const current = await authorize();
  return !!current
    && current.actor.userId === actor.userId
    && current.actor.businessId === actor.businessId;
}

export async function getFudoConnectionView(): Promise<FudoConnectionView | null> {
  const authorized = await authorize();
  if (!authorized) return null;
  const { db, actor } = authorized;
  const connection = await db.from("fudo_connections")
    .select("connection_generation,status,last_tested_at,last_synced_at,last_sync_status,last_error_code")
    .eq("business_id", actor.businessId).maybeSingle();
  if (connection.error) return null;
  const row = connection.data;
  if (!row) {
    return {
      configured: true, connectionRevision: null, status: "disconnected",
      lastTestedAt: null, lastSyncedAt: null, lastSyncStatus: null, lastErrorCode: null, lastCounts: {},
      importedCounts: {}, seenThisCycleCounts: {}, possiblyMissingCounts: {}, nextPages: {}, recentRuns: [],
    };
  }

  // Snapshot the generation as an immutable primitive: a second session may
  // rotate credentials during asynchronous reads. Do not rely on a mutable
  // connection object reference when checking that our report is still current.
  const generation: string = row.connection_generation;
  // Snapshot every connection field used by the readiness panel before
  // asynchronous aggregation. A retest or sync can change status without
  // rotating connection_generation, so comparing the generation alone is not
  // a sufficient consistency fence.
  const revision = {
    status: row.status,
    lastTestedAt: row.last_tested_at,
    lastSyncedAt: row.last_synced_at,
    lastSyncStatus: row.last_sync_status,
    lastErrorCode: row.last_error_code,
  };
  // Keep the pilot's audit/count summary server-only; never return provider
  // payloads, ciphertext, user IDs or raw authorization metadata to the UI.
  const [recentResult, progressResult, ...countResults] = await Promise.all([
    db.from("fudo_sync_runs")
      .select("id,started_at,finished_at,status,counts,error_code")
      .eq("business_id", actor.businessId).eq("connection_generation", generation)
      .order("started_at", { ascending: false }).limit(5),
    db.from("fudo_sync_progress")
      .select("resource_type,next_page,cycle_id,cycle_started_at")
      .eq("business_id", actor.businessId).eq("connection_generation", generation),
    ...FUDO_SYNC_RESOURCES.map((resource) =>
      db.from("fudo_external_records").select("id", { count: "exact", head: true })
        .eq("business_id", actor.businessId).eq("connection_generation", generation)
        .eq("resource_type", resource)),
  ]);
  if (recentResult.error || progressResult.error
    || countResults.some((result: { error?: unknown }) => result.error)) return null;
  const safeCounts = (raw: unknown): Record<string, number> => {
    const result: Record<string, number> = {};
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      for (const resource of FUDO_SYNC_RESOURCES) {
        const n = (raw as Record<string, unknown>)[resource];
        if (typeof n === "number" && Number.isFinite(n) && n >= 0) result[resource] = n;
      }
    }
    return result;
  };
  // Keep the newest run identity in a private snapshot. A second admin may
  // start (or finish) a run while counts and cursors are being read, even
  // though fudo_connections metadata has not yet changed.
  const firstRun = ((recentResult.data ?? []) as Array<{
    id: string; started_at: string; finished_at: string | null; status: FudoSyncRunView["status"];
  }>)[0] ?? null;
  // Copy primitives; a synthetic DB and concurrent writes must never mutate
  // the baseline we compare against at the end of this async aggregation.
  const latestRunRevision = firstRun ? {
    id: firstRun.id, started_at: firstRun.started_at,
    finished_at: firstRun.finished_at, status: firstRun.status,
  } : null;
  const recentRuns: FudoSyncRunView[] = ((recentResult.data ?? []) as Array<{
    started_at: string; finished_at: string | null; status: FudoSyncRunView["status"];
    counts: Record<string, unknown>; error_code: string | null;
  }>).map((run) => ({
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    status: run.status,
    counts: safeCounts(run.counts),
    errorCode: run.error_code,
  }));
  const counts = recentRuns[0]?.counts ?? {};
  const nextPages: Record<string, number | null> = Object.fromEntries(
    FUDO_SYNC_RESOURCES.map((resource) => [resource, null]),
  );
  for (const progress of (progressResult.data ?? []) as Array<{ resource_type: string; next_page: unknown }>) {
    const page = Number(progress.next_page);
    if (Object.prototype.hasOwnProperty.call(nextPages, progress.resource_type)
      && Number.isSafeInteger(page) && page >= 0 && page <= 100000
      && progress.next_page !== null) {
      nextPages[progress.resource_type] = page;
    }
  }
  const importedCounts: Record<string, number> = {};
  FUDO_SYNC_RESOURCES.forEach((resource, index) => {
    importedCounts[resource] = Math.max(0, Number(countResults[index].count ?? 0));
  });
  // Historical staging IDs remain for audit; only the same immutable scan
  // UUID counts as present in a resource's current full-scan cycle. This is
  // robust to clock skew and serverless restarts across successive pages.
  const progressRows = (progressResult.data ?? []) as Array<{
    resource_type: string; next_page: number; cycle_id: string | null;
  }>;
  const seenResults = await Promise.all(FUDO_SYNC_RESOURCES.map((resource) => {
    const progress = progressRows.find((item) => item.resource_type === resource);
    if (!progress?.cycle_id) {
      return Promise.resolve({ count: null as number | null, error: null });
    }
    return db.from("fudo_external_records").select("id", { count: "exact", head: true })
      .eq("business_id", actor.businessId).eq("connection_generation", generation)
      .eq("resource_type", resource).eq("last_seen_cycle_id", progress.cycle_id);
  }));
  if (seenResults.some((result: { error?: unknown }) => result.error)) return null;
  const seenThisCycleCounts: Record<string, number | null> = {};
  const possiblyMissingCounts: Record<string, number | null> = {};
  // Cursor completion alone is not a committed reconciliation: a serverless
  // invocation can stop after persisting a cursor but before finalizing its run.
  // Never report absences while the newest run is running, failed or missing.
  const latestRunSettled = recentRuns[0]?.status === "completed" || recentRuns[0]?.status === "partial";
  FUDO_SYNC_RESOURCES.forEach((resource, index) => {
    const seen = seenResults[index].count;
    seenThisCycleCounts[resource] = typeof seen === "number" && Number.isFinite(seen) ? Math.max(0, seen) : null;
    // A partial/failed scan does not prove a provider ID has been removed.
    possiblyMissingCounts[resource] = latestRunSettled && nextPages[resource] === 0 && seenThisCycleCounts[resource] !== null
      ? Math.max(0, importedCounts[resource] - seenThisCycleCounts[resource]!) : null;
  });
  // A second owner can also retest credentials or finish a sync WITHOUT
  // changing the generation. A stale connected/complete status must not be
  // returned alongside aggregation from an earlier revision.
  // Final read is metadata only: no ciphertext, provider payload or secret.
  const current = await db.from("fudo_connections")
    .select("connection_generation,status,last_tested_at,last_synced_at,last_sync_status,last_error_code")
    .eq("business_id", actor.businessId).maybeSingle();
  if (current.error || !current.data || current.data.connection_generation !== generation
    || current.data.status !== revision.status
    || current.data.last_tested_at !== revision.lastTestedAt
    || current.data.last_synced_at !== revision.lastSyncedAt
    || current.data.last_sync_status !== revision.lastSyncStatus
    || current.data.last_error_code !== revision.lastErrorCode) return null;
  // A new sync can start and alter progress without updating the connection
  // row until it settles. Never present mixed old-run/new-cursor readiness.
  // Read metadata only; run IDs remain server-side.
  const latestRunNow = await db.from("fudo_sync_runs")
    .select("id,started_at,finished_at,status")
    .eq("business_id", actor.businessId).eq("connection_generation", generation)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (latestRunNow.error) return null;
  const nowRun = latestRunNow.data;
  if (Boolean(latestRunRevision) !== Boolean(nowRun)
    || (latestRunRevision && (
      nowRun.id !== latestRunRevision.id
      || nowRun.started_at !== latestRunRevision.started_at
      || nowRun.finished_at !== latestRunRevision.finished_at
      || nowRun.status !== latestRunRevision.status
    ))) return null;
  return {
    configured: true,
    // Never reuse green checks after switching businesses with an identical
    // status and timestamp. Do not expose raw tenant or generation identifiers.
    connectionRevision: createHash("sha256")
      .update(JSON.stringify([actor.businessId, generation, revision.status, revision.lastTestedAt]))
      .digest("hex"),
    status: revision.status === "connected" ? "connected" : "error",
    lastTestedAt: revision.lastTestedAt ?? null,
    lastSyncedAt: revision.lastSyncedAt ?? null,
    lastSyncStatus: revision.lastSyncStatus ?? null,
    lastErrorCode: revision.lastErrorCode ?? null,
    lastCounts: counts,
    importedCounts,
    seenThisCycleCounts,
    possiblyMissingCounts,
    nextPages,
    recentRuns,
  };
}

export async function connectFudo(input: FudoCredentials): Promise<FudoActionResult> {
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "Necesitás ingresar como owner o administrador del negocio.");
    const apiKey = typeof input?.apiKey === "string" ? input.apiKey.trim() : "";
    const apiSecret = typeof input?.apiSecret === "string" ? input.apiSecret.trim() : "";
    if (apiKey.length < 8 || apiKey.length > 512 || apiSecret.length < 8 || apiSecret.length > 2048) {
      return fail("invalid_input", "Ingresá la API Key y API Secret de Fudo válidas.");
    }
    const creds = { apiKey, apiSecret };
    // Fail closed if encryption is not available; never persist plaintext credentials.
    const encrypted = encryptFudoCredentials(authorized.actor.businessId, creds);
    await new FudoClient(creds).testConnection();
    // A provider probe can take 15 seconds. The owner/admin may be removed
    // from this business (or switch session/tenant) while that GET is pending.
    // Recheck the current authenticated actor AND their live DB membership
    // before the service-role RPC persists encrypted credentials. The initial
    // authorization alone would permit a revoked actor to finish this write.
    if (!(await isStillAuthorized(authorized.actor))) {
      return fail("forbidden", "Tu acceso al negocio cambió durante la prueba. Volvé a ingresar y reintentá.");
    }
    // One transaction coordinates rotation with sync startup. Never check and write separately.
    const saved = await authorized.db.rpc("fudo_replace_connection", {
      p_business_id: authorized.actor.businessId, p_actor_id: authorized.actor.userId,
      p_ciphertext: encrypted,
    });
    if (saved.error) return fail("storage_unavailable", "No se pudo guardar la conexión cifrada. Verificá la migración Fudo.");
    if (saved.data === "forbidden") return fail("forbidden", "Tu acceso al negocio cambió. Volvé a ingresar.");
    if (saved.data === "sync_running") return fail("sync_running", "Hay una sincronización en curso; esperá antes de rotar credenciales.");
    if (saved.data !== "connected") return fail("storage_unavailable", UNKNOWN);
    return { ok: true, message: "Conexión validada y guardada. Fudo sigue siendo la fuente operativa; GastroPilot solo leerá datos." };
  } catch (error) { return safeFailure(error); }
}

export async function testStoredFudoConnection(): Promise<FudoActionResult> {
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "No tenés permiso para probar Fudo.");
    const { actor, db } = authorized;
    const stored = await db.from("fudo_connections").select("credentials_ciphertext,connection_generation,last_tested_at")
      .eq("business_id", actor.businessId).maybeSingle();
    if (stored.error) return fail("storage_unavailable", UNKNOWN);
    if (!stored.data) return fail("not_connected", "Primero conectá Fudo.");
    const credentials = decryptFudoCredentials(actor.businessId, stored.data.credentials_ciphertext);
    const generation: string = stored.data.connection_generation;
    const testedAtStart: string | null = stored.data.last_tested_at ?? null;
    // A concurrent rotation or retest can finish while our provider probe is pending.
    // Fence writes and success messages to the exact connection tested; the
    // encrypted credentials must never be included in PostgREST URL filters.
    // Compare-and-set the previous test revision as well as the generation.
    // Two owners can retest the same credentials concurrently; the slower
    // response must not overwrite a newer result with stale health metadata.
    // This filters only on a timestamp, never on encrypted credentials.
    const recordTest = async (status: "connected" | "error", errorCode: string | null) => {
      // The CAS revision must actually advance, including two retests in the
      // same millisecond or when an app server's clock lags the stored timestamp.
      const nextTestedAt = new Date(Math.max(
        Date.now(), testedAtStart ? Date.parse(testedAtStart) + 1 : 0,
      )).toISOString();
      const update = db.from("fudo_connections").update({
        status, last_error_code: errorCode, last_tested_at: nextTestedAt,
      }).eq("business_id", actor.businessId).eq("connection_generation", generation);
      return (testedAtStart === null
        ? update.is("last_tested_at", null)
        : update.eq("last_tested_at", testedAtStart))
        .select("business_id").maybeSingle();
    };
    try {
      await new FudoClient(credentials).testConnection();
      // A revoked owner or tenant switch must not record a stale successful
      // test via the service-role client, even with unchanged credentials.
      if (!(await isStillAuthorized(actor))) {
        return fail("forbidden", "Tu acceso al negocio cambió durante la prueba. Volvé a ingresar.");
      }
      const updated = await recordTest("connected", null);
      if (updated.error) return fail("storage_unavailable", UNKNOWN);
      if (!updated.data) return fail("connection_changed", "La conexión Fudo cambió durante la prueba. Volvé a probar las credenciales actuales.");
      return { ok: true, message: "La consulta de lectura a productos Fudo respondió correctamente." };
    } catch (error) {
      const failure = safeFailure(error);
      // Likewise, a late provider 401/403 cannot downgrade connection health
      // after the actor has lost membership or changed active business.
      if (!(await isStillAuthorized(actor))) {
        return fail("forbidden", "Tu acceso al negocio cambió durante la prueba. Volvé a ingresar.");
      }
      const updated = await recordTest("error", failure.ok ? null : failure.code);
      if (updated.error) return fail("storage_unavailable", UNKNOWN);
      if (!updated.data) return fail("connection_changed", "La conexión Fudo cambió durante la prueba. Volvé a probar las credenciales actuales.");
      return failure;
    }
  } catch (error) { return safeFailure(error); }
}

/**
 * Pilot readiness check: five lightweight read-only GETs, one for each resource
 * required for O1. This never persists provider payloads or mutates sync state.
 * Only the authenticated business owner/admin sees sanitized resource outcomes.
 */
export async function inspectFudoReadPermissions(): Promise<FudoResourcePreflight> {
  try {
    const authorized = await authorize();
    if (!authorized) {
      return { ok: false, message: "Necesitás ser owner o administrador del negocio.", checks: [] };
    }
    const { actor, db } = authorized;
    const stored = await db.from("fudo_connections")
      .select("credentials_ciphertext,connection_generation,status,last_tested_at")
      .eq("business_id", actor.businessId).maybeSingle();
    if (stored.error) return { ok: false, message: UNKNOWN, checks: [] };
    if (!stored.data) return { ok: false, message: "Primero conectá Fudo.", checks: [] };
    const generation: unknown = stored.data.connection_generation;
    if (typeof generation !== "string" || !generation) {
      return { ok: false, message: UNKNOWN, checks: [] };
    }
    // Copy primitive metadata before external calls; PostgREST results can be
    // replaced by another owner/admin's retest while these five GETs run.
    const statusAtStart: unknown = stored.data.status;
    const testedAtStart: unknown = stored.data.last_tested_at;
    const credentials = decryptFudoCredentials(actor.businessId, stored.data.credentials_ciphertext);
    const checks = await new FudoClient(credentials).probeReadAccess(FUDO_SYNC_RESOURCES);
    // Read-only permission results must not survive role revocation or a
    // business switch that happened during the five provider GETs.
    if (!(await isStillAuthorized(actor))) {
      return { ok: false, message: "Tu acceso al negocio cambió durante la revisión. Volvé a ingresar.", checks: [] };
    }
    // A second owner can rotate or disconnect while the five external probes
    // are running. Never report old credentials as currently authorized.
    // This status-only reread does not expose ciphertext to the browser.
    const current = await db.from("fudo_connections")
      .select("connection_generation,status,last_tested_at")
      .eq("business_id", actor.businessId).maybeSingle();
    if (current.error) return { ok: false, message: UNKNOWN, checks: [] };
    // A parallel connection retest can change status or its test timestamp
    // WITHOUT rotating the credentials. Never treat pre-retest permission
    // checks as evidence of the current connection's health.
    if (!current.data || current.data.connection_generation !== generation
      || current.data.status !== statusAtStart
      || current.data.last_tested_at !== testedAtStart) {
      return {
        ok: false,
        message: "La conexión Fudo cambió durante la revisión. Volvé a comprobar los permisos de la conexión actual.",
        checks: [],
      };
    }
    const available = checks.filter((item) => item.code === "available").length;
    return {
      ok: available === FUDO_SYNC_RESOURCES.length,
      message: available === FUDO_SYNC_RESOURCES.length
        ? "Los cinco recursos respondieron con datos compatibles. Falta conciliar la importación real."
        : `Acceso de lectura confirmado en ${available} de ${FUDO_SYNC_RESOURCES.length} recursos. Revisá permisos y disponibilidad antes de sincronizar.`,
      checks,
    };
  } catch (error) {
    // Global auth or ciphertext failures produce no fake per-resource success.
    const result = safeFailure(error);
    return { ok: false, message: result.message, checks: [] };
  }
}

export async function disconnectFudo(): Promise<FudoActionResult> {
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "No tenés permiso para desconectar Fudo.");
    const { actor, db } = authorized;
    // Runs abandoned by serverless invocations are recovered here, even if credentials
    // can no longer be decrypted (e.g. after a server key rotation).
    const removed = await db.rpc("fudo_disconnect_connection", {
      p_business_id: actor.businessId, p_actor_id: actor.userId,
    });
    if (removed.error) return fail("storage_unavailable", UNKNOWN);
    if (removed.data === "forbidden") return fail("forbidden", "Tu acceso al negocio cambió. Volvé a ingresar.");
    if (removed.data === "sync_running") return fail("sync_running", "Hay una sincronización en curso. Reintentá cuando termine.");
    if (removed.data !== "disconnected") return fail("storage_unavailable", UNKNOWN);
    return { ok: true, message: "Se eliminaron las credenciales. Se conserva la importación histórica para auditoría interna; no habrá nuevas consultas a Fudo." };
  } catch (error) { return safeFailure(error); }
}

/**
 * Bounded, resumable import. One page per resource per invocation. Upserts replace
 * the same external record but never insert into native sales/stock/order tables.
 * A cursor is only advanced after the whole page has been stored.
 */
export async function syncFudoReadOnly(): Promise<FudoActionResult> {
  let runId: string | null = null;
  let actor: Actor | null = null;
  let db: any;
  let generation: string | null = null;
  const counts: Record<string, number> = {};
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "No tenés permiso para sincronizar Fudo.");
    ({ actor, db } = authorized);
    const connection = await db.from("fudo_connections").select("credentials_ciphertext,connection_generation")
      .eq("business_id", actor.businessId).maybeSingle();
    if (connection.error) return fail("storage_unavailable", UNKNOWN);
    if (!connection.data) return fail("not_connected", "Conectá Fudo antes de sincronizar.");
    const encryptedConnection: string = connection.data.credentials_ciphertext;
    generation = connection.data.connection_generation;
    const credentials = decryptFudoCredentials(actor.businessId, encryptedConnection);
    const client = new FudoClient(credentials);

    // Fences disconnected/rotated credentials at sync startup, using the same
    // transaction-level business lock as rotation and disconnection.
    const started = await db.rpc("fudo_begin_sync", {
      p_business_id: actor.businessId, p_expected_generation: generation,
      p_actor_id: actor.userId,
    });
    if (started.error) return fail("storage_unavailable", UNKNOWN);
    if (started.data?.code === "forbidden") return fail("forbidden", "Tu acceso al negocio cambió. Volvé a ingresar.");
    if (started.data?.code === "sync_running") return fail("sync_running", "Ya hay una sincronización activa de este negocio.");
    if (started.data?.code === "connection_changed") return fail("connection_changed", "La conexión Fudo cambió; actualizá la pantalla e intentá nuevamente.");
    if (started.data?.code !== "started" || typeof started.data?.run_id !== "string") return fail("storage_unavailable", UNKNOWN);
    runId = started.data.run_id;
    // A role can be revoked after fudo_begin_sync commits. Do not reset
    // a completed cycle on behalf of an actor who is no longer authorized.
    if (!(await isStillAuthorized(authorized.actor))) throw new Error("fudo_actor_revoked");
    const previous = await db.from("fudo_sync_progress").select("resource_type,next_page")
      .eq("business_id", actor.businessId).eq("connection_generation", generation);
    if (previous.error) throw new Error("fudo_storage_failed");
    const progressRows = (previous.data ?? []) as Array<{ resource_type: string; next_page: number }>;
    // Once all five resources were completed, a new click begins a fresh full scan.
    // During an incomplete cycle, already completed resources are not re-read.
    const fullCycleFinished = FUDO_SYNC_RESOURCES.every((resource) =>
      progressRows.some((row) => row.resource_type === resource && row.next_page === 0));
    if (fullCycleFinished) {
      const reset = await db.from("fudo_sync_progress").delete()
        .eq("business_id", actor.businessId).eq("connection_generation", generation);
      if (reset.error) throw new Error("fudo_storage_failed");
    }
    const syncBusinessId = authorized.actor.businessId;
    const syncActor = authorized.actor;
    // Each Fudo GET may take up to 15s. Five sequential resource reads can
    // time out a 60s function; three bounded workers keep progress resumable.
    // Wait for ALL launched page writes to settle even if one resource fails.
    const pendingPages = await runFudoReadBatch(FUDO_SYNC_RESOURCES, async (resource) => {
      const cursor = await db.from("fudo_sync_progress").select("next_page,cycle_id,cycle_started_at")
        .eq("business_id", syncBusinessId).eq("connection_generation", generation).eq("resource_type", resource).maybeSingle();
      if (cursor.error) throw new Error("fudo_storage_failed");
      const page = cursor.data ? Number(cursor.data.next_page) : 1;
      if (page === 0) { counts[resource] = 0; return false; }
      // A UUID, not timestamps, defines membership in the same full-scan cycle.
      // Retry/resume preserves it; a first page starts a fresh cycle. Legacy
      // in-flight page >1 remains unknown rather than falsely reconciled.
      const cycleId: string | null = typeof cursor.data?.cycle_id === "string" && cursor.data.cycle_id
        ? cursor.data.cycle_id : page === 1 ? randomUUID() : null;
      const cycleStartedAt = typeof cursor.data?.cycle_started_at === "string"
        ? cursor.data.cycle_started_at : page === 1 ? new Date().toISOString() : null;
      // A previous parallel worker may have detected revocation already.
      // Do not initiate fresh provider reads using a removed actor's connection.
      if (!(await isStillAuthorized(syncActor))) throw new Error("fudo_actor_revoked");
      const response = await client.list(resource, {
        "page[number]": page, "page[size]": FUDO_SYNC_PAGE_SIZE,
      });
      const snapshots = parseFudoPage(response, resource);
      // A malformed next-link invalidates the entire page. Validate provider
      // pagination BEFORE any staging upsert so the failed page cannot leave
      // new records or cycle presence markers without a matching cursor.
      const nextPage = nextFudoPage(response, page, snapshots.length, resource);
      // Provider GETs are asynchronous: role revocation or session switch
      // during the request must abort before staging OR cursor writes,
      // including empty pages. SQL transaction fencing is still required
      // to eliminate the remaining check/write race entirely.
      if (!(await isStillAuthorized(syncActor))) throw new Error("fudo_actor_revoked");
      const partial = nextPage !== 0;
      const seenAt = new Date().toISOString();
      if (snapshots.length) {
        const rows = snapshots.map((entry) => ({
          business_id: syncBusinessId, connection_generation: generation, provider: "fudo", resource_type: resource,
          external_id: entry.externalId, payload: entry.payload, content_hash: entry.contentHash,
          last_seen_cycle_id: cycleId,
          source_updated_at: entry.sourceUpdatedAt, last_seen_at: seenAt,
        }));
        const saved = await db.from("fudo_external_records")
          .upsert(rows, { onConflict: "business_id,connection_generation,resource_type,external_id" });
        if (saved.error) throw new Error("fudo_storage_failed");
      }
      counts[resource] = snapshots.length;
      const progress = await db.from("fudo_sync_progress").upsert({
        business_id: syncBusinessId, connection_generation: generation, resource_type: resource,
        next_page: nextPage, cycle_id: cycleId, cycle_started_at: cycleStartedAt,
        last_complete_at: partial ? null : seenAt, updated_at: seenAt,
      }, { onConflict: "business_id,connection_generation,resource_type" });
      if (progress.error) throw new Error("fudo_storage_failed");
      return partial;
    });
    if (!(await isStillAuthorized(syncActor))) throw new Error("fudo_actor_revoked");
    const hasPendingPages = pendingPages.some(Boolean);
    const status = hasPendingPages ? "partial" : "completed";
    const completed = new Date().toISOString();
    const [runUpdate, connUpdate] = await Promise.all([
      db.from("fudo_sync_runs").update({
        status, counts, error_code: null, finished_at: completed,
      }).eq("business_id", actor.businessId).eq("id", runId),
      db.from("fudo_connections").update({
        status: "connected", last_sync_status: status, last_synced_at: completed, last_error_code: null,
      }).eq("business_id", actor.businessId).eq("connection_generation", generation),
    ]);
    if (runUpdate.error || connUpdate.error) return fail("storage_unavailable", UNKNOWN);
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return { ok: true, message: hasPendingPages
      ? `Se importaron ${total} registros de esta tanda. Hay páginas pendientes: ejecutá otra sincronización para continuar.`
      : `Sincronización de esta tanda completada: ${total} registros leídos. No se modificaron ventas ni stock nativos.` };
  } catch (error) {
    const failure = safeFailure(error);
    if (runId && actor && db) {
      await db.from("fudo_sync_runs").update({
        status: "failed", counts, error_code: failure.ok ? null : failure.code, finished_at: new Date().toISOString(),
      }).eq("business_id", actor.businessId).eq("id", runId);
      // Always close the audit run for recovery, but do not change the
      // connection health on behalf of an actor whose rights were revoked.
      if (generation && !(error instanceof Error && error.message === "fudo_actor_revoked")) {
        await db.from("fudo_connections").update({
          last_sync_status: "failed", last_error_code: failure.ok ? null : failure.code,
        }).eq("business_id", actor.businessId).eq("connection_generation", generation);
      }
    }
    return failure;
  }
}
