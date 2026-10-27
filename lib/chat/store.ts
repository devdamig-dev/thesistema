import { permissionsFor, type ModuleKey, type Role } from "../permissions";
import type { AgentActor } from "../whatsapp-agent/types";
import type { ChatMember, ChatSnapshot, Room } from "./types";
import { ChatError } from "./validation";
import { confirmationText } from "../whatsapp-agent/core";
import { getTool } from "../whatsapp-agent/registry";

type Db = any;
export type ChatActor = AgentActor & { admin: boolean };
export function checked<T = any>(result: { error?: unknown; data?: T }): T {
  if (result.error) {
    const message = typeof result.error === "object" && result.error !== null && "message" in result.error ? String(result.error.message) : "";
    if (message.includes("chat_agent_busy")) throw new ChatError("chat_agent_busy", "Esperá a que termine la consulta de IA antes de cambiar el grupo.", 409);
    if (message.includes("chat_confirmation_expired")) throw new ChatError("confirmation_expired", "Esta confirmación venció o ya fue resuelta. Actualizá el chat.", 409);
    if (message.includes("chat_request_conflict")) throw new ChatError("message_conflict", "Este envío ya existe con otro contenido. Actualizá el chat antes de continuar.", 409);
    throw new ChatError("chat_unavailable", "No pudimos verificar los datos del chat. Actualizá antes de repetir la acción.", 503);
  }
  return result.data as T;
}
export async function chatActor(db: Db, context: { isAuthenticated: boolean; userId: string | null; businessId: string | null }): Promise<ChatActor> {
  if (!context.isAuthenticated || !context.userId || !context.businessId) throw new ChatError("unauthenticated", "Ingresá a tu cuenta para abrir el chat.", 401);
  const member = checked(await db.from("business_members").select("id,role,profiles!inner(full_name,active)").eq("business_id", context.businessId).eq("user_id", context.userId).maybeSingle());
  if (!member?.profiles?.active || !permissionsFor(member.role).length) throw new ChatError("inactive_member", "Tu acceso al negocio no está activo.", 403);
  const [modules, assignments] = await Promise.all([
    db.from("business_modules").select("module_key").eq("business_id", context.businessId).eq("enabled", true),
    db.from("branch_assignments").select("branch_id").eq("business_member_id", member.id),
  ]);
  return { userId: context.userId, businessId: context.businessId, memberId: member.id, name: member.profiles.full_name, phone: "", role: member.role,
    admin: ["owner", "admin"].includes(member.role), enabledModules: checked(modules).map((m: any) => m.module_key as ModuleKey),
    branchIds: ["owner", "admin", "manager", "accountant"].includes(member.role) ? null : checked(assignments).map((a: any) => a.branch_id) };
}
export async function teamMembers(db: Db, businessId: string): Promise<ChatMember[]> {
  const members = checked(await db.from("business_members").select("id,user_id,role,profiles!inner(full_name,active)").eq("business_id", businessId));
  if (!members.length) return [];
  const assignments = checked(await db.from("branch_assignments").select("business_member_id,branch_id").in("business_member_id", members.map((m: any) => m.id)));
  return members.map((m: any) => ({ id: m.id, userId: m.user_id, name: m.profiles.full_name, role: m.role, active: m.profiles.active,
    branchIds: ["owner", "admin", "manager", "accountant"].includes(m.role) ? null : assignments.filter((a: any) => a.business_member_id === m.id).map((a: any) => a.branch_id) }));
}
export async function loadRoom(db: Db, actor: ChatActor, roomId: string) {
  const access = checked(await db.rpc("chat_access", { p_user: actor.userId, p_business: actor.businessId, p_room: roomId }));
  if (access !== actor.memberId) throw new ChatError("room_forbidden", "No tenés acceso vigente a este grupo. Pedile al administrador que revise tus permisos.", 403);
  const [roomResult, participantResult] = await Promise.all([
    db.from("chat_rooms").select("id,name,branch_id,archived,created_at,agent_busy_until,agent_request_id").eq("id", roomId).eq("business_id", actor.businessId).single(),
    db.from("chat_room_members").select("member_id,joined_at,role_snapshot").eq("room_id", roomId).eq("business_id", actor.businessId),
  ]);
  const room = checked(roomResult) as Room & { agent_request_id: string | null };
  const participants = checked(participantResult) as { member_id: string; joined_at: string; role_snapshot: Role }[];
  const membership = participants.find(p => p.member_id === actor.memberId);
  if (!membership) throw new ChatError("room_forbidden", "Ya no pertenecés al grupo.", 403);
  return { room, participants, membership };
}
export async function roomActor(db: Db, actor: ChatActor, roomId: string, requestId?: string): Promise<ChatActor> {
  const { room, participants } = await loadRoom(db, actor, roomId);
  if (requestId && (room.agent_request_id !== requestId || !room.agent_busy_until || Date.parse(room.agent_busy_until) <= Date.now())) throw new ChatError("chat_lease_lost", "La comprobación venció. Revisá el estado antes de confirmar.", 409);
  const members = await teamMembers(db, actor.businessId);
  let common = permissionsFor(actor.role);
  for (const p of participants) {
    const member = members.find(m => m.id === p.member_id);
    if (!member?.active || member.role !== p.role_snapshot || member.branchIds !== null && !member.branchIds.includes(room.branch_id)) throw new ChatError("room_permissions_changed", "Cambió el acceso de un integrante. Una persona administradora debe actualizar el grupo antes de usar la IA.", 409);
    common = common.filter(permission => permissionsFor(member.role).includes(permission));
  }
  return { ...actor, branchIds: [room.branch_id], permissionLimit: common };
}
export async function snapshot(db: Db, actor: ChatActor, roomId?: string, before?: string): Promise<ChatSnapshot> {
  const [members, linksResult, branchResult] = await Promise.all([
    teamMembers(db, actor.businessId),
    db.from("chat_room_members").select("room_id,role_snapshot").eq("member_id", actor.memberId).eq("business_id", actor.businessId),
    db.from("branches").select("id,name").eq("business_id", actor.businessId).order("name"),
  ]);
  const ids = checked(linksResult).filter((l: any) => l.role_snapshot === actor.role).map((l: any) => l.room_id);
  let rooms: Room[] = ids.length ? checked(await db.from("chat_rooms").select("id,name,branch_id,archived,created_at,agent_busy_until").eq("business_id", actor.businessId).in("id", ids).eq("archived", false).order("created_at")) : [];
  rooms = rooms.filter(r => actor.branchIds === null || actor.branchIds.includes(r.branch_id));
  const data: ChatSnapshot = { me: { id: actor.memberId, userId: actor.userId, name: actor.name, admin: actor.admin }, rooms,
    members: actor.admin ? members : [], branches: checked(branchResult).filter((b: any) => actor.branchIds === null || actor.branchIds.includes(b.id)) };
  if (!roomId) return data;
  const { room, participants, membership } = await loadRoom(db, actor, roomId);
  let query = db.from("chat_messages").select("*").eq("room_id", roomId).eq("business_id", actor.businessId).gte("created_at", membership.joined_at);
  if (before) {
    const [date, id] = before.split("|");
    if (!date || !id || !/^\d{4}-\d{2}-\d{2}T[\d:.+-]+Z?$/.test(date) || !/^[a-f0-9-]{36}$/i.test(id)) throw new ChatError("bad_cursor", "No pudimos cargar ese tramo del historial.");
    query = query.or(`created_at.lt.${date},and(created_at.eq.${date},id.lt.${id})`);
  }
  const rows = checked(await query.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(101));
  const messages = rows.slice(0, 100).reverse();
  const attachmentIds = messages.map((m: any) => m.attachment_id).filter(Boolean);
  const attachments = attachmentIds.length ? checked(await db.from("chat_attachments").select("id,filename,mime,size").eq("business_id", actor.businessId).eq("room_id", roomId).in("id", attachmentIds)) : [];
  const pending = checked(await db.from("whatsapp_agent_pending_operations").select("id,kind,tool_name,arguments,expires_at").eq("business_id", actor.businessId).eq("member_id", actor.memberId).eq("conversation_id", roomId).is("consumed_at", null).limit(2));
  const ownPending = pending.length === 1 ? pending[0] : null;
  return { ...data, members: actor.admin ? members : members.filter(m => participants.some(p => p.member_id === m.id)), room, participants,
    messages: messages.map((m: any) => ({ ...m, attachment: attachments.find((a: any) => a.id === m.attachment_id) ?? null })), hasOlder: rows.length > 100, pendingId: ownPending?.id ?? null, pendingKind: ownPending?.kind ?? null,
    pendingExpiresAt: ownPending?.expires_at ?? null,
    pendingSummary: ownPending?.kind === "confirmation" ? `${ownPending.arguments?.__resultUncertain ? "El intento anterior podría haberse guardado. Verificá el módulo antes de continuar.\n" : ""}${confirmationText(ownPending.tool_name, ownPending.arguments ?? {}, getTool(ownPending.tool_name)?.description ?? ownPending.tool_name)}` : null };
}
