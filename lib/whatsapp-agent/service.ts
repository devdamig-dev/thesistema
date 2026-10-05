import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runAgent } from "./core";
import { interpretHeuristically } from "./interpreter";
import { audit, claimMessage, consumePending, executeTool, getPending, resolveActor, savePending, resolveAuthorizedConversation } from "./supabase-adapter";
import type { IncomingAgentMessage } from "./types";

/** Transport-agnostic entry point used by Meta and by the internal test endpoint. */
export async function processWhatsAppAgentMessage(input: IncomingAgentMessage) {
  const db = createSupabaseAdminClient();
  const conversation = await resolveAuthorizedConversation(db, input);
  if (!conversation) return { status: "ignored" as const, text: "" };
  const conversationId = conversation.id;
  return runAgent(input, {
    resolveActor: (message) => resolveActor(db, message),
    claimMessage: (message, actor) => claimMessage(db, message, actor),
    interpret: interpretHeuristically,
    getPending: (actor) => getPending(db, actor, conversationId),
    savePending: (operation) => savePending(db, operation, conversationId),
    consumePending: (id, actor, requireUnexpired) => consumePending(db, id, actor, requireUnexpired, conversationId),
    execute: (actor, call) => executeTool(db, actor, call),
    audit: (event) => audit(db, event),
    now: () => new Date(),
  });
}
