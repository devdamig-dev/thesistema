/** Browser-reported troubleshooting metadata, never authorization evidence.
 * Deliberately excludes error_message, tokens, phone numbers and raw payloads. */
export type SignupDiagnostic = {
  providerEvent: "CANCEL" | "ERROR";
  errorCode?: string;
  sessionReference?: string;
  reportedAt?: number;
};
const reference = /^(?:[a-f0-9]{12,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
const errorCode = /^[1-9][0-9]{0,8}$/;
const validTime = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 946684800 && value < 4102444800;

export function diagnosticFromMeta(providerEvent: "CANCEL" | "ERROR", data: Record<string, unknown>): SignupDiagnostic {
  const result: SignupDiagnostic = { providerEvent };
  const code = typeof data.error_code === "number" || typeof data.error_code === "string" ? String(data.error_code) : "";
  if (errorCode.test(code)) result.errorCode = code;
  if (typeof data.session_id === "string" && reference.test(data.session_id)) result.sessionReference = data.session_id;
  const time = typeof data.timestamp === "string" && /^[0-9]{9,10}$/.test(data.timestamp) ? Number(data.timestamp) : data.timestamp;
  if (validTime(time)) result.reportedAt = time;
  return result;
}

/** Strict API boundary: reject unknown/free-text fields instead of persisting them. */
export function parseSignupDiagnostic(input: unknown): SignupDiagnostic | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !["providerEvent", "errorCode", "sessionReference", "reportedAt"].includes(key))) return null;
  if (data.providerEvent !== "CANCEL" && data.providerEvent !== "ERROR") return null;
  if (data.errorCode !== undefined && (typeof data.errorCode !== "string" || !errorCode.test(data.errorCode))) return null;
  if (data.sessionReference !== undefined && (typeof data.sessionReference !== "string" || !reference.test(data.sessionReference))) return null;
  if (data.reportedAt !== undefined && !validTime(data.reportedAt)) return null;
  return { providerEvent: data.providerEvent, ...(data.errorCode !== undefined ? { errorCode: data.errorCode as string } : {}), ...(data.sessionReference !== undefined ? { sessionReference: data.sessionReference as string } : {}), ...(data.reportedAt !== undefined ? { reportedAt: data.reportedAt as number } : {}) };
}

export function signupFailureMessage(diagnostic: SignupDiagnostic): string {
  const code = diagnostic.errorCode ? ` (código ${diagnostic.errorCode})` : "";
  return `Meta informó un error durante la conexión${code}. Esto no demuestra que tu WhatsApp sea incompatible: debemos comprobar el permiso para compartirlo con nuestra aplicación. No borres ni desvincules el número.`;
}
