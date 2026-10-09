import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import * as reporting from "../app/ventas/reporting";
const branch = "80000000-0000-4000-8000-000000000001";
const secondBranch = "80000000-0000-4000-8000-000000000002";
let context: any = { isAuthenticated: true, userId: "actor-a", businessId: "business-a", assignedBranchIds: [branch], role: "cashier", enabledModules: ["sales"] };
let queryError = false; let denied = false; let moduleEnabled = true;
const now = new Date(Date.now() - 10000).toISOString();
const sales = [
  { id: "1", business_id: "business-a", branch_id: branch, status: "active", sale_kind: "detailed", occurred_at: now, channel: "salon", amount: 30 },
  { id: "2", business_id: "business-a", branch_id: branch, status: "active", sale_kind: "summary", occurred_at: now, channel: "salon", amount: 1000 },
  { id: "3", business_id: "business-a", branch_id: branch, status: "voided", sale_kind: "detailed", occurred_at: now, channel: "salon", amount: 90000 },
  { id: "4", business_id: "business-a", branch_id: secondBranch, status: "active", sale_kind: "detailed", occurred_at: now, channel: "salon", amount: 300 },
  { id: "5", business_id: "business-b", branch_id: branch, status: "active", sale_kind: "detailed", occurred_at: now, channel: "salon", amount: 50000 },
];
const db = { rpc:async()=>({data:"0",error:null}), from(table: string) {
  let rows: any[] = table === "businesses" ? [{ id: "business-a", timezone: "Asia/Kolkata" }] : table === "profiles" ? [{ id: "actor-a", active: true }] : sales;
  let start = 0; let end = Infinity; let single = false;
  const q: any = {
    select() { return q; },
    eq(key: string, value: unknown) { rows = rows.filter((r) => r[key] === value); return q; },
    gte(key: string, value: string) { rows = rows.filter((r) => new Date(r[key]) >= new Date(value)); return q; },
    lt(key: string, value: string) { rows = rows.filter((r) => new Date(r[key]) < new Date(value)); return q; },
    in(key: string, values: string[]) { rows = rows.filter((r) => values.includes(r[key])); return q; },
    or(expression: string) { const ids = expression.match(/\(([^)]*)\)/)?.[1].split(",") ?? []; rows = rows.filter((r) => ids.includes(r.branch_id) || r.branch_id === null); return q; },
    order() { return q; }, range(from: number, to: number) { start = from; end = to; return q; }, maybeSingle() { single = true; return q; },
    then(resolve: any, reject: any) { return Promise.resolve({ data: single ? rows[0] ?? null : rows.slice(start, end + 1), count: rows.length, error: queryError ? { code: "offline" } : null }).then(resolve, reject); },
  }; return q;
} };
const loader = Module as any; const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: any = {
    "@/lib/supabase/server": { createSupabaseServerClient: async () => db },
    "@/lib/data/auth": { getCurrentUserContext: async () => context },
    "@/lib/permissions/server-action": { assertPermission: async () => denied ? { error: "forbidden" } : null },
    "@/lib/permissions": { canSeeModule: () => moduleEnabled },
    "@/app/ventas/reporting": reporting,
    "@/lib/data/branch-scope": { applyAdminBranchScope: (query: any, ids: string[] | null) => ids === null ? query : query.in("branch_id", ids) },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { getSalesPageDataAction } = require("../app/actions/sales-page") as typeof import("../app/actions/sales-page"); loader._load = original;
test("sales report applies tenant, branch and active filters with honest ticket statistics", async () => {
  const result = await getSalesPageDataAction("current_month", branch);
  assert.equal(result.ok, true); assert.equal(result.data.totalRecords, 2); assert.equal(result.data.totalTickets, 1); assert.equal(result.data.averageTicket, 30); assert.equal(result.data.salesByChannel[0].total, 1030);
  assert.equal((await getSalesPageDataAction("current_month", secondBranch)).ok, false);
  context.assignedBranchIds = []; const empty = await getSalesPageDataAction(); assert.equal(empty.ok && empty.data.totalRecords, 0); context.assignedBranchIds = [branch];
});
test("sales report never substitutes empty report for read, role, module or session errors", async () => {
  queryError = true; assert.equal((await getSalesPageDataAction()).ok, false); queryError = false;
  denied = true; assert.equal((await getSalesPageDataAction()).ok, false); denied = false;
  moduleEnabled = false; assert.equal((await getSalesPageDataAction()).ok, false); moduleEnabled = true;
  context.isAuthenticated = false; assert.equal((await getSalesPageDataAction()).ok, false); context.isAuthenticated = true;
});
