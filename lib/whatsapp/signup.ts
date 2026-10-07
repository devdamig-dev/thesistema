import type { ConnectionRecovery } from "./connection-recovery";

export type SignupMode = "business_app" | "cloud_api";
export type ConnectionActor = { userId: string; businessId: string; role: string };
export type PhoneChoice = {
  id: string;
  accountId: string;
  name: string;
  phone: string;
  selectable: boolean;
  reason: string | null;
};

export class ConnectionError extends Error {
  constructor(public code: string, message: string, public status = 400, public recovery?: ConnectionRecovery) {
    super(message);
    this.name = "ConnectionError";
  }
}

export const metaId = (value: unknown): value is string => typeof value === "string" && /^\d{5,30}$/.test(value);
export const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

export function authorizeConnectionActor(ctx: { isAuthenticated: boolean; userId: string | null; businessId: string | null; role: string }): ConnectionActor {
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId) throw new ConnectionError("authentication_required", "Iniciá sesión en el negocio para conectar WhatsApp.", 401);
  if (!["owner", "admin"].includes(ctx.role)) throw new ConnectionError("permission_denied", "Sólo una persona administradora del negocio puede conectar WhatsApp.", 403);
  return { userId: ctx.userId, businessId: ctx.businessId, role: ctx.role };
}

export type PrepareRequest = { action: "prepare"; mode: SignupMode; code: string; wabaId?: string; phoneNumberId?: string };
export type ConnectRequest = { action: "connect"; sessionId: string; phoneNumberId: string };
export type CancelRequest = { action: "cancel"; sessionId: string };
export function parseConnectionRequest(input: unknown): PrepareRequest | ConnectRequest | CancelRequest {
  const body = record(input);
  const fail = () => { throw new ConnectionError("invalid_request", "La solicitud de conexión no es válida. Volvé a iniciar el proceso."); };
  const only = (keys: string[]) => { if (Object.keys(body).some(key => !keys.includes(key))) fail(); };
  if (body.action === "prepare") {
    only(["action", "mode", "code", "wabaId", "phoneNumberId"]);
    if (body.mode !== "business_app" && body.mode !== "cloud_api") return fail();
    if (typeof body.code !== "string" || !body.code.trim() || body.code.length > 8192) return fail();
    if (body.wabaId !== undefined && !metaId(body.wabaId)) return fail();
    if (body.phoneNumberId !== undefined && !metaId(body.phoneNumberId)) return fail();
    return { action: "prepare", mode: body.mode, code: body.code.trim(), ...(body.wabaId ? { wabaId: body.wabaId as string } : {}), ...(body.phoneNumberId ? { phoneNumberId: body.phoneNumberId as string } : {}) };
  }
  if (body.action === "connect" || body.action === "cancel") {
    only(body.action === "connect" ? ["action", "sessionId", "phoneNumberId"] : ["action", "sessionId"]);
    if (typeof body.sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.sessionId)) return fail();
    if (body.action === "cancel") return { action: "cancel", sessionId: body.sessionId };
    if (!metaId(body.phoneNumberId)) return fail();
    return { action: "connect", sessionId: body.sessionId, phoneNumberId: body.phoneNumberId };
  }
  return fail();
}

/** In v4 the saved Meta configuration selects products/Coexistence, not legacy featureType flags. */
export function signupOptions(configId: string) {
  if (!metaId(configId)) throw new ConnectionError("configuration_invalid", "La conexión de Meta necesita una revisión de configuración.");
  return { config_id: configId, response_type: "code", override_default_response_type: true, extras: {} };
}

export type SignupEvent = { kind: "finish"; accountId?: string; phoneNumberId?: string } | { kind: "cancel" | "error" };
export function parseSignupEvent(origin: string, input: unknown): SignupEvent | null {
  if (!["https://www.facebook.com", "https://web.facebook.com"].includes(origin)) return null;
  let raw = input;
  if (typeof raw === "string") {
    if (raw.length > 65536) return null;
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  const event = record(raw);
  if (event.type !== "WA_EMBEDDED_SIGNUP") return null;
  if (event.event === "CANCEL") return { kind: "cancel" };
  if (event.event === "ERROR") return { kind: "error" };
  if (!["FINISH", "FINISH_ONLY_WABA", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING", "FINISH_GRANT_ONLY_API_ACCESS"].includes(String(event.event))) return null;
  const data = record(event.data);
  const accountId = data.waba_id ?? data.wabaId;
  const phoneNumberId = data.phone_number_id ?? data.phoneNumberId;
  if (accountId !== undefined && !metaId(accountId)) return null;
  if (phoneNumberId !== undefined && !metaId(phoneNumberId)) return null;
  return { kind: "finish", ...(metaId(accountId) ? { accountId } : {}), ...(metaId(phoneNumberId) ? { phoneNumberId } : {}) };
}

export function sameOrigin(requestUrl: string, origin: string | null): boolean {
  if (!origin) return false;
  try { return new URL(requestUrl).origin === new URL(origin).origin && origin === new URL(origin).origin; } catch { return false; }
}
