import { DebtPlanError, MAX_DEBT_MONEY_CENTS } from "../debts/plans";
import { validateCompleteDebtArguments } from "./debt-contract";
import type { ToolCall } from "./types";
import type { ToolValidation, ValidationIssue } from "./validation";

const selector = ["creditor", "debtId", "branchId"];
const internal = ["requestId", "expectedVersion", "currency"];
const fields: Record<string, string[]> = {
  "debts.createPlan": ["creditor", "creditorType", "branchId", "takenAt", "mode", "currency", "originalAmountCents", "totalFinancedCents", "installmentAmountCents", "confirmedBalance", "installmentCount", "periodicity", "firstDueDate", "dueDates", "dueDate", "interestRate", "concept", "category", "reference", "notes", "expectedPaymentMethod", "requestId"],
  "debts.getPlan": [...selector],
  "debts.listDue": ["from", "to", "branchId", "currency"],
  "debts.registerPlanPayment": [...selector, ...internal, "amountCents", "paidAt", "paymentMethod", "allocationRule", "installmentNumber", "installmentId", "reference", "notes"],
  "debts.voidPlanPayment": [...selector, ...internal, "paymentId", "reason"],
  "debts.editPlan": [...selector, ...internal, "kind", "installmentNumber", "installmentId", "dueDate", "notes"],
};
const enums: Record<string, string[]> = { creditorType: ["supplier", "bank", "card", "government", "person", "other"], mode: ["single", "installments"], periodicity: ["weekly", "fortnightly", "monthly", "custom"], allocationRule: ["selected_installment", "oldest_due"], kind: ["notes", "installment"], category: ["supplier", "tax", "loan", "rent", "utility", "payroll", "other"] };
const validDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;
export function validateDebtToolCall(call: ToolCall): ToolValidation {
  const issues: ValidationIssue[] = []; const cleaned: Record<string, unknown> = {};
  const a = call.arguments;
  if (!a || typeof a !== "object" || Array.isArray(a) || ![Object.prototype, null].includes(Object.getPrototypeOf(a))) return { call: { name: call.name, arguments: {} }, issues: [{ key: "arguments", message: "no tienen un formato válido", unexpected: true }] };
  for (const key of Reflect.ownKeys(a)) {
    if (typeof key !== "string" || !fields[call.name]?.includes(key) || !("value" in Object.getOwnPropertyDescriptor(a, key)!)) { issues.push({ key: String(key), message: "no es un argumento permitido", unexpected: true }); continue; }
    const raw = a[key]; if (raw === undefined || raw === "") continue;
    let valid = true; let value = raw;
    if (key.endsWith("Id")) valid = typeof raw === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);
    else if (key.endsWith("Cents")) valid = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 && raw <= MAX_DEBT_MONEY_CENTS;
    else if (["installmentNumber", "installmentCount", "expectedVersion"].includes(key)) valid = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= (key === "expectedVersion" ? 0 : 1) && raw <= (key === "expectedVersion" ? Number.MAX_SAFE_INTEGER : 1200);
    else if (enums[key]) valid = typeof raw === "string" && enums[key].includes(raw);
    else if (["from", "to", "takenAt", "paidAt", "firstDueDate", "dueDate"].includes(key)) valid = key === "dueDate" && raw === null || validDate(raw);
    else if (key === "dueDates") valid = Array.isArray(raw) && raw.length > 0 && raw.length <= 1200 && raw.every(validDate);
    else if (key === "currency") valid = typeof raw === "string" && /^[A-Z]{3}$/.test(raw);
    else if (key === "confirmedBalance") {
      valid = !!raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).every(k => ["confirmed", "downPaymentCents", "interestCents", "feesCents"].includes(k)) && (raw as any).confirmed === true && ["downPaymentCents", "interestCents", "feesCents"].every(k => Number.isSafeInteger((raw as any)[k]) && (raw as any)[k] >= 0 && (raw as any)[k] <= MAX_DEBT_MONEY_CENTS);
    } else if (key === "interestRate") {
      valid = !!raw && typeof raw === "object" && !Array.isArray(raw) && Object.keys(raw).every(k => ["value", "period"].includes(k)) && typeof (raw as any).value === "string" && /^\d+(?:\.\d{1,6})?$/.test((raw as any).value) && ["weekly", "fortnightly", "monthly", "annual", "one_time", "unspecified"].includes((raw as any).period);
    } else if (key === "notes" && raw === null && call.name === "debts.editPlan") valid = true;
    else { const max = ["notes", "concept", "reason"].includes(key) ? 1000 : ["paymentMethod", "expectedPaymentMethod"].includes(key) ? 80 : 200; valid = typeof raw === "string" && !!raw.trim() && raw.length <= max; if (valid) value = (raw as string).trim(); }
    if (valid) cleaned[key] = value; else issues.push({ key, message: "tiene un valor inválido; indicá el dato explícito sin suposiciones" });
  }
  if (!issues.length) {
    try { validateCompleteDebtArguments({ name: call.name, arguments: cleaned }); }
    catch (error) {
      const path = error instanceof DebtPlanError ? error.path : "arguments";
      let key = path.split(".").at(-1)!;
      if (path.includes("financing")) key = "totalFinancedCents";
      if (path.includes("schedule")) key = path.includes("dueDates") ? "dueDates" : "firstDueDate";
      if (key === "allocation" || key === "rule") key = "allocationRule";
      if (!(key in cleaned)) key = call.name === "debts.createPlan" ? "totalFinancedCents" : "amountCents";
      delete cleaned[key]; issues.push({ key, message: error instanceof DebtPlanError ? error.code : "datos inválidos" });
    }
  }
  if (cleaned.from && cleaned.to) {
    const days = (Date.parse(String(cleaned.to)) - Date.parse(String(cleaned.from))) / 86400000;
    if (days < 0 || days > 366) { delete cleaned.to; issues.push({ key: "to", message: "el período debe estar ordenado y no superar 366 días" }); }
  }
  return { call: { name: call.name, arguments: cleaned }, issues };
}
