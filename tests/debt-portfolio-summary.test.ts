import assert from "node:assert/strict";
import test from "node:test";
import { summarizeDebtViews } from "../app/deudas/portfolio-summary";
import type { DebtView } from "../app/deudas/plan-data";

function debt(id: string, pendingCents: number, currency: string | null = "ARS", legacy = false, creditor = "Banco A", creditorType = "bank"): DebtView {
  // Summary consumes the already-validated financial read model; only the fields
  // relevant to grouping are populated in these isolated aggregation fixtures.
  return { id, pendingCents, currency, creditor, creditorType, status: "in_plan", ledger: legacy ? null : {} } as DebtView;
}
test("creditor summaries reconcile known plan and legacy balances without mixing currencies or names", () => {
  const summary = summarizeDebtViews([debt("1", 60_000_000), debt("2", 5_000_000, "ARS", true), debt("3", 100_000, "USD"), debt("4", 20_000_000, "ARS", false, "Proveedor", "supplier")]);
  assert.deepEqual(summary.currencies, [
    { currency: "ARS", debtCount: 3, plannedPendingCents: 80_000_000, legacyPendingCents: 5_000_000, pendingCents: 85_000_000 },
    { currency: "USD", debtCount: 1, plannedPendingCents: 100_000, legacyPendingCents: 0, pendingCents: 100_000 },
  ]);
  assert.equal(summary.creditors.length, 3);
  assert.deepEqual(summary.creditors[0], { currency: "ARS", creditor: "Banco A", creditorType: "bank", debtCount: 2, plannedPendingCents: 60_000_000, legacyPendingCents: 5_000_000, pendingCents: 65_000_000 });
  assert.equal(summary.unknown.length, 0);
});
test("unknown currency remains separate per record and cancelled history never enters active totals", () => {
  const unknown1 = debt("1", 10000, null, true), unknown2 = debt("2", 20000, null, true);
  const cancelled = { ...debt("3", 60_000_000), status: "cancelled" };
  const summary = summarizeDebtViews([unknown1, unknown2, cancelled, debt("4", 50000)]);
  assert.deepEqual(summary.unknown, [unknown1, unknown2]);
  assert.deepEqual(summary.cancelled, [cancelled]);
  assert.equal(summary.currencies[0].pendingCents, 50000);
  assert.equal(summary.creditors[0].debtCount, 1);
});
test("summary rejects duplicate records and corrupt money instead of displaying partial totals", () => {
  assert.throws(() => summarizeDebtViews([debt("1", 1), debt("1", 2)]), /duplicate_debt/);
  for (const amount of [-1, 0.1, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => summarizeDebtViews([debt("1", amount)]), /invalid_debt_balance/);
  assert.throws(() => summarizeDebtViews([debt("1", 1, "ars")]), /invalid_debt_currency/);
  assert.equal(summarizeDebtViews([debt("1", 0)]).currencies[0].pendingCents, 0);
});
