import test from "node:test";
import assert from "node:assert/strict";
import { advanceJournalKey, advanceRpcResult, parseAdvanceApproval, recoverAdvance } from "../lib/advances/inbox";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = () => ({ extractionId: id(10), businessId: id(2), userId: id(1), expectedFields: { employee_name: "Juan", amount: 10 }, review: { employeeId: id(4), expectedEmployeeUpdatedAt: "2026-10-09T10:00:00.123456+00:00", branchId: id(3), amount: "10.00", date: "2026-10-08", note: " Nota revisada " } });
test("advance binds exact employee ID, microsecond version, reviewed date and decimal amount", () => {
  const result = parseAdvanceApproval(input()); assert.equal(result.review.employeeId, id(4)); assert.equal(result.review.expectedEmployeeUpdatedAt, input().review.expectedEmployeeUpdatedAt); assert.equal(result.review.note, "Nota revisada"); assert.deepEqual(result.expectedFields, input().expectedFields);
  for (const patch of [{ employeeId: "Juan" }, { employeeId: "" }, { expectedEmployeeUpdatedAt: "today" }, { branchId: null }, { date: "2026-02-30" }, { date: "2026-01-01T10:00:00Z" }, { date: "" }, { date: "1899-12-31" }, { amount: 10 }, { amount: "0" }, { amount: "0.001" }, { amount: "1e2" }, { amount: "10000000000" }, { note: "bad\u0000note" }, { paid: true }]) assert.throws(() => parseAdvanceApproval({ ...input(), review: { ...input().review, ...patch } }));
  assert.throws(() => parseAdvanceApproval({ ...input(), expectedFields: [] })); assert.throws(() => parseAdvanceApproval({ ...input(), extra: true }));
  for (const key of Object.keys(input().review)) { const missing: any = input(); delete missing.review[key]; assert.throws(() => parseAdvanceApproval(missing)); }
});
test("advance freezes payload and journal is scoped to actor/business/extraction", () => {
  const raw = input(); const parsed = parseAdvanceApproval(raw); raw.review.amount = "99"; raw.expectedFields.amount = 99;
  assert.equal(parsed.review.amount, "10.00"); assert.equal(parsed.expectedFields.amount, 10);
  assert.deepEqual(recoverAdvance(JSON.stringify(parsed), parsed), parsed); assert.equal(recoverAdvance(null, parsed), null);
  for (const key of ["businessId", "userId", "extractionId"]) { const other = { ...parsed, [key]: id(99) }; assert.throws(() => recoverAdvance(JSON.stringify(parsed), other)); assert.notEqual(advanceJournalKey(parsed), advanceJournalKey(other)); }
  assert.throws(() => recoverAdvance("broken", parsed)); assert.throws(() => recoverAdvance(" ".repeat(60001), parsed));
});
test("advance distinguishes definitive rollback and unknown transport without inventing success", () => {
  assert.deepEqual(advanceRpcResult({ data: { ok: true, id: id(9) }, error: null }), { ok: true, persisted: true, advanceId: id(9) });
  assert.equal(advanceRpcResult({ data: { ok: false, error: "advance_employee_changed" }, error: null }).persisted, false);
  for (const response of [{ data: null, error: null }, { data: { ok: true }, error: null }, { data: { ok: true, id: "bad" }, error: null }, { data: { ok: true, id: id(9) }, error: { message: "disconnect" } }]) assert.equal(advanceRpcResult(response).persisted, "unknown");
});
