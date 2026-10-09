/** Inbox debt boundary: the extractor proposes data; only an operator-reviewed snapshot can execute. */
import { debtRpcResult } from "./debt-contract";
import { createHash } from "node:crypto";
import { generateDebtPlan } from "../debts/plans";
import { parseCreatePlanRequest, parsePaymentPlanRequest } from "../../app/deudas/plan-contract";
import { canSeeModule, hasPermission } from "../permissions";
import type { Role, ModuleKey } from "../permissions";

type Context = { isAuthenticated: boolean; userId: string | null; businessId: string | null; role: Role; enabledModules: ModuleKey[] | null; assignedBranchIds: string[] | null };
export type InboxDebtExtraction = { id: string; message_id: string; business_id: string | null; branch_id: string | null; type: string; fields: unknown };
export type InboxDebtPreview = { digest: string; operation: "create" | "pay"; requestId: string; creditor: string; branchId: string; currency: string; creation?: ReturnType<typeof parseCreatePlanRequest>; schedule?: ReturnType<typeof generateDebtPlan>; payment?: ReturnType<typeof parsePaymentPlanRequest> };
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("missing_fields_for_creation"); return value as Record<string, unknown>; }
function scoped(branchId: string | null, ctx: Context) { if (!branchId || ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(branchId)) throw new Error("branch_forbidden"); }

export async function prepareInboxDebt(db: any, ctx: Context, extraction: InboxDebtExtraction): Promise<{ preview: InboxDebtPreview; rpc: string; args: Record<string, unknown> }> {
  const create = extraction.type === "debt_created";
  if (!create && extraction.type !== "debt_payment") throw new Error("unsupported_debt_extraction");
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId || extraction.business_id && extraction.business_id !== ctx.businessId) throw new Error("no_session_or_business_mismatch");
  if (!ctx.enabledModules?.includes("debts") || !hasPermission(ctx.role, create ? "debts.create" : "debts.pay") || !canSeeModule(ctx.role, "debts", ctx.enabledModules)) throw new Error("forbidden:debts");
  // Authenticate the Inbox source rather than accepting a caller-provided origin/business.
  const source = await db.from("whatsapp_messages").select("id,business_id,branch_id").eq("id", extraction.message_id).eq("business_id", ctx.businessId).maybeSingle();
  if (source.error || !source.data || source.data.business_id !== ctx.businessId) throw new Error("source_message_not_found");
  if (extraction.branch_id && source.data.branch_id && extraction.branch_id !== source.data.branch_id) throw new Error("branch_mismatch");
  const sourceBranch = extraction.branch_id ?? source.data.branch_id;
  if (sourceBranch) scoped(sourceBranch, ctx);
  const fields = record(extraction.fields);
  let preview: Omit<InboxDebtPreview, "digest">; let rpc: string; let args: Record<string, unknown>;
  if (create) {
    if (Object.keys(fields).some(key => key !== "planRequest")) throw new Error("missing_fields_for_creation");
    const raw = record(fields.planRequest);
    if ("requestId" in raw || "scheduleConfirmed" in raw) throw new Error("untrusted_review_metadata");
    // No default currency, financing, date, interest or branch. Every required value comes from the proposal.
    const value = parseCreatePlanRequest({ ...raw, branchId: raw.branchId ?? sourceBranch, requestId: extraction.id, scheduleConfirmed: true });
    scoped(value.branchId, ctx);
    if (sourceBranch && sourceBranch !== value.branchId) throw new Error("branch_mismatch");
    const branch = await db.from("branches").select("id").eq("business_id", ctx.businessId).eq("id", value.branchId).maybeSingle();
    if (branch.error || !branch.data) throw new Error("branch_not_found");
    const plan = generateDebtPlan(value.planInput);
    preview = { operation: "create", requestId: extraction.id, creditor: value.creditor, branchId: value.branchId, currency: plan.currency, creation: value, schedule: plan };
    rpc = "create_debt_installment_plan";
    args = { p_idempotency_key: extraction.id, p_plan: { business_id: ctx.businessId, branch_id: value.branchId, creditor: value.creditor, creditor_type: value.creditorType, taken_at: value.takenAt, origin: "whatsapp", ...(value.concept ? { concept: value.concept } : {}), ...(value.category ? { category: value.category } : {}), ...(value.reference ? { reference: value.reference } : {}), ...(value.notes ? { notes: value.notes } : {}), ...(value.expectedPaymentMethod ? { expected_payment_method: value.expectedPaymentMethod } : {}), plan } };
  } else {
    if (Object.keys(fields).some(key => key !== "paymentRequest")) throw new Error("missing_fields_for_creation");
    const raw = record(fields.paymentRequest);
    if ("requestId" in raw) throw new Error("untrusted_review_metadata");
    const value = parsePaymentPlanRequest({ ...raw, requestId: extraction.id });
    const res = await db.from("debts").select("id,business_id,branch_id,creditor,currency,plan_definition").eq("business_id", ctx.businessId).eq("id", value.debtId).maybeSingle();
    if (res.error || !res.data || res.data.business_id !== ctx.businessId) throw new Error("debt_not_found");
    const debt = res.data; scoped(debt.branch_id, ctx);
    if (sourceBranch && sourceBranch !== debt.branch_id) throw new Error("branch_mismatch");
    if (!debt.plan_definition) throw new Error("plan_required");
    preview = { operation: "pay", requestId: extraction.id, creditor: debt.creditor, branchId: debt.branch_id, currency: debt.currency, payment: value };
    rpc = "register_debt_plan_payment";
    args = { p_debt_id: value.debtId, p_expected_version: value.expectedVersion, p_idempotency_key: extraction.id, p_payment: { amountCents: value.amountCents, paidAt: value.paidAt, paymentMethod: value.paymentMethod, allocation: value.allocation, origin: "whatsapp", ...(value.reference ? { reference: value.reference } : {}), ...(value.notes ? { notes: value.notes } : {}) } };
  }
  const digest = createHash("sha256").update(JSON.stringify({ actorId: ctx.userId, businessId: ctx.businessId, rpc, args })).digest("hex");
  return { preview: { ...preview, digest }, rpc, args };
}

export async function executeInboxDebt(db: any, ctx: Context, extraction: InboxDebtExtraction, reviewDigest: unknown) {
  const prepared = await prepareInboxDebt(db, ctx, extraction);
  if (typeof reviewDigest !== "string" || reviewDigest !== prepared.preview.digest) throw new Error("debt_review_required");
  const args = {
    p_extraction_id: extraction.id,
    p_expected_fields: extraction.fields,
    p_expected_message_id: extraction.message_id,
    p_operation: prepared.preview.operation,
    p_payload: prepared.preview.operation === "create" ? prepared.args.p_plan : { debt_id: prepared.args.p_debt_id, payment: prepared.args.p_payment },
    p_expected_version: prepared.preview.operation === "pay" ? prepared.args.p_expected_version : null,
  };
  let result;
  try { result = await db.rpc("approve_debt_extraction_atomic", args); } catch { throw new Error("debt_response_unknown"); }
  const data = debtRpcResult(result, { debtId: prepared.args.p_debt_id as string | undefined, paymentRequired: prepared.preview.operation === "pay" });
  return { debtId: data.debt_id as string, paymentId: data.payment_id as string | undefined };
}
