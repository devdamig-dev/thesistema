import type { FudoResourcePreflight } from "./service";
import { FUDO_SYNC_RESOURCES } from "./snapshot";

/**
 * UI boundary for Fudo O1 server actions.
 *
 * A rejected action (network interruption, expired session or server transport
 * failure) must not leave the owner/admin without feedback or surface the raw
 * exception, which could contain provider data. Never log the thrown value.
 */
export type FudoUiActionResult = { ok: boolean; message: string };

const UNAVAILABLE = "No se pudo completar la solicitud a GastroPilot. Revisá tu conexión e intentá nuevamente.";

export async function runFudoActionSafely(
  action: () => Promise<FudoUiActionResult>,
): Promise<FudoUiActionResult> {
  try {
    const result = await action();
    // Treat unexpected server action responses as failure, not silent success
    // or React render crashes. Only use the server's already-sanitized copy.
    if (!result || typeof result.ok !== "boolean"
      || typeof result.message !== "string" || !result.message.trim()) {
      return { ok: false, message: UNAVAILABLE };
    }
    return result;
  } catch {
    return { ok: false, message: UNAVAILABLE };
  }
}


/** The server, not a browser message parser, decides whether another page exists. */
export const FUDO_SYNC_UI_BATCH_LIMIT = 5;
export type FudoUiSyncOutcome = {
  ok: boolean;
  message: string;
  completedBatches: number;
  hasMorePages: boolean;
};

/**
 * Continue the idempotent read-only sync through at most five separate
 * authenticated Server Actions. Never retry a rejected/ambiguous action:
 * the caller may not know whether its transaction committed. The durable
 * PostgreSQL cursor remains the source of truth for the next manual attempt.
 * This is foreground work, not an unbounded background job.
 */
export async function runFudoSyncBatches(
  action: () => Promise<FudoUiActionResult & { hasMorePages?: boolean }>,
  batchLimit: number = FUDO_SYNC_UI_BATCH_LIMIT,
): Promise<FudoUiSyncOutcome> {
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > FUDO_SYNC_UI_BATCH_LIMIT) {
    return { ok: false, message: UNAVAILABLE, completedBatches: 0, hasMorePages: false };
  }
  let completedBatches = 0;
  while (completedBatches < batchLimit) {
    const result = await runFudoActionSafely(action);
    if (!result.ok) {
      return { ok: false, message: result.message, completedBatches, hasMorePages: false };
    }
    // A string in the response, or a missing continuation flag, cannot
    // authorize another API call. Do not parse human-readable success copy.
    const syncResult = result as FudoUiActionResult & { hasMorePages?: unknown };
    if (typeof syncResult.hasMorePages !== "boolean") {
      return { ok: false, message: UNAVAILABLE, completedBatches, hasMorePages: false };
    }
    completedBatches++;
    if (!syncResult.hasMorePages) {
      return {
        ok: true,
        message: `Se completó la lectura del ciclo en ${completedBatches} tanda(s). Falta conciliar los datos con Fudo real para aprobar el piloto.`,
        completedBatches,
        hasMorePages: false,
      };
    }
  }
  return {
    ok: true,
    message: `Se importaron ${completedBatches} tandas de lectura. Quedan páginas pendientes; volvé a sincronizar para continuar.`,
    completedBatches,
    hasMorePages: true,
  };
}

/**
 * Permission diagnostics carry five structured resource checks in addition to
 * the generic action feedback. A malformed Server Action payload must not be
 * stored as "available": readiness would otherwise render invalid checks (or
 * throw when checks is absent), despite no trustworthy diagnostic result.
 */

const FUDO_PROBE_CODES = new Set([
  "available", "invalid_credentials", "forbidden", "rate_limited",
  "provider_unavailable", "api_unavailable", "invalid_response",
]);

export async function runFudoPreflightSafely(
  action: () => Promise<FudoResourcePreflight>,
): Promise<FudoResourcePreflight> {
  const result = await runFudoActionSafely(action);
  const checks = (result as Partial<FudoResourcePreflight>).checks;
  const invalid = { ok: false, message: UNAVAILABLE, checks: [] };
  if (!Array.isArray(checks) || checks.length > FUDO_SYNC_RESOURCES.length) return invalid;

  const seen = new Set<string>();
  for (const check of checks) {
    if (!check || typeof check !== "object"
      || typeof check.resource !== "string"
      || !FUDO_SYNC_RESOURCES.some((resource) => resource === check.resource)
      || typeof check.code !== "string" || !FUDO_PROBE_CODES.has(check.code)
      || seen.has(check.resource)) return invalid;
    seen.add(check.resource);
  }
  // A success claim is only credible when every O1 resource was checked.
  // Partial diagnostics are valid only as failures with individual safe codes.
  if (result.ok && (checks.length !== FUDO_SYNC_RESOURCES.length
    || checks.some((check) => check.code !== "available"))) return invalid;

  // Keep the server-side credential revision all the way through the action
  // feedback boundary. Dropping it would make every real five-resource probe
  // appear stale in the UI, even when its source was unchanged.
  const revision = (result as Partial<FudoResourcePreflight>).connectionRevision;
  if (revision !== undefined && (typeof revision !== "string"
    || !/^[a-f0-9]{64}$/.test(revision))) return invalid;

  return {
    ok: result.ok, message: result.message, checks,
    ...(revision === undefined ? {} : { connectionRevision: revision }),
  };
}
