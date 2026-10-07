import { randomUUID } from "node:crypto";
import { ConnectionError, type ConnectionActor, type PhoneChoice, type PrepareRequest, type SignupMode } from "./signup";
import type { GraphPhone, TokenInfo } from "./graph";

export type SignupSession = {
  id: string; business_id: string; user_id: string; mode: SignupMode;
  access_token: string | null; token_expires_at: string | null;
  choices: PhoneChoice[]; expires_at: string; claimed_at: string | null; consumed_at: string | null;
};
export interface ConnectionStore {
  create(session: SignupSession): Promise<void>;
  get(id: string, actor: ConnectionActor): Promise<SignupSession | null>;
  claim(id: string, actor: ConnectionActor): Promise<boolean>;
  discard(id: string, actor: ConnectionActor): Promise<void>;
  persist(id: string, actor: ConnectionActor, phone: GraphPhone): Promise<void>;
  assertAvailable(actor: ConnectionActor, phoneId: string): Promise<void>;
}
export interface ConnectionGraph {
  exchange(code: string): Promise<TokenInfo>;
  validateToken(token: string): Promise<TokenInfo>;
  phones(accountId: string, token: string, mode: SignupMode): Promise<GraphPhone[]>;
  assertWebhook(): Promise<void>;
  subscribe(accountId: string, token: string): Promise<void>;
}
const safeChoice = (phone: GraphPhone): PhoneChoice => ({ id: phone.id, accountId: phone.accountId, name: phone.name, phone: phone.phone, selectable: phone.selectable, reason: phone.reason });
export function assertSession(session: SignupSession | null, actor: ConnectionActor, now: number): asserts session is SignupSession {
  if (!session || session.business_id !== actor.businessId || session.user_id !== actor.userId || session.consumed_at || session.claimed_at || !session.access_token || !Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= now) throw new ConnectionError("session_unavailable", "Esta autorización venció o ya fue utilizada. Volvé a iniciar la conexión.", 409);
}
export async function prepareConnection(actor: ConnectionActor, input: PrepareRequest, graph: ConnectionGraph, store: ConnectionStore) {
  const token = await graph.exchange(input.code);
  const accountIds = input.wabaId ? [input.wabaId] : token.accountIds;
  if (input.wabaId && token.accountIds.length && !token.accountIds.includes(input.wabaId)) throw new ConnectionError("account_not_authorized", "La cuenta elegida no coincide con la autorización de Meta. Volvé a seleccionarla.", 403);
  if (!accountIds.length || accountIds.length > 20) throw new ConnectionError("account_selection_required", "Meta no identificó una cuenta concreta. Repetí la conexión y seleccioná el portfolio y la cuenta de WhatsApp que querés usar.", 409);
  const phones: GraphPhone[] = [];
  for (const accountId of accountIds) phones.push(...await graph.phones(accountId, token.accessToken, input.mode));
  const choices = [...new Map(phones.map(phone => [phone.id, phone])).values()].map(safeChoice);
  if (input.phoneNumberId && !choices.some(phone => phone.id === input.phoneNumberId)) throw new ConnectionError("phone_not_authorized", "Meta no autorizó el número seleccionado para esta cuenta.", 403);
  if (!choices.length) throw new ConnectionError("no_authorized_numbers", "Meta no compartió ningún número de esa cuenta. Revisá que el portfolio sea el correcto y que tengas control del WhatsApp, no solamente de la página o de los anuncios.", 409);
  const session: SignupSession = { id: randomUUID(), user_id: actor.userId, business_id: actor.businessId, mode: input.mode, access_token: token.accessToken, token_expires_at: token.expiresAt, choices, expires_at: new Date(Date.now() + 10 * 60_000).toISOString(), claimed_at: null, consumed_at: null };
  await store.create(session);
  return { ok: true as const, phase: "choose_number" as const, sessionId: session.id, expiresAt: session.expires_at, choices, suggestedPhoneId: input.phoneNumberId ?? null };
}
export async function connectSelection(actor: ConnectionActor, sessionId: string, phoneId: string, graph: ConnectionGraph, store: ConnectionStore) {
  const session = await store.get(sessionId, actor);
  assertSession(session, actor, Date.now());
  const selected = session.choices.find(phone => phone.id === phoneId);
  if (!selected || !selected.selectable) throw new ConnectionError("phone_not_authorized", "Ese número no está habilitado en esta autorización.", 403);
  const token = session.access_token!;
  const refreshed = await graph.validateToken(token);
  if (refreshed.accountIds.length && !refreshed.accountIds.includes(selected.accountId)) throw new ConnectionError("account_not_authorized", "La autorización de esta cuenta cambió. Volvé a conectarla.", 403);
  const phone = (await graph.phones(selected.accountId, token, session.mode)).find(phone => phone.id === phoneId);
  if (!phone || !phone.selectable) throw new ConnectionError("phone_not_ready", phone?.reason ?? "El número dejó de estar disponible en Meta.", 409);
  await store.assertAvailable(actor, phone.id);
  await graph.assertWebhook();
  if (!await store.claim(sessionId, actor)) throw new ConnectionError("connection_in_progress", "Esta conexión ya se está procesando. Actualizá la página para comprobar el resultado.", 409);
  try {
    // Additive subscription: never unregister a phone, change its PIN or remove another provider.
    await graph.subscribe(phone.accountId, token);
    await store.persist(sessionId, actor, phone);
  } catch (error) {
    await store.discard(sessionId, actor).catch(() => {});
    throw error;
  }
  return { ok: true as const, phase: "linked" as const, phone: phone.phone, message: "Cuenta vinculada. Autorizá una conversación del equipo y enviá un mensaje para verificar el recorrido completo." };
}
