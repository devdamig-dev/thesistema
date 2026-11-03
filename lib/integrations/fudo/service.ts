import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { FudoApiError, FudoClient, type FudoCredentials } from "./client";
import { encryptFudoCredentials, decryptFudoCredentials } from "./crypto";
import { FUDO_SYNC_PAGE_SIZE, FUDO_SYNC_RESOURCES, parseFudoPage } from "./snapshot";

export type FudoActionResult = { ok: true; message: string } | { ok: false; code: string; message: string };
export type FudoConnectionView = {
  configured: boolean;
  status: "disconnected" | "connected" | "error";
  lastTestedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: string | null;
  lastErrorCode: string | null;
  lastCounts: Record<string, number>;
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
      invalid_response: "La API de Fudo devolvió un formato inesperado. Revisá la versión de la integración.",
    };
    return fail(error.code, messages[error.code] ?? UNKNOWN);
  }
  if (error instanceof Error && error.message === "fudo_encryption_unavailable") {
    return fail("server_unconfigured", "La conexión segura todavía no está habilitada en GastroPilot.");
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
  const membership = await db.from("business_members").select("id")
    .eq("business_id", ctx.businessId).eq("user_id", ctx.userId).in("role", ["owner", "admin"]).maybeSingle();
  if (membership.error || !membership.data) return null;
  return { actor: { businessId: ctx.businessId, userId: ctx.userId }, db };
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
      configured: true, status: "disconnected",
      lastTestedAt: null, lastSyncedAt: null, lastSyncStatus: null, lastErrorCode: null, lastCounts: {},
    };
  }
  const lastRun = await db.from("fudo_sync_runs").select("counts")
    .eq("business_id", actor.businessId).eq("connection_generation", row.connection_generation).order("started_at", { ascending: false }).limit(1).maybeSingle();
  const rawCounts = lastRun.error ? null : lastRun.data?.counts;
  const counts: Record<string, number> = {};
  if (rawCounts && typeof rawCounts === "object" && !Array.isArray(rawCounts)) {
    for (const resource of FUDO_SYNC_RESOURCES) {
      const n = (rawCounts as Record<string, unknown>)[resource];
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) counts[resource] = n;
    }
  }
  return {
    configured: true,
    status: row.status === "connected" ? "connected" : "error",
    lastTestedAt: row.last_tested_at ?? null,
    lastSyncedAt: row.last_synced_at ?? null,
    lastSyncStatus: row.last_sync_status ?? null,
    lastErrorCode: row.last_error_code ?? null,
    lastCounts: counts,
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
    const running = await authorized.db.from("fudo_sync_runs").select("id").eq("business_id", authorized.actor.businessId).eq("status", "running").limit(1);
    if (running.error) return fail("storage_unavailable", UNKNOWN);
    if (running.data?.length) return fail("sync_running", "Hay una sincronización en curso; esperá antes de rotar credenciales.");
    const saved = await authorized.db.from("fudo_connections").upsert({
      business_id: authorized.actor.businessId, connection_generation: crypto.randomUUID(),
      credentials_ciphertext: encrypted, status: "connected",
      last_synced_at: null, last_sync_status: null,
      last_tested_at: new Date().toISOString(), last_error_code: null,
      updated_by: authorized.actor.userId, updated_at: new Date().toISOString(),
    }, { onConflict: "business_id" });
    if (saved.error) return fail("storage_unavailable", "No se pudo guardar la conexión cifrada. Verificá la migración Fudo.");
    return { ok: true, message: "Conexión validada y guardada. Fudo sigue siendo la fuente operativa; GastroPilot solo leerá datos." };
  } catch (error) { return safeFailure(error); }
}

export async function testStoredFudoConnection(): Promise<FudoActionResult> {
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "No tenés permiso para probar Fudo.");
    const { actor, db } = authorized;
    const stored = await db.from("fudo_connections").select("credentials_ciphertext")
      .eq("business_id", actor.businessId).maybeSingle();
    if (stored.error) return fail("storage_unavailable", UNKNOWN);
    if (!stored.data) return fail("not_connected", "Primero conectá Fudo.");
    const credentials = decryptFudoCredentials(actor.businessId, stored.data.credentials_ciphertext);
    try {
      await new FudoClient(credentials).testConnection();
      const updated = await db.from("fudo_connections").update({
        status: "connected", last_error_code: null, last_tested_at: new Date().toISOString(),
      }).eq("business_id", actor.businessId).eq("credentials_ciphertext", stored.data.credentials_ciphertext);
      if (updated.error) return fail("storage_unavailable", UNKNOWN);
      return { ok: true, message: "La consulta de lectura a productos Fudo respondió correctamente." };
    } catch (error) {
      const failure = safeFailure(error);
      await db.from("fudo_connections").update({
        status: "error", last_error_code: failure.ok ? null : failure.code, last_tested_at: new Date().toISOString(),
      }).eq("business_id", actor.businessId).eq("credentials_ciphertext", stored.data.credentials_ciphertext);
      return failure;
    }
  } catch (error) { return safeFailure(error); }
}

export async function disconnectFudo(): Promise<FudoActionResult> {
  try {
    const authorized = await authorize();
    if (!authorized) return fail("forbidden", "No tenés permiso para desconectar Fudo.");
    const { actor, db } = authorized;
    const running = await db.from("fudo_sync_runs").select("id").eq("business_id", actor.businessId)
      .eq("status", "running").limit(1);
    if (running.error) return fail("storage_unavailable", UNKNOWN);
    if (running.data?.length) return fail("sync_running", "Hay una sincronización en curso. Reintentá cuando termine.");
    const removed = await db.from("fudo_connections").delete().eq("business_id", actor.businessId);
    if (removed.error) return fail("storage_unavailable", UNKNOWN);
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
  let ciphertext: string | null = null;
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
    ciphertext = connection.data.credentials_ciphertext;
    generation = connection.data.connection_generation;
    const credentials = decryptFudoCredentials(actor.businessId, ciphertext);
    const client = new FudoClient(credentials);

    // Recover abandoned invocations, while unique partial index prevents concurrent runs.
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    await db.from("fudo_sync_runs").update({
      status: "failed", error_code: "interrupted", finished_at: new Date().toISOString(),
    }).eq("business_id", actor.businessId).eq("status", "running").lt("started_at", staleBefore);

    const created = await db.from("fudo_sync_runs").insert({
      business_id: actor.businessId, connection_generation: generation, status: "running", started_by: actor.userId,
    }).select("id").single();
    if (created.error) return fail(created.error.code === "23505" ? "sync_running" : "storage_unavailable",
      created.error.code === "23505" ? "Ya hay una sincronización activa de este negocio." : UNKNOWN);
    runId = created.data.id;
    let hasPendingPages = false;
    for (const resource of FUDO_SYNC_RESOURCES) {
      const cursor = await db.from("fudo_sync_progress").select("next_page")
        .eq("business_id", actor.businessId).eq("connection_generation", generation).eq("resource_type", resource).maybeSingle();
      if (cursor.error) throw new Error("fudo_storage_failed");
      const page = Number(cursor.data?.next_page || 1);
      const response = await client.list(resource, {
        "page[number]": page, "page[size]": FUDO_SYNC_PAGE_SIZE,
      });
      const snapshots = parseFudoPage(response);
      const seenAt = new Date().toISOString();
      if (snapshots.length) {
        const rows = snapshots.map((entry) => ({
          business_id: actor!.businessId, connection_generation: generation, provider: "fudo", resource_type: resource,
          external_id: entry.externalId, payload: entry.payload, content_hash: entry.contentHash,
          source_updated_at: entry.sourceUpdatedAt, last_seen_at: seenAt,
        }));
        const saved = await db.from("fudo_external_records")
          .upsert(rows, { onConflict: "business_id,connection_generation,resource_type,external_id" });
        if (saved.error) throw new Error("fudo_storage_failed");
      }
      counts[resource] = snapshots.length;
      const partial = snapshots.length === FUDO_SYNC_PAGE_SIZE;
      hasPendingPages ||= partial;
      const progress = await db.from("fudo_sync_progress").upsert({
        business_id: actor.businessId, connection_generation: generation, resource_type: resource,
        next_page: partial ? page + 1 : 1,
        last_complete_at: partial ? null : seenAt, updated_at: seenAt,
      }, { onConflict: "business_id,connection_generation,resource_type" });
      if (progress.error) throw new Error("fudo_storage_failed");
    }
    const status = hasPendingPages ? "partial" : "completed";
    const completed = new Date().toISOString();
    const [runUpdate, connUpdate] = await Promise.all([
      db.from("fudo_sync_runs").update({
        status, counts, error_code: null, finished_at: completed,
      }).eq("business_id", actor.businessId).eq("id", runId),
      db.from("fudo_connections").update({
        status: "connected", last_sync_status: status, last_synced_at: completed, last_error_code: null,
      }).eq("business_id", actor.businessId).eq("credentials_ciphertext", ciphertext),
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
      if (ciphertext) await db.from("fudo_connections").update({
        last_sync_status: "failed", last_error_code: failure.ok ? null : failure.code,
      }).eq("business_id", actor.businessId).eq("credentials_ciphertext", ciphertext);
    }
    return failure;
  }
}
