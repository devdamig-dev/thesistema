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
const { consumePending } = require("../lib/whatsapp-agent/supabase-adapter");
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
    assert.equal(url.searchParams.get("consumed_at"), "is.null");
    assert.match(url.searchParams.get("expires_at")!, /^gt\.\d{4}-/);
    assert.equal(url.searchParams.get("select"), "id");
    assert.ok(JSON.parse(String(init?.body)).consumed_at);
    const data = consumed ? [] : [{ id: "pending-1" }];
    consumed = true;
    return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
  } } });
  assert.deepEqual(await Promise.all([consumePending(db, "pending-1", actor, true), consumePending(db, "pending-1", actor, true)]), [true, false]);
});

test("adapter propagates database failures instead of authorizing execution", async () => {
  const db = createClient("https://agent.test", "test-key", { global: { fetch: async () =>
    new Response(JSON.stringify({ code: "42501", message: "permission denied" }), { status: 403, headers: { "Content-Type": "application/json" } })
  } });
  await assert.rejects(consumePending(db, "pending-1", actor, true), (error: any) => error.code === "42501");
});
