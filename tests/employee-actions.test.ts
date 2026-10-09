import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { hasPermission } from "../lib/permissions";

const businessId = "00000000-0000-4000-8000-000000000011";
const employeeId = "00000000-0000-4000-8000-000000000031";
const branchId = "00000000-0000-4000-8000-000000000021";
const fields = { fullName: "Employee", role: "Cook", shift: "", branchId, monthlyHours: "100", monthlyCost: "10000", pendingAdvance: "0", absences: "0", lateArrivals: "0" };
const version = "2026-10-09T01:02:03.123456+00:00";
let mode = true;
let context: any;
let calls: { name: string; args: any }[] = [];
let queryCalls: { table: string; filters: Record<string, unknown>; selection: string; range?: number[] }[] = [];
let rpcResult: any;
let throwRpc = false;
let revalidateThrows = false;
const row = { id: employeeId, full_name: "Employee", role: "Cook", shift: null, branch_id: branchId, monthly_hours: 100, monthly_cost: 10000, pending_advance: 0, absences: 0, late_arrivals: 0, active: true, updated_at: version };
const fromResults: Record<string, any> = {};
const database = () => ({
  async rpc(name: string, args: any) { if (name === "employee_manual_summary") return { data: { count: 60, activeCount: 3, totalMonthlyCost: 500, pendingAdvances: 0, totalAbsences: 0, totalLateArrivals: 0 }, error: null }; calls.push({ name, args }); if (throwRpc) throw new Error("response lost"); return rpcResult; },
  from(table: string) {
    const recorded = { table, filters: {} as Record<string, unknown>, selection: "", range: undefined as number[] | undefined };
    queryCalls.push(recorded);
    const query: any = {
      select(selection: string) { recorded.selection = selection; return query; },
      eq(key: string, value: unknown) { recorded.filters[key] = value; return query; },
      in(key: string, value: unknown) { recorded.filters[key] = value; return query; },
      ilike(key: string, value: unknown) { recorded.filters[`ilike:${key}`] = value; return query; },
      order() { return query; }, limit() { return query; },
      range(start: number, end: number) { recorded.range = [start, end]; return query; },
      maybeSingle() { return Promise.resolve(fromResults[table] ?? { data: null, error: null }); },
      then(resolve: (value: unknown) => void) { resolve(fromResults[table] ?? { data: [], count: 0, error: null }); },
    };
    return query;
  },
});
function reset() {
  context = { isAuthenticated: true, userId: "actor-a", businessId, role: "admin", assignedBranchIds: null };
  mode = true; calls = []; queryCalls = []; throwRpc = false; revalidateThrows = false;
  rpcResult = { data: row, error: null };
  for (const key of Object.keys(fromResults)) delete fromResults[key];
  fromResults.profiles = { data: { active: true }, error: null };
}
const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "@/lib/supabase/server": { createSupabaseServerClient: database },
    "@/lib/data/auth": { getCurrentUserContext: async () => context },
    "@/lib/env": { isDatabaseMode: () => mode },
    "@/lib/permissions": { hasPermission },
    "@/lib/permissions/server-action": {
      withPermission: (permission: any, handler: Function) => (input: unknown) => hasPermission(context.role, permission) ? handler(context, input) : { ok: false, persisted: false, error: "forbidden", message: "No autorizado" },
    },
    "next/cache": { revalidatePath: () => { if (revalidateThrows) throw new Error("cache failure"); } },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions: typeof import("../app/actions/employees-page") = require("../app/actions/employees-page");
loader._load = original;

test("employee create sends server tenant, normalized role and stable ID only", async () => {
  reset();
  const result = await actions.createEmployeeManualAction({ ...fields, id: employeeId, fullName: " Employee ", role: " Cook " });
  assert.equal(result.ok, true); assert.equal(calls[0].name, "create_employee_manual");
  assert.equal(calls[0].args.p_business_id, businessId); assert.equal(calls[0].args.p_full_name, "Employee");
  assert.equal(calls[0].args.p_role, "Cook"); assert.equal(calls[0].args.p_actor_id, undefined); assert.equal(calls[0].args.p_id, employeeId);
});
test("only owner/admin may change employee payroll; readers stay read-only", async () => {
  for (const role of ["manager", "viewer", "accountant", "kitchen", "marketing", "employee"]) {
    reset(); context.role = role;
    assert.equal((await actions.createEmployeeManualAction({ ...fields, id: employeeId })).ok, false);
    assert.equal((await actions.updateEmployeeManualAction({ ...fields, id: employeeId, expectedUpdatedAt: version })).ok, false);
    assert.equal((await actions.setEmployeeActiveAction({ id: employeeId, expectedUpdatedAt: version, active: false })).ok, false);
    assert.equal(calls.length, 0);
  }
  for (const role of ["owner", "admin"]) { reset(); context.role = role; assert.equal((await actions.createEmployeeManualAction({ ...fields, id: employeeId })).ok, true); }
});
test("demo, no session, missing actor/business fail closed", async () => {
  for (const change of [{ isAuthenticated: false }, { businessId: null }, { userId: null }]) {
    reset(); Object.assign(context, change); assert.equal((await actions.createEmployeeManualAction({ ...fields, id: employeeId })).ok, false); assert.equal(calls.length, 0);
  }
  reset(); mode = false; assert.equal((await actions.createEmployeeManualAction({ ...fields, id: employeeId })).ok, false); assert.equal(calls.length, 0);
});
test("invalid values and stale tokens reject before RPC", async () => {
  for (const invalid of [{ ...fields, fullName: "" }, { ...fields, branchId: "bad" }, { ...fields, monthlyCost: "-5" }]) {
    reset(); assert.equal((await actions.createEmployeeManualAction({ ...invalid, id: employeeId })).ok, false); assert.equal(calls.length, 0);
  }
  reset(); assert.equal((await actions.updateEmployeeManualAction({ ...fields, id: employeeId, expectedUpdatedAt: "yesterday" })).ok, false); assert.equal(calls.length, 0);
});
test("employee CAS remains exact and state update keeps tenant", async () => {
  reset(); await actions.updateEmployeeManualAction({ ...fields, id: employeeId, expectedUpdatedAt: version });
  await actions.setEmployeeActiveAction({ id: employeeId, expectedUpdatedAt: version, active: false });
  assert.equal(calls[0].name, "update_employee_manual"); assert.equal(calls[0].args.p_expected_updated_at, version);
  assert.equal(calls[1].args.p_active, false); assert.equal(calls[1].args.p_business_id, businessId);
});
test("lost responses never retry and invalidation failure cannot hide commit", async () => {
  reset(); throwRpc = true; const lost = await actions.createEmployeeManualAction({ ...fields, id: employeeId });
  assert.equal(lost.persisted, null); assert.equal(calls.length, 1);
  reset(); rpcResult = { data: null, error: null }; assert.equal((await actions.createEmployeeManualAction({ ...fields, id: employeeId })).persisted, null);
  reset(); revalidateThrows = true; assert.equal((await actions.createEmployeeManualAction({ ...fields, id: employeeId })).persisted, true);
});
test("database stale employee is a recoverable conflict", async () => {
  reset(); rpcResult = { data: null, error: { code: "40001", message: "employee_stale_version" } };
  const result = await actions.updateEmployeeManualAction({ ...fields, id: employeeId, expectedUpdatedAt: version });
  if (!result.ok && "status" in result) assert.equal(result.status, "conflict"); else assert.fail("expected conflict");
});
test("employee list is tenant/branch scoped, paginated, literal filtered and profile checked", async () => {
  reset(); fromResults.employees = { data: [row], error: null };
  const result = await actions.getEmployeesPageDataAction({ query: "100%_", status: "archived", branchId, page: 1 });
  assert.equal(result.ok, true);
  if (result.ok) { assert.equal(result.data.canManage, true); assert.equal(result.data.count, 60); assert.equal(result.data.draftScope, `actor-a:${businessId}`); }
  const q = queryCalls.find((call) => call.table === "employees")!;
  assert.deepEqual(q.range, [30, 59]); assert.equal(q.filters.business_id, businessId); assert.equal(q.filters.branch_id, branchId);
  assert.equal(q.filters.active, false); assert.equal(q.filters["ilike:full_name"], "%100\\%\\_%");
  reset(); fromResults.profiles = { data: { active: false }, error: null };
  assert.equal((await actions.getEmployeesPageDataAction()).ok, false); assert.equal(queryCalls.some((q) => q.table === "employees"), false);
});
test("employee readers cannot get write controls; accountant cannot list payroll", async () => {
  for (const role of ["manager", "viewer"]) { reset(); context.role = role; const r = await actions.getEmployeesPageDataAction(); assert.equal(r.ok, true); if (r.ok) assert.equal(r.data.canManage, false); }
  reset(); context.role = "accountant"; assert.equal((await actions.getEmployeesPageDataAction()).ok, false);
});
test("reconciliation uses exact employee ID and active tenant, never assumes missing on read error", async () => {
  reset(); fromResults.employees = { data: row, error: null };
  const r = await actions.getEmployeeManualAction(employeeId); assert.equal(r.ok, true); if (r.ok) assert.equal(r.employee?.id, employeeId);
  const q = queryCalls.find((call) => call.table === "employees")!; assert.equal(q.filters.business_id, businessId); assert.equal(q.filters.id, employeeId);
  fromResults.employees = { data: null, error: { message: "unavailable" } }; assert.equal((await actions.getEmployeeManualAction(employeeId)).ok, false);
});
