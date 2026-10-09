import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { hasPermission, canSeeModule } from "../lib/permissions";
import * as inbox from "../lib/purchases/inbox";
import * as service from "../lib/purchases/service";
import * as read from "../lib/expenses/read";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const extracted = () => ({ supplier: "Proveedor QA", item: "Tomate", total_amount: 300, quantity: 2, unit: "kg", payment_method: "Efectivo", extra: { original: true } });
const proposal = () => ({ extractionId: id(20), businessId: id(2), userId: id(1), expectedFields: extracted(), review: { kind: "summary", branchId: id(3), supplierId: id(4), purchasedAt: "2026-10-09", paymentMethod: "Efectivo", amount: "300.00" } });
const defaults = () => ({ database: true, dbAvailable: true, authenticated: true, active: true, role: "owner", userId: id(1) as string | null, businessId: id(2) as string | null, enabled: ["purchases", "inbox_ai"], assigned: null as string[] | null, extraction: { id: id(20), business_id: id(2) as string | null, branch_id: id(3) as string | null, message_id: id(21), type: "purchase", status: "pending", fields: extracted() as any }, message: { business_id: id(2), branch_id: id(3) as string | null }, suppliers: [{ id: id(4), name: "Proveedor QA" }], ingredients: [{ id: id(5), name: "Tomate", unit: "kg" }], branches: [{ id: id(3), name: "Central" }], errorTable: "", missingTable: "", badCountTable: "", failure: "", response: undefined as unknown, throwCache: false, calls: [] as any[], paths: [] as string[], selections: [] as { table: string; fields: string; filters: Record<string, unknown>; range?: number[] }[] });
const state = defaults();
const db: any = {
  from(table: string) {
    let single = false; let range = [0, 999]; const filters: Record<string, unknown> = {};
    const selection = { table, fields: "", filters, range };
    const q: any = {
      select(fields: string) { selection.fields = fields; state.selections.push(selection); return q; },
      eq(key: string, value: unknown) { filters[key] = value; return q; },
      in(key: string, value: unknown) { filters[key] = value; return q; },
      order() { return q; },
      range(from: number, to: number) { range = [from, to]; selection.range = range; return q; },
      maybeSingle() { single = true; return q; },
      then(resolve: any, reject: any) {
        let rows: any[] = table === "profiles" ? [{ active: state.active }] : table === "ai_extractions" ? [state.extraction] : table === "whatsapp_messages" ? [state.message] : table === "branches" ? state.branches : table === "suppliers" ? state.suppliers : table === "ingredients" ? state.ingredients : [];
        if (state.missingTable === table) rows = [];
        if (table === "branches" && Array.isArray(filters.id)) rows = rows.filter(row => (filters.id as string[]).includes(row.id));
        return Promise.resolve({ data: single ? rows[0] ?? null : rows.slice(range[0], range[1] + 1), error: state.errorTable === table ? { code: "read_error" } : null, count: state.badCountTable === table ? null : rows.length }).then(resolve, reject);
      },
    };
    return q;
  },
  async rpc(name: string, args: any) {
    state.calls.push({ name, args });
    if (state.failure === "throw") throw new Error("network");
    if (state.response !== undefined) return state.response;
    if (state.failure) return { data: null, error: { code: state.failure } };
    return { data: { ok: true, id: id(30), replayed: false, source: "inbox", kind: args.p_input.review.kind }, error: null };
  },
};
const loader = Module as any; const original = loader._load;
loader._load = function (name: string, ...args: any[]) {
  const mocks: any = {
    "next/cache": { revalidatePath: (path: string) => { state.paths.push(path); if (state.throwCache) throw new Error("cache"); } },
    "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: state.authenticated, userId: state.userId, businessId: state.businessId, role: state.role, enabledModules: state.enabled, assignedBranchIds: state.assigned }) },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => state.dbAvailable ? db : null },
    "@/lib/env": { isDatabaseMode: () => state.database }, "@/lib/permissions": { hasPermission, canSeeModule },
    "@/lib/permissions/server-action": { assertPermission: async () => null },
    "@/lib/data/activity": { logActivity: async () => { throw new Error("Unexpected legacy write"); } },
    "@/lib/data/notifications": { createNotification: async () => { throw new Error("Unexpected notification"); } },
    "@/lib/whatsapp-agent/inbox-debts": { executeInboxDebt: async () => { throw new Error("Unexpected debt transport"); }, prepareInboxDebt: async () => { throw new Error("Unexpected debt preview"); } },
    "@/lib/purchases/inbox": inbox, "@/lib/purchases/service": service, "@/lib/expenses/read": read,
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions = require("../app/actions/inbox-purchases") as typeof import("../app/actions/inbox-purchases");
const genericActions = require("../app/actions/inbox") as typeof import("../app/actions/inbox");
loader._load = original;
const reset = () => Object.assign(state, defaults());

test("purchase preview remains read-only, keeps exact expectedFields and does not infer date, price, kind or stock mapping", async () => {
  reset(); const result = await actions.getInboxPurchaseReviewAction(id(20));
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.deepEqual(result.review.expectedFields, extracted()); assert.equal(result.review.supplierId, id(4));
  assert.equal(result.review.purchasedAt, ""); assert.equal(Object.hasOwn(result.review, "kind"), false);
  assert.deepEqual(result.review.items, [{ ingredientId: null, description: "Tomate", qty: "2", unit: "kg", unitPrice: "" }]);
  assert.equal(result.review.amount, "300"); assert.equal(result.review.alreadyApproved, false); assert.equal(state.calls.length, 0);
  state.extraction.fields.extra.original = false; assert.deepEqual(result.review.expectedFields.extra, { original: true });
  for (const table of ["branches", "suppliers", "ingredients"]) assert.equal(state.selections.find(s => s.table === table)?.filters.business_id, id(2));
  for (const table of ["suppliers", "ingredients"]) assert.equal(state.selections.find(s => s.table === table)?.filters.active, true);
});

test("purchase preview only resolves a unique exact supplier label and never fabricates missing quantities", async () => {
  reset(); state.suppliers.push({ id: id(6), name: " PROVEEDOR QA " }); state.extraction.fields = { total_amount: 1000, supplier: "Proveedor QA" };
  const result = await actions.getInboxPurchaseReviewAction(id(20)); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.review.supplierId, ""); assert.equal(result.review.paymentMethod, ""); assert.equal(result.review.purchasedAt, "");
  assert.deepEqual(result.review.items, [{ ingredientId: null, description: "", qty: "", unit: "", unitPrice: "" }]);
});

test("purchase preview rejects missing/closed/foreign origin and mismatched branches without RPC", async () => {
  const setups = [
    () => { state.extraction.type = "expense"; }, () => { state.extraction.status = "rejected"; },
    () => { state.extraction.business_id = id(99); }, () => { state.message.business_id = id(99); },
    () => { state.message.branch_id = id(99); }, () => { state.assigned = []; },
    () => { state.assigned = [id(99)]; }, () => { state.branches = []; },
    () => { state.extraction.fields = []; }, () => { state.extraction.fields = { amount: NaN }; },
    ...["profiles", "ai_extractions", "whatsapp_messages"].flatMap(table => [() => { state.errorTable = table; }, () => { state.missingTable = table; }]),
  ];
  for (const setup of setups) { reset(); setup(); assert.equal((await actions.getInboxPurchaseReviewAction(id(20))).ok, false); assert.equal(state.calls.length, 0); }
  reset(); assert.equal((await actions.getInboxPurchaseReviewAction("invalid")).ok, false); assert.equal(state.selections.length, 0);
});

test("purchase preview permits legacy nullable extraction tenant and branch selection within assigned options", async () => {
  reset(); state.extraction.business_id = null; state.extraction.branch_id = null; state.message.branch_id = null; state.assigned = [id(3)];
  const result = await actions.getInboxPurchaseReviewAction(id(20)); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.review.branchId, null); assert.deepEqual(result.review.branches, state.branches);
  assert.deepEqual(state.selections.find(s => s.table === "branches")?.filters.id, [id(3)]);
});

test("purchase preview identifies already-approved extraction for exact journal replay only", async () => {
  for (const status of ["pending", "needs_review", "failed", "approved"]) {
    reset(); state.extraction.status = status;
    const result = await actions.getInboxPurchaseReviewAction(id(20)); assert.equal(result.ok, true); if (result.ok) assert.equal(result.review.alreadyApproved, status === "approved");
  }
});

test("purchase option reads paginate fully and fail closed instead of offering partial references", async () => {
  reset(); state.suppliers = Array.from({ length: 1001 }, (_, n) => ({ id: id(100 + n), name: `Proveedor ${n}` }));
  const result = await actions.getInboxPurchaseReviewAction(id(20)); assert.equal(result.ok, true); if (result.ok) assert.equal(result.review.suppliers.length, 1001);
  assert.deepEqual(state.selections.filter(s => s.table === "suppliers").map(s => s.range), [[0, 999], [1000, 1999]]);
  for (const table of ["branches", "suppliers", "ingredients"]) {
    reset(); state.errorTable = table; assert.equal((await actions.getInboxPurchaseReviewAction(id(20))).ok, false);
    reset(); state.badCountTable = table; assert.equal((await actions.getInboxPurchaseReviewAction(id(20))).ok, false);
  }
});

test("approval forwards one exact atomic Inbox contract without actor impersonation or arbitrary source", async () => {
  reset(); const request = proposal(); const result = await actions.approveInboxPurchaseAction(request);
  assert.equal(result.ok, true); assert.equal(state.calls.length, 1);
  assert.deepEqual(state.calls[0], { name: "commit_purchase_atomic", args: { p_business_id: id(2), p_input: { expectedFields: request.expectedFields, review: request.review }, p_extraction_id: id(20), p_pending_id: null } });
  assert.equal(state.selections.some(s => ["purchase_items", "stock_movements", "purchases"].includes(s.table)), false);
  assert.equal(Object.hasOwn(state.calls[0].args.p_input.review, "items"), false);
  for (const path of ["/inbox", "/compras", "/stock", "/gastos", "/balances", "/auditoria"]) assert.ok(state.paths.includes(path));
});

test("approval forwards detailed lines verbatim and leaves total/stock effects inside the atomic RPC", async () => {
  reset(); const request = { ...proposal(), review: { kind: "detailed", branchId: id(3), supplierId: id(4), purchasedAt: "2026-10-09", paymentMethod: "Efectivo", items: [{ ingredientId: id(5), description: "Tomate", qty: "2.125000", unit: "kg", unitPrice: "100.00" }, { ingredientId: null, description: "Envío", qty: "1", unit: "servicio", unitPrice: "0" }] } };
  assert.equal((await actions.approveInboxPurchaseAction(request)).ok, true);
  assert.deepEqual(state.calls[0].args.p_input.review, request.review); assert.equal(Object.hasOwn(state.calls[0].args.p_input.review, "amount"), false);
});

test("preview and approval fail closed for stale session, inactive profile, missing database, role, module and branch", async () => {
  const setups = [() => { state.database = false; }, () => { state.dbAvailable = false; }, () => { state.authenticated = false; }, () => { state.active = false; }, () => { state.userId = null; }, () => { state.businessId = null; }, () => { state.role = "viewer"; }, () => { state.role = "accountant"; }, () => { state.enabled = []; }, () => { state.enabled = ["purchases"]; }, () => { state.enabled = ["inbox_ai"]; }, () => { state.assigned = []; }, () => { state.errorTable = "profiles"; }];
  for (const setup of setups) {
    reset(); setup(); assert.equal((await actions.approveInboxPurchaseAction(proposal())).persisted, false); assert.equal(state.calls.length, 0);
    assert.equal((await actions.getInboxPurchaseReviewAction(id(20))).ok, false);
  }
  for (const setup of [() => { state.userId = id(99); }, () => { state.businessId = id(99); }]) { reset(); setup(); assert.equal((await actions.approveInboxPurchaseAction(proposal())).persisted, false); assert.equal(state.calls.length, 0); }
  reset(); assert.equal((await actions.approveInboxPurchaseAction({ ...proposal(), source: "manual" })).persisted, false); assert.equal(state.selections.length, 0); assert.equal(state.calls.length, 0);
});

test("atomic stale-extraction rejection returns definitive rollback without retry or cache invalidation", async () => {
  for (const code of ["23514", "23505", "42501", "22023", "P0001"]) { reset(); state.failure = code; assert.equal((await actions.approveInboxPurchaseAction(proposal())).persisted, false); assert.equal(state.calls.length, 1); assert.equal(state.paths.length, 0); }
});

test("transport failures and malformed/mismatched receipts remain uncertain and never trigger implicit retry", async () => {
  for (const failure of ["throw", "08006", "timeout", "23514-corrupt"]) { reset(); state.failure = failure; assert.equal((await actions.approveInboxPurchaseAction(proposal())).persisted, "unknown"); assert.equal(state.calls.length, 1); assert.equal(state.paths.length, 0); }
  for (const data of [null, { ok: true }, { ok: "yes", id: id(30), replayed: false, source: "inbox", kind: "summary" }, { ok: true, id: id(30), replayed: false, source: "manual", kind: "summary" }, { ok: true, id: id(30), replayed: false, source: "inbox", kind: "detailed" }]) { reset(); state.response = { data, error: null }; assert.equal((await actions.approveInboxPurchaseAction(proposal())).persisted, "unknown"); assert.equal(state.calls.length, 1); assert.equal(state.paths.length, 0); }
});

test("cache errors cannot turn a confirmed purchase or exact replay into uncertainty", async () => {
  reset(); state.throwCache = true; state.response = { data: { ok: true, id: id(30), replayed: true, source: "inbox", kind: "summary" }, error: null };
  const result = await actions.approveInboxPurchaseAction(proposal()); assert.equal(result.ok, true); if (result.ok) assert.equal(result.replayed, true);
  assert.equal(state.calls.length, 1); assert.equal(state.paths.length, 6);
});


test("generic ID-only Inbox approval refuses purchases before legacy inserts, updates, audit or notification", async () => {
  for (const status of ["pending", "needs_review", "failed", "approved"]) {
    reset(); state.extraction.status = status;
    assert.deepEqual(await genericActions.approveExtractionAction(id(20)), { ok: false, persisted: false, error: "purchase_review_required" });
    assert.equal(state.calls.length, 0); assert.equal(state.paths.length, 0);
    assert.deepEqual(state.selections.map(s => s.table), ["ai_extractions"]);
  }
});
