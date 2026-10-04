import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { runAgent } from "./core";
import { interpretHeuristically } from "./interpreter";
import { audit, claimMessage, consumePending, executeTool, getPending, resolveActor, savePending } from "./supabase-adapter";
import type { IncomingAgentMessage } from "./types";

/** Transport-agnostic entry point used by Meta and by the internal test endpoint. */
export async function processWhatsAppAgentMessage(input: IncomingAgentMessage) {
  const db = createSupabaseAdminClient();
  return runAgent(input, {
    resolveActor: (message) => resolveActor(db, message),
    claimMessage: (message, actor) => claimMessage(db, message, actor),
    interpret: interpretHeuristically,
    getPending: (actor) => getPending(db, actor),
    savePending: (operation) => savePending(db, operation),
    consumePending: (id, actor, requireUnexpired) => consumePending(db, id, actor, requireUnexpired),
    execute: (actor, call) => executeTool(db, actor, call),
    audit: (event) => audit(db, event),
    now: () => new Date(),
  });
}
