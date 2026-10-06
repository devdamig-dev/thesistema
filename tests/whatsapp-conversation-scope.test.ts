import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { permissionsFor } from "../lib/permissions/index";
import type { AgentActor } from "../lib/whatsapp-agent/types";

const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/permissions") return { permissionsFor };
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => { throw new Error("not used"); } };
  return original.call(this, name, ...args);
};
const { scopeActorToConversation } = require("../lib/whatsapp-agent/service");
loader._load = original;

const actor: AgentActor = {
  userId: "user-a",
  memberId: "member-a",
  businessId: "business-a",
  phone: "5491111111111",
  name: "Ana",
  role: "owner",
  enabledModules: ["sales"],
  branchIds: null,
};

const conversation = {
  id: "conversation-a",
  business_id: "business-a",
  branch_id: "branch-a",
  provider: "meta",
  provider_conversation_id: "group-1",
  conversation_type: "group",
  display_name: "Operaciones",
};

test("a conversation can never cross businesses", () => {
  assert.equal(scopeActorToConversation(actor, { ...conversation, business_id: "business-b" }), null);
});

test("conversation branch narrows unrestricted and assigned actors", () => {
  assert.deepEqual(scopeActorToConversation(actor, conversation)?.branchIds, ["branch-a"]);
  assert.deepEqual(scopeActorToConversation({ ...actor, branchIds: ["branch-a", "branch-b"] }, conversation)?.branchIds, ["branch-a"]);
});

test("conversation branch rejects an actor who is not assigned", () => {
  assert.equal(scopeActorToConversation({ ...actor, branchIds: ["branch-b"] }, conversation), null);
});

test("an unscoped conversation preserves the actor branch permissions", () => {
  const restricted = { ...actor, branchIds: ["branch-a"] };
  assert.equal(scopeActorToConversation(restricted, { ...conversation, branch_id: null }), restricted);
});

test("migration and settings preserve tenant and conversation isolation contracts", () => {
  const migration = readFileSync("supabase/migrations/20261005170000_whatsapp_authorized_conversations.sql", "utf8");
  const settings = readFileSync("app/ajustes/whatsapp/layout.tsx", "utf8");
  const adapter = readFileSync("lib/whatsapp-agent/supabase-adapter.ts", "utf8");

  assert.match(migration, /unique\(business_id, provider, provider_conversation_id\)/);
  assert.match(migration, /whatsapp_agent_audit_logs add column if not exists conversation_id/);
  assert.match(adapter, /\.eq\("business_id", businessId\)[\s\S]*\.eq\("provider", provider\)/);
  assert.match(adapter, /whatsapp_agent_pending_operations[\s\S]*\.eq\("conversation_id", conversationId/);
  assert.doesNotMatch(settings, /createSupabaseAdminClient/);
  assert.match(migration, /for select to authenticated[\s\S]*is_admin_of_business\(business_id\)/);
  assert.match(migration, /grant select on public\.whatsapp_authorized_conversations to authenticated/);
  assert.match(migration, /whatsapp_authorized_conversations_branch_id_idx/);
  assert.match(migration, /whatsapp_authorized_conversations_created_by_idx/);
  assert.match(migration, /whatsapp_agent_messages_conversation_id_idx/);
  assert.match(migration, /whatsapp_agent_pending_operations_conversation_id_idx/);
  assert.match(migration, /whatsapp_agent_audit_logs_conversation_id_idx/);
  assert.match(settings, /whatsapp_authorized_conversations[\s\S]*\.eq\("business_id", ctx\.businessId\)/);
});
