import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { readFileSync } from "node:fs";
import * as contract from "../app/deudas/plan-contract";
import * as plans from "../lib/debts/plans";
import * as permissions from "../lib/permissions";
import { mapDebtView, type DebtRow, type PaymentRow, type InstallmentRow } from "../app/deudas/plan-data";

const businessId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000001";
const otherBranch = "20000000-0000-4000-8000-000000000002";
const debtId = "30000000-0000-4000-8000-000000000001";
const paymentId = "40000000-0000-4000-8000-000000000001";
const installmentId = "50000000-0000-4000-8000-000000000001";
const requestId = "60000000-0000-4000-8000-000000000001";
const actorId = "70000000-0000-4000-8000-000000000001";
const planInput: plans.DebtPlanInput = { mode: "single", currency: "ARS", originalAmountCents: 10000, financing: { totalFinancedCents: 10000 }, dueDate: "2026-11-10" };
const plan = plans.generateDebtPlan(planInput);
let ctx: any;
let connected = true;
let databaseMode = true;
let legacy = false;
let found = true;
let debtBranch = branchId;
let rpcResult: any;
let throwRpc = false;
let cacheThrows = false;
let calls: { name: string; args: Record<string, any> }[] = [];
let queries: { table: string; filters: Record<string, unknown> }[] = [];
const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, async maybeSingle() { queries.push({ table, filters }); return { error: null, data: found ? table === "branches" ? { id: branchId } : { id: debtId, branch_id: debtBranch, plan_definition: legacy ? null : plan } : null }; } };
    return query;
  },
  async rpc(name: string, args: Record<string, unknown>) { calls.push({ name, args }); if (throwRpc) throw new Error("lost response"); return rpcResult; },
};
const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "@/lib/supabase/server": { createSupabaseServerClient: async () => connected ? db : null },
    "@/lib/data/auth": { getCurrentUserContext: async () => ctx },
    "@/lib/env": { isDatabaseMode: () => databaseMode },
    "@/lib/permissions": permissions,
    "@/lib/debts/plans": plans,
    "@/app/deudas/plan-contract": contract,
    "next/cache": { revalidatePath: () => { if (cacheThrows) throw new Error("cache offline"); } },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const rawActions: typeof import("../app/actions/debt-plans") = require("../app/actions/debt-plans");
const actions = Object.fromEntries(Object.entries(rawActions).map(([name, action]) => [name, (input: unknown) => action(input, { actorId, businessId })])) as { [K in keyof typeof rawActions]: (input: unknown) => ReturnType<typeof rawActions[K]> };
loader._load = original;
function reset() { ctx = { isAuthenticated: true, userId: actorId, businessId, role: "owner", assignedBranchIds: null, enabledModules: ["debts"] }; connected = true; databaseMode = true; legacy = false; found = true; debtBranch = branchId; throwRpc = false; cacheThrows = false; calls = []; queries = []; rpcResult = { data: { ok: true, debt_id: debtId, payment_id: paymentId, version: 1 }, error: null }; }
function createInput() { return { requestId, branchId, creditor: "Banco Nación", creditorType: "bank", takenAt: "2026-10-09", planInput, scheduleConfirmed: true }; }
function paymentInput() { return { requestId, debtId, expectedVersion: 0, amountCents: 5000, paidAt: "2026-10-09", paymentMethod: "Transferencia", allocation: { rule: "oldest_due" } }; }
function voidInput() { return { requestId, debtId, paymentId, expectedVersion: 1, reason: "Pago duplicado en el registro" }; }

test("create action regenerates schedule, derives business and actor server-side, and uses one atomic RPC", async () => {
  reset(); const result = await actions.createDebtPlanAction(createInput());
  assert.equal(result.ok, true); assert.equal(calls.length, 1); assert.equal(calls[0].name, "create_debt_installment_plan");
  const sent = calls[0].args.p_plan;
  assert.equal(sent.business_id, businessId); assert.equal(sent.branch_id, branchId); assert.equal(sent.origin, "manual"); assert.equal(sent.plan.totalFinancedCents, 10000); assert.equal(sent.plan.installments[0].totalAmountCents, 10000); assert.equal(calls[0].args.p_idempotency_key, requestId);
  assert.equal("actor_id" in sent, false); assert.equal("created_by" in sent, false);
  assert.deepEqual(queries[0].filters, { business_id: businessId, id: branchId });
});
test("create action requires preview confirmation and rejects actor/business/origin or forged nested fields", async () => {
  for (const input of [{ ...createInput(), scheduleConfirmed: false }, { ...createInput(), actorId: "attacker" }, { ...createInput(), businessId: "other" }, { ...createInput(), origin: "whatsapp" }, { ...createInput(), planInput: { ...planInput, pendingAmountCents: 1 } }, { ...createInput(), planInput: { ...planInput, financing: { totalFinancedCents: 10000, fees: -1 } } }]) {
    reset(); const result = await actions.createDebtPlanAction(input); assert.equal(result.ok, false); assert.equal(calls.length, 0);
  }
});
test("all plan actions fail closed for missing auth, disabled module, view-only role, demo and disconnected database", async () => {
  for (const configure of [() => { ctx.isAuthenticated = false; }, () => { ctx.userId = null; }, () => { ctx.businessId = null; }, () => { ctx.enabledModules = []; }, () => { ctx.role = "accountant"; }, () => { databaseMode = false; }, () => { connected = false; }]) {
    for (const [action, input] of [[actions.createDebtPlanAction, createInput()], [actions.registerDebtPlanPaymentAction, paymentInput()], [actions.voidDebtPlanPaymentAction, voidInput()]] as const) {
      reset(); configure(); assert.equal((await action(input)).ok, false); assert.equal(calls.length, 0);
    }
  }
});
test("branch scope is checked for creation, payment and reversal before RPC", async () => {
  reset(); ctx.assignedBranchIds = [otherBranch]; assert.equal((await actions.createDebtPlanAction(createInput())).ok, false); assert.equal(calls.length, 0);
  for (const [action, input] of [[actions.registerDebtPlanPaymentAction, paymentInput()], [actions.voidDebtPlanPaymentAction, voidInput()]] as const) {
    reset(); ctx.assignedBranchIds = [otherBranch]; assert.equal((await action(input)).ok, false); assert.equal(calls.length, 0); assert.deepEqual(queries[0].filters, { business_id: businessId, id: debtId });
    reset(); ctx.assignedBranchIds = [branchId]; debtBranch = null as any; assert.equal((await action(input)).ok, false);
    reset(); found = false; assert.equal((await action(input)).ok, false);
  }
});
test("payment requires explicit valid amount, method, date and exact allocation rule", async () => {
  const cases = [{ amountCents: 0 }, { amountCents: 0.1 }, { amountCents: plans.MAX_DEBT_MONEY_CENTS + 1 }, { paymentMethod: " " }, { paidAt: "2026-02-30" }, { paidAt: undefined }, { allocation: {} }, { allocation: { rule: "oldest_due", installmentId } }, { allocation: { rule: "selected_installment" } }, { expectedVersion: 1.1 }, { actorId: actorId }, { currency: "USD" }];
  for (const invalid of cases) { reset(); assert.equal((await actions.registerDebtPlanPaymentAction({ ...paymentInput(), ...invalid })).ok, false); assert.equal(calls.length, 0); }
});
test("selected partial/advance payment uses explicit selection, CAS and stable idempotency key", async () => {
  reset(); const input = { ...paymentInput(), allocation: { rule: "selected_installment", installmentId } }; const result = await actions.registerDebtPlanPaymentAction(input);
  assert.equal(result.ok, true); assert.deepEqual(calls[0], { name: "register_debt_plan_payment", args: { p_debt_id: debtId, p_expected_version: 0, p_idempotency_key: requestId, p_payment: { amountCents: 5000, paidAt: "2026-10-09", paymentMethod: "Transferencia", allocation: input.allocation, origin: "manual" } } });
});
test("CAS and overpayment business rejections are known failures with drafts recoverable", async () => {
  for (const code of ["stale_version", "amount_exceeds_pending", "amount_exceeds_installment_pending", "idempotency_conflict"]) { reset(); rpcResult = { data: { ok: false, error: code }, error: null }; const result = await actions.registerDebtPlanPaymentAction(paymentInput()); assert.equal(result.ok, false); if (!result.ok) { assert.equal(result.code, code); assert.equal(result.uncertain, undefined); } }
});
test("lost response retry sends byte-equivalent arguments and same request ID instead of a new payment", async () => {
  reset(); throwRpc = true; const input = paymentInput(); const first = await actions.registerDebtPlanPaymentAction(input); assert.equal(first.ok, false); if (!first.ok) assert.equal(first.uncertain, true);
  throwRpc = false; assert.equal((await actions.registerDebtPlanPaymentAction(input)).ok, true); assert.deepEqual(calls[0], calls[1]);
});
test("missing success payload is uncertain; cache failure after commit remains success", async () => {
  reset(); rpcResult = { data: { ok: true }, error: null }; const result = await actions.createDebtPlanAction(createInput()); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.uncertain, true);
  reset(); cacheThrows = true; assert.equal((await actions.createDebtPlanAction(createInput())).ok, true);
});
test("reversal requires reason and preserves expected version and stable operation ID", async () => {
  reset(); assert.equal((await actions.voidDebtPlanPaymentAction({ ...voidInput(), reason: " " })).ok, false); assert.equal(calls.length, 0);
  assert.equal((await actions.voidDebtPlanPaymentAction(voidInput())).ok, true); assert.deepEqual(calls[0], { name: "void_debt_plan_payment", args: { p_debt_id: debtId, p_payment_id: paymentId, p_expected_version: 1, p_reason: "Pago duplicado en el registro", p_idempotency_key: requestId } });
});
test("legacy payment requires explicit metadata, uses legacy audited RPC and exposes uncertain outcome without claiming safe retries", async () => {
  reset(); legacy = true;
  assert.equal((await actions.registerDebtPlanPaymentAction(paymentInput())).ok, false); assert.equal(calls.length, 0);
  assert.equal((await actions.registerLegacyDebtPaymentAction(paymentInput())).ok, true); assert.equal(calls[0].name, "register_debt_payment_atomic"); assert.equal(calls[0].args.p_amount, "50.00"); assert.equal(calls[0].args.p_actor_id, actorId); assert.equal(calls[0].args.p_paid_at, "2026-10-09");
  throwRpc = true; const result = await actions.registerLegacyDebtPaymentAction(paymentInput()); assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "legacy_response_unknown");
});

const access: plans.DebtAccess = { actorId, businessId, branchIds: null, permissions: ["debts.view", "debts.pay"] };
function row(): DebtRow { return { id: debtId, business_id: businessId, branch_id: branchId, creditor: "Banco", creditor_type: "bank", concept: "Capital", currency: "ARS", original_amount: "100", pending_amount: "50", taken_at: "2026-10-09", due_date: "2026-11-10", status: "active", origin: "manual", category: null, reference: null, notes: null, expected_payment_method: null, total_financed_amount: "100", down_payment_amount: null, mode: "single", plan_version: 1, plan_definition: plan, created_by: actorId, created_at: "2026-10-09T12:00:00Z" }; }
const part: InstallmentRow = { id: installmentId, business_id: businessId, branch_id: branchId, debt_id: debtId, installment_number: 1, due_date: "2026-11-10", total_amount: "100", capital_amount: null, interest_amount: null, fees_amount: null, notes: null };
function paymentRow(): PaymentRow { return { id: paymentId, business_id: businessId, branch_id: branchId, debt_id: debtId, currency: "ARS", amount: "50", paid_at: "2026-10-09", payment_method: "Transferencia", created_by: actorId, created_at: "2026-10-09T12:00:00Z", origin: "manual", reference: null, notes: null, allocation_rule: "oldest_due", selected_installment_id: null, voided_at: null, voided_on: null, voided_by: null, void_reason: null }; }
const allocation = { business_id: businessId, branch_id: branchId, debt_id: debtId, payment_id: paymentId, installment_id: installmentId, amount: "50" };
test("read model calculates installments from immutable allocations, excludes voided payments, and detects inconsistent balances", () => {
  const result = mapDebtView(row(), [part], [paymentRow()], [allocation], [], "2026-10-09", access); assert.equal(result.projection?.pendingAmountCents, 5000); assert.equal(result.projection?.installments[0].status, "partial"); assert.equal(result.projection?.next60DaysCents, 5000);
  const reversed = { ...paymentRow(), voided_at: "2026-10-10T12:00:00Z", voided_on: "2026-10-10", voided_by: actorId, void_reason: "Duplicado" };
  assert.equal(mapDebtView({ ...row(), pending_amount: "100" }, [part], [reversed], [allocation], [], "2026-10-10", access).projection?.pendingAmountCents, 10000);
  assert.throws(() => mapDebtView(row(), [part], [reversed], [allocation], [], "2026-10-10", access), /ledger_balance_mismatch/);
});
test("read model fails closed on cross-business debt or allocation and restricted legacy branch", () => {
  assert.throws(() => mapDebtView({ ...row(), business_id: "other" }, [part], [paymentRow()], [allocation], [], "2026-10-09", access), /debt_scope_mismatch/);
  assert.throws(() => mapDebtView(row(), [part], [paymentRow()], [{ ...allocation, business_id: "other" }], [], "2026-10-09", access), /allocation_scope_mismatch/);
  assert.throws(() => mapDebtView({ ...row(), plan_definition: null }, [], [], [], [], "2026-10-09", { ...access, branchIds: [otherBranch] }), /debt_scope_mismatch/);
});
test("legacy view preserves unknown currency and has no invented schedule or projection", () => {
  const result = mapDebtView({ ...row(), plan_definition: null, currency: null }, [], [paymentRow()], [], [], "2026-10-09", access);
  assert.equal(result.currency, null); assert.equal(result.ledger, null); assert.equal(result.projection, null); assert.equal(result.pendingCents, 5000);
});
test("database UI avoids demo/estimated totals and unsafe automatic retry defaults", () => {
  const page = readFileSync("app/deudas/page.tsx", "utf8"); const source = readFileSync("app/deudas/database-debts-client.tsx", "utf8"); const dataPage = readFileSync("app/deudas/database-debts-page.tsx", "utf8");
  assert.doesNotMatch(page, /totalDeuda\s*\/\s*6/); assert.doesNotMatch(dataPage, /mock-data|fallbackDebts|fallbackKpis/);
  assert.match(dataPage, /\.limit\(500\)/); assert.match(source, /useRef\(false\)/); assert.match(source, /const \[method, setMethod\] = useState\(""\)/); assert.match(source, /const \[rule, setRule\] = useState\(""\)/); assert.match(source, /Confirmar y guardar cronograma/); assert.match(source, /No se habilitan reintentos automáticos/);
});

test("legacy reference plus notes validates combined SQL limit before submitting", async () => {
  reset(); legacy = true;
  const result = await actions.registerLegacyDebtPaymentAction({ ...paymentInput(), reference: "A".repeat(200), notes: "N".repeat(900) });
  assert.equal(result.ok, false); if (!result.ok) assert.equal(result.code, "notes_too_long"); assert.equal(calls.length, 0);
});
test("read model uses business civil reversal date, not UTC timestamp slicing", () => {
  const payment = { ...paymentRow(), paid_at: "2026-10-10", voided_at: "2026-10-09T23:30:00Z", voided_on: "2026-10-10", voided_by: actorId, void_reason: "Duplicado" };
  const result = mapDebtView({ ...row(), pending_amount: "100" }, [part], [payment], [allocation], [], "2026-10-10", access);
  assert.equal(result.ledger?.payments[0].voided?.voidedAt, "2026-10-10");
});
test("recovery journal rejects forged payloads, preserves operation identity and supports same-key replay", async () => {
  const { parseOperationJournal, retainDebtOperation } = await import("../app/deudas/operation-journal");
  const operation = { kind: "pay" as const, request: contract.parsePaymentPlanRequest(paymentInput()) };
  const journal = retainDebtOperation({ active: [], expired: [] }, operation);
  assert.deepEqual(parseOperationJournal(JSON.stringify(journal)), journal);
  assert.deepEqual(retainDebtOperation(journal, operation), journal);
  assert.throws(() => retainDebtOperation(journal, { ...operation, request: { ...operation.request, amountCents: 4000 } }), /journal_identity_conflict/);
  assert.throws(() => parseOperationJournal(JSON.stringify([{ kind: "pay", request: { ...paymentInput(), actorId: "forged" } }])));
  assert.throws(() => parseOperationJournal(JSON.stringify([operation, operation])), /duplicate_journal_request/);
  assert.throws(() => parseOperationJournal("not json"));
});
test("retry uncertainty is sticky and pending operation is retained before every RPC UI call", () => {
  const source = readFileSync("app/deudas/database-debts-client.tsx", "utf8");
  assert.doesNotMatch(source, /setUncertain\(!!result\.uncertain\)/);
  assert.match(source, /setUncertain\(\(previous\) => previous \|\| !!result\.uncertain\)/);
  assert.match(source, /sessionStorage\.setItem\(journalKey/);
  assert.match(source, /debt-operations:v1:\$\{access\.businessId\}:\$\{access\.actorId\}/);
  assert.match(source, /onRetain\(\{ kind: "create"[\s\S]*createDebtPlanAction\(review\.request, expectedSession\)/);
  assert.match(source, /onRetain\(\{ kind: debt\.ledger[\s\S]*const result = await action\(review\.request, expectedSession\)/);
  assert.match(source, /onRetain\(\{ kind: "void"[\s\S]*voidDebtPlanPaymentAction\(review, expectedSession\)/);
});

test("edits validate exact scope, version, nullable notes and dates, then use versioned RPCs", async () => {
  reset(); const common = { requestId, debtId, expectedVersion: 1, notes: "Cambió el acuerdo" };
  assert.equal((await actions.editDebtPlanAction({ ...common, kind: "notes" })).ok, true);
  assert.deepEqual(calls[0], { name: "update_debt_plan_notes", args: { p_debt_id: debtId, p_expected_version: 1, p_notes: "Cambió el acuerdo", p_idempotency_key: requestId } });
  reset(); assert.equal((await actions.editDebtPlanAction({ ...common, kind: "installment", installmentId, dueDate: "2026-11-12", notes: null })).ok, true);
  assert.deepEqual(calls[0], { name: "edit_debt_installment", args: { p_debt_id: debtId, p_expected_version: 1, p_notes: null, p_idempotency_key: requestId, p_installment_id: installmentId, p_due_date: "2026-11-12" } });
  for (const input of [{ ...common, kind: "notes", originalAmountCents: 2000 }, { ...common, kind: "notes", installmentId }, { ...common, kind: "installment", installmentId, dueDate: "2026-02-30" }, { ...common, kind: "installment", installmentId, dueDate: "2026-11-12", businessId: "foreign" }]) {
    reset(); assert.equal((await actions.editDebtPlanAction(input)).ok, false); assert.equal(calls.length, 0);
  }
  reset(); ctx.assignedBranchIds = [otherBranch]; assert.equal((await actions.editDebtPlanAction({ ...common, kind: "notes" })).ok, false); assert.equal(calls.length, 0);
});

test("authenticated recovery lookup reads result without replay and not-found never claims rollback", async () => {
  reset(); rpcResult = { data: { ok: true, found: true, debt_id: debtId, payment_id: paymentId }, error: null };
  assert.deepEqual(await actions.getDebtOperationResultAction({ operation: "pay", requestId, debtId }), { ok: true, found: true, debtId, paymentId });
  assert.deepEqual(calls[0], { name: "get_debt_operation_result", args: { p_operation: "pay", p_idempotency_key: requestId, p_debt_id: debtId } });
  reset(); rpcResult = { data: { ok: true, found: false }, error: null };
  assert.deepEqual(await actions.getDebtOperationResultAction({ operation: "create", requestId }), { ok: true, found: false });
  reset(); ctx.isAuthenticated = false; assert.equal((await actions.getDebtOperationResultAction({ operation: "pay", requestId, debtId })).ok, false); assert.equal(calls.length, 0);
  reset(); assert.equal((await actions.getDebtOperationResultAction({ operation: "pay", requestId, debtId, actorId: "forged" })).ok, false); assert.equal(calls.length, 0);
  reset(); assert.equal((await actions.getDebtOperationResultAction({ operation: "legacy", requestId, debtId })).ok, false); assert.equal(calls.length, 0);
});

test("editing a supported historical due date does not invent a newer date", () => {
  assert.equal(contract.parseEditPlanRequest({ kind: "installment", requestId, debtId, installmentId, expectedVersion: 0, notes: null, dueDate: "1999-12-31" }).kind, "installment");
});

test("stale actor/business session fence rejects all mutation and recovery calls before database access", async () => {
  const expected = { actorId, businessId };
  for (const [action, input] of [[rawActions.createDebtPlanAction, createInput()], [rawActions.registerDebtPlanPaymentAction, paymentInput()], [rawActions.registerLegacyDebtPaymentAction, paymentInput()], [rawActions.voidDebtPlanPaymentAction, voidInput()], [rawActions.editDebtPlanAction, { kind: "notes", requestId, debtId, expectedVersion: 0, notes: null }], [rawActions.getDebtOperationResultAction, { operation: "pay", requestId, debtId }], [rawActions.verifyDebtSessionAction, null]] as const) {
    reset(); ctx.userId = "70000000-0000-4000-8000-000000000002";
    assert.equal((await action(input, expected)).ok, false); assert.equal(calls.length, 0); assert.equal(queries.length, 0);
    reset(); ctx.businessId = "10000000-0000-4000-8000-000000000002";
    assert.equal((await action(input, expected)).ok, false); assert.equal(calls.length, 0); assert.equal(queries.length, 0);
  }
});
test("only definitive post-idempotency transaction rejection can clear earlier uncertain attempts", async () => {
  for (const [code, expected] of [["stale_version", true], ["amount_exceeds_pending", true], ["installment_not_found", true], ["permission_denied", false], ["debt_not_found", false], ["idempotency_conflict", false]] as const) {
    reset(); rpcResult = { data: { ok: false, error: code }, error: null };
    const result = await actions.registerDebtPlanPaymentAction(paymentInput()); assert.equal(result.ok, false); if (!result.ok) assert.equal(!!result.definitiveRejected, expected);
  }
});


test("administrative cancellation needs explicit semantics and sends one scoped versioned RPC", async () => {
  const input = { requestId, debtId, expectedVersion: 1, reason: "Registro duplicado", administrativeOnlyConfirmed: true };
  reset(); assert.equal((await actions.cancelDebtPlanRecordAction(input)).ok, true);
  assert.deepEqual(calls[0], { name: "cancel_debt_plan_record", args: { p_debt_id: debtId, p_expected_version: 1, p_reason: "Registro duplicado", p_idempotency_key: requestId } });
  for (const change of [{ administrativeOnlyConfirmed: false }, { reason: " " }, { expectedVersion: -1 }, { actorId: "spoofed" }]) {
    reset(); assert.equal((await actions.cancelDebtPlanRecordAction({ ...input, ...change })).ok, false); assert.equal(calls.length, 0);
  }
  reset(); ctx.assignedBranchIds = [otherBranch]; assert.equal((await actions.cancelDebtPlanRecordAction(input)).ok, false); assert.equal(calls.length, 0);
  reset(); ctx.role = "accountant"; assert.equal((await actions.cancelDebtPlanRecordAction(input)).ok, false); assert.equal(calls.length, 0);
  reset(); legacy = true; assert.equal((await actions.cancelDebtPlanRecordAction(input)).ok, false); assert.equal(calls.length, 0);
  reset(); const result = await rawActions.cancelDebtPlanRecordAction(input, { actorId: "another", businessId }); assert.equal(result.ok, false); assert.equal(calls.length, 0);
  reset(); throwRpc = true; const lost = await actions.cancelDebtPlanRecordAction(input); assert.equal(lost.ok, false); if (!lost.ok) assert.equal(lost.uncertain, true);
  reset(); rpcResult = { data: { ok: true, found: true, debt_id: debtId }, error: null };
  assert.deepEqual(await actions.getDebtOperationResultAction({ operation: "cancel", requestId, debtId }), { ok: true, found: true, debtId });
});
test("cancelled read model retains paid history and exact historical unpaid balance", () => {
  const cancelled = { ...row(), status: "cancelled", cancelled_at: "2026-10-09T23:30:00Z", cancelled_on: "2026-10-10", cancelled_by: actorId, cancel_reason: "Duplicado" };
  const view = mapDebtView(cancelled, [part], [paymentRow()], [allocation], [], "2026-10-10", access);
  assert.equal(view.status, "cancelled"); assert.equal(view.pendingCents, 5000); assert.equal(view.payments.length, 1);
  assert.equal(view.ledger?.cancelled?.cancelledAt, "2026-10-10"); assert.equal(view.projection?.nextDueDate, null);
  assert.throws(() => mapDebtView({ ...cancelled, status: "active" }, [part], [paymentRow()], [allocation], [], "2026-10-10", access), /cancellation_state_mismatch/);
});
