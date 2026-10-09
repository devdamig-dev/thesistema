"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { canSeeModule, hasPermission } from "@/lib/permissions";
import { centsToDecimalMoney, generateDebtPlan } from "@/lib/debts/plans";
import { debtErrorMessage, parseCancelPlanRequest, parseCreatePlanRequest, parseEditPlanRequest, parsePaymentPlanRequest, parseVoidPlanRequest, requestUuid, type PlanActionResult } from "@/app/deudas/plan-contract";

function failure(code: string, error: string, uncertain = false, definitiveRejected = false): PlanActionResult { return { ok: false, persisted: false, code, error, ...(uncertain ? { uncertain: true } : {}), ...(definitiveRejected ? { definitiveRejected: true as const } : {}) }; }
async function context(permission: "debts.view" | "debts.create" | "debts.pay", expectedSession: unknown) {
  if (!isDatabaseMode()) throw new Error("database_required");
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId || !ctx.userId) throw new Error("no_session");
  if (!expectedSession || typeof expectedSession !== "object" || Array.isArray(expectedSession) || Object.keys(expectedSession).some((key) => !["actorId", "businessId"].includes(key)) || (expectedSession as Record<string, unknown>).actorId !== ctx.userId || (expectedSession as Record<string, unknown>).businessId !== ctx.businessId) throw new Error("session_changed");
  if (!hasPermission(ctx.role, permission) || !canSeeModule(ctx.role, "debts", ctx.enabledModules)) throw new Error("permission_denied");
  const db = await createSupabaseServerClient();
  if (!db) throw new Error("database_unavailable");
  return { ctx, db: db as any };
}
function blocked(error: unknown): PlanActionResult {
  const code = error instanceof Error ? error.message : "invalid_request";
  const messages: Record<string, string> = { session_changed: "La sesión o el negocio cambiaron desde que abriste el formulario. Actualizá la página antes de continuar.", database_required: "Los planes se guardan únicamente en el modo conectado.", no_session: "Tu sesión o negocio activo no está disponible. Volvé a iniciar sesión.", permission_denied: "No tenés permiso para realizar esta operación.", database_unavailable: "No pudimos conectar con el negocio. Conservamos tu borrador.", branch_forbidden: "La sucursal no está asignada a tu usuario.", branch_not_found: "La sucursal seleccionada no está disponible.", debt_not_found: "No encontramos esa deuda dentro de tu negocio y sucursales." };
  return failure(messages[code] ? code : "invalid_request", messages[code] ?? debtErrorMessage(error));
}
function rpcFailure(code: string, definitiveRejected = false): PlanActionResult {
  const messages: Record<string, string> = { debt_cancelled: "El registro está cancelado administrativamente. Conserva su saldo e historial y no admite más cambios.", version_conflict: "El saldo cambió mientras revisabas. Actualizá los datos y volvé a revisar la operación.", stale_version: "El saldo cambió mientras revisabas. Actualizá los datos y volvé a revisar la operación.", amount_exceeds_pending: "El pago supera el saldo pendiente.", amount_exceeds_installment_pending: "El pago supera el saldo de la cuota seleccionada.", permission_denied: "No tenés permiso para realizar esta operación.", installment_not_found: "La cuota no pertenece a esta deuda.", debt_not_found: "La deuda ya no está disponible.", payment_already_voided: "Ese pago ya está anulado.", payment_not_found: "No encontramos ese pago en esta deuda.", idempotency_conflict: "Este intento ya se usó con otros datos. Actualizá el historial antes de iniciar una nueva operación.", plan_required: "Esta deuda histórica todavía no tiene un plan registrado.", invalid_paid_at: "La fecha de pago no es válida.", allocation_rule_required: "Elegí una regla de imputación para el pago." };
  return failure(messages[code] ? code : "rejected", messages[code] ?? "La base de datos rechazó la operación. Revisá los datos; no se guardaron cambios.", false, definitiveRejected);
}
async function debtScope(db: any, ctx: Awaited<ReturnType<typeof getCurrentUserContext>>, debtId: string) {
  const result = await db.from("debts").select("id,branch_id,plan_definition").eq("business_id", ctx.businessId).eq("id", debtId).maybeSingle();
  if (result.error || !result.data) throw new Error("debt_not_found");
  if (ctx.assignedBranchIds !== null && (!result.data.branch_id || !ctx.assignedBranchIds.includes(result.data.branch_id))) throw new Error("branch_forbidden");
  return result.data;
}
async function mutate(db: any, name: string, args: Record<string, unknown>): Promise<PlanActionResult> {
  let result;
  try { result = await db.rpc(name, args); } catch { return failure("response_unknown", "No pudimos confirmar el resultado. Reintentá esta misma operación para recuperar su resultado sin duplicarla.", true); }
  if (result.error || !result.data || typeof result.data.ok !== "boolean") return failure("response_unknown", "No pudimos confirmar el resultado. Reintentá esta misma operación para recuperar su resultado sin duplicarla.", true);
  if (!result.data.ok) {
    const code = String(result.data.error ?? "rejected");
    // These rejections occur under the debt lock, AFTER the idempotency lookup.
    // Preflight/auth/not-found failures cannot disprove an earlier lost commit.
    const definitive = ["stale_version", "amount_exceeds_pending", "amount_exceeds_installment_pending", "installment_not_found", "payment_already_voided", "invalid_paid_at", "debt_cancelled"].includes(code);
    return rpcFailure(code, definitive);
  }
  if (typeof result.data.debt_id !== "string") return failure("response_unknown", "La respuesta está incompleta. Reintentá el mismo intento para comprobar qué se guardó.", true);
  // Audit, balances and allocations are committed by the RPC in the same transaction.
  // A cache failure after commit must never report a failed write or invite a new ID.
  try { revalidatePath("/deudas"); } catch { /* next refresh reads the committed ledger */ }
  return { ok: true, persisted: true, debtId: result.data.debt_id, ...(result.data.payment_id ? { paymentId: result.data.payment_id } : {}), ...(Number.isSafeInteger(result.data.version) ? { version: result.data.version } : {}) };
}
export async function createDebtPlanAction(input: unknown, expectedSession: unknown): Promise<PlanActionResult> {
  try {
    const { db, ctx } = await context("debts.create", expectedSession);
    const value = parseCreatePlanRequest(input);
    if (ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(value.branchId)) throw new Error("branch_forbidden");
    const branch = await db.from("branches").select("id").eq("business_id", ctx.businessId).eq("id", value.branchId).maybeSingle();
    if (branch.error || !branch.data) throw new Error("branch_not_found");
    return await mutate(db, "create_debt_installment_plan", { p_idempotency_key: value.requestId, p_plan: { business_id: ctx.businessId, branch_id: value.branchId, creditor: value.creditor, creditor_type: value.creditorType, taken_at: value.takenAt, origin: "manual", ...(value.concept ? { concept: value.concept } : {}), ...(value.category ? { category: value.category } : {}), ...(value.reference ? { reference: value.reference } : {}), ...(value.notes ? { notes: value.notes } : {}), ...(value.expectedPaymentMethod ? { expected_payment_method: value.expectedPaymentMethod } : {}), plan: generateDebtPlan(value.planInput) } });
  } catch (error) { return blocked(error); }
}
export async function registerDebtPlanPaymentAction(input: unknown, expectedSession: unknown): Promise<PlanActionResult> {
  try {
    const { db, ctx } = await context("debts.pay", expectedSession);
    const value = parsePaymentPlanRequest(input);
    const debt = await debtScope(db, ctx, value.debtId);
    if (!debt.plan_definition) return rpcFailure("plan_required");
    return await mutate(db, "register_debt_plan_payment", { p_debt_id: value.debtId, p_expected_version: value.expectedVersion, p_idempotency_key: value.requestId, p_payment: { amountCents: value.amountCents, paidAt: value.paidAt, paymentMethod: value.paymentMethod, allocation: value.allocation, origin: "manual", ...(value.reference ? { reference: value.reference } : {}), ...(value.notes ? { notes: value.notes } : {}) } });
  } catch (error) { return blocked(error); }
}
export async function voidDebtPlanPaymentAction(input: unknown, expectedSession: unknown): Promise<PlanActionResult> {
  try {
    const { db, ctx } = await context("debts.pay", expectedSession);
    const value = parseVoidPlanRequest(input);
    await debtScope(db, ctx, value.debtId);
    return await mutate(db, "void_debt_plan_payment", { p_debt_id: value.debtId, p_payment_id: value.paymentId, p_expected_version: value.expectedVersion, p_reason: value.reason, p_idempotency_key: value.requestId });
  } catch (error) { return blocked(error); }
}
/** Internal administrative record closure; never pays or forgives the debt. */
export async function cancelDebtPlanRecordAction(input: unknown, expectedSession: unknown): Promise<PlanActionResult> {
  try {
    const { db, ctx } = await context("debts.create", expectedSession);
    const value = parseCancelPlanRequest(input);
    const debt = await debtScope(db, ctx, value.debtId);
    if (!debt.plan_definition) return rpcFailure("plan_required");
    return await mutate(db, "cancel_debt_plan_record", { p_debt_id: value.debtId, p_expected_version: value.expectedVersion, p_reason: value.reason, p_idempotency_key: value.requestId });
  } catch (error) { return blocked(error); }
}

/** Legacy debts retain their existing audited RPC. They do not acquire a guessed currency or schedule. */
export async function registerLegacyDebtPaymentAction(input: unknown, expectedSession: unknown): Promise<PlanActionResult> {
  try {
    const { db, ctx } = await context("debts.pay", expectedSession);
    const value = parsePaymentPlanRequest(input);
    if (value.allocation.rule !== "oldest_due") return rpcFailure("allocation_rule_required");
    const debt = await debtScope(db, ctx, value.debtId);
    if (debt.plan_definition) return rpcFailure("allocation_rule_required");
    const legacyNotes = [value.reference ? `Referencia: ${value.reference}` : null, value.notes].filter(Boolean).join("\n") || null;
    if (legacyNotes && legacyNotes.length > 1000) return failure("notes_too_long", "En deudas históricas, la referencia y las notas juntas deben ocupar como máximo 1000 caracteres.");
    let result;
    try { result = await db.rpc("register_debt_payment_atomic", { p_debt_id: value.debtId, p_business_id: ctx.businessId, p_actor_id: ctx.userId, p_amount: centsToDecimalMoney(value.amountCents), p_payment_method: value.paymentMethod, p_paid_at: value.paidAt, p_notes: legacyNotes }); } catch { return failure("legacy_response_unknown", "No pudimos confirmar el pago histórico. Actualizá y revisá el historial antes de registrar otro; no reintentes a ciegas.", true); }
    if (result.error || !result.data || typeof result.data.ok !== "boolean") return failure("legacy_response_unknown", "No pudimos confirmar el pago histórico. Actualizá y revisá el historial antes de registrar otro; no reintentes a ciegas.", true);
    if (!result.data.ok) return rpcFailure(result.data.error ?? "rejected");
    try { revalidatePath("/deudas"); } catch { /* committed */ }
    return { ok: true, persisted: true, debtId: value.debtId, paymentId: result.data.payment_id };
  } catch (error) { return blocked(error); }
}

/** Financial terms stay immutable. Only audited notes and installment dates can change. */
export async function editDebtPlanAction(input: unknown, expectedSession: unknown): Promise<PlanActionResult> {
  try {
    const { db, ctx } = await context("debts.create", expectedSession);
    const value = parseEditPlanRequest(input);
    const debt = await debtScope(db, ctx, value.debtId);
    if (!debt.plan_definition) return rpcFailure("plan_required");
    const common = { p_debt_id: value.debtId, p_expected_version: value.expectedVersion, p_notes: value.notes, p_idempotency_key: value.requestId };
    return value.kind === "notes"
      ? await mutate(db, "update_debt_plan_notes", common)
      : await mutate(db, "edit_debt_installment", { ...common, p_installment_id: value.installmentId, p_due_date: value.dueDate });
  } catch (error) { return blocked(error); }
}

export async function getDebtOperationResultAction(input: unknown, expectedSession: unknown): Promise<{ ok: true; found: boolean; debtId?: string; paymentId?: string } | { ok: false; error: string; code?: string }> {
  try {
    const { db } = await context("debts.view", expectedSession);
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !["operation", "requestId", "debtId"].includes(key))) return { ok: false, error: "La referencia del intento no es válida." };
    const value = input as Record<string, unknown>;
    if (typeof value.operation !== "string" || !["create", "pay", "void", "edit_installment", "edit_notes", "cancel"].includes(value.operation)) return { ok: false, error: "La operación no admite esta comprobación." };
    const id = requestUuid(value.requestId, "requestId");
    const debtId = value.operation === "create" ? null : requestUuid(value.debtId, "debtId");
    const result = await db.rpc("get_debt_operation_result", { p_operation: value.operation, p_idempotency_key: id, p_debt_id: debtId });
    if (result.error || result.data?.ok !== true || typeof result.data.found !== "boolean" || (result.data.found && typeof result.data.debt_id !== "string")) return { ok: false, error: "No pudimos verificar el resultado. El intento sigue pendiente; no lo reemplaces por otro." };
    return result.data.found ? { ok: true, found: true, debtId: result.data.debt_id, ...(result.data.payment_id ? { paymentId: result.data.payment_id } : {}) } : { ok: true, found: false };
  } catch (error) { return { ok: false, error: "No pudimos verificar el intento con tu sesión actual. Conservamos su identificador para volver a comprobarlo.", ...(error instanceof Error && ["session_changed", "no_session"].includes(error.message) ? { code: error.message } : {}) }; }
}

/** A stale tab must discard visible drafts when its authenticated session changes. */
export async function verifyDebtSessionAction(input: unknown, expectedSession: unknown): Promise<{ ok: true } | { ok: false; code: string }> {
  try {
    if (input !== null) return { ok: false, code: "invalid_request" };
    await context("debts.view", expectedSession);
    return { ok: true };
  } catch (error) { return { ok: false, code: error instanceof Error && ["session_changed", "no_session", "permission_denied"].includes(error.message) ? error.message : "verification_unavailable" }; }
}
