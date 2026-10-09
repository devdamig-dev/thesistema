import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as inboxDebtBoundary from "../lib/whatsapp-agent/inbox-debts";
import { getMissingArguments, interpretHeuristically } from "../lib/whatsapp-agent/interpreter";
import { validateToolCall } from "../lib/whatsapp-agent/validation";
import { WHATSAPP_TOOLS } from "../lib/whatsapp-agent/registry";
import { heuristicExtract } from "../lib/ai/heuristic";
import { runAgent } from "../lib/whatsapp-agent/core";
import { hasPermission, permissionsFor } from "../lib/permissions";
import type { AgentActor, AgentDependencies, PendingOperation } from "../lib/whatsapp-agent/types";

const actor: AgentActor = { userId: "actor-a", memberId: "member-a", businessId: "business-a", branchIds: ["branch-a"],
  name: "Operator", role: "kitchen", phone: "5491111111111", enabledModules: ["stock"] };
const state = { dbAvailable: true, role: "kitchen", rpcError: false, failRefresh: false,
  extraction: { id: "extraction-a", type: "stock_update", status: "pending", business_id: "business-a", branch_id: "branch-a", fields: {} },
  rpcData: { ok: true, target_record_id: "movement-a" } as any, queries: [] as any[], rpcs: [] as any[] };
function fakeDb() {
  return {
    from(table: string) {
      const log = { table, filters: {} as any }; state.queries.push(log);
      const q: any = { select() { return q; }, eq(k: string, v: unknown) { log.filters[k] = v; return q; },
        ilike(k: string, v: unknown) { log.filters[k] = v; return q; },
        async maybeSingle() { return { data: table === "ai_extractions" ? state.extraction : { id: "ingredient-a" }, error: null }; } };
      return q;
    },
    async rpc(name: string, args: unknown) { state.rpcs.push({ name, args }); return { data: state.rpcData, error: state.rpcError ? { message: "network" } : null }; },
  };
}
const loader = Module as any; const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const stubs: Record<string, unknown> = {
    "@/lib/whatsapp-agent/inbox-debts": inboxDebtBoundary,
    "next/cache": { revalidatePath() { if (state.failRefresh) throw new Error("refresh_failure"); } },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => state.dbAvailable ? fakeDb() : null },
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/data/activity": { logActivity() { throw new Error("separate_audit_forbidden"); } },
    "@/lib/data/notifications": { createNotification() { throw new Error("separate_notification_unexpected"); } },
    "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: true, userId: actor.userId, businessId: actor.businessId, role: state.role }) },
    "@/lib/permissions/server-action": { assertPermission: async (permission: any) => hasPermission(state.role as any, permission) ? null : { ok: false, persisted: false, error: "forbidden" } },
    "@/lib/permissions": { permissionsFor },
  };
  return name in stubs ? stubs[name] : original.call(this, name, ...args);
};
const { executeTool } = require("../lib/whatsapp-agent/supabase-adapter");
const { approveExtractionAction } = require("../app/actions/inbox");
loader._load = original;
function reset() {
  state.dbAvailable = true; state.role = "kitchen"; state.rpcError = false; state.failRefresh = false;
  state.extraction = { id: "extraction-a", type: "stock_update", status: "pending", business_id: "business-a", branch_id: "branch-a", fields: {} };
  state.rpcData = { ok: true, target_record_id: "movement-a" }; state.queries = []; state.rpcs = [];
}

test("WhatsApp stock retains original reason and unit including sub-gram quantities", async () => {
  for (const [text, qty, unit] of [
    ["Sumá 0.001 kg de carne al stock.", 0.001, "kg"],
    ["Agregá 250 g de carne al stock.", 250, "g"],
    ["Ingresá 250 ml de leche al stock.", 250, "ml"],
    ["Sumá 2,5 litros de leche al stock.", 2.5, "l"],
    ["Sumá 3 unidades de pan al stock.", 3, "unit"],
  ] as const) {
    const call = await interpretHeuristically(text, [...WHATSAPP_TOOLS]); assert.ok(call);
    const valid = validateToolCall(call); assert.deepEqual(valid.issues, []);
    assert.equal(valid.call.arguments.quantity, qty); assert.equal(valid.call.arguments.unit, unit); assert.equal(valid.call.arguments.reason, text);
  }
});
test("WhatsApp stock validation supports zero correction, waste, rejects empty direction/invalid units", () => {
  for (const operation of ["in", "out", "waste", "set"]) {
    const call = { name: "stock.addMovement", arguments: { ingredient: "carne", quantity: operation === "set" ? 0 : 1, unit: "g", reason: "Reason", operation } };
    assert.deepEqual(validateToolCall(call).issues, []);
  }
  for (const args of [{ quantity: 0, operation: "in" }, { quantity: 1, operation: "delete" }, { quantity: 1, operation: "in", unit: "box" }]) {
    assert.ok(validateToolCall({ name: "stock.addMovement", arguments: { ingredient: "carne", reason: "Reason", ...args } }).issues.length);
  }
});
test("WhatsApp calls shared SQL adapter with real actor, request reason and unit", async () => {
  reset(); const call = { name: "stock.addMovement", arguments: { ingredient: "carne", quantity: 100, operation: "in", reason: "Sumá 100 g de carne al stock", unit: "g" } };
  state.rpcData = [{ new_current: "1.1", delta: "0.1" }];
  await executeTool(fakeDb(), actor, call);
  assert.deepEqual(state.rpcs, [{ name: "adjust_stock_for_agent", args: { p_business_id: "business-a", p_actor_id: "actor-a", p_ingredient_id: "ingredient-a", p_branch_id: "branch-a", p_operation: "in", p_quantity: 100, p_reason: call.arguments.reason, p_unit: "g" } }]);
  assert.equal(state.queries[0].filters.business_id, "business-a");
  assert.equal(state.queries.some((q) => q.table === "stock_items" || q.table === "stock_movements"), false);
});
test("Inbox count extraction is explicit set and preserves actual statement as reason", () => {
  const input = "Quedan 0.001 kg de carne";
  const result = heuristicExtract(input);
  assert.equal(result.movement_type, "stock_update");
  assert.equal((result.detected_fields as any).qty, 0.001);
  assert.equal((result.detected_fields as any).operation, "set");
  assert.equal((result.detected_fields as any).reason_note, input);
});
test("Inbox stock approval delegates before legacy branch/creator paths", async () => {
  reset(); assert.deepEqual(await approveExtractionAction("extraction-a"), { ok: true, persisted: true, target_entity: "stock_movements", target_record_id: "movement-a" });
  assert.deepEqual(state.rpcs, [{ name: "approve_stock_extraction_atomic", args: { p_extraction_id: "extraction-a", p_business_id: "business-a" } }]);
  assert.deepEqual(state.queries.map((q) => q.table), ["ai_extractions"]);
});
test("Inbox repeated stock approval still asks the atomic RPC for consistent idempotent result", async () => {
  reset(); state.extraction.status = "approved";
  assert.equal((await approveExtractionAction("extraction-a")).ok, true); assert.equal(state.rpcs.length, 1);
});
test("Inbox incomplete fields remain needs_review, mismatched tenant/permission never write", async () => {
  reset(); state.rpcData = { ok: false, needs_review: true, error: "stock_extraction_fields_required" };
  assert.deepEqual(await approveExtractionAction("extraction-a"), { ok: false, persisted: false, error: "missing_fields_for_creation" });
  reset(); state.extraction.business_id = "foreign"; assert.equal((await approveExtractionAction("extraction-a")).ok, false); assert.equal(state.rpcs.length, 0);
  reset(); state.role = "viewer"; assert.equal((await approveExtractionAction("extraction-a")).ok, false); assert.equal(state.rpcs.length, 0);
  reset(); state.dbAvailable = false; assert.equal((await approveExtractionAction("extraction-a")).ok, false); assert.equal(state.rpcs.length, 0);
});
test("Inbox uncertain response never fabricates a target or success", async () => {
  reset(); state.rpcError = true; assert.match((await approveExtractionAction("extraction-a")).error, /No se confirmó/);
  reset(); state.rpcData = { ok: true }; assert.equal((await approveExtractionAction("extraction-a")).error, "stock_approval_result_unconfirmed");
});

test("Inbox refresh failure cannot report a confirmed movement as rolled back", async () => {
  reset(); state.failRefresh = true; assert.equal((await approveExtractionAction("extraction-a")).ok, true); assert.equal(state.rpcs.length, 1);
});

test("an invalid WhatsApp unit must be clarified instead of disappearing into base-unit default", async () => {
  const invalid = validateToolCall({ name: "stock.addMovement", arguments: { ingredient: "carne", quantity: 2, unit: "box", reason: "Delivery", operation: "in" } });
  assert.equal(invalid.issues[0].key, "unit");
  assert.deepEqual(getMissingArguments(invalid.call, [...WHATSAPP_TOOLS]), ["unit"]);
  const corrected = await interpretHeuristically("g", [...WHATSAPP_TOOLS], { id: "pending", actor, toolCall: invalid.call, kind: "clarification", expiresAt: "2026-12-01" });
  assert.ok(corrected); assert.equal(corrected.arguments.unit, "g");
  assert.deepEqual(validateToolCall(corrected).issues, []);
  assert.deepEqual(getMissingArguments(corrected, [...WHATSAPP_TOOLS]), []);
});

test("WhatsApp malformed stock RPC responses are uncertain, not successful", async () => {
  for (const data of [null, [], {}, { new_current: null, delta: 1 }, { new_current: "NaN", delta: 1 }]) {
    reset(); state.rpcData = data;
    await assert.rejects(executeTool(fakeDb(), actor, { name: "stock.addMovement", arguments: { ingredient: "carne", quantity: 1, unit: "g", operation: "in", reason: "Input" } }), /stock_result_unconfirmed/);
  }
});
test("two replies to one stock clarification consume it before writing once", async () => {
  let consumed = false; let writes = 0;
  const pending: PendingOperation = { id: "pending-stock", actor, kind: "clarification", expiresAt: "2026-10-10T00:00:00Z", toolCall: { name: "stock.addMovement", arguments: { ingredient: "carne", quantity: 2, operation: "in", reason: "Delivery" } } };
  const deps: AgentDependencies = {
    resolveActor: async () => actor, claimMessage: async () => true, interpret: interpretHeuristically,
    getPending: async () => pending, savePending: async (value) => ({ id: "pending-stock", ...value }),
    consumePending: async () => { if (consumed) return false; consumed = true; return true; },
    execute: async () => { writes++; return [{ new_current: 2, delta: 2 }]; },
    audit: async () => {}, now: () => new Date("2026-10-09T00:00:00Z"),
  };
  const input = { senderPhone: actor.phone, recipientPhone: "5491100000000", text: "g" };
  const results = await Promise.all([runAgent({ ...input, messageId: "reply-1" }, deps), runAgent({ ...input, messageId: "reply-2" }, deps)]);
  assert.equal(writes, 1); assert.deepEqual(results.map((r) => r.status).sort(), ["completed", "rejected"]);
});
test("WhatsApp stock transport failure never promises rollback", async () => {
  const deps: AgentDependencies = {
    resolveActor: async () => actor, claimMessage: async () => true, interpret: interpretHeuristically,
    getPending: async () => null, savePending: async (value) => ({ id: "pending-stock", ...value }), consumePending: async () => true,
    execute: async () => { throw new Error("fetch_timeout"); }, audit: async () => {}, now: () => new Date("2026-10-09T00:00:00Z"),
  };
  const result = await runAgent({ messageId: "stock-uncertain", senderPhone: actor.phone, recipientPhone: "5491100000000", text: "Sumá 2 g de carne al stock" }, deps);
  assert.equal(result.status, "failed"); assert.match(result.text, /No pude confirmar/); assert.match(result.text, /historial/); assert.doesNotMatch(result.text, /No se realizó ningún cambio/);
});

// Generic Inbox approval must never fall back to a fuzzy payroll name match.
test("Inbox advances require exact reviewed approval even when already marked approved", async () => {
  for (const status of ["pending", "approved"]) {
    reset(); state.role = "admin"; state.extraction.type = "employee_advance"; state.extraction.status = status;
    assert.deepEqual(await approveExtractionAction("extraction-a"), { ok: false, persisted: false, error: "advance_review_required" });
    assert.equal(state.rpcs.length, 0); assert.deepEqual(state.queries.map(q => q.table), ["ai_extractions"]);
  }
});
