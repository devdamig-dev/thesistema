import { ConnectionError, type ConnectionActor } from "./signup";
import { activeGroupMembers, groupConnection, savedGroupMembers } from "./groups-store";
import type { GroupRequest } from "./groups";

export async function manageGroups(db: any, actor: ConnectionActor, input: GroupRequest) {
  if (input.action === "identify_member") {
    const result = await db.rpc("identify_whatsapp_group_member", { p_business_id: actor.businessId, p_actor_id: actor.userId, p_member_id: input.memberId, p_phone: input.phone });
    if (result.error || !result.data) throw new ConnectionError("group_identity_failed", "No pudimos confirmar el teléfono. Debe pertenecer a una única persona activa del negocio; un teléfono ya registrado no se reemplaza desde acá.", 409);
    return { ok: true, message: "Teléfono confirmado. Ahora podés elegir a esa persona como integrante del grupo." };
  }
  if (input.action === "pause") {
    const paused = await db.rpc("pause_whatsapp_group", { p_business_id: actor.businessId, p_actor_id: actor.userId, p_conversation_id: input.conversationId });
    if (paused.error || !paused.data) throw new ConnectionError("group_pause_failed", "No pudimos confirmar la pausa del grupo.", 503);
    return { ok: true, message: "Procesamiento del grupo pausado." };
  }
  const { graph, phoneNumberId } = await groupConnection(db, actor.businessId);
  const readiness = await graph.readiness();
  if (input.action === "list") {
    const saved = await db.from("whatsapp_authorized_conversations").select("id,provider_conversation_id,display_name,branch_id,enabled,group_phone_number_id,whatsapp_group_members(member_id)").eq("business_id", actor.businessId).eq("conversation_type", "group");
    if (saved.error) throw new ConnectionError("group_list_failed", "No pudimos leer los grupos configurados.", 503);
    return { ok: true, readiness, groups: readiness.ready ? await graph.list() : [], saved: saved.data ?? [] };
  }
  if (!readiness.ready) throw new ConnectionError(readiness.code, readiness.message, 409);
  if (input.action === "create") {
    const reserved = await db.from("whatsapp_group_creation_requests").insert({ id: input.requestId, business_id: actor.businessId, actor_id: actor.userId, phone_number_id: phoneNumberId, subject: input.subject });
    if (reserved.error?.code === "23505") throw new ConnectionError("group_already_requested", "Ya se solicitó una creación con esta referencia o nombre. Actualizá la lista para recuperar el grupo; no se volvió a crear.", 409);
    if (reserved.error) throw new ConnectionError("group_creation_not_started", "No pudimos registrar la solicitud. No se inició la creación en Meta.", 503);
    try {
      await graph.create(input.subject, input.description);
      const updated = await db.from("whatsapp_group_creation_requests").update({ status: "submitted" }).eq("id", input.requestId).eq("business_id", actor.businessId);
      if (updated.error) throw new ConnectionError("group_result_unknown", "La solicitud llegó a Meta, pero no pudimos guardar su resultado. Actualizá la lista; no repitas la creación.", 502);
    } catch (error) {
      await db.from("whatsapp_group_creation_requests").update({ status: error instanceof ConnectionError && error.code === "group_meta_rejected" ? "failed" : "unknown" }).eq("id", input.requestId).eq("business_id", actor.businessId);
      throw error;
    }
    return { ok: true, message: "Creación solicitada a Meta. Actualizá la lista, seleccioná el grupo y autorizá sus integrantes." };
  }
  await graph.assertOwned(input.groupId);
  const info = await graph.info(input.groupId);
  if (info.suspended || !info.approvalRequired) throw new ConnectionError("group_requires_control", "El grupo debe estar activo y requerir aprobación para ingresar. Los grupos creados desde acá ya usan esa configuración.", 409);
  if (input.action === "details") {
    const [inviteLink, requests] = await Promise.all([graph.invitation(input.groupId), graph.joinRequests(input.groupId)]);
    return { ok: true, info, inviteLink, requests };
  }
  if (input.action === "authorize") {
    const members = await activeGroupMembers(db, actor.businessId, input.memberIds);
    if (members.some(member => member.branchIds !== null && !member.branchIds.includes(input.branchId))) throw new ConnectionError("group_branch_forbidden", "Todos los integrantes deben tener acceso a la sucursal elegida.", 403);
    if (info.participants.some(phone => !members.some(member => member.phone === phone))) throw new ConnectionError("unknown_group_participant", "El grupo tiene participantes que no están entre las personas autorizadas. Revisá sus integrantes antes de activarlo.", 409);
    const saved = await db.rpc("set_whatsapp_group_conversation", { p_business_id: actor.businessId, p_actor_id: actor.userId, p_group_id: input.groupId, p_phone_number_id: phoneNumberId, p_name: info.subject, p_branch_id: input.branchId, p_member_ids: input.memberIds });
    if (saved.error || !saved.data) throw new ConnectionError("group_authorization_failed", "No pudimos guardar el grupo. Revisá los teléfonos, la sucursal y los permisos actuales de las personas.", 409);
    return { ok: true, message: "Grupo autorizado. Se procesarán mensajes nuevos de sus integrantes habilitados." };
  }
  const conversation = await db.from("whatsapp_authorized_conversations").select("id,branch_id").eq("business_id", actor.businessId).eq("provider_conversation_id", input.groupId).eq("conversation_type", "group").eq("group_phone_number_id", phoneNumberId).eq("enabled", true).maybeSingle();
  if (conversation.error || !conversation.data) throw new ConnectionError("group_not_authorized", "Autorizá primero el grupo y elegí a las personas del equipo.", 403);
  const [members, requests] = await Promise.all([savedGroupMembers(db, actor.businessId, conversation.data.id), graph.joinRequests(input.groupId)]);
  const request = requests.find(row => row.id === input.joinRequestId);
  const member = members.find(row => row.phone === request?.phone);
  if (!request || !member || member.branchIds !== null && !member.branchIds.includes(conversation.data.branch_id) || info.participants.length >= 8) throw new ConnectionError("join_not_authorized", "La solicitud no corresponde a una persona autorizada con acceso a la sucursal, o el grupo está completo.", 403);
  await graph.approve(input.groupId, input.joinRequestId);
  return { ok: true, message: "Meta confirmó el ingreso de la persona autorizada." };
}
