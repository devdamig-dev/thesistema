import { checked, loadRoom, type ChatActor } from "./store";
import { ChatError, fileDescriptor, memberIds, textValue, uuid } from "./validation";
import { attachmentBytes } from "./media";
import { publicPushKey, subscribePush } from "./push";

export async function manageChat(db: any, actor: ChatActor, value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ChatError("invalid_request", "La solicitud no es válida.");
  const body = value as Record<string, any>;
  const fields: Record<string, string[]> = {
    push_key: [], subscribe: ["subscription"], unsubscribe: ["endpoint"],
    configure: ["roomId", "branchId", "name", "memberIds", "archived"], read: ["roomId"],
    upload_prepare: ["roomId", "filename", "mime", "size"], upload_complete: ["roomId", "id"],
    send: ["roomId", "id", "body", "attachmentId", "askAi", "pendingId"], retry_ai: ["roomId", "id"],
  };
  if (typeof body.action !== "string" || !Object.hasOwn(fields, body.action) || Object.keys(body).some(key => key !== "action" && !fields[body.action].includes(key))) throw new ChatError("invalid_request", "La solicitud contiene campos no permitidos.");
  if (body.action === "push_key") return { publicKey: await publicPushKey(db) };
  if (body.action === "subscribe") { await subscribePush(db, actor, body.subscription); return {}; }
  if (body.action === "unsubscribe") {
    checked(await db.from("chat_push_subscriptions").delete().eq("user_id", actor.userId).eq("endpoint", textValue(body.endpoint, 2000)));
    return {};
  }
  const roomId = uuid(body.roomId);
  if (body.action === "configure") {
    if (!actor.admin) throw new ChatError("admin_required", "Solo una persona administradora puede configurar grupos.", 403);
    if (body.archived !== undefined && typeof body.archived !== "boolean") throw new ChatError("invalid_archive", "El estado no es válido.");
    checked(await db.rpc("configure_chat_room", { p_business: actor.businessId, p_user: actor.userId, p_room: roomId, p_branch: uuid(body.branchId), p_name: textValue(body.name, 80), p_members: memberIds(body.memberIds), p_archived: body.archived === true }));
    return { roomId };
  }
  const { membership } = await loadRoom(db, actor, roomId);
  if (body.action === "read") {
    checked(await db.from("chat_room_members").update({ last_read_at: new Date().toISOString() }).eq("room_id", roomId).eq("business_id", actor.businessId).eq("member_id", actor.memberId));
    return {};
  }
  if (body.action === "upload_prepare") {
    const file = fileDescriptor(body);
    const recent = await db.from("chat_attachments").select("id", { count: "exact", head: true }).eq("member_id", actor.memberId).gte("created_at", new Date(Date.now() - 3600000).toISOString());
    checked(recent);
    if (recent.count >= 30) throw new ChatError("upload_limit", "Llegaste al límite de 30 adjuntos por hora. Probá más tarde.", 429);
    const id = crypto.randomUUID(), path = `${actor.businessId}/${roomId}/${id}`;
    checked(await db.from("chat_attachments").insert({ id, business_id: actor.businessId, room_id: roomId, member_id: actor.memberId, storage_path: path, ...file }));
    const signed = checked(await db.storage.from("team-chat").createSignedUploadUrl(path, { upsert: false }));
    return { id, path, token: signed.token };
  }
  if (body.action === "upload_complete") {
    const id = uuid(body.id);
    const attachment = checked(await db.from("chat_attachments").select("*").eq("id", id).eq("business_id", actor.businessId).eq("room_id", roomId).eq("member_id", actor.memberId).single());
    await attachmentBytes(db, attachment);
    checked(await db.from("chat_attachments").update({ ready: true }).eq("id", id).eq("member_id", actor.memberId).eq("business_id", actor.businessId));
    return { id };
  }
  if (body.action === "send") {
    const id = uuid(body.id);
    const text = textValue(body.body, 10000, false);
    if (typeof body.askAi !== "boolean" || !text && !body.attachmentId) throw new ChatError("empty_message", "Escribí un mensaje o adjuntá un archivo.");
    const recent = await db.from("chat_messages").select("id", { count: "exact", head: true }).eq("member_id", actor.memberId).gte("created_at", new Date(Date.now() - 60000).toISOString());
    checked(recent);
    if (recent.count >= 30) throw new ChatError("message_limit", "Esperá un minuto antes de enviar más mensajes.", 429);
    const saved = checked(await db.rpc("send_chat_message", { p_business: actor.businessId, p_user: actor.userId, p_room: roomId, p_id: id, p_body: text,
      p_attachment: body.attachmentId ? uuid(body.attachmentId) : null, p_ask_ai: body.askAi, p_pending: body.pendingId ? uuid(body.pendingId) : null }));
    return { roomId, id, askAi: body.askAi, notify: !saved.existing };
  }
  if (body.action === "retry_ai") {
    const id = uuid(body.id);
    const message = checked(await db.from("chat_messages").select("ai_status,created_at").eq("id", id).eq("room_id", roomId).eq("member_id", actor.memberId).eq("business_id", actor.businessId).single());
    if (message.ai_status !== "queued" || message.created_at < membership.joined_at) throw new ChatError("ai_not_queued", "Revisá el resultado y la operación pendiente antes de volver a confirmar.", 409);
    return { roomId, id, askAi: true, notify: false };
  }
  throw new ChatError("unknown_action", "La acción no está disponible.");
}
