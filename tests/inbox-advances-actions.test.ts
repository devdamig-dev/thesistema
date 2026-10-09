import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import * as permissions from "../lib/permissions";
import * as domain from "../lib/advances/inbox";
import * as validation from "../lib/expenses/validation";
import * as read from "../lib/expenses/read";
import * as employeeDomain from "../lib/employees/domain";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const version = "2026-10-09T10:00:00.123456+00:00";
let ctx: any; let mode = true; let calls: any[] = []; let queries: any[] = []; let rows: Record<string, any> = {}; let rpc: any; let throws = false; let cacheThrows = false;
const input = () => ({ extractionId: id(10), businessId: id(2), userId: id(1), expectedFields: { employee_name: "Juan", amount: 10 }, review: { employeeId: id(4), expectedEmployeeUpdatedAt: version, branchId: id(3), amount: "10.00", date: "2026-10-08", note: "" } });
const db = {
  async rpc(name: string, args: any) { calls.push({ name, args }); if (throws) throw Error("lost"); return rpc; },
  from(table: string) { const entry = { table, filters: {} as any, select: "", range: [] as number[] }; queries.push(entry); const q: any = {
    select(value: string) { entry.select = value; return q; }, eq(k: string, v: any) { entry.filters[k] = v; return q; }, in(k: string, v: any) { entry.filters[k] = v; return q; }, order() { return q; }, range(a: number, b: number) { entry.range = [a, b]; return q; }, maybeSingle() { return Promise.resolve(rows[table]); }, then(resolve: Function) { resolve(rows[table]); }
  }; return q; }
};
function reset() {
  ctx = { isAuthenticated: true, businessId: id(2), userId: id(1), role: "admin", enabledModules: ["inbox_ai", "employees"], assignedBranchIds: null };
  mode = true; calls = []; queries = []; throws = false; cacheThrows = false; rpc = { data: { ok: true, id: id(20) }, error: null };
  rows = { ai_extractions: { data: { id: id(10), type: "employee_advance", fields: input().expectedFields, status: "pending", business_id: id(2), branch_id: id(3), message_id: id(11), target_record_id: null }, error: null }, profiles: { data: { active: true }, error: null }, whatsapp_messages: { data: { business_id: id(2), branch_id: id(3) }, error: null }, branches: { data: [{ id: id(3), name: "Central" }], count: 1, error: null }, employees: { data: [{ id: id(4), full_name: "Juan", role: "Cocina", branch_id: id(3), updated_at: version }, { id: id(5), full_name: "Juan", role: "Salón", branch_id: id(3), updated_at: version }], count: 2, error: null } };
}
const loader = Module as any; const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, unknown> = { "@/lib/supabase/server": { createSupabaseServerClient: async () => db }, "@/lib/data/auth": { getCurrentUserContext: async () => ctx }, "@/lib/env": { isDatabaseMode: () => mode }, "@/lib/permissions": permissions, "@/lib/advances/inbox": domain, "@/lib/expenses/validation": validation, "@/lib/expenses/read": read, "@/lib/employees/domain": employeeDomain, "next/cache": { revalidatePath() { if (cacheThrows) throw Error("cache failed"); } } };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions: typeof import("../app/actions/inbox-advances") = require("../app/actions/inbox-advances"); loader._load = original;
test("advance preview is read only, exact tenant/branch/active employee list keeps duplicate names", async () => {
  reset(); const result = await actions.getInboxAdvanceReviewAction(id(10)); assert.equal(result.ok, true); if (result.ok) { assert.equal(result.review.employees.length, 2); assert.equal(result.review.date, ""); assert.equal(result.review.detectedName, "Juan"); assert.equal(result.review.closed, false); }
  assert.equal(calls.length, 0); const employees = queries.find(q => q.table === "employees"); assert.equal(employees.filters.business_id, id(2)); assert.equal(employees.filters.active, true); assert.deepEqual(employees.filters.branch_id, [id(3)]); assert.deepEqual(employees.range, [0, 999]);
});
test("advance approval calls one atomic RPC with exact token and reviewed date, cache failure preserves success", async () => {
  reset(); cacheThrows = true; assert.equal((await actions.approveInboxAdvanceAction(input())).persisted, true); assert.equal(calls.length, 1); assert.equal(calls[0].name, "approve_employee_advance_extraction_atomic"); assert.equal(calls[0].args.p_actor_id, id(1)); assert.deepEqual(calls[0].args.p_review, input().review); assert.equal(queries.length, 0);
});
test("invalid actors, modules, tenant, inactive profiles and conflicting branches fail closed", async () => {
  for (const patch of [{ role: "manager" }, { role: "viewer" }, { role: "accountant" }, { role: "employee" }, { isAuthenticated: false }, { businessId: id(99) }, { userId: id(99) }, { enabledModules: ["inbox_ai"] }, { enabledModules: ["employees"] }]) { reset(); Object.assign(ctx, patch); assert.equal((await actions.approveInboxAdvanceAction(input())).ok, false); assert.equal(calls.length, 0); }
  reset(); mode = false; assert.equal((await actions.approveInboxAdvanceAction(input())).ok, false); assert.equal(calls.length, 0);
  reset(); rows.profiles.data.active = false; assert.equal((await actions.getInboxAdvanceReviewAction(id(10))).ok, false); assert.equal(queries.some(q => q.table === "employees"), false);
  reset(); rows.whatsapp_messages.data.branch_id = id(99); assert.equal((await actions.getInboxAdvanceReviewAction(id(10))).ok, false);
  reset(); rows.employees.error = { message: "unavailable" }; assert.equal((await actions.getInboxAdvanceReviewAction(id(10))).ok, false);
  reset(); rows.employees.count = 3; assert.equal((await actions.getInboxAdvanceReviewAction(id(10))).ok, false);
});
test("unsupported extraction does not require payroll privileges and closed advances can recover a saved attempt", async () => {
  reset(); ctx.role = "employee"; rows.ai_extractions.data.type = "sale"; assert.deepEqual(await actions.getInboxAdvanceReviewAction(id(10)), { ok: false, error: "unsupported_advance_extraction" });
  reset(); rows.ai_extractions.data.status = "approved"; rows.ai_extractions.data.target_record_id = id(20); const result = await actions.getInboxAdvanceReviewAction(id(10)); assert.equal(result.ok, true); if (result.ok) { assert.equal(result.review.closed, true); assert.equal(result.review.targetAdvanceId, id(20)); }
});
test("uncertain transport never auto-retries or claims rollback", async () => {
  reset(); throws = true; assert.equal((await actions.approveInboxAdvanceAction(input())).persisted, "unknown"); assert.equal(calls.length, 1);
  reset(); rpc = { data: null, error: null }; assert.equal((await actions.approveInboxAdvanceAction(input())).persisted, "unknown");
  reset(); rpc = { data: { ok: false, error: "advance_employee_changed" }, error: null }; assert.equal((await actions.approveInboxAdvanceAction(input())).persisted, false);
});
