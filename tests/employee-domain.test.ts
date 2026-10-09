import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { employeeError, employeeRpcFields, employeeToFields, isEmployeeId, isEmployeeVersion, mapEmployeeRow, validateEmployeeFields } from "../lib/employees/domain";
const fields = { fullName: " José Gómez ", role: " Cocinero ", shift: " Noche ", branchId: "00000000-0000-4000-8000-000000000021", monthlyHours: "160.25", monthlyCost: "1000000.99", pendingAdvance: "10000", absences: "0", lateArrivals: "2" };
test("employee operational fields normalize without inventing data or application roles", () => {
  assert.equal(validateEmployeeFields(fields), null);
  assert.deepEqual(employeeRpcFields(fields), { p_full_name: "José Gómez", p_role: "Cocinero", p_shift: "Noche", p_branch_id: fields.branchId, p_monthly_hours: 160.25, p_monthly_cost: 1000000.99, p_pending_advance: 10000, p_absences: 0, p_late_arrivals: 2 });
});
test("employee validation rejects missing branch, blank role, wrong types and invalid numbers", () => {
  for (const input of [null, [], "x", { ...fields, fullName: " " }, { ...fields, role: "" }, { ...fields, branchId: "" }, { ...fields, fullName: "a\nb" }, { ...fields, role: "x".repeat(121) }, { ...fields, monthlyHours: "745" }, { ...fields, absences: "32" }, { ...fields, monthlyCost: "-1" }, { ...fields, monthlyCost: "NaN" }, { ...fields, monthlyCost: "1e4" }, { ...fields, monthlyCost: 20 }, { ...fields, monthlyCost: "1.001" }, { ...fields, monthlyCost: "100,00" }, { ...fields, pendingAdvance: "" }, { ...fields, lateArrivals: "1.5" }]) assert.ok(validateEmployeeFields(input), JSON.stringify(input));
});
test("employee ID and CAS tokens preserve PostgreSQL microseconds", () => {
  assert.equal(isEmployeeId(fields.branchId), true); assert.equal(isEmployeeId("x"), false);
  assert.equal(isEmployeeVersion("2026-10-09T01:02:03.123456+00:00"), true); assert.equal(isEmployeeVersion("2026-10-09"), false);
});
test("raw employee mapping retains branch, archive and operational numbers", () => {
  const row = mapEmployeeRow({ id: fields.branchId, full_name: "José", role: "Chef", shift: null, branch_id: fields.branchId, monthly_hours: "160.25", monthly_cost: "1234.56", pending_advance: "12.34", absences: 2, late_arrivals: 3, active: false, updated_at: "2026-10-09T01:02:03.123456+00:00" });
  assert.equal(row.monthlyHours, 160.25); assert.equal(row.active, false); assert.equal(employeeToFields(row).monthlyCost, "1234.56"); assert.equal(employeeToFields(row).shift, "");
});
test("employee failure classification never claims rollback after uncertain transport", () => {
  for (const error of [null, { code: "503" }, { code: "PGRST000" }]) { const r = employeeError(error); if (!r.ok) { assert.equal(r.persisted, null); assert.equal(r.status, "uncertain"); } }
  for (const message of ["employee_stale_version", "employee_request_conflict"]) { const r = employeeError({ message }); if (!r.ok) assert.equal(r.status, "conflict"); }
  for (const code of ["42501", "23514", "P0002", "22003"]) { const r = employeeError({ code }); if (!r.ok) assert.equal(r.status, "rejected"); }
});
test("employee form has stable create recovery and synchronous duplicate guard", () => {
  const source = readFileSync("components/employees/employee-form.tsx", "utf8");
  assert.match(source, /sessionStorage\.setItem\(storageKey, JSON\.stringify\(request\)\)/);
  assert.match(source, /if \(busy\.current/); assert.match(source, /getEmployeeManualAction\(id\)/);
  assert.match(source, /attempt && verifiedAbsent/); assert.match(source, /sendCreate\(attempt, true\)/);
  assert.match(source, /expectedUpdatedAt: row\.updatedAt/);
  const page = readFileSync("app/empleados/page.tsx", "utf8");
  assert.doesNotMatch(page, /comingSoon|mock-data|demoEmployees/);
});
