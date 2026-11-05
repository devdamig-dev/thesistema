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

/**
 * Permission diagnostics carry five structured resource checks in addition to
 * the generic action feedback. A malformed Server Action payload must not be
 * stored as "available": readiness would otherwise render invalid checks (or
 * throw when checks is absent), despite no trustworthy diagnostic result.
 */
import type { FudoResourcePreflight } from "./service";
import { FUDO_SYNC_RESOURCES } from "./snapshot";

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

  return { ok: result.ok, message: result.message, checks };
}
