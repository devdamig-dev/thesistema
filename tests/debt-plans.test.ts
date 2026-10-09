import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_DEBT_MONEY_CENTS,
  MAX_DEBT_INSTALLMENTS,
  MAX_DEBT_LEDGER_PAYMENTS,
  DebtPlanError,
  allocateDebtPayment,
  centsToDecimalMoney,
  decimalMoneyToCents,
  generateDebtPlan,
  projectDebtCommitments,
  projectDebtPortfolio,
  validateDebtLedger,
  voidDebtPayment,
  type DebtAccess,
  type DebtLedgerSnapshot,
  type DebtPaymentInput,
  type DebtPlanInput,
  type DebtScope,
  type VoidDebtPaymentInput,
} from "../lib/debts/plans";

const scope: DebtScope = { businessId: "business-a", debtId: "debt-a", branchId: "branch-a" };
const access: DebtAccess = { actorId: "user-a", businessId: scope.businessId, branchIds: null, permissions: ["debts.view", "debts.create", "debts.pay"] };
function planInput(overrides: Partial<DebtPlanInput> = {}): DebtPlanInput {
  return { mode: "installments", currency: "ARS", originalAmountCents: 90_000_000, financing: { totalFinancedCents: 90_000_000 }, installmentCount: 3, schedule: { periodicity: "monthly", firstDueDate: "2026-11-10" }, ...overrides } as DebtPlanInput;
}
function ledger(input: unknown = planInput(), otherScope: Partial<DebtScope> = {}): DebtLedgerSnapshot {
  const plan = generateDebtPlan(input);
  const identity = { ...scope, ...otherScope };
  return {
    ...identity, currency: plan.currency, mode: plan.mode, totalFinancedCents: plan.totalFinancedCents, version: 0,
    installments: plan.installments.map((part) => ({ ...identity, id: `${identity.debtId}-installment-${part.installmentNumber}`, installmentNumber: part.installmentNumber, dueDate: part.dueDate, totalAmountCents: part.totalAmountCents })), payments: [],
  };
}
function payment(overrides: Partial<DebtPaymentInput> = {}): DebtPaymentInput {
  return { ...scope, paymentId: "payment-a", currency: "ARS", expectedVersion: 0, amountCents: 10_000_000, paidAt: "2026-10-09", paymentMethod: "Transferencia", origin: "manual", allocation: { rule: "oldest_due" }, ...overrides };
}
function reversal(overrides: Partial<VoidDebtPaymentInput> = {}): VoidDebtPaymentInput {
  return { ...scope, paymentId: "payment-a", currency: "ARS", expectedVersion: 1, voidedAt: "2026-10-10", reason: "Pago duplicado en el comprobante", ...overrides };
}
function rejects(action: () => unknown, code: string): void {
  assert.throws(action, (error: unknown) => error instanceof DebtPlanError && error.code === code);
}
function project(snapshot: unknown, date = "2026-10-09") { return projectDebtCommitments(snapshot, date, access); }

// Amounts and strict runtime boundaries.
test("decimal strings convert exactly to and from cents at numeric(12,2) limits", () => {
  for (const [value, expected] of [["0", 0], ["0.01", 1], ["1.1", 110], ["0.29", 29], ["900000", 90_000_000], ["9999999999.99", MAX_DEBT_MONEY_CENTS]] as const) {
    assert.equal(decimalMoneyToCents(value), expected);
    assert.equal(decimalMoneyToCents(centsToDecimalMoney(expected)), expected);
  }
  assert.equal(centsToDecimalMoney(1), "0.01");
});
test("money conversion rejects floats, locale text, excess precision and unsafe limits", () => {
  for (const value of [0.1, NaN, Infinity, null, "", " 1.00", "1,50", "$2", "1e3", "01", "-1", "0.001", "10000000000.00", "9007199254740993"]) assert.throws(() => decimalMoneyToCents(value), DebtPlanError);
  for (const value of [-1, 0.1, Infinity, NaN, Number.MAX_SAFE_INTEGER, MAX_DEBT_MONEY_CENTS + 1, "1"]) assert.throws(() => centsToDecimalMoney(value), DebtPlanError);
});
test("bank example creates three exact 300,000 installments", () => {
  const result = generateDebtPlan(planInput());
  assert.equal(result.totalFinancedCents, 90_000_000);
  assert.deepEqual(result.installments.map((part) => [part.totalAmountCents, part.dueDate]), [[30_000_000, "2026-11-10"], [30_000_000, "2026-12-10"], [30_000_000, "2027-01-10"]]);
  assert.equal(result.amountSource, "explicit_total");
});
test("last installment absorbs all cents, with exact totals across counts", () => {
  for (const count of [1, 2, 3, 7, 12, 100, MAX_DEBT_INSTALLMENTS]) {
    for (const total of [count, count + 1, 90_000_001, MAX_DEBT_MONEY_CENTS]) {
      const result = generateDebtPlan(planInput({ installmentCount: count, financing: { totalFinancedCents: total } }));
      const amounts = result.installments.map((part) => part.totalAmountCents);
      assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), total);
      assert.ok(amounts.every(Number.isSafeInteger));
      assert.ok(amounts.every((amount) => amount > 0));
      assert.ok(amounts.slice(0, -1).every((amount) => amount === Math.floor(total / count)));
      assert.equal(amounts[count - 1], Math.floor(total / count) + total % count);
    }
  }
  assert.deepEqual(generateDebtPlan(planInput({ financing: { totalFinancedCents: 100 } })).installments.map((part) => part.totalAmountCents), [33, 33, 34]);
});
test("explicit installment amount determines total and contradictory totals are rejected", () => {
  const result = generateDebtPlan(planInput({ financing: { installmentAmountCents: 12_345 } }));
  assert.equal(result.totalFinancedCents, 37_035);
  assert.equal(result.amountSource, "explicit_installment");
  assert.deepEqual(result.installments.map((part) => part.totalAmountCents), [12_345, 12_345, 12_345]);
  assert.equal(generateDebtPlan(planInput({ financing: { totalFinancedCents: 37_035, installmentAmountCents: 12_345 } })).totalFinancedCents, 37_035);
  rejects(() => generateDebtPlan(planInput({ financing: { totalFinancedCents: 100, installmentAmountCents: 33 } })), "inconsistent_financing");
});
test("invalid, missing and unsafe amounts never become defaults", () => {
  for (const totalFinancedCents of [-1, 0, 1.1, NaN, Infinity, MAX_DEBT_MONEY_CENTS + 1, "100"]) rejects(() => generateDebtPlan({ ...planInput(), financing: { totalFinancedCents } }), "invalid_integer");
  rejects(() => generateDebtPlan(planInput({ financing: {} })), "financed_amount_required");
  rejects(() => generateDebtPlan(planInput({ financing: { totalFinancedCents: 2 } })), "installment_below_one_cent");
  rejects(() => generateDebtPlan(planInput({ financing: { installmentAmountCents: MAX_DEBT_MONEY_CENTS } })), "money_overflow");
  for (const count of [0, -1, 2.5, MAX_DEBT_INSTALLMENTS + 1, "3"]) rejects(() => generateDebtPlan({ ...planInput(), installmentCount: count }), "invalid_integer");
});
test("strict plan input rejects unknown fields at every object boundary", () => {
  const cases = [
    { ...planInput(), pendingAmountCents: 1 },
    { ...planInput(), financing: { totalFinancedCents: 900, ignoreInterest: true } },
    { ...planInput(), schedule: { periodicity: "monthly", firstDueDate: "2026-11-10", timezone: "UTC" } },
    { ...planInput(), components: [{ capitalAmountCents: 1, other: 3 }, {}, {}] },
    { ...planInput(), interestRate: { value: "3", period: "monthly", compound: true } },
    { ...planInput(), dueDate: "2026-11-10" },
    { mode: "single", currency: "ARS", originalAmountCents: 900, financing: { totalFinancedCents: 900 }, installmentCount: 1 },
  ];
  for (const input of cases) rejects(() => generateDebtPlan(input), "unknown_field");
  rejects(() => generateDebtPlan({ ...planInput(), currency: "ars" }), "invalid_currency");
  rejects(() => generateDebtPlan({ ...planInput(), currency: undefined }), "invalid_currency");
});
test("invalid roots, non-plain objects, getters, symbol keys and sparse arrays fail closed", () => {
  for (const value of [null, [], new Date(), "plan", 1]) rejects(() => generateDebtPlan(value), "invalid_object");
  const withGetter = { ...planInput(), get financing() { throw new Error("must not evaluate"); } };
  rejects(() => generateDebtPlan(withGetter), "invalid_object");
  rejects(() => generateDebtPlan({ ...planInput(), [Symbol("hidden")]: true }), "unknown_field");
  rejects(() => generateDebtPlan({ ...planInput(), components: new Array(3) }), "invalid_array");
});

// Financing is explicit: unknown interest, principal splits and down payments remain unknown.
test("supplier example derives four payments after an explicitly confirmed down payment", () => {
  const result = generateDebtPlan(planInput({ originalAmountCents: 50_000_000, installmentCount: 4, financing: { confirmedBalance: { confirmed: true, downPaymentCents: 10_000_000, interestCents: 0, feesCents: 0 } } }));
  assert.equal(result.totalFinancedCents, 40_000_000);
  assert.deepEqual(result.installments.map((part) => part.totalAmountCents), [10_000_000, 10_000_000, 10_000_000, 10_000_000]);
  assert.equal(result.confirmedBalance?.downPaymentCents, 10_000_000);
  assert.equal(result.downPaymentCents, 10_000_000);
  assert.equal(result.totalObligationCents, 50_000_000);
  assert.equal(result.originalAmountCents, 50_000_000);
  assert.equal(result.amountSource, "confirmed_balance");
  // Total principal is known, but its per-installment allocation has not been agreed.
  assert.ok(result.installments.every((part) => part.capitalAmountCents === null));
});
test("confirmed financing includes stated interest and fees exactly once", () => {
  const input = planInput({ originalAmountCents: 50_000, installmentCount: 4, financing: { confirmedBalance: { confirmed: true, downPaymentCents: 10_000, interestCents: 4_000, feesCents: 200 } } });
  const result = generateDebtPlan(input);
  assert.equal(result.totalFinancedCents, 44_200);
  assert.equal(result.installments[0].totalAmountCents, 11_050);
  assert.equal(generateDebtPlan({ ...input, financing: { ...input.financing, totalFinancedCents: 44_200 } }).totalFinancedCents, 44_200);
  rejects(() => generateDebtPlan({ ...input, financing: { ...input.financing, totalFinancedCents: 50_000 } }), "inconsistent_financing");
});
test("balance derivation requires confirmed values including explicit zero charges", () => {
  const confirmedBalance = { confirmed: true, downPaymentCents: 100, interestCents: 0, feesCents: 0 };
  rejects(() => generateDebtPlan({ ...planInput(), financing: { confirmedBalance: { ...confirmedBalance, confirmed: false } } }), "balance_not_confirmed");
  for (const key of ["downPaymentCents", "interestCents", "feesCents"]) {
    const missing: Record<string, unknown> = { ...confirmedBalance };
    delete missing[key];
    rejects(() => generateDebtPlan({ ...planInput(), financing: { confirmedBalance: missing } }), "invalid_integer");
  }
  rejects(() => generateDebtPlan({ ...planInput(), financing: { confirmedBalance: { ...confirmedBalance, downPaymentCents: 90_000_001 } } }), "down_payment_exceeds_original");
  rejects(() => generateDebtPlan({ ...planInput(), financing: { confirmedBalance: { ...confirmedBalance, downPaymentCents: 90_000_000 } } }), "invalid_integer");
  rejects(() => generateDebtPlan({ ...planInput(), financing: { confirmedBalance: { ...confirmedBalance, unverified: true } } }), "unknown_field");
});
test("rate metadata never invents a monetary total, period, payment method or amortization", () => {
  const input = planInput({ interestRate: { value: "2.5", period: "monthly" } });
  const result = generateDebtPlan(input);
  assert.deepEqual(result.interestRate, { value: "2.5", period: "monthly" });
  assert.equal(result.totalFinancedCents, 90_000_000);
  assert.equal(result.confirmedBalance, null);
  assert.equal(result.downPaymentCents, null);
  assert.equal(result.totalObligationCents, null);
  assert.ok(result.installments.every((part) => part.capitalAmountCents === null && part.interestAmountCents === null && part.feesAmountCents === null));
  rejects(() => generateDebtPlan({ ...input, financing: {} }), "financed_amount_required");
  rejects(() => generateDebtPlan({ ...input, interestRate: { value: "2.5" } }), "invalid_choice");
  for (const value of [2.5, "-1", "NaN", "2,5", "1e2", " 2"]) rejects(() => generateDebtPlan({ ...input, interestRate: { value, period: "monthly" } }), "invalid_interest_rate");
});
test("supplied component breakdowns are preserved and validated without filling gaps", () => {
  const result = generateDebtPlan(planInput({ financing: { totalFinancedCents: 300 }, components: [{ capitalAmountCents: 80, interestAmountCents: 15, feesAmountCents: 5 }, { capitalAmountCents: 70 }, {}] }));
  assert.deepEqual(result.installments.map((part) => [part.capitalAmountCents, part.interestAmountCents, part.feesAmountCents]), [[80, 15, 5], [70, null, null], [null, null, null]]);
  rejects(() => generateDebtPlan(planInput({ financing: { totalFinancedCents: 300 }, components: [{ capitalAmountCents: 80, interestAmountCents: 10, feesAmountCents: 5 }, {}, {}] })), "inconsistent_components");
  rejects(() => generateDebtPlan(planInput({ financing: { totalFinancedCents: 300 }, components: [{ capitalAmountCents: 101 }, {}, {}] })), "inconsistent_components");
  rejects(() => generateDebtPlan(planInput({ components: [{}] })), "installment_count_mismatch");
});
test("component totals reconcile with confirmed capital, interest and fee totals", () => {
  const input = planInput({ originalAmountCents: 280, financing: { confirmedBalance: { confirmed: true, downPaymentCents: 10, interestCents: 27, feesCents: 3 } }, components: Array.from({ length: 3 }, () => ({ capitalAmountCents: 90, interestAmountCents: 9, feesAmountCents: 1 })) });
  assert.equal(generateDebtPlan(input).totalFinancedCents, 300);
  rejects(() => generateDebtPlan({ ...input, components: Array.from({ length: 3 }, () => ({ capitalAmountCents: 89, interestAmountCents: 10, feesAmountCents: 1 })) }), "inconsistent_components");
  rejects(() => generateDebtPlan({ ...input, components: [{ feesAmountCents: 4 }, {}, {}] }), "inconsistent_components");
});

// Scheduling: civil dates independent of machine timezone and daylight-saving shifts.
test("single informal debt supports explicit estimated date or no date", () => {
  const input: DebtPlanInput = { mode: "single", currency: "ARS", originalAmountCents: 10_000, financing: { totalFinancedCents: 10_000 } };
  const result = generateDebtPlan(input);
  assert.equal(result.installmentCount, 1);
  assert.equal(result.periodicity, null);
  assert.equal(result.installments[0].dueDate, null);
  assert.equal(generateDebtPlan({ ...input, dueDate: "2027-01-31" }).installments[0].dueDate, "2027-01-31");
  assert.equal(generateDebtPlan({ ...input, dueDate: null }).installments[0].dueDate, null);
});
test("monthly dates preserve first day number through February and across years", () => {
  for (const [first, expected] of [
    ["2026-01-31", ["2026-01-31", "2026-02-28", "2026-03-31"]],
    ["2028-01-31", ["2028-01-31", "2028-02-29", "2028-03-31"]],
    ["2026-01-30", ["2026-01-30", "2026-02-28", "2026-03-30"]],
    ["2026-02-28", ["2026-02-28", "2026-03-28", "2026-04-28"]],
    ["2026-12-31", ["2026-12-31", "2027-01-31", "2027-02-28"]],
  ] as const) {
    const result = generateDebtPlan(planInput({ schedule: { periodicity: "monthly", firstDueDate: first } }));
    assert.deepEqual(result.installments.map((part) => part.dueDate), expected);
    assert.equal(result.monthlyAnchorDay, Number(first.slice(8)));
  }
});
test("weekly and fortnightly schedules mean 7 and 15 civil days without DST drift", () => {
  assert.deepEqual(generateDebtPlan(planInput({ schedule: { periodicity: "weekly", firstDueDate: "2026-03-01" } })).installments.map((part) => part.dueDate), ["2026-03-01", "2026-03-08", "2026-03-15"]);
  assert.deepEqual(generateDebtPlan(planInput({ schedule: { periodicity: "fortnightly", firstDueDate: "2026-12-20" } })).installments.map((part) => part.dueDate), ["2026-12-20", "2027-01-04", "2027-01-19"]);
  assert.deepEqual(generateDebtPlan(planInput({ schedule: { periodicity: "fortnightly", firstDueDate: "2028-02-15" } })).installments.map((part) => part.dueDate), ["2028-02-15", "2028-03-01", "2028-03-16"]);
});
test("custom schedules require exact, ordered dates without invented dates", () => {
  const dueDates = ["2026-10-10", "2026-11-30", "2027-03-01"];
  assert.deepEqual(generateDebtPlan(planInput({ schedule: { periodicity: "custom", dueDates } })).installments.map((part) => part.dueDate), dueDates);
  for (const dates of [["2026-10-10"], [], [...dueDates, "2028-01-01"]]) rejects(() => generateDebtPlan(planInput({ schedule: { periodicity: "custom", dueDates: dates } })), "installment_count_mismatch");
  for (const dates of [["2026-10-10", "2026-10-10", "2027-01-01"], [...dueDates].reverse()]) rejects(() => generateDebtPlan(planInput({ schedule: { periodicity: "custom", dueDates: dates } })), "dates_not_increasing");
  rejects(() => generateDebtPlan({ ...planInput(), schedule: { periodicity: "custom", firstDueDate: dueDates[0], dueDates } }), "unknown_field");
});
test("calendar validation rejects nonexistent dates, ambiguity, timestamps and schedule overflow", () => {
  for (const firstDueDate of [undefined, "", "10/11/2026", "2026-2-01", "2026-02-29", "2026-04-31", "0000-01-01", "2026-13-01", "2026-00-01", "2026-10-00", "2026-11-10T00:00:00Z"]) rejects(() => generateDebtPlan({ ...planInput(), schedule: { periodicity: "monthly", firstDueDate } }), "invalid_date");
  for (const periodicity of ["monthly", "weekly", "fortnightly"]) rejects(() => generateDebtPlan({ ...planInput(), schedule: { periodicity, firstDueDate: "9999-12-31" } }), "invalid_date");
  assert.equal(generateDebtPlan(planInput({ schedule: { periodicity: "monthly", firstDueDate: "0001-01-31" } })).installments[1].dueDate, "0001-02-28");
});

// Payment allocation, immutable ledger and explicit scope/security boundaries.
test("selected installment supports partial and full advance payment without touching others", () => {
  const initial = ledger();
  const result = allocateDebtPayment(initial, payment({ allocation: { rule: "selected_installment", installmentId: initial.installments[1].id } }), access);
  assert.deepEqual(result.payment.allocations, [{ installmentId: initial.installments[1].id, amountCents: 10_000_000 }]);
  assert.equal(result.payment.actorId, access.actorId);
  assert.equal(result.payment.paidAt, "2026-10-09");
  assert.equal(result.pendingAmountCents, 80_000_000);
  assert.equal(project(result.snapshot).installments[1].status, "partial");
  const full = allocateDebtPayment(result.snapshot, payment({ paymentId: "payment-b", expectedVersion: 1, amountCents: 20_000_000, allocation: { rule: "selected_installment", installmentId: initial.installments[1].id } }), access);
  assert.deepEqual(project(full.snapshot).installments.map((part) => part.paidAmountCents), [0, 30_000_000, 0]);
  assert.equal(project(full.snapshot).paidInstallmentCount, 1);
  assert.equal(project(full.snapshot).status, "partially_paid");
  assert.equal(initial.payments.length, 0);
  assert.equal(initial.version, 0);
});
test("selected installment overpayment cannot silently spill into other balances", () => {
  const initial = ledger();
  rejects(() => allocateDebtPayment(initial, payment({ amountCents: 30_000_001, allocation: { rule: "selected_installment", installmentId: initial.installments[0].id } }), access), "amount_exceeds_installment_pending");
  rejects(() => allocateDebtPayment(initial, payment({ allocation: { rule: "selected_installment", installmentId: "another-debt-installment" } }), access), "installment_not_found");
});
test("oldest-due rule sorts dates explicitly, handles partials and prepays future installments", () => {
  const initial = ledger();
  // Dates can change after plan creation; ordering follows due date, then number.
  initial.installments[0].dueDate = "2027-03-01";
  initial.installments[2].dueDate = "2026-11-01";
  initial.installments.reverse();
  const result = allocateDebtPayment(initial, payment({ amountCents: 35_000_000 }), access);
  assert.deepEqual(result.payment.allocations, [{ installmentId: "debt-a-installment-3", amountCents: 30_000_000 }, { installmentId: "debt-a-installment-2", amountCents: 5_000_000 }]);
  const second = allocateDebtPayment(result.snapshot, payment({ paymentId: "payment-b", expectedVersion: 1, amountCents: 30_000_000 }), access);
  assert.deepEqual(second.payment.allocations, [{ installmentId: "debt-a-installment-2", amountCents: 25_000_000 }, { installmentId: "debt-a-installment-1", amountCents: 5_000_000 }]);
});
test("oldest-due tie breaks by installment number and skips fully paid installments", () => {
  const initial = ledger();
  initial.installments.forEach((part) => { part.dueDate = "2026-11-10"; });
  initial.installments.reverse();
  const first = allocateDebtPayment(initial, payment({ amountCents: 30_000_000 }), access);
  const second = allocateDebtPayment(first.snapshot, payment({ paymentId: "payment-b", expectedVersion: 1, amountCents: 1 }), access);
  assert.equal(first.payment.allocations[0].installmentId, "debt-a-installment-1");
  assert.equal(second.payment.allocations[0].installmentId, "debt-a-installment-2");
});
test("global early settlement pays exact outstanding amount, never assumed discounts or interest rebates", () => {
  const initial = ledger();
  const result = allocateDebtPayment(initial, payment({ amountCents: initial.totalFinancedCents }), access);
  assert.equal(result.pendingAmountCents, 0);
  assert.equal(project(result.snapshot).status, "paid");
  assert.equal(project(result.snapshot).paidInstallmentCount, 3);
  assert.equal(project(result.snapshot).nextDueDate, null);
  rejects(() => allocateDebtPayment(result.snapshot, payment({ paymentId: "payment-b", expectedVersion: 1, amountCents: 1 }), access), "amount_exceeds_pending");
});
test("single unscheduled debt can be paid under an explicit oldest-due rule", () => {
  const initial = ledger({ mode: "single", currency: "ARS", originalAmountCents: 500, financing: { totalFinancedCents: 500 } });
  const result = allocateDebtPayment(initial, payment({ amountCents: 500 }), access);
  assert.equal(result.payment.allocations.length, 1);
  assert.equal(project(result.snapshot).pendingAmountCents, 0);
});
test("payment boundary rejects invalid amounts, missing rules, defaults and unsupported fields", () => {
  const initial = ledger();
  for (const amountCents of [0, -1, 1.1, NaN, Infinity, "100", MAX_DEBT_MONEY_CENTS + 1]) rejects(() => allocateDebtPayment(initial, { ...payment(), amountCents }, access), "invalid_integer");
  rejects(() => allocateDebtPayment(initial, payment({ amountCents: initial.totalFinancedCents + 1 }), access), "amount_exceeds_pending");
  rejects(() => allocateDebtPayment(initial, { ...payment(), allocation: undefined }, access), "invalid_object");
  rejects(() => allocateDebtPayment(initial, { ...payment(), allocation: { rule: "automatic" } }, access), "invalid_choice");
  rejects(() => allocateDebtPayment(initial, { ...payment(), allocation: { rule: "oldest_due", installmentId: "x" } }, access), "unknown_field");
  rejects(() => allocateDebtPayment(initial, { ...payment(), actorId: "spoofed" }, access), "unknown_field");
  rejects(() => allocateDebtPayment(initial, { ...payment(), paymentMethod: undefined }, access), "invalid_text");
  rejects(() => allocateDebtPayment(initial, { ...payment(), paidAt: undefined }, access), "invalid_date");
  rejects(() => allocateDebtPayment(initial, { ...payment(), origin: undefined }, access), "invalid_choice");
  rejects(() => allocateDebtPayment(initial, { ...payment(), paymentMethod: " " }, access), "invalid_text");
});
test("payment actor comes from supplied trusted context and all known metadata is preserved", () => {
  const result = allocateDebtPayment(ledger(), payment({ reference: " TRX-21 ", notes: " Anticipo de cuota ", origin: "whatsapp" }), access);
  assert.equal(result.payment.actorId, "user-a");
  assert.equal(result.payment.reference, "TRX-21");
  assert.equal(result.payment.notes, "Anticipo de cuota");
  assert.equal(result.payment.origin, "whatsapp");
  rejects(() => allocateDebtPayment(ledger(), payment({ notes: "a".repeat(1001) }), access), "invalid_text");
});
test("payments cannot cross business, debt, branch or currency boundaries", () => {
  const initial = ledger();
  for (const [field, value, code] of [["businessId", "business-b", "business_mismatch"], ["debtId", "debt-b", "debt_mismatch"], ["branchId", "branch-b", "branch_mismatch"], ["currency", "USD", "currency_mismatch"]] as const) rejects(() => allocateDebtPayment(initial, { ...payment(), [field]: value }, access), code);
  rejects(() => allocateDebtPayment(initial, payment(), { ...access, businessId: "business-b" }), "business_mismatch");
});
test("unauthorized roles and branch-restricted actors fail closed", () => {
  const initial = ledger();
  rejects(() => allocateDebtPayment(initial, payment(), { ...access, permissions: ["debts.view"] }), "permission_denied");
  rejects(() => allocateDebtPayment(initial, payment(), { ...access, branchIds: ["branch-b"] }), "branch_forbidden");
  rejects(() => allocateDebtPayment(initial, payment(), { ...access, branchIds: [] }), "branch_forbidden");
  const unscoped = ledger(planInput(), { branchId: null });
  rejects(() => allocateDebtPayment(unscoped, payment({ branchId: null }), { ...access, branchIds: ["branch-a"] }), "branch_forbidden");
  assert.equal(allocateDebtPayment(initial, payment(), { ...access, branchIds: ["branch-a"] }).pendingAmountCents, 80_000_000);
  rejects(() => allocateDebtPayment(initial, payment(), { ...access, role: "owner" }), "unknown_field");
});
test("version fence rejects stale commands but pure snapshots cannot serialize concurrent writers", () => {
  const initial = ledger();
  const first = allocateDebtPayment(initial, payment({ amountCents: 60_000_000 }), access);
  rejects(() => allocateDebtPayment(first.snapshot, payment({ paymentId: "payment-b", amountCents: 60_000_000 }), access), "stale_version");
  rejects(() => allocateDebtPayment(first.snapshot, payment({ paymentId: "payment-b", expectedVersion: 1, amountCents: 60_000_000 }), access), "amount_exceeds_pending");
  // Both stale previews can be locally valid: only an atomic database lock can
  // reject the second writer. This is deliberately not called a concurrency test.
  const parallelPreview = allocateDebtPayment(initial, payment({ paymentId: "payment-b", amountCents: 60_000_000 }), access);
  assert.equal(parallelPreview.snapshot.version, first.snapshot.version);
});
test("duplicate payment identities are rejected even after reversal; version overflow is rejected", () => {
  const first = allocateDebtPayment(ledger(), payment(), access);
  rejects(() => allocateDebtPayment(first.snapshot, payment({ expectedVersion: 1 }), access), "duplicate_payment");
  const voided = voidDebtPayment(first.snapshot, reversal(), access);
  rejects(() => allocateDebtPayment(voided, payment({ expectedVersion: 2 }), access), "duplicate_payment");
  const initial = ledger();
  initial.version = Number.MAX_SAFE_INTEGER;
  rejects(() => allocateDebtPayment(initial, payment({ expectedVersion: Number.MAX_SAFE_INTEGER }), access), "version_overflow");
});

// Snapshot integrity and reversals.
test("ledger validation rejects cross-scope installments and payment records", () => {
  for (const [field, value, code] of [["businessId", "business-b", "business_mismatch"], ["debtId", "debt-b", "debt_mismatch"], ["branchId", "branch-b", "branch_mismatch"]] as const) {
    const initial = ledger();
    initial.installments[0][field] = value;
    rejects(() => validateDebtLedger(initial), code);
    const paid = allocateDebtPayment(ledger(), payment(), access).snapshot;
    paid.payments[0][field] = value;
    rejects(() => validateDebtLedger(paid), code);
  }
  const paid = allocateDebtPayment(ledger(), payment(), access).snapshot;
  paid.payments[0].currency = "USD";
  rejects(() => validateDebtLedger(paid), "currency_mismatch");
});
test("ledger requires exact totals, unique IDs, contiguous numbers and no hidden paid_amount input", () => {
  const initial = ledger();
  rejects(() => validateDebtLedger({ ...initial, totalFinancedCents: 90_000_001 }), "installment_total_mismatch");
  rejects(() => validateDebtLedger({ ...initial, installments: [] }), "installment_count_mismatch");
  rejects(() => validateDebtLedger({ ...initial, installments: [initial.installments[0], initial.installments[0], initial.installments[2]] }), "duplicate_installment");
  rejects(() => validateDebtLedger({ ...initial, installments: initial.installments.map((part, i) => ({ ...part, installmentNumber: i === 0 ? 4 : part.installmentNumber })) }), "invalid_installment_numbers");
  rejects(() => validateDebtLedger({ ...initial, installments: initial.installments.map((part) => ({ ...part, paidAmountCents: 0 })) }), "unknown_field");
  rejects(() => validateDebtLedger({ ...initial, installments: initial.installments.map((part) => ({ ...part, dueDate: null })) }), "installment_date_required");
  rejects(() => validateDebtLedger({ ...initial, mode: "single" }), "installment_count_mismatch");
});
test("ledger validates payment allocation sums, targets, uniqueness and cumulative overpayment", () => {
  const initial = allocateDebtPayment(ledger(), payment(), access).snapshot;
  const wrongSum = structuredClone(initial);
  wrongSum.payments[0].amountCents++;
  rejects(() => validateDebtLedger(wrongSum), "allocation_total_mismatch");
  const foreign = structuredClone(initial);
  foreign.payments[0].allocations[0].installmentId = "foreign-installment";
  rejects(() => validateDebtLedger(foreign), "installment_not_found");
  const duplicate = structuredClone(initial);
  duplicate.payments[0].allocations = [{ installmentId: "debt-a-installment-1", amountCents: 5_000_000 }, { installmentId: "debt-a-installment-1", amountCents: 5_000_000 }];
  rejects(() => validateDebtLedger(duplicate), "duplicate_allocation");
  const overpaid = structuredClone(initial);
  overpaid.payments = Array.from({ length: 4 }, (_, i) => ({ ...initial.payments[0], id: `payment-${i}` }));
  rejects(() => validateDebtLedger(overpaid), "amount_exceeds_pending");
  const duplicatePayment = structuredClone(initial);
  duplicatePayment.payments.push(duplicatePayment.payments[0]);
  rejects(() => validateDebtLedger(duplicatePayment), "duplicate_payment");
});
test("selected allocation history cannot claim a different installment", () => {
  const initial = ledger();
  const paid = allocateDebtPayment(initial, payment({ allocation: { rule: "selected_installment", installmentId: initial.installments[0].id } }), access).snapshot;
  paid.payments[0].allocation = { rule: "selected_installment", installmentId: initial.installments[1].id };
  rejects(() => validateDebtLedger(paid), "allocation_choice_mismatch");
});
test("reversal reopens a fully paid debt and preserves original audit and allocations", () => {
  const settled = allocateDebtPayment(ledger(), payment({ amountCents: 90_000_000 }), access).snapshot;
  const reversed = voidDebtPayment(settled, reversal(), access);
  const result = project(reversed, "2026-11-11");
  assert.equal(result.pendingAmountCents, 90_000_000);
  assert.equal(result.paidAmountCents, 0);
  assert.equal(result.status, "overdue");
  assert.equal(result.overdueAmountCents, 30_000_000);
  assert.equal(reversed.version, 2);
  assert.deepEqual(reversed.payments[0].allocations, settled.payments[0].allocations);
  assert.equal(reversed.payments[0].voided?.actorId, access.actorId);
  assert.equal(reversed.payments[0].voided?.reason, reversal().reason);
  assert.equal(settled.payments[0].voided, undefined);
  assert.equal(project(settled).pendingAmountCents, 0);
});
test("reversing one of several partial payments preserves the other balances", () => {
  const first = allocateDebtPayment(ledger(), payment({ amountCents: 20_000_000 }), access).snapshot;
  const second = allocateDebtPayment(first, payment({ paymentId: "payment-b", expectedVersion: 1, amountCents: 20_000_000 }), access).snapshot;
  const reversed = voidDebtPayment(second, reversal({ expectedVersion: 2 }), access);
  const result = project(reversed);
  assert.equal(result.paidAmountCents, 20_000_000);
  assert.equal(result.pendingAmountCents, 70_000_000);
  assert.deepEqual(result.installments.map((part) => part.paidAmountCents), [10_000_000, 10_000_000, 0]);
  assert.equal(reversed.payments.length, 2);
});
test("reversal rejects replays, stale versions, foreign scopes, missing permission and bad chronology", () => {
  const initial = allocateDebtPayment(ledger(), payment(), access).snapshot;
  rejects(() => voidDebtPayment(initial, reversal({ paymentId: "missing" }), access), "payment_not_found");
  rejects(() => voidDebtPayment(initial, reversal({ expectedVersion: 0 }), access), "stale_version");
  rejects(() => voidDebtPayment(initial, reversal({ debtId: "debt-b" }), access), "debt_mismatch");
  rejects(() => voidDebtPayment(initial, reversal(), { ...access, permissions: ["debts.view"] }), "permission_denied");
  rejects(() => voidDebtPayment(initial, reversal({ voidedAt: "2026-10-08" }), access), "void_before_payment");
  rejects(() => voidDebtPayment(initial, reversal({ reason: " " }), access), "invalid_text");
  const reversed = voidDebtPayment(initial, reversal(), access);
  rejects(() => voidDebtPayment(reversed, reversal({ expectedVersion: 2 }), access), "payment_already_voided");
});

// Forecasts, states, branch filtering and currency separation.
test("installment and debt states distinguish paid, overdue, partial and pending", () => {
  const initial = ledger();
  assert.equal(project(initial).status, "in_plan");
  assert.equal(project(initial, "2026-11-10").installments[0].status, "pending");
  const partial = allocateDebtPayment(initial, payment(), access).snapshot;
  assert.equal(project(partial).status, "partially_paid");
  assert.equal(project(partial).installments[0].status, "partial");
  const overdue = project(partial, "2026-11-11");
  assert.equal(overdue.status, "overdue");
  assert.equal(overdue.installments[0].status, "overdue");
  assert.equal(overdue.overdueAmountCents, 20_000_000);
  assert.equal(overdue.nextDueDate, "2026-11-10");
});
test("7/30/60 projections use remaining balances and exact half-open day boundaries", () => {
  const dueDates = ["2026-10-08", "2026-10-09", "2026-10-15", "2026-10-16", "2026-11-07", "2026-11-08", "2026-12-07", "2026-12-08"];
  const initial = ledger(planInput({ installmentCount: dueDates.length, financing: { totalFinancedCents: 800 }, schedule: { periodicity: "custom", dueDates } }));
  const partial = allocateDebtPayment(initial, payment({ amountCents: 40, allocation: { rule: "selected_installment", installmentId: "debt-a-installment-2" } }), access).snapshot;
  const result = project(partial);
  assert.equal(result.pendingAmountCents, 760);
  assert.equal(result.overdueAmountCents, 100);
  assert.equal(result.dueTodayCents, 60);
  assert.equal(result.next7DaysCents, 160); // Oct 9 through Oct 15.
  assert.equal(result.next30DaysCents, 360); // Through Nov 7.
  assert.equal(result.next60DaysCents, 560); // Through Dec 7.
  assert.equal(result.dueThisMonthCents, 360); // Includes unpaid earlier dates in month.
});
test("undated debt remains separate from dated commitments, and forecasts are not historical accounting", () => {
  const initial = ledger({ mode: "single", currency: "ARS", originalAmountCents: 500, financing: { totalFinancedCents: 500 } });
  const result = project(initial);
  assert.equal(result.status, "pending");
  assert.equal(result.unscheduledAmountCents, 500);
  assert.equal(result.nextDueDate, null);
  assert.equal(result.next60DaysCents, 0);
  const paid = allocateDebtPayment(initial, payment({ amountCents: 500, paidAt: "2026-10-10" }), access).snapshot;
  // asOfDate only changes due-date classification; historical ledger reconstruction is a separate concern.
  assert.equal(project(paid, "2026-10-09").paidAmountCents, 500);
});
test("projections work across leap years and civil-year boundaries", () => {
  const initial = ledger(planInput({ installmentCount: 3, financing: { totalFinancedCents: 300 }, schedule: { periodicity: "custom", dueDates: ["2028-02-28", "2028-02-29", "2028-03-01"] } }));
  assert.equal(project(initial, "2028-02-28").next7DaysCents, 300);
  assert.equal(project(initial, "2028-02-28").dueThisMonthCents, 200);
  const yearEnd = ledger(planInput({ installmentCount: 2, financing: { totalFinancedCents: 200 }, schedule: { periodicity: "custom", dueDates: ["2026-12-31", "2027-01-06"] } }));
  assert.equal(project(yearEnd, "2026-12-31").next7DaysCents, 200);
  assert.equal(project(yearEnd, "2026-12-31").dueThisMonthCents, 100);
});
test("portfolio filters assigned branches and keeps currencies separate", () => {
  const first = ledger();
  const second = ledger(planInput(), { debtId: "debt-b", branchId: "branch-b" });
  const third = ledger(planInput({ currency: "USD" }), { debtId: "debt-c" });
  const unscoped = ledger(planInput(), { debtId: "debt-d", branchId: null });
  const options = { currency: "ARS", asOfDate: "2026-10-09" };
  const all = [first, second, third, unscoped];
  assert.equal(projectDebtPortfolio(all, options, access).pendingAmountCents, 270_000_000);
  const restricted = projectDebtPortfolio(all, options, { ...access, branchIds: ["branch-a"] });
  assert.equal(restricted.pendingAmountCents, 90_000_000);
  assert.equal(restricted.debtCount, 1);
  assert.deepEqual(restricted.debts.map((debt) => debt.debtId), ["debt-a"]);
  assert.equal(projectDebtPortfolio(all, { ...options, branchId: "branch-b" }, access).debtCount, 1);
  assert.equal(projectDebtPortfolio(all, { ...options, branchId: null }, access).debtCount, 1);
  assert.equal(projectDebtPortfolio(all, { ...options, currency: "USD" }, access).pendingAmountCents, 90_000_000);
  assert.equal(projectDebtPortfolio([], options, access).pendingAmountCents, 0);
});
test("projection access rejects foreign business data, forbidden branches and missing view permission", () => {
  const initial = ledger();
  rejects(() => projectDebtCommitments(initial, "2026-10-09", { ...access, permissions: ["debts.pay"] }), "permission_denied");
  rejects(() => projectDebtCommitments(initial, "2026-10-09", { ...access, branchIds: ["branch-b"] }), "branch_forbidden");
  rejects(() => projectDebtPortfolio([ledger(planInput(), { businessId: "business-b" })], { currency: "ARS", asOfDate: "2026-10-09" }, access), "business_mismatch");
  rejects(() => projectDebtPortfolio([initial], { currency: "ARS", asOfDate: "2026-10-09", branchId: "branch-b" }, { ...access, branchIds: ["branch-a"] }), "branch_forbidden");
  rejects(() => projectDebtPortfolio([initial], { currency: "ARS", asOfDate: "2026-10-09", businessId: "business-a" }, access), "unknown_field");
  rejects(() => projectDebtPortfolio([initial, initial], { currency: "ARS", asOfDate: "2026-10-09" }, access), "duplicate_debt");
  rejects(() => projectDebtPortfolio([initial], { currency: "ARS", asOfDate: "2026-02-30" }, access), "invalid_date");
});
test("outputs never alias input plans, snapshots or access arrays", () => {
  const input = planInput({ components: [{ capitalAmountCents: 10 }, {}, {}] });
  const inputBefore = structuredClone(input);
  const planned = generateDebtPlan(input);
  planned.installments[0].capitalAmountCents = 20;
  assert.deepEqual(input, inputBefore);
  const initial = allocateDebtPayment(ledger(), payment(), access).snapshot;
  const before = structuredClone(initial);
  const validated = validateDebtLedger(initial);
  validated.payments[0].allocations[0].amountCents = 0;
  const projected = project(initial);
  projected.installments[0].dueDate = null;
  assert.deepEqual(initial, before);
});


test("array boundaries reject added fields and accessors without evaluating them", () => {
  const annotated = Object.assign([{}, {}, {}], { extra: true });
  rejects(() => generateDebtPlan({ ...planInput(), components: annotated }), "unknown_field");
  const accessor = [{}, {}, {}];
  Object.defineProperty(accessor, "0", { get() { throw new Error("must not evaluate"); } });
  rejects(() => generateDebtPlan({ ...planInput(), components: accessor }), "invalid_array");
});
test("even voided history must contain individually valid payment allocations", () => {
  const paid = allocateDebtPayment(ledger(), payment(), access).snapshot;
  const reversed = voidDebtPayment(paid, reversal(), access);
  reversed.payments[0].amountCents = 30_000_001;
  reversed.payments[0].allocations[0].amountCents = 30_000_001;
  rejects(() => validateDebtLedger(reversed), "amount_exceeds_installment_pending");
});
test("confirmed upfront payment is not subtracted again from financed installments", () => {
  const input = planInput({ originalAmountCents: 50_000_000, installmentCount: 4, financing: { confirmedBalance: { confirmed: true, downPaymentCents: 10_000_000, interestCents: 4_000_000, feesCents: 200_000 } } });
  const planned = generateDebtPlan(input);
  const initial = ledger(input);
  assert.equal(project(initial).pendingAmountCents, 44_200_000);
  assert.equal(project(initial).paidAmountCents, 0); // The schedule has no installment payments yet.
  assert.equal(planned.totalObligationCents, 54_200_000);
  const paid = allocateDebtPayment(initial, payment({ amountCents: 44_200_000 }), access);
  assert.equal(project(paid.snapshot).paidAmountCents + planned.downPaymentCents!, planned.totalObligationCents);
});
test("deterministic payment/reversal sequences always conserve cents and nonnegative installment balances", () => {
  for (let total = 31; total < 100; total += 7) {
    let state = ledger(planInput({ financing: { totalFinancedCents: total }, installmentCount: 7 }));
    for (let step = 0; step < 24; step++) {
      const current = project(state);
      const active = state.payments.filter((record) => !record.voided);
      if ((step % 4 === 3 || current.pendingAmountCents === 0) && active.length) {
        state = voidDebtPayment(state, reversal({ paymentId: active[0].id, expectedVersion: state.version }), access);
      } else {
        const amountCents = Math.min(current.pendingAmountCents, 1 + (step * 7) % 13);
        if (amountCents) state = allocateDebtPayment(state, payment({ paymentId: `sequence-${step}`, amountCents, expectedVersion: state.version }), access).snapshot;
      }
      const after = project(state);
      assert.equal(after.pendingAmountCents + after.paidAmountCents, total);
      assert.equal(after.installments.reduce((sum, installment) => sum + installment.pendingAmountCents, 0), after.pendingAmountCents);
      assert.ok(after.installments.every((installment) => installment.pendingAmountCents >= 0 && Number.isSafeInteger(installment.pendingAmountCents)));
    }
  }
});


test("partial component declarations must leave a feasible allocation of confirmed totals", () => {
  const two = planInput({ originalAmountCents: 150, installmentCount: 2, financing: { confirmedBalance: { confirmed: true, downPaymentCents: 0, interestCents: 50, feesCents: 0 } }, components: [{ capitalAmountCents: 0 }, { interestAmountCents: 0, feesAmountCents: 0 }] });
  rejects(() => generateDebtPlan(two), "inconsistent_components");
  // Each individual component fits somewhere, but capital + interest compete
  // for the same 100-cent installment and cannot both fit.
  const competing = planInput({ originalAmountCents: 100, installmentCount: 3, financing: { confirmedBalance: { confirmed: true, downPaymentCents: 0, interestCents: 100, feesCents: 100 } }, components: [{ feesAmountCents: 0 }, { capitalAmountCents: 0, interestAmountCents: 0 }, { capitalAmountCents: 0, interestAmountCents: 0 }] });
  rejects(() => generateDebtPlan(competing), "inconsistent_components");
  const feasible = generateDebtPlan({ ...competing, components: [{ feesAmountCents: 0 }, { interestAmountCents: 0 }, { capitalAmountCents: 0 }] });
  assert.equal(feasible.totalFinancedCents, 300);
  assert.equal(feasible.installments[0].capitalAmountCents, null);
  assert.equal(feasible.installments[0].interestAmountCents, null);
});


test("array subclasses cannot bypass element validation through custom map methods", () => {
  const dates = ["2026-11-01", "2026-12-01"];
  const prototype = Object.create(Array.prototype) as string[];
  prototype.map = (() => ["aaa", "bbb"]) as typeof prototype.map;
  Object.setPrototypeOf(dates, prototype);
  rejects(() => generateDebtPlan({ ...planInput(), installmentCount: 2, schedule: { periodicity: "custom", dueDates: dates } }), "invalid_array");
});
test("append at the ledger history bound fails instead of returning an invalid snapshot", () => {
  const initial = allocateDebtPayment(ledger(), payment({ amountCents: 1 }), access).snapshot;
  const first = initial.payments[0];
  initial.payments = Array.from({ length: MAX_DEBT_LEDGER_PAYMENTS }, (_, i) => ({ ...first, id: `history-${i}` }));
  initial.version = MAX_DEBT_LEDGER_PAYMENTS;
  rejects(() => allocateDebtPayment(initial, payment({ amountCents: 1, expectedVersion: initial.version }), access), "payment_history_limit");
});
