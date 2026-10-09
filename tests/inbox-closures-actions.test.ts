import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { hasPermission, canSeeModule } from "../lib/permissions";
import * as domain from "../lib/closures/domain";
import * as inboxDomain from "../lib/closures/inbox";
import * as read from "../lib/expenses/read";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = { authenticated: true, active: true, role: "owner", userId: id(1), businessId: id(2), enabled: ["daily_closures", "inbox_ai"], failure: "", calls: [] as any[], cacheThrows: false, type: "daily_closure" };
const db: any = { from: (table: string) => { let single = false; const q: any = { select: () => q, eq: () => q, in: () => q, order: () => q, range: () => q, maybeSingle: () => { single = true; return q; }, then: (resolve: any) => {
  const rows = table === "ai_extractions" ? [{ id: id(20), business_id: id(2), branch_id: id(3), message_id: id(21), type: state.type, status: "pending", fields: { total: 100, cash: 100, date: "16/05" } }] : table === "whatsapp_messages" ? [{ business_id: id(2), branch_id: id(3) }] : table === "profiles" ? [{ active: state.active }] : table === "branches" ? [{ id: id(3), name: "Central" }] : [];
  return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: rows.length }).then(resolve);
} }; return q; }, rpc: async (name: string, args: any) => { state.calls.push({ name, args }); if (state.failure === "throw") throw new Error("lost after commit"); return state.failure ? { data: { ok: false, error: state.failure }, error: null } : { data: { ok: true, id: id(10), version: 1 }, error: null }; } };
const loader = Module as any; const original = loader._load;
loader._load = function (name: string, ...args: any[]) { const mocks: any = { "next/cache": { revalidatePath: () => { if (state.cacheThrows) throw new Error("cache"); } }, "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: state.authenticated, userId: state.userId, businessId: state.businessId, role: state.role, enabledModules: state.enabled, assignedBranchIds: null }) }, "@/lib/supabase/server": { createSupabaseServerClient: async () => db }, "@/lib/env": { isDatabaseMode: () => true }, "@/lib/permissions": { hasPermission, canSeeModule }, "@/lib/closures/domain": domain, "@/lib/closures/inbox": inboxDomain, "@/lib/expenses/read": read }; return name in mocks ? mocks[name] : original.call(this, name, ...args); };
const actions = require("../app/actions/inbox-closures") as typeof import("../app/actions/inbox-closures"); loader._load = original;
const input = () => ({ extractionId: id(20), businessId: id(2), userId: id(1), expectedFields: { total: 100 }, review: { branchId: id(3), closureDate: "2026-01-02", grossTotal: "100.00", netTotal: "80.00", note: "Revisado" } });
function reset() { Object.assign(state, { authenticated: true, active: true, role: "owner", userId: id(1), businessId: id(2), enabled: ["daily_closures", "inbox_ai"], failure: "", calls: [], cacheThrows: false, type: "daily_closure" }); }
test("closure preview suggests only stated values and never derives date or net", async () => {
  reset(); const result = await actions.getInboxClosureReviewAction(id(20)); assert.equal(result.ok, true); if (result.ok) { assert.equal(result.review.closureDate, ""); assert.equal(result.review.netTotal, ""); assert.equal(result.review.grossTotal, "100"); } assert.equal(state.calls.length, 0);
  reset(); state.active = false; assert.equal((await actions.getInboxClosureReviewAction(id(20))).ok, false);
  reset(); state.type = "expense"; const other = await actions.getInboxClosureReviewAction(id(20)); assert.deepEqual(other, { ok: false, error: "unsupported_closure_extraction" });
});
test("closure approval uses one identity-bound atomic RPC and preserves confirmed commit", async () => {
  reset(); state.cacheThrows = true; assert.equal((await actions.approveInboxClosureAction(input())).ok, true); assert.equal(state.calls.length, 1); assert.equal(state.calls[0].name, "approve_closure_extraction_atomic"); assert.deepEqual(state.calls[0].args.p_expected_fields, input().expectedFields); assert.deepEqual(state.calls[0].args.p_review, input().review);
  for (const change of [() => { state.userId = id(99); }, () => { state.businessId = id(99); }, () => { state.enabled = ["daily_closures"]; }, () => { state.role = "viewer"; }, () => { state.role = "waiter"; }]) { reset(); change(); assert.equal((await actions.approveInboxClosureAction(input())).persisted, false); assert.equal(state.calls.length, 0); }
});
test("closure approval uncertain result does not manufacture rollback or retry", async () => {
  reset(); state.failure = "throw"; assert.equal((await actions.approveInboxClosureAction(input())).persisted, "unknown"); assert.equal(state.calls.length, 1);
  reset(); state.failure = "closure_extraction_changed"; assert.equal((await actions.approveInboxClosureAction(input())).persisted, false);
});
