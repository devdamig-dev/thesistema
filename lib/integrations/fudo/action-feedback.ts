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
