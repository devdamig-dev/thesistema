import test from "node:test";
import assert from "node:assert/strict";
import { expenseAmount, parseSaveExpense, parseExpenseState } from "../lib/expenses/validation";
import { expenseRpcResult, mutateExpense } from "../lib/expenses/service";
import { expenseJournalKey, readExpenseOperation, retainExpenseOperation } from "../lib/expenses/journal";
import { readExpenseRows, readExpenseRevision } from "../lib/expenses/read";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = () => ({ requestId: id(1), businessId: id(2), userId: id(3), id: null, expectedVersion: null, branchId: id(4), name: "Internet", category: "Servicios", amount: "123.45", dueDate: "2026-10-31", status: "pending" });
test("expense parser preserves decimal precision and rejects rounding before write", () => {
  for (const amount of ["0", "-1", "0.001", "10000000000", "1e2", "01", "NaN", "1,2", 1, null]) assert.throws(() => expenseAmount(amount));
  assert.equal(expenseAmount("9999999999.99"), "9999999999.99"); assert.equal(parseSaveExpense(input()).amount, "123.45");
});
test("expense domain requires complete scope, real dates and unforgeable source", () => {
  for (const patch of [{ source: "whatsapp" }, { extra: 1 }, { id: id(6) }, { expectedVersion: 1 }, { name: "" }, { category: "x".repeat(81) }, { name: "a\nb" }, { requestId: "invalid" }, { dueDate: "2026-02-30" }, { dueDate: "0000-01-01" }, { dueDate: "infinity" }, { status: "voided" }]) assert.throws(() => parseSaveExpense({ ...input(), ...patch }));
  for (const raw of [null, [], {}, 1, new Date()]) assert.throws(() => parseSaveExpense(raw));
  const getter = { ...input(), get name(): string { throw new Error("never evaluate accessors"); } }; assert.throws(() => parseSaveExpense(getter), /Datos de gasto/);
  assert.equal(parseSaveExpense({ ...input(), dueDate: "2024-02-29", name: "  Internet  " }).name, "Internet");
  const state = { requestId: id(1), businessId: id(2), userId: id(3), id: id(4), expectedVersion: 0, reason: "Error de carga" };
  assert.equal(parseExpenseState(state).expectedVersion, 0);
  for (const patch of [{ reason: "" }, { expectedVersion: -1 }, { expectedVersion: 1.5 }, { expectedVersion: 2147483647 }]) assert.throws(() => parseExpenseState({ ...state, ...patch }));
});
test("manual and WhatsApp expenses use the same parser, context and transaction payload", async () => {
  const calls: any[] = []; const db = { rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { ok: true, id: id(9), version: 1 }, error: null }; } };
  for (const source of ["manual", "whatsapp"] as const) assert.equal((await mutateExpense(db, { businessId: id(2), userId: id(3), source }, "save", input())).ok, true);
  assert.deepEqual(calls.map((c) => c.name), ["save_expense_atomic", "mutate_expense_for_agent"]); assert.deepEqual(calls[0].args.p_input, calls[1].args.p_input);
  assert.equal((await mutateExpense(db, { businessId: id(8), userId: id(3), source: "manual" }, "save", input())).ok, false); assert.equal(calls.length, 2);
});
test("expense RPC treats malformed or lost responses as unknown without auto retry", async () => {
  for (const response of [{ data: null, error: null }, { data: { ok: true }, error: null }, { data: { ok: false }, error: null }, { data: { ok: false, error: "expense_conflict" }, error: { code: "network" } }]) assert.equal(expenseRpcResult(response).persisted, "unknown");
  assert.equal(expenseRpcResult({ data: { ok: false, error: "expense_conflict" }, error: null }).persisted, false);
  let calls = 0; const result = await mutateExpense({ rpc: async () => { calls++; throw new Error("lost response"); } }, { businessId: id(2), userId: id(3), source: "manual" }, "save", input()); assert.equal(result.persisted, "unknown"); assert.equal(calls, 1);
});
test("expense operation journal freezes attempt and binds user and tenant", () => {
  const operation = { kind: "save" as const, input: parseSaveExpense(input()) }; const retained = retainExpenseOperation(null, operation);
  assert.deepEqual(readExpenseOperation(JSON.stringify(retained), id(2), id(3)), retained);
  operation.input.name = "changed outside"; assert.equal(retained.kind === "save" ? retained.input.name : null, "Internet"); assert.throws(() => retainExpenseOperation(retained, operation));
  for (const raw of ["{", JSON.stringify({ ...retained, extra: true }), JSON.stringify({ ...retained, kind: "delete" })]) assert.throws(() => readExpenseOperation(raw, id(2), id(3)));
  assert.throws(() => readExpenseOperation(JSON.stringify(retained), id(9), id(3))); assert.throws(() => readExpenseOperation(JSON.stringify(retained), id(2), id(9)));
  assert.notEqual(expenseJournalKey(id(2), id(3)), expenseJournalKey(id(2), id(4)));
});
test("expense reads paginate beyond 1000 and reject incomplete/changing totals", async () => {
  const rows = Array.from({ length: 2001 }, (_, id) => ({ id })); let calls = 0;
  assert.equal((await readExpenseRows(async (from, to) => { calls++; return { data: rows.slice(from, to + 1), count: 2001, error: null }; })).length, 2001); assert.equal(calls, 3);
  await assert.rejects(readExpenseRows(async () => ({ data: rows.slice(0, 10), count: 20, error: null })));
  await assert.rejects(readExpenseRows(async (from, to) => ({ data: rows.slice(from, to + 1), count: from ? 2000 : 2001, error: null })));
  assert.equal(await readExpenseRevision({ rpc: async () => ({ data: "27", error: null }) }, id(2)), "27");
  await assert.rejects(readExpenseRevision({ rpc: async () => ({ data: 27, error: null }) }, id(2)));
});

test("expense operating facts are explicit, complete and independent from due/payment status", () => {
  const full = { ...input(), expenseDate: "2026-10-09", paymentMethod: "Transferencia", supplierId: id(8), isRecurring: true, periodicity: "monthly" };
  const parsed = parseSaveExpense(full);
  assert.equal(parsed.expenseDate, "2026-10-09"); assert.equal(parsed.dueDate, "2026-10-31"); assert.equal(parsed.paymentMethod, "Transferencia"); assert.equal(parsed.isRecurring, true); assert.equal(parsed.periodicity, "monthly");
  for (const patch of [{ expenseDate: "2026-02-30" }, { expenseDate: "0000-01-01" }, { expenseDate: null }, { paymentMethod: null }, { paymentMethod: "" }, { paymentMethod: "x".repeat(81) }, { paymentMethod: "cash\n" }, { supplierId: "bad" }, { isRecurring: "false" }, { isRecurring: null }, { periodicity: "sometimes" }, { periodicity: null }, { isRecurring: false }]) assert.throws(() => parseSaveExpense({ ...full, ...patch }), JSON.stringify(patch));
  for (const field of ["expenseDate", "paymentMethod", "supplierId", "isRecurring", "periodicity"]) { const missing: any = { ...full }; delete missing[field]; assert.throws(() => parseSaveExpense(missing)); }
  assert.equal(parseSaveExpense({ ...full, isRecurring: false, periodicity: null, supplierId: null }).isRecurring, false);
  assert.deepEqual(parseSaveExpense(input()), input());
  const historical = parseSaveExpense({ ...full, id: id(50), expectedVersion: 0, expenseDate: null, paymentMethod: null, supplierId: null, isRecurring: null, periodicity: null });
  assert.equal(historical.expenseDate, null); assert.equal(historical.paymentMethod, null); assert.equal(historical.isRecurring, null);
});
test("extended expense facts remain immutable through retry and identical across transports", async () => {
  const full = parseSaveExpense({ ...input(), expenseDate: "2026-10-09", paymentMethod: "Efectivo", supplierId: null, isRecurring: false, periodicity: null });
  const frozen = retainExpenseOperation(null, { kind: "save", input: full });
  assert.deepEqual(readExpenseOperation(JSON.stringify(frozen), full.businessId, full.userId), frozen);
  assert.throws(() => retainExpenseOperation(frozen, { kind: "save", input: { ...full, expenseDate: "2026-10-10" } }));
  const calls: any[] = []; const db = { rpc: async (name: string, args: any) => { calls.push({ name, args }); return { data: { ok: true, id: id(9), version: 1 }, error: null }; } };
  for (const source of ["manual", "whatsapp"] as const) await mutateExpense(db, { businessId: full.businessId, userId: full.userId, source }, "save", full);
  assert.deepEqual(calls[0].args.p_input, full); assert.deepEqual(calls[1].args.p_input, full);
});
