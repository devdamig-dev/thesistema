/** Transport-only mapping. Financial validation and schedule generation remain shared with the UI. */
import { randomUUID } from "node:crypto";
import { parseCreatePlanRequest, parsePaymentPlanRequest, parseVoidPlanRequest, parseEditPlanRequest } from "../../app/deudas/plan-contract";
import { DebtPlanError, decimalMoneyToCents, generateDebtPlan, type DebtPlanInput } from "../debts/plans";
import type { ToolCall } from "./types";

export const DEBT_PLAN_TOOLS = ["debts.create", "debts.createPlan", "debts.getPlan", "debts.listDue", "debts.registerPlanPayment", "debts.voidPlanPayment", "debts.editPlan"] as const;
/** Old create commands remain aliases, never a second financial write path. */
export function canonicalDebtCall(call: ToolCall): ToolCall {
  if (call.name !== "debts.create") return call;
  const args = call.arguments;
  if (!args || typeof args !== "object" || Array.isArray(args) || ![Object.prototype, null].includes(Object.getPrototypeOf(args)) || Reflect.ownKeys(args).some(key => !("value" in Object.getOwnPropertyDescriptor(args, key)!))) return { name: "debts.createPlan", arguments: args };
  const mapped = { ...args };
  if (Object.hasOwn(args, "amount") && !Object.hasOwn(args, "originalAmountCents") && typeof args.amount === "number") {
    try { mapped.originalAmountCents = decimalMoneyToCents(String(args.amount)); delete mapped.amount; } catch { /* Invalid legacy money stays rejected by the strict schema. */ }
  }
  return { name: "debts.createPlan", arguments: mapped };
}
export const isDebtPlanTool = (name: string) => (DEBT_PLAN_TOOLS as readonly string[]).includes(name);
export const isDebtPlanWrite = (name: string) => isDebtPlanTool(name) && !["debts.getPlan", "debts.listDue"].includes(name);
export type DebtCreateArguments = { creditor: string; creditorType: string; branchId?: string; takenAt: string; mode: "single" | "installments"; currency: string; originalAmountCents: number; totalFinancedCents?: number; installmentAmountCents?: number; confirmedBalance?: DebtPlanInput["financing"]["confirmedBalance"]; installmentCount?: number; periodicity?: string; firstDueDate?: string; dueDates?: string[]; dueDate?: string | null; interestRate?: DebtPlanInput["interestRate"]; concept?: string; category?: string; reference?: string; notes?: string; expectedPaymentMethod?: string };
export type DebtPaymentArguments = { creditor?: string; debtId?: string; branchId?: string; amountCents: number; paidAt: string; paymentMethod: string; allocationRule: "selected_installment" | "oldest_due"; installmentNumber?: number; installmentId?: string; reference?: string; notes?: string };
const placeholderId = "00000000-0000-4000-8000-000000000001";
const copyOptional = (a: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => a[key] !== undefined).map(key => [key, a[key]]));

export function planInputFromArguments(a: Record<string, unknown>): DebtPlanInput {
  return { currency: a.currency, originalAmountCents: a.originalAmountCents,
    financing: copyOptional(a, ["totalFinancedCents", "installmentAmountCents", "confirmedBalance"]),
    ...copyOptional(a, ["interestRate"]),
    ...(a.mode === "single" ? { mode: "single", ...copyOptional(a, ["dueDate"]) } : { mode: a.mode, installmentCount: a.installmentCount, schedule: a.periodicity === "custom" ? { periodicity: a.periodicity, dueDates: a.dueDates } : { periodicity: a.periodicity, firstDueDate: a.firstDueDate } }),
  } as DebtPlanInput;
}
export function createPlanRequest(a: Record<string, unknown>) {
  return parseCreatePlanRequest({ requestId: a.requestId ?? placeholderId, branchId: a.branchId ?? placeholderId, creditor: a.creditor, creditorType: a.creditorType, takenAt: a.takenAt, ...copyOptional(a, ["concept", "category", "reference", "notes", "expectedPaymentMethod"]), planInput: planInputFromArguments(a), scheduleConfirmed: true });
}
export function paymentPlanRequest(a: Record<string, unknown>) {
  return parsePaymentPlanRequest({ requestId: a.requestId ?? placeholderId, debtId: a.debtId ?? placeholderId, expectedVersion: a.expectedVersion ?? 0, amountCents: a.amountCents, paidAt: a.paidAt, paymentMethod: a.paymentMethod, allocation: a.allocationRule === "selected_installment" ? { rule: a.allocationRule, installmentId: a.installmentId ?? placeholderId } : { rule: a.allocationRule }, ...copyOptional(a, ["reference", "notes"]) });
}
export function missingDebtArguments(call: ToolCall): string[] {
  const a = call.arguments; const missing: string[] = [];
  const need = (key: string) => { if (a[key] === undefined || a[key] === null || a[key] === "") missing.push(key); };
  if (call.name === "debts.createPlan") {
    ["creditor", "creditorType", "takenAt", "mode", "currency", "originalAmountCents"].forEach(need);
    if (a.totalFinancedCents === undefined && a.installmentAmountCents === undefined && a.confirmedBalance === undefined) need("totalFinancedCents");
    if (a.mode === "installments") { ["installmentCount", "periodicity"].forEach(need); if (a.periodicity === "custom") need("dueDates"); else need("firstDueDate"); }
  } else if (call.name === "debts.listDue") ["from", "to"].forEach(need);
  else {
    if (!a.debtId) need("creditor");
    if (call.name === "debts.registerPlanPayment") {
      ["amountCents", "paidAt", "paymentMethod", "allocationRule"].forEach(need);
      if (a.allocationRule === "selected_installment" && !a.installmentId) need("installmentNumber");
    }
    if (call.name === "debts.voidPlanPayment") ["paymentId", "reason"].forEach(need);
    if (call.name === "debts.editPlan") {
      need("kind"); if (!("notes" in a)) missing.push("notes");
      if (a.kind === "installment") { if (!a.installmentId) need("installmentNumber"); if (!("dueDate" in a)) missing.push("dueDate"); }
    }
  }
  return missing;
}
export function validateCompleteDebtArguments(call: ToolCall): void {
  if (missingDebtArguments(call).length) return;
  const a = call.arguments;
  if (call.name === "debts.createPlan") {
    if (a.mode === "single" && ["installmentCount", "periodicity", "firstDueDate", "dueDates"].some(key => a[key] !== undefined)) throw new DebtPlanError("invalid_request", "mode");
    if (a.mode === "installments" && a.dueDate !== undefined) throw new DebtPlanError("invalid_request", "dueDate");
    if (a.periodicity === "custom" && a.firstDueDate !== undefined || a.periodicity !== "custom" && a.dueDates !== undefined) throw new DebtPlanError("invalid_request", "periodicity");
    createPlanRequest(a);
  }
  if (call.name === "debts.registerPlanPayment") {
    if (a.allocationRule === "oldest_due" && (a.installmentId !== undefined || a.installmentNumber !== undefined)) throw new DebtPlanError("invalid_request", "allocationRule");
    paymentPlanRequest(a);
  }
  if (call.name === "debts.voidPlanPayment") parseVoidPlanRequest({ requestId: a.requestId ?? placeholderId, debtId: a.debtId ?? placeholderId, expectedVersion: a.expectedVersion ?? 0, paymentId: a.paymentId, reason: a.reason });
  if (call.name === "debts.editPlan") parseEditPlanRequest({ requestId: a.requestId ?? placeholderId, debtId: a.debtId ?? placeholderId, expectedVersion: a.expectedVersion ?? 0, kind: a.kind, notes: a.notes, ...(a.kind === "installment" ? { installmentId: a.installmentId ?? placeholderId, dueDate: a.dueDate } : {}) });
}
export function newDebtOperationId(): string { return randomUUID(); }
const money = (cents: unknown, currency: unknown) => `${String(currency)} ${(Number(cents) / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function debtConfirmationText(call: ToolCall): string {
  call = canonicalDebtCall(call);
  const a = call.arguments;
  let text = `Deuda de ${String(a.creditor)}, sucursal ${String(a.branchId)}.`;
  if (call.name === "debts.createPlan") {
    const plan = generateDebtPlan(planInputFromArguments(a));
    text += ` Origen: ${String(a.takenAt)}. Capital: ${money(plan.originalAmountCents, plan.currency)}. Total financiado: ${money(plan.totalFinancedCents, plan.currency)}.\n`;
    text += plan.installments.map(part => `Cuota ${part.installmentNumber}: ${money(part.totalAmountCents, plan.currency)}, ${part.dueDate ?? "sin vencimiento informado"}`).join("\n");
    if (plan.downPaymentCents !== null) text += `\nAnticipo histórico confirmado: ${money(plan.downPaymentCents, plan.currency)}.`;
    if (plan.interestRate) text += `\nTasa informada: ${plan.interestRate.value} (${plan.interestRate.period}); no calculada.`;
  } else if (call.name === "debts.registerPlanPayment") text += ` Registrar ${money(a.amountCents, a.currency)} el ${String(a.paidAt)} mediante ${String(a.paymentMethod)}. Imputación: ${a.allocationRule === "oldest_due" ? "cuotas pendientes más antiguas" : `sólo cuota ${a.installmentNumber ?? a.installmentId}, sin distribuir a otras cuotas`}.`;
  else if (call.name === "debts.voidPlanPayment") text += ` Anular pago ${String(a.paymentId)}. Motivo: ${String(a.reason)}.`;
  else text += a.kind === "notes" ? ` Cambiar notas a: ${a.notes ?? "sin notas"}.` : ` Cuota ${a.installmentNumber ?? a.installmentId}: vencimiento ${a.dueDate ?? "sin fecha"}; notas ${a.notes ?? "sin notas"}.`;
  return `${text}\nRespondé “Sí” para confirmar este detalle o “Cancelar” para descartar.`;
}

/** A malformed success is an unknown result, never evidence that no write occurred. */
export function debtRpcResult(response: unknown, expected: { debtId?: string; paymentRequired?: boolean } = {}): Record<string, any> {
  const unknown = (): never => { throw new Error("debt_response_unknown"); };
  if (!response || typeof response !== "object" || Array.isArray(response)) return unknown();
  const result = response as Record<string, any>;
  if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data) || typeof result.data.ok !== "boolean") return unknown();
  const data = result.data;
  if (!data.ok) { if (typeof data.error !== "string" || !data.error.trim()) return unknown(); throw new Error(data.error); }
  const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  if (!uuid(data.debt_id) || expected.debtId && data.debt_id !== expected.debtId || !Number.isSafeInteger(data.version) || data.version < 0) return unknown();
  if (expected.paymentRequired && !uuid(data.payment_id) || data.payment_id !== undefined && !uuid(data.payment_id)) return unknown();
  return data;
}
