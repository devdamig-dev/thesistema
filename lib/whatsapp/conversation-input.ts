import { record, ConnectionError } from "./signup";
export type ConversationInput = { memberId: string; branchId: string | null; enabled: boolean; phone: string; confirmed: true };
export function parseConversationInput(value: unknown): ConversationInput {
  const body = record(value);
  const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if (Object.keys(body).some(key => !["memberId", "branchId", "enabled", "phone", "confirmed"].includes(key)) || !uuid(body.memberId) || (body.branchId !== null && !uuid(body.branchId)) || typeof body.enabled !== "boolean" || body.confirmed !== true || typeof body.phone !== "string" || !/^\+?[0-9 ()-]{8,30}$/.test(body.phone)) throw new ConnectionError("invalid_conversation", "Revisá la persona, su teléfono con código de país y la confirmación de la autorización.");
  const phone = body.phone.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(phone)) throw new ConnectionError("invalid_phone", "Ingresá el teléfono completo con código de país, sin el prefijo 00.");
  return { memberId: body.memberId as string, branchId: body.branchId as string | null, enabled: body.enabled, phone, confirmed: true };
}
