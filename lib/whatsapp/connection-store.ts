import { ConnectionError, type ConnectionActor } from "./signup";
import type { ConnectionStore, SignupSession } from "./connection-service";
import type { GraphPhone } from "./graph";

// This schema is distinct from an earlier, externally applied single-account signup draft.
export const CONNECTION_SESSION_TABLE = "whatsapp_connection_sessions";

export async function readWhatsAppConnectionStatus(db: any, businessId: string) {
  const result = await db.from("whatsapp_integrations").select("phone_number_id,display_phone_number,status,connected_at,token_expires_at").eq("business_id", businessId).maybeSingle();
  if (result.error) throw new ConnectionError("connection_status_failed", "No pudimos comprobar la vinculación.", 503);
  const integration = result.data;
  const expiry = integration?.token_expires_at ? Date.parse(integration.token_expires_at) : null;
  const expired = expiry !== null && (!Number.isFinite(expiry) || expiry <= Date.now());
  return { integration, expired };
}

/** The mutation client must be server-owned. Reads and writes are bound to actor + business. */
export function connectionStore(db: any): ConnectionStore {
  const scoped = (query: any, id: string, actor: ConnectionActor) => query.eq("id", id).eq("business_id", actor.businessId).eq("user_id", actor.userId);
  const failure = () => new ConnectionError("connection_storage_failed", "No pudimos guardar la conexión. Actualizá la página para comprobar su estado antes de reintentar.", 503);
  return {
    async create(session: SignupSession) {
      const cleanup = await db.from(CONNECTION_SESSION_TABLE).delete().lt("expires_at", new Date().toISOString());
      if (cleanup.error) throw failure();
      const result = await db.from(CONNECTION_SESSION_TABLE).insert(session);
      if (result.error) throw failure();
    },
    async get(id: string, actor: ConnectionActor) {
      const result = await scoped(db.from(CONNECTION_SESSION_TABLE).select("id,business_id,user_id,mode,access_token,token_expires_at,choices,expires_at,claimed_at,consumed_at"), id, actor).maybeSingle();
      if (result.error) throw failure();
      return result.data as SignupSession | null;
    },
    async claim(id: string, actor: ConnectionActor) {
      const result = await scoped(db.from(CONNECTION_SESSION_TABLE).update({ claimed_at: new Date().toISOString() }), id, actor)
        .is("claimed_at", null).is("consumed_at", null).gt("expires_at", new Date().toISOString()).select("id").maybeSingle();
      if (result.error) throw failure();
      return Boolean(result.data);
    },
    async discard(id: string, actor: ConnectionActor) {
      const result = await scoped(db.from(CONNECTION_SESSION_TABLE).update({ consumed_at: new Date().toISOString(), access_token: null, choices: [] }), id, actor).is("consumed_at", null);
      if (result.error) throw failure();
    },
    async assertAvailable(actor: ConnectionActor, phoneId: string) {
      const result = await db.from("whatsapp_integrations").select("business_id,phone_number_id")
        .or(`business_id.eq.${actor.businessId},phone_number_id.eq.${phoneId}`);
      if (result.error) throw failure();
      if ((result.data ?? []).some((row: { business_id: string; phone_number_id: string }) => row.business_id !== actor.businessId || row.phone_number_id !== phoneId)) throw new ConnectionError("existing_connection", "Ese número ya está asignado, o este negocio tiene otro número vinculado. No reemplazamos conexiones existentes automáticamente.", 409);
    },
    async persist(id: string, actor: ConnectionActor, phone: GraphPhone) {
      const result = await db.rpc("complete_whatsapp_signup", { p_session_id: id, p_business_id: actor.businessId, p_actor_id: actor.userId, p_phone_id: phone.id, p_display_phone: phone.phone });
      if (result.error) {
        if (result.error.code === "23505" || /phone_already_assigned|existing_connection/.test(result.error.message ?? "")) throw new ConnectionError("existing_connection", "El número quedó reservado por otra conexión. No se reemplazó ninguna cuenta existente.", 409);
        if (/permission_denied/.test(result.error.message ?? "")) throw new ConnectionError("permission_denied", "Tus permisos cambiaron. Volvé a iniciar sesión antes de conectar WhatsApp.", 403);
        throw failure();
      }
    },
  };
}
