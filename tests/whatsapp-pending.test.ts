import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";
import { permissionsFor } from "../lib/permissions/index";
import type { AgentActor } from "../lib/whatsapp-agent/types";

const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  return name === "@/lib/permissions" ? { permissionsFor } : original.call(this, name, ...args);
};
const { consumePending, resolveActor, resolveAuthorizedConversation } = require("../lib/whatsapp-agent/supabase-adapter");
loader._load = original;

const actor: AgentActor = { userId: "u", memberId: "m", businessId: "b", phone: "5491111111111", name: "Ana", role: "owner", enabledModules: ["debts"], branchIds: null };

test("adapter sends a scoped conditional UPDATE and only one racing request wins", async () => {
  let consumed = false;
  const db = createClient("https://agent.test", "test-key", { global: { fetch: async (request, init) => {
    const url = new URL(String(request));
    assert.equal(init?.method, "PATCH");
    assert.equal(url.pathname, "/rest/v1/whatsapp_agent_pending_operations");
    assert.equal(url.searchParams.get("id"), "eq.pending-1");
    assert.equal(url.searchParams.get("business_id"), "eq.b");
    assert.equal(url.searchParams.get("member_id"), "eq.m");
    assert.equal(url.searchParams.get("conversation_id"), "eq.conversation-a");
    assert.equal(url.searchParams.get("consumed_at"), "is.null");
    assert.match(url.searchParams.get("expires_at")!, /^gt\.\d{4}-/);
    assert.equal(url.searchParams.get("select"), "id");
    assert.ok(JSON.parse(String(init?.body)).consumed_at);
    const data = consumed ? [] : [{ id: "pending-1" }];
    consumed = true;
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  } } });
  assert.deepEqual(await Promise.all([
    consumePending(db, "pending-1", actor, true, "conversation-a"),
    consumePending(db, "pending-1", actor, true, "conversation-a"),
  ]), [true, false]);
});

test("adapter propagates database failures instead of authorizing execution", async () => {
  const db = createClient("https://agent.test", "test-key", { global: { fetch: async () =>
    new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 403, headers: { "Content-Type": "application/json" } })
  } });
  await assert.rejects(consumePending(db, "pending-1", actor, true), (error: any) => error.code === "42501");
});

type IdentityRows = Record<string, unknown[] | { error: string }>;
const identityInput = {
  messageId: "wamid.identity",
  senderPhone: "+54 9 11 1234-5678",
  recipientPhone: "+54 9 11 9999-0000",
  text: "ventas de hoy",
};

function identityDb(rows: IdentityRows, requests: string[] = []) {
  return createClient("https://agent.test", "test-key", { global: { fetch: async (request) => {
    const url = new URL(String(request));
    const table = url.pathname.split("/").at(-1)!;
    requests.push(table);
    const value = rows[table] ?? [];
    if (!Array.isArray(value)) {
      return new Response(JSON.stringify({ code: "XX000", message: value.error }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } } });
}

const validIdentityRows: IdentityRows = {
  whatsapp_integrations: [{ business_id: "business-a", display_phone_number: "+54 9 11 9999-0000" }],
  profiles: [{ id: "user-a", full_name: "Ana", phone: "+54 9 11 1234-5678" }],
  business_members: [{ id: "member-a", role: "owner" }],
  business_modules: [{ module_key: "sales" }],
  branch_assignments: [],
};

test("phone identity resolves one exact active profile inside the recipient business", async () => {
  const resolved = await resolveActor(identityDb(validIdentityRows), identityInput);
  assert.equal(resolved?.businessId, "business-a");
  assert.equal(resolved?.userId, "user-a");
  assert.deepEqual(resolved?.enabledModules, ["sales"]);
});

test("ambiguous recipient or sender phones fail closed before authorization", async () => {
  const ambiguousIntegration = {
    ...validIdentityRows,
    whatsapp_integrations: [
      { business_id: "business-a", display_phone_number: "+54 9 11 9999-0000" },
      { business_id: "business-b", display_phone_number: "5491199990000" },
    ],
  };
  const integrationRequests: string[] = [];
  assert.equal(await resolveActor(identityDb(ambiguousIntegration, integrationRequests), identityInput), null);
  assert.deepEqual(integrationRequests, ["whatsapp_integrations"]);

  const ambiguousProfile = {
    ...validIdentityRows,
    profiles: [
      { id: "user-a", full_name: "Ana", phone: "+54 9 11 1234-5678" },
      { id: "user-b", full_name: "Otra Ana", phone: "5491112345678" },
    ],
  };
  const profileRequests: string[] = [];
  assert.equal(await resolveActor(identityDb(ambiguousProfile, profileRequests), identityInput), null);
  assert.deepEqual(profileRequests, ["whatsapp_integrations", "profiles"]);
});

test("legacy recipient lookup rejects zero or multiple businesses", async () => {
  for (const businesses of [
    [],
    [
      { id: "business-a", whatsapp_phone: "+54 9 11 9999-0000" },
      { id: "business-b", whatsapp_phone: "5491199990000" },
    ],
  ]) {
    const rows = { ...validIdentityRows, whatsapp_integrations: [], businesses };
    assert.equal(await resolveActor(identityDb(rows), identityInput), null);
  }
});

test("every identity query error fails closed without using partial data", async () => {
  for (const failingTable of [
    "whatsapp_integrations",
    "businesses",
    "profiles",
    "business_members",
    "business_modules",
    "branch_assignments",
  ]) {
    const rows: IdentityRows = {
      ...validIdentityRows,
      ...(failingTable === "businesses" ? { whatsapp_integrations: [] } : {}),
      [failingTable]: { error: `${failingTable} unavailable` },
    };
    const requests: string[] = [];
    assert.equal(await resolveActor(identityDb(rows, requests), identityInput), null, failingTable);
    if (failingTable === "whatsapp_integrations") assert.deepEqual(requests, ["whatsapp_integrations"]);
  }
});

test("missing or duplicated membership cannot authorize the sender", async () => {
  for (const memberships of [
    [],
    [{ id: "member-a", role: "owner" }, { id: "member-b", role: "admin" }],
  ]) {
    const rows = { ...validIdentityRows, business_members: memberships };
    assert.equal(await resolveActor(identityDb(rows), identityInput), null);
  }
});

test("authorized conversations are resolved inside the actor business only", async () => {
  const db = createClient("https://agent.test", "test-key", { global: { fetch: async (request) => {
    const url = new URL(String(request));
    assert.equal(url.pathname, "/rest/v1/whatsapp_authorized_conversations");
    assert.equal(url.searchParams.get("business_id"), "eq.business-a");
    assert.equal(url.searchParams.get("provider"), "eq.meta");
    assert.equal(url.searchParams.get("provider_conversation_id"), "eq.group-1");
    assert.equal(url.searchParams.get("enabled"), "eq.true");
    assert.equal(url.searchParams.get("limit"), "2");
    return new Response(JSON.stringify([{
      id: "conversation-a",
      business_id: "business-a",
      branch_id: "branch-a",
      provider: "meta",
      provider_conversation_id: "group-1",
      conversation_type: "group",
      display_name: "Operaciones",
    }]), { status: 200, headers: { "Content-Type": "application/json" } });
  } } });

  const conversation = await resolveAuthorizedConversation(db, {
    ...identityInput,
    provider: "meta",
    providerConversationId: "group-1",
  }, "business-a");
  assert.equal(conversation?.id, "conversation-a");
  assert.equal(conversation?.business_id, "business-a");
});

test("missing, duplicated, or failed conversation lookup never authorizes processing", async () => {
  for (const response of [
    new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } }),
    new Response(JSON.stringify([{ id: "a" }, { id: "b" }]), { status: 200, headers: { "Content-Type": "application/json" } }),
  ]) {
    const db = createClient("https://agent.test", "test-key", { global: { fetch: async () => response.clone() } });
    assert.equal(await resolveAuthorizedConversation(db, { ...identityInput, providerConversationId: "group-1" }, "business-a"), null);
  }

  const failedDb = createClient("https://agent.test", "test-key", { global: { fetch: async () =>
    new Response(JSON.stringify({ code: "XX000", message: "lookup failed" }), { status: 500, headers: { "Content-Type": "application/json" } })
  } });
  await assert.rejects(
    resolveAuthorizedConversation(failedDb, { ...identityInput, providerConversationId: "group-1" }, "business-a"),
    (error: any) => error.code === "XX000",
  );
});
