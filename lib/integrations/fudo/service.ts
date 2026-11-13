import { createHash, randomUUID } from "node:crypto";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { FudoApiError, FudoClient, type FudoCredentials, type FudoReadResourceStatus } from "./client";
import { encryptFudoCredentials, decryptFudoCredentials } from "./crypto";
import { FUDO_SYNC_PAGE_SIZE, FUDO_SYNC_RESOURCES, nextFudoPage, parseFudoPage } from "./snapshot";
import { runFudoReadBatch } from "./read-batch";

export type FudoActionResult = { ok: true; message: string; hasMorePages?: boolean } | { ok: false; code: string; message: string };
export type FudoResourcePreflight = {
  ok: boolean;
  message: string;
  checks: FudoReadResourceStatus[];
  /** Server-derived revision of the actual credential generation probed, never a UI guess. */
  connectionRevision?: string;
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
  /** Opaque user/business binding for lifecycle actions, including disconnected views. */
  businessRevision?: string;
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

/** Bind a diagnostic to the exact tenant, credential generation and last retest. */
function revisionForFudoConnection(
  actor: Actor, generation: string, status: string, lastTestedAt: string | null,
): string {
  return createHash("sha256")
    .update(JSON.stringify([actor.businessId, generation, status, lastTestedAt]))
    .digest("hex");
}

/** Bind browser lifecycle operations to the business actually rendered, even before Fudo is connected.
 * This is a stale-tab fence, NOT an authorization token: every action still checks role and membership.
 */
function businessRevisionForFudoActor(actor: Actor): string {
  return createHash("sha256")
    .update(JSON.stringify(["fudo-business-scope-v1", actor.userId, actor.businessId]))
    .digest("hex");
}

function matchesFudoBusinessRevision(actor: Actor, expected?: string): boolean {
  return expected === undefined || (
    typeof expected === "string" && /^[a-f0-9]{64}$/.test(expected)
    && expected === businessRevisionForFudoActor(actor)
  );
}

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
  if (error instanceof Error && error.message === "fudo_connection_changed") {
    return fail("connection_changed", "La conexión Fudo cambió. Actualizá la pantalla y reintentá.");
  }
  if (error instanceof Error && error.message === "fudo_duplicate_in_cycle") {
    return fail("invalid_response", "Fudo repitió un identificador en páginas distintas del mismo recurso. La lectura se detuvo para evitar una conciliación incorrecta.");
  }
  if (error instanceof Error && error.message === "fudo_sync_page_rejected") {
    return fail("sync_conflict", "La sincronización cambió durante la lectura. Actualizá y reintentá.");
  }
  if (error instanceof Error && error.message === "fudo_ciphertext_invalid") {
    return fail("invalid_stored_credentials", "No se pudo leer la conexión cifrada. Volvé a vincular Fudo.");
  }
  if (error instanceof Error && error.message === "invalid_fudo_page") {
    // A malformed continuation or a short page without a verifiable end marker
    // cannot certify a complete Fudo scan. Do not mislabel pagination as a
    // malformed business record or expose provider links/records in feedback.
    return fail("invalid_response", "Fudo devolvió paginación no verificable. Se frenó la lectura de ese recurso para evitar saltos u omisiones; revisá la compatibilidad de la API antes de continuar.");
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
    // Even an empty configuration view must not escape after a concurrent
    // role revocation, profile deactivation or server-side tenant switch.
    if (!(await isStillAuthorized(actor))) return null;
    return {
      configured: true, businessRevision: businessRevisionForFudoActor(actor),
      connectionRevision: null, status: "disconnected",
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
        if (typeof n === "number" && Number.isSafeInteger(n) && n >= 0) result[resource] = n;
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
  // PostgREST can return a null count without a row-level error. Unknown,
  // fractional or unsafe totals are NOT an observed zero; omit them so the
  // private pilot worksheet says "No verificable" instead of false parity.
  const importedCounts: Record<string, number> = {};
  FUDO_SYNC_RESOURCES.forEach((resource, index) => {
    const count: unknown = countResults[index].count;
    if (typeof count === "number" && Number.isSafeInteger(count) && count >= 0) {
      importedCounts[resource] = count;
    }
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
    seenThisCycleCounts[resource] = typeof seen === "number"
      && Number.isSafeInteger(seen) && seen >= 0 ? seen : null;
    // An unavailable historical total or cycle count cannot prove absences.
    // Never replace an unknown metric with zero when estimating removals.
    const historical = importedCounts[resource];
    const currentCycle = seenThisCycleCounts[resource];
    possiblyMissingCounts[resource] = latestRunSettled && nextPages[resource] === 0
      && typeof historical === "number" && typeof currentCycle === "number"
      ? Math.max(0, historical - currentCycle) : null;
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
  // Aggregates are read through the privileged service role. A revoked
  // administrator or a switched session must not receive those results, even
  // when connection metadata and the latest run did not change.
  if (!(await isStillAuthorized(actor))) return null;
  return {
    configured: true,
    businessRevision: businessRevisionForFudoActor(actor),
    // Never reuse green checks after switching businesses with an identical
    // status and timestamp. Do not expose raw tenant or generation identifiers.
    connectionRevision: revisionForFudoConnection(
      actor, generation, revision.status, revision.lastTestedAt,
    ),
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

export async function connectFudo(
  input: FudoCredentials,
  expectedBusinessRevision?: string,
  expectedConnectionRevision?: string | null,
): Promise<FudoActionResult> {
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "Necesitás ingresar como owner o administrador del negocio.");
    // A stale A tab must not save A's entered credentials under newly selected business B.
    if (!matchesFudoBusinessRevision(authorized.actor, expectedBusinessRevision)) {
      return fail("connection_changed", "Cambiaste de negocio desde que abriste la pantalla. Actualizá y reintentá.");
    }
    // Snapshot the exact connection the owner/admin saw before making a
    // potentially slow Fudo request. The UI sends an opaque revision (or null
    // for a disconnected form), NEVER a raw generation UUID.
    const before = await authorized.db.from("fudo_connections")
      .select("connection_generation,status,last_tested_at")
      .eq("business_id", authorized.actor.businessId).maybeSingle();
    if (before.error) return fail("storage_unavailable", UNKNOWN);
    const expectedGeneration: string | null = before.data?.connection_generation ?? null;
    const expectedTestedAt: string | null = before.data?.last_tested_at ?? null;
    const currentRevision = before.data
      ? revisionForFudoConnection(
          authorized.actor, expectedGeneration!, before.data.status, expectedTestedAt,
        )
      : null;
    if (expectedConnectionRevision !== undefined && expectedConnectionRevision !== currentRevision) {
      return fail("connection_changed", "La conexión Fudo cambió desde que abriste la pantalla. Actualizá y reintentá.");
    }
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
    // The SQL RPC rechecks generation + retest timestamp under the business
    // transaction lock. A late successful probe cannot resurrect a disconnected
    // account or overwrite another admin's newer credential rotation.
    const saved = await authorized.db.rpc("fudo_replace_connection_guarded", {
      p_business_id: authorized.actor.businessId, p_actor_id: authorized.actor.userId,
      p_ciphertext: encrypted,
      p_expected_generation: expectedGeneration,
      p_expected_last_tested_at: expectedTestedAt,
    });
    if (saved.error) return fail("storage_unavailable", "No se pudo guardar la conexión cifrada. Verificá la migración Fudo.");
    if (saved.data === "forbidden") return fail("forbidden", "Tu acceso al negocio cambió. Volvé a ingresar.");
    if (saved.data === "sync_running") return fail("sync_running", "Hay una sincronización en curso; esperá antes de rotar credenciales.");
    if (saved.data === "connection_changed") {
      return fail("connection_changed", "La conexión Fudo cambió mientras validábamos las credenciales. Actualizá y reintentá.");
    }
    if (saved.data !== "connected") return fail("storage_unavailable", UNKNOWN);
    return { ok: true, message: "Conexión validada y guardada. Fudo sigue siendo la fuente operativa; GastroPilot solo leerá datos." };
  } catch (error) { return safeFailure(error); }
}

export async function testStoredFudoConnection(expectedBusinessRevision?: string): Promise<FudoActionResult> {
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "No tenés permiso para probar Fudo.");
    if (!matchesFudoBusinessRevision(authorized.actor, expectedBusinessRevision)) {
      return fail("connection_changed", "Cambiaste de negocio desde que abriste la pantalla. Actualizá y reintentá.");
    }
    const { actor, db } = authorized;
    const stored = await db.from("fudo_connections").select("credentials_ciphertext,connection_generation,last_tested_at")
      .eq("business_id", actor.businessId).maybeSingle();
    if (stored.error) return fail("storage_unavailable", UNKNOWN);
    if (!stored.data) return fail("not_connected", "Primero conectá Fudo.");
    const credentials = decryptFudoCredentials(actor.businessId, stored.data.credentials_ciphertext);
    const generation: string = stored.data.connection_generation;
    const testedAtStart: string | null = stored.data.last_tested_at ?? null;
    // A concurrent rotation, retest or role revocation can finish while the
    // provider GET is pending. SQL must fence both membership and the exact
    // generation/test revision in the SAME transaction as the metadata write.
    // No ciphertext enters PostgREST filters, RPC arguments or logs.
    let providerFailure: FudoActionResult | null = null;
    try {
      await new FudoClient(credentials).testConnection();
    } catch (error) {
      providerFailure = safeFailure(error);
    }
    if (!(await isStillAuthorized(actor))) {
      return fail("forbidden", "Tu acceso al negocio cambió durante la prueba. Volvé a ingresar.");
    }

    const recorded = await db.rpc("fudo_record_connection_test", {
      p_business_id: actor.businessId,
      p_expected_generation: generation,
      p_actor_id: actor.userId,
      p_expected_last_tested_at: testedAtStart,
      p_status: providerFailure ? "error" : "connected",
      p_error_code: providerFailure && !providerFailure.ok ? providerFailure.code : null,
    });
    if (recorded.error) return fail("storage_unavailable", UNKNOWN);
    if (recorded.data === "forbidden") {
      return fail("forbidden", "Tu acceso al negocio cambió durante la prueba. Volvé a ingresar.");
    }
    if (recorded.data === "connection_changed") {
      return fail("connection_changed", "La conexión Fudo cambió durante la prueba. Volvé a probar las credenciales actuales.");
    }
    if (recorded.data !== "recorded") return fail("storage_unavailable", UNKNOWN);
    if (providerFailure) return providerFailure;
    return { ok: true, message: "La consulta de lectura a productos Fudo respondió correctamente." };
  } catch (error) { return safeFailure(error); }
}

/**
 * Pilot readiness check: five lightweight read-only GETs, one for each resource
 * required for O1. This never persists provider payloads or mutates sync state.
 * Only the authenticated business owner/admin sees sanitized resource outcomes.
 */
export async function inspectFudoReadPermissions(expectedBusinessRevision?: string): Promise<FudoResourcePreflight> {
  try {
    const authorized = await authorize();
    if (!authorized) {
      return { ok: false, message: "Necesitás ser owner o administrador del negocio.", checks: [] };
    }
    if (!matchesFudoBusinessRevision(authorized.actor, expectedBusinessRevision)) {
      return { ok: false, message: "Cambiaste de negocio desde que abriste la pantalla. Actualizá y reintentá.", checks: [] };
    }
    const { actor, db } = authorized;
    const stored = await db.from("fudo_connections")
      .select("credentials_ciphertext,connection_generation,status,last_tested_at")
      .eq("business_id", actor.businessId).maybeSingle();
    if (stored.error) return { ok: false, message: UNKNOWN, checks: [] };
    if (!stored.data) return { ok: false, message: "Primero conectá Fudo.", checks: [] };
    // A failed credential retest marks this connection as error. Do not issue
    // another five provider GETs with unvalidated credentials or present fresh
    // green probes for a connection explicitly blocked by the last retest.
    // The owner/admin must first recover it through "Probar conexión".
    if (stored.data.status !== "connected") {
      return { ok: false, message: "La conexión Fudo requiere un test exitoso antes de revisar permisos.", checks: [] };
    }
    const generation: unknown = stored.data.connection_generation;
    if (typeof generation !== "string" || !generation) {
      return { ok: false, message: UNKNOWN, checks: [] };
    }
    // Copy primitive metadata before external calls; PostgREST results can be
    // replaced by another owner/admin's retest while these five GETs run.
    const statusAtStart: string = stored.data.status;
    const testedAtStart: string | null = stored.data.last_tested_at ?? null;
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
    // The privileged connection reread above is asynchronous: a role can be
    // revoked or the active business can change *during that final query*.
    // The earlier recheck after Fudo GETs is not sufficient to publish checks.
    if (!(await isStillAuthorized(actor))) {
      return { ok: false, message: "Tu acceso al negocio cambió durante la revisión. Volvé a ingresar.", checks: [] };
    }
    const available = checks.filter((item) => item.code === "available").length;
    return {
      ok: available === FUDO_SYNC_RESOURCES.length,
      message: available === FUDO_SYNC_RESOURCES.length
        ? "Los cinco recursos respondieron con datos compatibles. Falta conciliar la importación real."
        : `Acceso de lectura confirmado en ${available} de ${FUDO_SYNC_RESOURCES.length} recursos. Revisá permisos y disponibilidad antes de sincronizar.`,
      checks,
      // The UI can be stale while another admin rotates/retests before this
      // request begins. Return the revision actually verified server-side, not
      // one captured from the browser's older render.
      connectionRevision: revisionForFudoConnection(actor, generation, statusAtStart, testedAtStart),
    };
  } catch (error) {
    // Global auth or ciphertext failures produce no fake per-resource success.
    const result = safeFailure(error);
    return { ok: false, message: result.message, checks: [] };
  }
}

export async function disconnectFudo(
  expectedBusinessRevision?: string,
  expectedConnectionRevision?: string,
): Promise<FudoActionResult> {
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "No tenés permiso para desconectar Fudo.");
    if (!matchesFudoBusinessRevision(authorized.actor, expectedBusinessRevision)) {
      return fail("connection_changed", "Cambiaste de negocio desde que abriste la pantalla. Actualizá y reintentá.");
    }
    // Disconnect is destructive for the integration: never apply a stale tab's
    // confirmation to credentials rotated or retested by another administrator.
    if (typeof expectedConnectionRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedConnectionRevision)) {
      return fail("connection_changed", "La conexión Fudo cambió. Actualizá la pantalla antes de desconectar.");
    }
    const { actor, db } = authorized;
    const before = await db.from("fudo_connections")
      .select("connection_generation,status,last_tested_at")
      .eq("business_id", actor.businessId).maybeSingle();
    if (before.error) return fail("storage_unavailable", UNKNOWN);
    if (!before.data) return fail("connection_changed", "La conexión Fudo ya no está disponible. Actualizá la pantalla.");
    const generation: string = before.data.connection_generation;
    const lastTestedAt: string | null = before.data.last_tested_at ?? null;
    if (expectedConnectionRevision !== revisionForFudoConnection(
      actor, generation, before.data.status, lastTestedAt,
    )) {
      return fail("connection_changed", "La conexión Fudo cambió desde que abriste la pantalla. Actualizá y reintentá.");
    }
    // The same business-level lock protects disconnect, rotation, retest and
    // sync. SQL compares the observed generation/test revision INSIDE the
    // transaction before deleting ciphertext, closing the preflight/write race.
    const removed = await db.rpc("fudo_disconnect_connection_guarded", {
      p_business_id: actor.businessId, p_actor_id: actor.userId,
      p_expected_generation: generation, p_expected_last_tested_at: lastTestedAt,
    });
    if (removed.error) return fail("storage_unavailable", "No se pudo desconectar Fudo. Verificá la migración de seguridad.");
    if (removed.data === "forbidden") return fail("forbidden", "Tu acceso al negocio cambió. Volvé a ingresar.");
    if (removed.data === "sync_running") return fail("sync_running", "Hay una sincronización en curso. Reintentá cuando termine.");
    if (removed.data === "connection_changed") {
      return fail("connection_changed", "La conexión Fudo cambió mientras confirmabas la desconexión. Actualizá y reintentá.");
    }
    if (removed.data !== "disconnected") return fail("storage_unavailable", UNKNOWN);
    return { ok: true, message: "Se eliminaron las credenciales. Se conserva la importación histórica para auditoría interna; no habrá nuevas consultas a Fudo." };
  } catch (error) { return safeFailure(error); }
}

/**
 * Bounded, resumable import. One page per resource per invocation. Upserts replace
 * the same external record but never insert into native sales/stock/order tables.
 * A cursor is only advanced after the whole page has been stored.
 */
export async function syncFudoReadOnly(expectedConnectionRevision?: string): Promise<FudoActionResult> {
  let runId: string | null = null;
  let actor: Actor | null = null;
  let db: any;
  let generation: string | null = null;
  const counts: Record<string, number> = {};
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "No tenés permiso para sincronizar Fudo.");
    ({ actor, db } = authorized);
    const connection = await db.from("fudo_connections")
      .select("credentials_ciphertext,connection_generation,status,last_tested_at")
      .eq("business_id", actor.businessId).maybeSingle();
    if (connection.error) return fail("storage_unavailable", UNKNOWN);
    if (!connection.data) return fail("not_connected", "Conectá Fudo antes de sincronizar.");
    generation = connection.data.connection_generation;
    // The foreground UI can issue up to five consecutive Server Actions.
    // A tenant switch in another tab or a concurrent credential rotation/retest
    // must not silently redirect a later batch to the newly selected business.
    // The browser passes only an opaque revision; the server derives tenant
    // and generation from the authenticated session and its own database row.
    // Older server-side callers omit this guard, but all browser sync actions
    // require a revision. SQL still fences generation and membership at commit.
    if (expectedConnectionRevision !== undefined &&
      (typeof expectedConnectionRevision !== "string"
        || !/^[a-f0-9]{64}$/.test(expectedConnectionRevision)
        || connection.data.status !== "connected"
        || expectedConnectionRevision !== revisionForFudoConnection(
          actor, generation!, connection.data.status, connection.data.last_tested_at ?? null,
        ))) {
      return fail("connection_changed", "La conexión o el negocio activo cambió. Actualizá y reintentá la lectura.");
    }
    const encryptedConnection: string = connection.data.credentials_ciphertext;
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
    // fudo_begin_sync atomically starts the run AND resets completed
    // five-resource cursors under the live owner/admin tenant lock.
    // Do not delete cursors from application code: a revoked actor could
    // otherwise reset a finished scan after the SQL authorization check.
    if (!(await isStillAuthorized(authorized.actor))) throw new Error("fudo_actor_revoked");
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
      // One PostgreSQL transaction validates the live actor + generation +
      // running import + expected page, then persists snapshots AND cursor.
      // A TypeScript preflight alone leaves a revocation/check-write race.
      const saved = await db.rpc("fudo_commit_sync_page", {
        p_business_id: syncBusinessId,
        p_expected_generation: generation,
        p_actor_id: syncActor.userId,
        p_run_id: runId,
        p_resource_type: resource,
        p_expected_page: page,
        p_next_page: nextPage,
        p_cycle_id: cycleId,
        p_cycle_started_at: cycleStartedAt,
        p_rows: snapshots.map((entry) => ({
          external_id: entry.externalId,
          payload: entry.payload,
          content_hash: entry.contentHash,
          source_updated_at: entry.sourceUpdatedAt,
        })),
      });
      if (saved.error) throw new Error("fudo_storage_failed");
      if (saved.data?.code === "forbidden") throw new Error("fudo_actor_revoked");
      if (saved.data?.code === "connection_changed") throw new Error("fudo_connection_changed");
      if (saved.data?.code === "duplicate_in_cycle") throw new Error("fudo_duplicate_in_cycle");
      if (saved.data?.code !== "saved") throw new Error("fudo_sync_page_rejected");
      counts[resource] = snapshots.length;
      return partial;
    });
    if (!(await isStillAuthorized(syncActor))) throw new Error("fudo_actor_revoked");
    const hasPendingPages = pendingPages.some(Boolean);
    const status = hasPendingPages ? "partial" : "completed";
    // The run result and connection health must commit atomically. Re-check
    // owner/admin and generation inside SQL to close the final auth/write race.
    const finalized = await db.rpc("fudo_finish_sync", {
      p_business_id: syncBusinessId,
      p_expected_generation: generation,
      p_actor_id: syncActor.userId,
      p_run_id: runId,
      p_status: status,
      p_counts: counts,
      p_error_code: null,
      p_update_connection: true,
    });
    if (finalized.error) throw new Error("fudo_storage_failed");
    if (finalized.data?.code === "forbidden") throw new Error("fudo_actor_revoked");
    if (finalized.data?.code === "connection_changed") throw new Error("fudo_connection_changed");
    if (finalized.data?.code !== "finished") throw new Error("fudo_storage_failed");
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    return { ok: true, hasMorePages: hasPendingPages, message: hasPendingPages
      ? `Se importaron ${total} registros de esta tanda. Hay páginas pendientes: ejecutá otra sincronización para continuar.`
      : `Sincronización de esta tanda completada: ${total} registros leídos. No se modificaron ventas ni stock nativos.` };
  } catch (error) {
    const failure = safeFailure(error);
    if (runId && actor && db && generation) {
      // Always close the audit run after a failure, even if the actor was
      // revoked, but NEVER rewrite connection health for that revoked actor.
      // If SQL is unavailable, stale-run recovery remains the fallback.
      const actorChanged = error instanceof Error &&
        (error.message === "fudo_actor_revoked" || error.message === "fudo_connection_changed");
      try {
        await db.rpc("fudo_finish_sync", {
          p_business_id: actor.businessId,
          p_expected_generation: generation,
          p_actor_id: actor.userId,
          p_run_id: runId,
          p_status: "failed",
          p_counts: counts,
          p_error_code: failure.ok ? null : failure.code,
          p_update_connection: !actorChanged,
        });
      } catch {
        // A later authorized request will recover an abandoned run.
      }
    }
    return failure;
  }
}
