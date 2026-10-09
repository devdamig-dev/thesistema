import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { hasPermission, canSeeModule } from "../lib/permissions";
import * as service from "../lib/expenses/service";
import * as read from "../lib/expenses/read";
import * as validation from "../lib/expenses/validation";
import * as inboxDomain from "../lib/expenses/inbox";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const state = { database: true, authenticated: true, active: true, role: "owner", userId: id(1), businessId: id(2), enabled: ["fixed_expenses", "inbox_ai"], failure: "", throwCache: false, revision: "0", changeRevision: false, calls: [] as any[], paths: [] as string[], selections: [] as any[] };
const input = () => ({ requestId: id(9), businessId: id(2), userId: id(1), id: null, expectedVersion: null, branchId: id(3), name: "Internet", category: "Servicios", amount: "123.45", dueDate: null, status: "pending" as const });
const db: any = { from: (table: string) => {
  let single = false; let fields = ""; const filters: Record<string, unknown> = {};
  const q: any = { select: (value: string) => { fields = value; state.selections.push({ table, fields, filters }); return q; }, eq: (key: string, value: unknown) => { filters[key] = value; return q; }, in: () => q, gte: () => q, order: () => q, limit: () => q, range: () => q, maybeSingle: () => { single = true; return q; }, then: (resolve: any) => {
    const rows = table === "ai_extractions" ? [{id:id(20), business_id:id(2),branch_id:id(3),message_id:id(21),type:"expense",status:"pending",fields:{concept:"Internet",amount:123.45,payment_method:"Efectivo",date:"2026-10-09"}}] : table === "whatsapp_messages" ? [{business_id:id(2),branch_id:id(3)}] : table === "profiles" ? [{ active: state.active }] : table === "businesses" ? [{ timezone: "UTC" }] : table === "branches" ? [{ id: id(3), name: "Central" }] : table === "suppliers" ? [{ id: id(40), name: "Proveedor QA", active: true }] : table === "expenses" ? [{ id: id(10), expense_date: "2026-10-09", payment_method: "Transferencia", supplier_id: id(40), is_recurring: true, periodicity: "monthly", name: "Internet", category: "Servicios", amount: "123.45", status: "pending", record_status: "active", version: 1, branch_id: id(3), branches: { name: "Central" } }, { id: id(11), name: "Anulado", category: "Servicios", amount: "999.00", status: "paid", record_status: "voided", version: 2, branch_id: id(3) }] : table === "purchases" ? [{ id: id(12), total: "10.00" }] : table === "balance_snapshots" ? [{ gross_margin_pct: "30", sales_data_stale: false, expenses_data_stale: true }] : [];
    return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null, count: rows.length }).then(resolve);
  } }; return q;
}, rpc: async (name: string, args: any) => { state.calls.push({ name, args }); if (name === "get_expenses_revision") return { data: state.changeRevision ? String(state.calls.length) : state.revision, error: null }; if (state.failure === "throw") throw new Error("network"); return state.failure === "unknown" ? { data: null, error: { code: "timeout" } } : state.failure ? { data: { ok: false, error: state.failure }, error: null } : { data: { ok: true, id: id(10), version: 1 }, error: null }; } };
const loader = Module as any; const original = loader._load;
loader._load = function (name: string, ...args: any[]) { const mocks: any = { "next/cache": { revalidatePath: (path: string) => { state.paths.push(path); if (state.throwCache) throw new Error("cache"); } }, "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: state.authenticated, userId: state.userId, businessId: state.businessId, role: state.role, enabledModules: state.enabled, assignedBranchIds: null }) }, "@/lib/supabase/server": { createSupabaseServerClient: async () => db }, "@/lib/env": { isDatabaseMode: () => state.database }, "@/lib/permissions": { hasPermission, canSeeModule }, "@/lib/expenses/service": service, "@/lib/expenses/read": read, "@/lib/expenses/validation": validation, "@/lib/expenses/inbox": inboxDomain }; return name in mocks ? mocks[name] : original.call(this, name, ...args); };
const actions = require("../app/actions/expenses-page") as typeof import("../app/actions/expenses-page"); const inboxActions = require("../app/actions/inbox-expenses") as typeof import("../app/actions/inbox-expenses"); loader._load = original;
function reset() { Object.assign(state, { database: true, authenticated: true, active: true, role: "owner", userId: id(1), businessId: id(2), enabled: ["fixed_expenses", "inbox_ai"], failure: "", throwCache: false, revision: "0", changeRevision: false, calls: [], paths: [], selections: [] }); }
test("expense action calls one atomic domain RPC; cache exception preserves confirmed receipt", async () => {
  reset(); state.throwCache = true; assert.equal((await actions.createExpenseAction(input())).ok, true); assert.equal(state.calls.length, 1); assert.equal(state.calls[0].name, "save_expense_atomic");
  for (const path of ["/gastos", "/auditoria", "/balances", "/dashboard"]) assert.ok(state.paths.includes(path));
});
test("expense actions reject session, role, profile, module and cross-tenant context before RPC", async () => {
  for (const setup of [() => { state.database = false; }, () => { state.authenticated = false; }, () => { state.active = false; }, () => { state.role = "viewer"; }, () => { state.role = "accountant"; }, () => { state.enabled = []; }, () => { state.userId = id(99); }, () => { state.businessId = id(99); }]) { reset(); setup(); assert.equal((await actions.saveExpenseAction(input())).ok, false); assert.equal(state.calls.length, 0); }
  reset(); assert.equal((await actions.createExpenseAction({ ...input(), id: id(10), expectedVersion: 1 })).ok, false); assert.equal(state.calls.length, 0);
});
test("expense SQL rejection differs from connection uncertainty without implicit retry", async () => {
  for (const failure of ["throw", "unknown", "expense_conflict"]) { reset(); state.failure = failure; assert.equal((await actions.saveExpenseAction(input())).persisted, failure === "expense_conflict" ? false : "unknown"); assert.equal(state.calls.length, 1); }
});
test("expense page excludes voided totals and stale balances; purchases filter excludes voids", async () => {
  reset(); const result = await actions.getExpensesPageDataAction(); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.data.expenses.length, 2); assert.equal(result.data.totalFixed, 123.45); assert.equal(result.data.totalVariable, 10); assert.equal(result.data.grossMarginPct, null); assert.equal(result.data.expenses[0].amount, "123.45");
  assert.equal(state.selections.find((q) => q.table === "purchases").filters.record_status, "active"); assert.ok(state.selections.find((q) => q.table === "expenses").fields.includes("amount::text"));
  reset(); state.changeRevision = true; assert.equal((await actions.getExpensesPageDataAction()).ok, false);
});
test("expense read-only accountant sees history but cannot mutate", async () => {
  reset(); state.role = "accountant"; const result = await actions.getExpensesPageDataAction(); assert.equal(result.ok, true); if (result.ok) assert.equal(result.data.canManage, false);
  assert.equal((await actions.getExpenseHistoryAction(id(10))).ok, true); assert.equal((await actions.saveExpenseAction(input())).ok, false);
});
test("Inbox expense preview never infers payment status or due date from extraction", async () => {
  reset(); const result = await inboxActions.getInboxExpenseReviewAction(id(20)); assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.review.dueDate, null); assert.equal(Object.hasOwn(result.review, "status"), false); assert.equal(result.review.branchId, id(3)); assert.equal(state.calls.length, 0);
});
test("Inbox expense action atomically binds original fields, actor, tenant and review", async () => {
  reset(); const request = { extractionId: id(20), businessId: id(2), userId: id(1), expectedFields: { amount: 123.45 }, review: { branchId: id(3), name: "Internet", category: "Servicios", amount: "123.45", dueDate: null, status: "pending" } };
  state.throwCache = true; assert.equal((await inboxActions.approveInboxExpenseAction(request)).ok, true); assert.equal(state.calls.length, 1); assert.equal(state.calls[0].name, "approve_expense_extraction_atomic"); assert.deepEqual(state.calls[0].args.p_review, request.review); assert.deepEqual(state.calls[0].args.p_expected_fields, request.expectedFields);
  for (const change of [() => { state.userId = id(99); }, () => { state.businessId = id(99); }, () => { state.enabled = ["fixed_expenses"]; }, () => { state.role = "accountant"; }]) { reset(); change(); assert.equal((await inboxActions.approveInboxExpenseAction(request)).persisted, false); assert.equal(state.calls.length, 0); }
  reset(); state.failure = "throw"; assert.equal((await inboxActions.approveInboxExpenseAction(request)).persisted, "unknown"); assert.equal(state.calls.length, 1);
});

test("expense page maps declared fields, keeps historical nulls and scopes supplier catalog", async () => {
  reset(); const result = await actions.getExpensesPageDataAction(); assert.equal(result.ok, true); if (!result.ok) return;
  const row = result.data.expenses[0]; assert.equal(row.expenseDate, "2026-10-09"); assert.equal(row.paymentMethod, "Transferencia"); assert.equal(row.supplierId, id(40)); assert.equal(row.supplierName, "Proveedor QA"); assert.equal(row.isRecurring, true); assert.equal(row.periodicity, "monthly");
  assert.equal(result.data.expenses[1].expenseDate, null); assert.equal(result.data.expenses[1].paymentMethod, null); assert.equal(result.data.expenses[1].isRecurring, null);
  assert.equal(state.selections.find((q) => q.table === "suppliers").filters.business_id, id(2));
  reset(); const review = await inboxActions.getInboxExpenseReviewAction(id(20)); assert.ok(review.ok); if (!review.ok) return;
  assert.equal(Object.hasOwn(review.review, "expenseDate"), false); assert.equal(Object.hasOwn(review.review, "paymentMethod"), false); assert.equal(Object.hasOwn(review.review, "isRecurring"), false); assert.equal(review.review.suppliers.length, 1);
  assert.equal(state.selections.find((q) => q.table === "suppliers").filters.active, true);
});
test("expense actions forward every reviewed operational fact through the atomic service", async () => {
  const fields = { expenseDate: "2026-10-09", paymentMethod: "Transferencia", supplierId: id(40), isRecurring: true, periodicity: "monthly" as const };
  reset(); const result = await actions.createExpenseAction({ ...input(), ...fields }); assert.ok(result.ok);
  for (const [key, value] of Object.entries(fields)) assert.equal(state.calls[0].args.p_input[key], value);
  reset(); const request = { extractionId: id(20), businessId: id(2), userId: id(1), expectedFields: { amount: 123.45 }, review: { branchId: id(3), name: "Internet", category: "Servicios", amount: "123.45", dueDate: null, status: "pending", ...fields } };
  assert.ok((await inboxActions.approveInboxExpenseAction(request)).ok); assert.deepEqual(state.calls[0].args.p_review, request.review);
});
