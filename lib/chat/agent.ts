import { runAgent } from "../whatsapp-agent/core";
import { interpretHeuristically } from "../whatsapp-agent/interpreter";
import { interpretWithManagedAi } from "../ai/whatsapp-interpreter";
import { toolsForActor } from "../whatsapp-agent/registry";
import * as adapter from "../whatsapp-agent/supabase-adapter";
import { isPurchaseWrite, preparePurchaseTool } from "../purchases/agent";
import { isSaleWrite, prepareSaleTool } from "../sales/agent";
import { isDebtPlanTool } from "../whatsapp-agent/debt-contract";
import { prepareDebtTool } from "../whatsapp-agent/debt-adapter";
import type { AgentReply, ToolCall } from "../whatsapp-agent/types";
import { checked, roomActor, type ChatActor } from "./store";
import { ChatError } from "./validation";
import { extractAttachment } from "./media";
import { answerInternalChat } from "./conversation";

export async function processChatAi(db: any, actor: ChatActor, roomId: string, messageId: string) {
  if (checked(await db.rpc("claim_chat_ai", { p_business: actor.businessId, p_user: actor.userId, p_room: roomId, p_id: messageId })) !== true) return;
  const uncertain: AgentReply = { text: "No pudimos confirmar el resultado. Revisá el historial y la operación pendiente antes de volver a confirmar.", status: "failed" };
  let reply: AgentReply = uncertain;
  let pendingId: string | null = null;
  try {
    const scoped = await roomActor(db, actor, roomId, messageId);
    const message = checked(await db.from("chat_messages").select("*").eq("id", messageId).eq("business_id", actor.businessId).eq("member_id", actor.memberId).single());
    const pending = await adapter.getPending(db, scoped, roomId);
    const confirmation = /^(s[ií]|confirmo|dale|ok|confirmar|no|cancelar|cancel[aá]|cancelo|no confirmar)[.!\s]*$/i.test(message.body);
    if (confirmation && (!message.pending_id || pending?.id !== message.pending_id)) throw new ChatError("confirmation_expired", "Esta confirmación ya no está vigente. Actualizá el chat y revisá la operación pendiente.", 409);
    let inputText = message.body;
    if (message.attachment_id) {
      if (pending) throw new ChatError("pending_before_attachment", "Primero confirmá o cancelá tu operación pendiente. Después podés pedir una carga con este archivo.", 409);
      const file = checked(await db.from("chat_attachments").select("*").eq("id", message.attachment_id).eq("room_id", roomId).eq("business_id", actor.businessId).eq("ready", true).single());
      const extracted = await extractAttachment(db, actor, file);
      // Extracted text cannot silently confirm an operation. The user reviews it first.
      reply = { text: `Contenido interpretado del adjunto:\n\n${extracted}\n\nRevisá estos datos. Para registrar una operación, escribí qué querés cargar y enviá esa solicitud a la IA.`, status: "completed", tool: undefined };
    } else {
      inputText = inputText.trim();
      const input = { messageId: `chat:${messageId}`, senderPhone: "", recipientPhone: "", text: inputText, provider: "internal" as const, providerConversationId: roomId, conversationType: "group" as const };
      const guard = async (call?: ToolCall) => {
        const current = await roomActor(db, actor, roomId, messageId);
        if (call && !toolsForActor(current).some(t => t.name === call.name)) throw new ChatError("permission_changed", "Cambió el permiso para esta operación.", 403);
        return current;
      };
      reply = { ...await runAgent(input, {
        resolveActor: async () => scoped,
        claimMessage: (i, a) => adapter.claimMessage(db, i, a, roomId),
        interpret: async (text, tools, operation) => await interpretHeuristically(text, tools, operation) || interpretWithManagedAi({ businessId: actor.businessId, actorId: actor.userId, text, tools, pending: operation, source: "web" }),
        getPending: a => adapter.getPending(db, a, roomId),
        savePending: async operation => { await guard(operation.toolCall); return adapter.savePending(db, operation, roomId); },
        consumePending: (id, a, unexpired) => adapter.consumePending(db, id, a, unexpired, roomId),
        claimSalePending: (id, a, recovery) => adapter.claimSalePending(db, id, a, recovery, roomId),
        cancelSalePending: (id, a) => adapter.cancelSalePending(db, id, a, roomId),
        claimDebtPending: (id, a, recovery) => adapter.claimDebtPending(db, id, a, recovery, roomId),
        cancelDebtPending: (id, a) => adapter.cancelDebtPending(db, id, a, roomId),
        claimPurchasePending: (id, a, recovery) => adapter.claimPurchasePending(db, id, a, recovery, roomId),
        cancelPurchasePending: (id, a) => adapter.cancelPurchasePending(db, id, a, roomId),
        prepare: async (_a, call) => { const current = await guard(call); return isPurchaseWrite(call.name) ? preparePurchaseTool(db, current, call) : isDebtPlanTool(call.name) ? prepareDebtTool(db, current, call) : isSaleWrite(call.name) ? prepareSaleTool(db, current, call) : call; },
        execute: async (_a, call, id) => adapter.executeTool(db, await guard(call), call, id),
        audit: event => adapter.audit(db, event, roomId), now: () => new Date(),
      }) };
      // The human-readable response is enough for the shared thread; raw results stay server-side.
      pendingId = (await adapter.getPending(db, scoped, roomId))?.id ?? null;
    }
    try { await roomActor(db, actor, roomId, messageId); }
    catch { reply = uncertain; pendingId = null; }
  } catch (error) {
    if (error instanceof ChatError) reply = { text: error.message, status: "rejected", tool: undefined };
  }
  if (checked(await db.rpc("finish_chat_ai", { p_business: actor.businessId, p_room: roomId, p_id: messageId, p_text: reply.text, p_result: reply.status, p_tool: reply.tool ?? null, p_pending: pendingId })) !== true) throw new ChatError("ai_result_uncertain", uncertain.text, 409);
}
