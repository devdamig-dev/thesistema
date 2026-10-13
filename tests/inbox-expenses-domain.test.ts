import test from "node:test";
import assert from "node:assert/strict";
import { inboxExpenseJournalKey, parseInboxExpenseApproval, recoverInboxExpense } from "../lib/expenses/inbox";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = () => ({ extractionId: id(10), businessId: id(2), userId: id(1), expectedFields: { concept: "Internet", amount: 10, payment_method: "Efectivo", date: "2026-10-09" }, review: { branchId: id(3), name: "Internet revisado", category: "Servicios", amount: "10.00", dueDate: null, status: "pending" } });
test("Inbox expense requires explicit status and preserves original fields without inferred dates", () => {
  const result = parseInboxExpenseApproval(input()); assert.equal(result.review.status, "pending"); assert.equal(result.review.dueDate, null); assert.deepEqual(result.expectedFields, input().expectedFields);
  const noStatus: any = input(); delete noStatus.review.status; assert.throws(() => parseInboxExpenseApproval(noStatus));
  for (const patch of [{ status: "" }, { status: "unknown" }, { amount: 10 }, { amount: "0.001" }, { source: "manual" }, { dueDate: "2026-02-30" }]) assert.throws(() => parseInboxExpenseApproval({ ...input(), review: { ...input().review, ...patch } }));
  assert.throws(() => parseInboxExpenseApproval({ ...input(), expectedFields: [] })); assert.throws(() => parseInboxExpenseApproval({ ...input(), extra: true }));
});
test("Inbox expense approval stores frozen independent copy and safely recovers after reload", () => {
  const original = input(); const parsed = parseInboxExpenseApproval(original); original.expectedFields.amount = 999; original.review.name = "changed";
  assert.equal(parsed.expectedFields.amount, 10); assert.equal(parsed.review.name, "Internet revisado");
  assert.deepEqual(recoverInboxExpense(JSON.stringify(parsed), parsed), parsed);
  assert.throws(() => recoverInboxExpense(JSON.stringify(parsed), { ...parsed, businessId: id(99) }));
  assert.throws(() => recoverInboxExpense(JSON.stringify(parsed), { ...parsed, userId: id(99) }));
  assert.throws(() => recoverInboxExpense(JSON.stringify(parsed), { ...parsed, extractionId: id(99) }));
  assert.notEqual(inboxExpenseJournalKey(parsed), inboxExpenseJournalKey({ ...parsed, userId: id(99) }));
});

test("Inbox extended review requires declared date, payment and recurrence without OCR defaults", () => {
  const original = input(); const review = { ...original.review, expenseDate: "2026-10-08", paymentMethod: "Transferencia", supplierId: id(44), isRecurring: true, periodicity: "yearly" };
  const parsed = parseInboxExpenseApproval({ ...original, review });
  assert.deepEqual(parsed.review, review); assert.equal(parsed.review.dueDate, null); assert.equal(parsed.expectedFields.payment_method, "Efectivo");
  for (const patch of [{ expenseDate: null }, { paymentMethod: null }, { isRecurring: null }, { periodicity: null }, { supplierId: "bad" }, { isRecurring: false }]) assert.throws(() => parseInboxExpenseApproval({ ...original, review: { ...review, ...patch } }));
  assert.deepEqual(recoverInboxExpense(JSON.stringify(parsed), parsed), parsed);
  assert.deepEqual(recoverInboxExpense(JSON.stringify(original), original), original);
});
