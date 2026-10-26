import { isPurchaseWrite, preparePurchaseTool } from "../purchases/agent";
import { isSaleWrite, prepareSaleTool } from "../sales/agent";
import { isDebtPlanTool } from "./debt-contract";
import { prepareDebtTool } from "./debt-adapter";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runAgent } from "./core";
import { interpretHeuristically } from "./interpreter";
import { interpretWithManagedAi } from "../ai/whatsapp-interpreter";
import { claimPurchasePending, cancelPurchasePending, claimSalePending, cancelSalePending, claimDebtPending, cancelDebtPending, audit, claimMessage, consumePending, executeTool, getPending, resolveActor, savePending, resolveAuthorizedConversation, type AuthorizedConversation } from "./supabase-adapter";
import type { AgentActor, IncomingAgentMessage } from "./types";
import { authorizeGroupMessage } from "../whatsapp/groups-access";
import { toolsForActor } from "./registry";

export function scopeActorToConversation(
  actor: AgentActor,
  conversation: AuthorizedConversation,
): AgentActor | null {
  if (actor.businessId !== conversation.business_id) return null;
  if (!conversation.branch_id) return actor;
  if (actor.branchIds !== null && !actor.branchIds.includes(conversation.branch_id)) return null;
  return { ...actor, branchIds: [conversation.branch_id] };
}

/** Transport-agnostic entry point used by Meta and by the internal test endpoint. */
export async function processWhatsAppAgentMessage(input: IncomingAgentMessage) {
  const db = createSupabaseAdminClient();
  const resolvedActor = await resolveActor(db, input);
  if (!resolvedActor) {
    return runAgent(input, {
      resolveActor: async () => null,
      claimMessage: async () => false,
      interpret: interpretHeuristically,
      getPending: async () => null,
      savePending: async () => { throw new Error("unreachable"); },
      consumePending: async () => false,
      execute: async () => { throw new Error("unreachable"); },
      audit: async () => {},
      now: () => new Date(),
    });
  }
  const conversation = await resolveAuthorizedConversation(db, input, resolvedActor.businessId);
  if (!conversation) return { status: "ignored" as const, text: "" };
  let actor = scopeActorToConversation(resolvedActor, conversation);
  if (!actor) return { status: "rejected" as const, text: "No tenés acceso a la sucursal autorizada para esta conversación." };
  if (conversation.conversation_type === "group") {
    actor = await authorizeGroupMessage(db, input, actor, conversation);
    if (!actor) return { status: "ignored" as const, text: "" };
  }
  const scopedActor = actor;
  const conversationId = conversation.id;
  const reply = await runAgent(input, {
    resolveActor: async () => scopedActor,
    claimMessage: (message, scopedActor) => claimMessage(db, message, scopedActor, conversationId),
    interpret: async (text, tools, pending) => {
      const heuristic = await interpretHeuristically(text, tools, pending);
      if (heuristic) return heuristic;
      return interpretWithManagedAi({
        businessId: scopedActor.businessId,
        actorId: scopedActor.userId,
        text,
        tools,
        pending,
      });
    },
    getPending: (actor) => getPending(db, actor, conversationId),
    savePending: (operation) => savePending(db, operation, conversationId),
    consumePending: (id, actor, requireUnexpired) => consumePending(db, id, actor, requireUnexpired, conversationId),
    claimSalePending: (id,actor,recovery) => claimSalePending(db,id,actor,recovery,conversationId),
    cancelSalePending: (id,actor) => cancelSalePending(db,id,actor,conversationId),
    claimDebtPending: (id, actor, recovery) => claimDebtPending(db, id, actor, recovery, conversationId),
    cancelDebtPending: (id, actor) => cancelDebtPending(db, id, actor, conversationId),
    claimPurchasePending: (id, actor, recovery) => claimPurchasePending(db, id, actor, recovery, conversationId),
    cancelPurchasePending: (id, actor) => cancelPurchasePending(db, id, actor, conversationId),
    prepare: (actor, call) => isPurchaseWrite(call.name) ? preparePurchaseTool(db, actor, call) : isDebtPlanTool(call.name) ? prepareDebtTool(db, actor, call) : isSaleWrite(call.name) ? prepareSaleTool(db, actor, call) : Promise.resolve(call),
    execute: (actor, call, pendingId) => executeTool(db, actor, call, pendingId),
    audit: (event) => audit(db, event, conversationId),
    now: () => new Date(),
  });
  if (conversation.conversation_type === "group" && reply.text.trim()) {
    // A participant/role can change while the model or a domain operation runs.
    // Re-check the audience before publishing a response into a shared chat.
    const currentConversation = await resolveAuthorizedConversation(db, input, scopedActor.businessId);
    const currentActor = await resolveActor(db, input);
    const current = currentConversation && currentActor ? await authorizeGroupMessage(db, input, currentActor, currentConversation) : null;
    if (!current || reply.tool && !toolsForActor(current).some(tool => tool.name === reply.tool)) return { ...reply, text: "" };
  }
  return reply;
}
