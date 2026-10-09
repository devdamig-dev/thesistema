import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { createClient } from "@supabase/supabase-js";
import { permissionsFor } from "../lib/permissions";
import type { AgentActor } from "../lib/whatsapp-agent/types";

const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  return name === "@/lib/permissions" ? { permissionsFor } : original.call(this, name, ...args);
};
const { claimPurchasePending, cancelPurchasePending, executeTool } = require("../lib/whatsapp-agent/supabase-adapter");
loader._load = original;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: AgentActor = { userId: id(1), memberId: id(2), businessId: id(3), branchIds: [id(4)], enabledModules: ["purchases"], role: "owner", name: "Ana", phone: "5491111111111" };
const expected = { p_business_id: actor.businessId, p_member_id: actor.memberId, p_conversation_id: id(5), p_pending_id: id(6) };

test("purchase claim/cancel adapters bind pending, member, business and conversation and validate responses", async () => {
  const calls: any[] = [];
  const db = createClient("https://agent.test", "test-key", { global: { fetch: async (request, init) => {
    const url = new URL(String(request));
    assert.equal(init?.method, "POST");
    calls.push({ path: url.pathname, args: JSON.parse(String(init?.body)) });
    const result = url.pathname.endsWith("claim_purchase_pending_execution") ? true : { consumed: true, resultUncertain: true };
    return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json" } });
  } } });
  assert.equal(await claimPurchasePending(db, id(6), actor, false, id(5)), true);
  assert.equal(await claimPurchasePending(db, id(6), actor, true, id(5)), true);
  assert.deepEqual(await cancelPurchasePending(db, id(6), actor, id(5)), { consumed: true, resultUncertain: true });
  assert.deepEqual(calls, [
    { path: "/rest/v1/rpc/claim_purchase_pending_execution", args: { ...expected, p_recovery: false } },
    { path: "/rest/v1/rpc/claim_purchase_pending_execution", args: { ...expected, p_recovery: true } },
    { path: "/rest/v1/rpc/cancel_purchase_pending_execution", args: expected },
  ]);
  for (const data of [undefined, null, "true", [], {}, { consumed: true }, { consumed: true, resultUncertain: "false" }]) {
    const bad: any = { rpc: async () => ({ data, error: null }) };
    await assert.rejects(() => claimPurchasePending(bad, id(6), actor, false, id(5)), /pending_response_unknown/);
    await assert.rejects(() => cancelPurchasePending(bad, id(6), actor, id(5)), /pending_response_unknown/);
  }
});

test("WA execution dispatcher forwards only the trusted persisted pending ID to purchase kernel", async () => {
  const calls: any[] = [];
  const db: any = { rpc: async (name: string, args: unknown) => {
    calls.push({ name, args }); return { data: { ok: true, id: id(9), replayed: false, kind: "summary", source: "whatsapp" }, error: null };
  }, from: () => { throw new Error("direct_write_forbidden"); } };
  const call = { name: "purchases.create", arguments: { kind: "summary", branchId: id(4), supplierId: id(7), amount: "100.00", purchasedAt: "2026-10-09", paymentMethod: "Efectivo", requestId: id(8) } };
  assert.equal((await executeTool(db, actor, call, id(6))).ok, true);
  assert.deepEqual(calls, [{ name: "commit_purchase_atomic", args: { p_business_id: actor.businessId, p_input: null, p_extraction_id: null, p_pending_id: id(6) } }]);
  await assert.rejects(() => executeTool(db, actor, call), /purchase_write_rejected/);
  assert.equal(calls.length, 1);
});
