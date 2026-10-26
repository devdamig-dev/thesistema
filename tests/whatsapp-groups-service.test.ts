import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { permissionsFor } from "../lib/permissions";
import type { AgentActor, IncomingAgentMessage } from "../lib/whatsapp-agent/types";
import type { GroupMember } from "../lib/whatsapp/groups";

const actor: AgentActor = { userId: "user-a", memberId: "member-a", businessId: "business-a", phone: "5491111111111", name: "Ana", role: "owner", enabledModules: ["sales"], branchIds: null };
const conversation = { id: "conversation-a", business_id: actor.businessId, branch_id: "branch-a", provider: "meta", provider_conversation_id: "Y2FwaV9ncm91cDox", conversation_type: "group", group_phone_number_id: "123456789", group_activated_at: new Date(Date.now() - 60000).toISOString() };
let participants: string[], members: GroupMember[], claims: number, executions: number, lookups: number, enabled: boolean, afterExecute: () => void;
const loader = Module as any, original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/permissions") return { permissionsFor };
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => ({}) };
  if (name === "./groups-store") return {
    groupConnection: async () => ({ phoneNumberId: "123456789", graph: { info: async () => { lookups++; return { participants, suspended: false, approvalRequired: true }; } } }),
    savedGroupMembers: async () => members,
  };
  if (name === "./supabase-adapter") return {
    resolveActor: async () => actor,
    resolveAuthorizedConversation: async () => enabled ? conversation : null,
    claimMessage: async (_db: unknown, _input: unknown, scoped: AgentActor, id: string) => { claims++; assert.equal(id, conversation.id); assert.deepEqual(scoped.branchIds, ["branch-a"]); return true; },
    getPending: async () => null,
    executeTool: async (_db: unknown, scoped: AgentActor) => { executions++; assert.deepEqual(scoped.branchIds, ["branch-a"]); afterExecute(); return { total: 9000, count: 1 }; },
    audit: async () => {},
  };
  return original.call(this, name, ...args);
};
const { processWhatsAppAgentMessage } = require("../lib/whatsapp-agent/service");
loader._load = original;
const input = (): IncomingAgentMessage => ({ messageId: "wamid.fixture", senderPhone: actor.phone, recipientPhone: "5491199999999", text: "ventas de hoy", provider: "meta", providerConversationId: conversation.provider_conversation_id, conversationType: "group", sentAt: Date.now() });
function reset() {
  participants = [actor.phone]; members = [{ memberId: actor.memberId, phone: actor.phone, role: "owner", branchIds: null }];
  claims = executions = lookups = 0; enabled = true; afterExecute = () => {};
}

test("group service executes within its branch and checks the audience before and after", async () => {
  reset(); const reply = await processWhatsAppAgentMessage(input());
  assert.equal(reply.status, "completed"); assert.match(reply.text, /Ventas/);
  assert.equal(executions, 1); assert.equal(claims, 1); assert.equal(lookups, 2);
});
test("unknown group participants and pre-authorization messages cannot claim or run tools", async () => {
  reset(); participants.push("5491100000000");
  assert.equal((await processWhatsAppAgentMessage(input())).status, "ignored");
  assert.equal(executions, 0); assert.equal(claims, 0);
  reset(); assert.equal((await processWhatsAppAgentMessage({ ...input(), sentAt: 1000 })).status, "ignored");
  assert.equal(executions, 0); assert.equal(claims, 0);
});
test("an audience change or group pause during processing suppresses the shared response", async () => {
  for (const change of [() => participants.push("5491100000000"), () => { enabled = false; }]) {
    reset(); afterExecute = change;
    const reply = await processWhatsAppAgentMessage(input());
    assert.equal(executions, 1); assert.equal(reply.text, "");
  }
});
test("a newly restricted participant cannot receive a previously prepared financial result", async () => {
  reset(); afterExecute = () => {
    participants.push("5491122222222");
    members.push({ memberId: "member-b", phone: "5491122222222", role: "accountant", branchIds: null });
  };
  const reply = await processWhatsAppAgentMessage(input());
  assert.equal(executions, 1); assert.equal(reply.text, "");
});
