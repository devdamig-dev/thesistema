import { ConnectionError, type ConnectionActor } from "./signup";
import { WhatsAppGroupsGraph } from "./groups-graph";
import type { GroupMember } from "./groups";
import { permissionsFor, type Role } from "../permissions";

type Db = any;
export async function groupConnection(db: Db, businessId: string) {
  const result = await db.from("whatsapp_integrations").select("business_id,phone_number_id,display_phone_number,access_token,token_expires_at,status").eq("business_id", businessId).maybeSingle();
  if (result.error) throw new ConnectionError("group_connection_unknown", "No pudimos consultar la conexión del negocio.", 503);
  const value = result.data;
  if (!value || value.status !== "connected" || !value.access_token || value.token_expires_at && (!Number.isFinite(Date.parse(value.token_expires_at)) || Date.parse(value.token_expires_at) <= Date.now())) throw new ConnectionError("group_not_connected", "Vinculá una cuenta de WhatsApp con autorización vigente antes de configurar grupos.", 409);
  const graph = new WhatsAppGroupsGraph({ phoneNumberId: value.phone_number_id, token: value.access_token, phone: value.display_phone_number || "Número conectado", version: process.env.META_GRAPH_VERSION || "v25.0", appId: process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID || "", appSecret: process.env.META_APP_SECRET || "", callbackUrl: process.env.META_WEBHOOK_CALLBACK_URL || "https://gastropilot.nexodg.com/api/webhooks/whatsapp" });
  return { graph, phoneNumberId: value.phone_number_id as string };
}

export async function activeGroupMembers(db: Db, businessId: string, memberIds: string[]): Promise<GroupMember[]> {
  if (!memberIds.length || memberIds.length > 8) throw new ConnectionError("group_members_invalid", "Elegí entre una y ocho personas del equipo.");
  const members = await db.from("business_members").select("id,user_id,role").eq("business_id", businessId).in("id", memberIds);
  if (members.error || members.data?.length !== memberIds.length) throw new ConnectionError("group_members_invalid", "Hay integrantes que ya no pertenecen a este negocio.", 403);
  const [profiles, assignments] = await Promise.all([
    db.from("profiles").select("id,phone,active").eq("active", true).not("phone", "is", null),
    db.from("branch_assignments").select("business_member_id,branch_id").in("business_member_id", memberIds),
  ]);
  if (profiles.error || assignments.error) throw new ConnectionError("group_members_unknown", "No pudimos comprobar los permisos actuales del equipo.", 503);
  const result: GroupMember[] = members.data.map((member: any) => {
    const profile = profiles.data?.find((row: any) => row.id === member.user_id);
    const phone = String(profile?.phone || "").replace(/\D/g, "");
    if (profile?.active !== true || !/^[1-9]\d{7,14}$/.test(phone) || !permissionsFor(member.role).length) throw new ConnectionError("group_members_invalid", "Cada integrante debe estar activo y tener su teléfono registrado en Equipo y roles.", 403);
    if (profiles.data.filter((row: any) => String(row.phone || "").replace(/\D/g, "") === phone).length !== 1) throw new ConnectionError("group_phone_ambiguous", "No pudimos identificar de forma única el teléfono de un integrante.", 409);
    return { memberId: member.id, phone, role: member.role as Role, branchIds: ["owner", "admin", "manager", "accountant"].includes(member.role) ? null : assignments.data.filter((row: any) => row.business_member_id === member.id).map((row: any) => row.branch_id) };
  });
  if (new Set(result.map(member => member.phone)).size !== result.length) throw new ConnectionError("group_phone_ambiguous", "Dos integrantes tienen el mismo teléfono. Corregí esa identidad antes de habilitar el grupo.", 409);
  return result;
}

export async function savedGroupMembers(db: Db, businessId: string, conversationId: string): Promise<GroupMember[]> {
  const links = await db.from("whatsapp_group_members").select("member_id").eq("business_id", businessId).eq("conversation_id", conversationId);
  if (links.error) throw new ConnectionError("group_members_unknown", "No pudimos comprobar los integrantes autorizados.", 503);
  return activeGroupMembers(db, businessId, (links.data ?? []).map((row: any) => row.member_id));
}

export async function assertGroupAdmin(db: Db, actor: ConnectionActor) {
  const result = await db.from("business_members").select("id,role,profiles!inner(active)").eq("business_id", actor.businessId).eq("user_id", actor.userId).maybeSingle();
  if (result.error || !result.data || !["owner", "admin"].includes(result.data.role) || result.data.profiles?.active !== true) throw new ConnectionError("permission_denied", "Necesitás ser una persona administradora activa de este negocio.", 403);
}
