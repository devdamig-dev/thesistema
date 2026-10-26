import { groupConnection, savedGroupMembers } from "./groups-store";
import { scopeActorToGroup } from "./groups";
import type { AgentActor, IncomingAgentMessage } from "../whatsapp-agent/types";
import type { AuthorizedConversation } from "../whatsapp-agent/supabase-adapter";

/** Re-read participants before a group command. An unknown participant closes access for everyone. */
export async function authorizeGroupMessage(db: any, input: IncomingAgentMessage, actor: AgentActor, conversation: AuthorizedConversation): Promise<AgentActor | null> {
  if (input.conversationType !== "group" || conversation.conversation_type !== "group" || !conversation.branch_id || !conversation.group_phone_number_id || !conversation.group_activated_at || !input.sentAt || input.sentAt < Date.parse(conversation.group_activated_at)) return null;
  const { graph, phoneNumberId } = await groupConnection(db, actor.businessId);
  if (phoneNumberId !== conversation.group_phone_number_id) return null;
  const [info, members] = await Promise.all([graph.info(conversation.provider_conversation_id), savedGroupMembers(db, actor.businessId, conversation.id)]);
  if (info.suspended || !info.approvalRequired) return null;
  return scopeActorToGroup(actor, conversation.branch_id, info.participants, members);
}
