import type { SupabaseClient } from "@supabase/supabase-js";
import { mapDebtView, type DebtRow, type DebtView } from "../../app/deudas/plan-data";
import { parseEditPlanRequest, parseVoidPlanRequest, requestUuid } from "../../app/deudas/plan-contract";
import { generateDebtPlan, type DebtOrigin } from "../debts/plans";
import { permissionsFor } from "../permissions";
import { getTool } from "./registry";
import { validateDebtToolCall } from "./debt-validation";
import { debtRpcResult, canonicalDebtCall, createPlanRequest, paymentPlanRequest, missingDebtArguments, newDebtOperationId, isDebtPlanWrite, debtConfirmationText } from "./debt-contract";
import type { AgentActor, ToolCall } from "./types";

type Db = SupabaseClient<any, "public", any>;
const nil = "00000000-0000-0000-0000-000000000000";
const scopeQuery = (query: any, actor: AgentActor) => actor.branchIds === null ? query : query.in("branch_id", actor.branchIds.length ? actor.branchIds : [nil]);
function assertScope(row: { business_id: string; branch_id: string | null }, actor: AgentActor) {
  if (row.business_id !== actor.businessId || actor.branchIds !== null && (!row.branch_id || !actor.branchIds.includes(row.branch_id))) throw new Error("debt_scope_mismatch");
}
function checked(actor: AgentActor, call: ToolCall): ToolCall {
  const tool = getTool(call.name);
  if (!tool || !actor.enabledModules.includes("debts") || !permissionsFor(actor.role).includes(tool.permission)) throw new Error("permission_denied");
  const validation = validateDebtToolCall(canonicalDebtCall(call));
  if (validation.issues.length || missingDebtArguments(validation.call).length) throw new Error("debt_missing_fields");
  return validation.call;
}
export async function resolveDebtBranch(db: Db, actor: AgentActor, requested?: string): Promise<string> {
  if (requested && actor.branchIds !== null && !actor.branchIds.includes(requested)) throw new Error("branch_not_allowed");
  let query = db.from("branches").select("id").eq("business_id", actor.businessId);
  if (requested) query = query.eq("id", requested);
  else if (actor.branchIds !== null) query = query.in("id", actor.branchIds.length ? actor.branchIds : [nil]);
  const res = await query.limit(2);
  if (res.error) throw res.error;
  if (!res.data?.length) throw new Error("branch_not_found");
  if (res.data.length !== 1) throw new Error("branch_ambiguous");
  return res.data[0].id;
}
export async function resolveDebt(db: Db, actor: AgentActor, a: Record<string, unknown>): Promise<DebtRow> {
  let query = scopeQuery(db.from("debts").select("*").eq("business_id", actor.businessId), actor);
  if (a.branchId) {
    if (actor.branchIds !== null && !actor.branchIds.includes(String(a.branchId))) throw new Error("branch_not_allowed");
    query = query.eq("branch_id", a.branchId);
  }
  if (a.debtId) query = query.eq("id", a.debtId);
  else query = query.ilike("creditor", String(a.creditor).replace(/[\\%_]/g, "\\$&"));
  const res = await query.limit(2);
  if (res.error) throw res.error;
  if (!res.data?.length) throw new Error("debt_not_found");
  if (res.data.length !== 1) throw new Error("debt_not_unambiguous");
  const debt = res.data[0]; assertScope(debt, actor);
  if (a.debtId && debt.id !== a.debtId || a.branchId && debt.branch_id !== a.branchId) throw new Error("debt_scope_mismatch");
  return debt;
}
async function allRows(db: Db, table: string, actor: AgentActor, debt: DebtRow): Promise<any[]> {
  const all: any[] = []; const size = 500;
  for (let offset = 0; offset <= 100000; offset += size) {
    const res = await scopeQuery(db.from(table).select("*").eq("business_id", actor.businessId).eq("debt_id", debt.id), actor).order(table === "debt_payment_allocations" ? "payment_id" : "id").range(offset, offset + size - 1);
    if (res.error || !Array.isArray(res.data)) throw new Error("debt_read_failed");
    for (const row of res.data) { assertScope(row, actor); if (row.debt_id !== debt.id || row.branch_id !== debt.branch_id) throw new Error("debt_scope_mismatch"); }
    all.push(...res.data); if (res.data.length < size) return all;
  }
  throw new Error("debt_read_limit");
}
export async function readDebtView(db: Db, actor: AgentActor, debt: DebtRow, asOfDate: string): Promise<DebtView> {
  assertScope(debt, actor);
  const [installments, payments, allocations] = await Promise.all([allRows(db, "debt_installments", actor, debt), allRows(db, "debt_payments", actor, debt), allRows(db, "debt_payment_allocations", actor, debt)]);
  return mapDebtView(debt, installments, payments, allocations, [], asOfDate, { actorId: actor.userId, businessId: actor.businessId, branchIds: actor.branchIds, permissions: ["debts.view"] });
}
async function today(db: Db, actor: AgentActor): Promise<string> {
  const business = await db.from("businesses").select("timezone").eq("id", actor.businessId).maybeSingle();
  if (business.error || typeof business.data?.timezone !== "string") throw new Error("debt_timezone_unavailable");
  try { return new Date().toLocaleDateString("en-CA", { timeZone: business.data.timezone }); }
  catch { throw new Error("debt_timezone_unavailable"); }
}

/** Resolves once before preview. The exact debt, installment, version and operation ID persist in pending arguments. */
export async function prepareDebtTool(db: Db, actor: AgentActor, input: ToolCall): Promise<ToolCall> {
  const call = checked(actor, input); const a = { ...call.arguments };
  if (call.name === "debts.getPlan") {
    const debt = await resolveDebt(db, actor, a);
    return { name: call.name, arguments: { ...a, debtId: debt.id, creditor: debt.creditor, ...(debt.branch_id ? { branchId: debt.branch_id } : {}) } };
  }
  if (!isDebtPlanWrite(call.name)) return call;
  a.requestId = newDebtOperationId(); // Never trust an interpreter-supplied request ID for a new operation.
  if (call.name === "debts.createPlan") {
    a.branchId = await resolveDebtBranch(db, actor, a.branchId as string | undefined);
    createPlanRequest(a); // Same request parser as manual UI.
    if (debtConfirmationText({ name: call.name, arguments: a }).length > 3500) throw new Error("debt_preview_requires_ui");
  } else {
    const debt = await resolveDebt(db, actor, a);
    if (!debt.plan_definition) throw new Error("plan_required");
    a.debtId = debt.id; a.creditor = debt.creditor; a.branchId = debt.branch_id; a.currency = debt.currency; a.expectedVersion = debt.plan_version;
    const view = await readDebtView(db, actor, debt, await today(db, actor));
    if (a.allocationRule === "selected_installment" || call.name === "debts.editPlan" && a.kind === "installment") {
      const choices = view.projection!.installments.filter(part => a.installmentId ? part.id === a.installmentId && (a.installmentNumber === undefined || part.installmentNumber === a.installmentNumber) : part.installmentNumber === a.installmentNumber);
      if (choices.length !== 1) throw new Error("installment_not_found");
      a.installmentId = choices[0].id; a.installmentNumber = choices[0].installmentNumber;
    }
    if (call.name === "debts.voidPlanPayment" && !view.payments.some(payment => payment.id === a.paymentId && !payment.voided_at)) throw new Error("payment_not_found");
  }
  return checked(actor, { name: call.name, arguments: a });
}
async function mutate(db: Db, name: string, args: Record<string, unknown>): Promise<any> {
  let result;
  try { result = await db.rpc(name, args); } catch { throw new Error("debt_response_unknown"); }
  return debtRpcResult(result, { debtId: args.p_debt_id as string | undefined, paymentRequired: ["register_debt_plan_payment", "void_debt_plan_payment"].includes(name) });
}
/** Executes only an already confirmed prepared call. Origin and actor come from the verified transport. */
export async function executeDebtTool(db: Db, actor: AgentActor, input: ToolCall, origin: DebtOrigin = "whatsapp"): Promise<unknown> {
  const call = checked(actor, input); const a = call.arguments;
  if (call.name === "debts.getPlan") return readDebtView(db, actor, await resolveDebt(db, actor, a), await today(db, actor));
  if (call.name === "debts.listDue") {
    let query = scopeQuery(db.from("debts").select("*").eq("business_id", actor.businessId), actor);
    if (a.branchId) { await resolveDebtBranch(db, actor, String(a.branchId)); query = query.eq("branch_id", a.branchId); }
    if (a.currency) query = query.eq("currency", a.currency);
    const res = await query.neq("status", "settled").neq("status", "cancelled").limit(101);
    if (res.error || !Array.isArray(res.data)) throw new Error("debt_read_failed");
    if (res.data.length > 100) throw new Error("debt_read_limit");
    const views: DebtView[] = []; const asOfDate = await today(db, actor);
    for (const debt of res.data) { if (debt.status !== "cancelled") views.push(await readDebtView(db, actor, debt, asOfDate)); }
    // No multi-currency grand total and no guessed currency for historical debt.
    return { from: a.from, to: a.to, debts: views.filter(view => view.status !== "cancelled").map(view => ({ debtId: view.id, creditor: view.creditor, currency: view.currency,
      installments: view.projection?.installments.filter(part => part.pendingAmountCents > 0 && part.dueDate !== null && part.dueDate >= String(a.from) && part.dueDate <= String(a.to)) ?? [],
      legacyDue: !view.plan && view.dueDate && view.dueDate >= String(a.from) && view.dueDate <= String(a.to) ? { dueDate: view.dueDate, pendingAmountCents: view.pendingCents } : null,
    })).filter(view => view.installments.length || view.legacyDue) };
  }
  requestUuid(a.requestId, "requestId");
  if (call.name === "debts.createPlan") {
    const value = createPlanRequest(a);
    await resolveDebtBranch(db, actor, value.branchId);
    return mutate(db, "create_debt_installment_plan", { p_actor_id: actor.userId, p_idempotency_key: value.requestId,
      p_plan: { business_id: actor.businessId, branch_id: value.branchId, creditor: value.creditor, creditor_type: value.creditorType, taken_at: value.takenAt, origin,
        ...(value.concept ? { concept: value.concept } : {}), ...(value.category ? { category: value.category } : {}), ...(value.reference ? { reference: value.reference } : {}), ...(value.notes ? { notes: value.notes } : {}), ...(value.expectedPaymentMethod ? { expected_payment_method: value.expectedPaymentMethod } : {}), plan: generateDebtPlan(value.planInput) } });
  }
  if (!a.debtId || !Number.isSafeInteger(a.expectedVersion)) throw new Error("debt_operation_not_prepared");
  const debt = await resolveDebt(db, actor, a);
  if (!debt.plan_definition) throw new Error("plan_required");
  const common = { p_actor_id: actor.userId, p_debt_id: debt.id, p_expected_version: a.expectedVersion, p_idempotency_key: a.requestId };
  if (call.name === "debts.registerPlanPayment") {
    const value = paymentPlanRequest(a);
    return mutate(db, "register_debt_plan_payment", { ...common, p_payment: { amountCents: value.amountCents, paidAt: value.paidAt, paymentMethod: value.paymentMethod, allocation: value.allocation, origin, ...(value.reference ? { reference: value.reference } : {}), ...(value.notes ? { notes: value.notes } : {}) } });
  }
  if (call.name === "debts.voidPlanPayment") {
    const value = parseVoidPlanRequest({ requestId: a.requestId, debtId: a.debtId, expectedVersion: a.expectedVersion, paymentId: a.paymentId, reason: a.reason });
    return mutate(db, "void_debt_plan_payment", { ...common, p_payment_id: value.paymentId, p_reason: value.reason });
  }
  if (call.name === "debts.editPlan") {
    const value = parseEditPlanRequest({ requestId: a.requestId, debtId: a.debtId, expectedVersion: a.expectedVersion, kind: a.kind, notes: a.notes, ...(a.kind === "installment" ? { installmentId: a.installmentId, dueDate: a.dueDate } : {}) });
    return value.kind === "notes" ? mutate(db, "update_debt_plan_notes", { ...common, p_notes: value.notes }) : mutate(db, "edit_debt_installment", { ...common, p_notes: value.notes, p_installment_id: value.installmentId, p_due_date: value.dueDate });
  }
  throw new Error("tool_not_implemented");
}
