import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runAgent } from "./core";
import { interpretHeuristically } from "./interpreter";
import { audit, claimMessage, consumePending, executeTool, getPending, resolveActor, savePending, resolveAuthorizedConversation, type AuthorizedConversation } from "./supabase-adapter";
import type { AgentActor, IncomingAgentMessage } from "./types";

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
  const actor = scopeActorToConversation(resolvedActor, conversation);
  if (!actor) return { status: "rejected" as const, text: "No tenés acceso a la sucursal autorizada para esta conversación." };
  const conversationId = conversation.id;
  return runAgent(input, {
    resolveActor: async () => actor,
    claimMessage: (message, scopedActor) => claimMessage(db, message, scopedActor, conversationId),
    interpret: interpretHeuristically,
    getPending: (actor) => getPending(db, actor, conversationId),
    savePending: (operation) => savePending(db, operation, conversationId),
    consumePending: (id, actor, requireUnexpired) => consumePending(db, id, actor, requireUnexpired, conversationId),
    execute: (actor, call) => executeTool(db, actor, call),
    audit: (event) => audit(db, event, conversationId),
    now: () => new Date(),
  });
}
