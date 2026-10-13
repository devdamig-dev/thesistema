import { validateProductFields } from "../catalog/products";
import { isPurchaseWrite, validatePurchaseCall } from "../purchases/agent";
import { isSaleWrite, validateSaleCall } from "../sales/agent";
import { normalizeUnit } from "../recipes/quantities";
import { canonicalDebtCall, isDebtPlanTool } from "./debt-contract";
import { validateDebtToolCall } from "./debt-validation";
import type { ToolCall } from "./types";

type FieldKind = "string" | "positiveNumber" | "nonNegativeNumber" | "date" | "paymentMethod" | "stockOperation" | "stockUnit" | "stockReason" | "debtCategory";
type ToolSchema = Record<string, FieldKind>;
export type ValidationIssue = { key: string; message: string; unexpected?: boolean };
export type ToolValidation = { call: ToolCall; issues: ValidationIssue[] };

const schemas: Record<string, ToolSchema> = {
  "sales.getToday": {},
  "sales.getPeriod": { from: "date", to: "date" },
  "sales.comparePeriods": { from: "date", to: "date", previousFrom: "date", previousTo: "date" },
  "purchases.list": {},
  "debts.list": {},
  "debts.create": { creditor: "string", amount: "positiveNumber", concept: "string", category: "debtCategory", dueDate: "date", branchId: "string" },
  "debts.registerPayment": { creditor: "string", amount: "positiveNumber", paymentMethod: "paymentMethod", paidAt: "date" },
  "stock.getReplenishment": { branchId: "string", from: "date", to: "date" },
  "stock.getLowStock": {},
  "stock.addMovement": { ingredient: "string", quantity: "nonNegativeNumber", operation: "stockOperation", branchId: "string", reason: "stockReason", unit: "stockUnit" },
  "products.list": {},
  "invoices.listPending": {},
};

const paymentMethods: Record<string, string> = {
  transferencia: "Transferencia",
  efectivo: "Efectivo",
  debito: "Débito",
  credito: "Crédito",
  tarjeta: "Tarjeta",
  "cuenta corriente": "Cuenta corriente",
  otro: "Otro",
};
const debtCategories = new Set(["supplier", "tax", "loan", "rent", "utility", "payroll", "other"]);
const stockOperations = new Set(["in", "out", "waste", "set"]);
const normalizeEnum = (value: string) => value.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateField(key: string, kind: FieldKind, raw: unknown): { value?: unknown; issue?: ValidationIssue } {
  if (raw === undefined || raw === null || raw === "") return {};
  if (kind === "stockUnit") {
    const unit = normalizeUnit(raw);
    return unit ? { value: unit } : { issue: { key, message: "debe ser unit, kg, g, l o ml; no se pueden inferir paquetes ni densidades" } };
  }
  if (kind === "stockReason") {
    if (typeof raw !== "string" || !raw.trim() || raw.trim().length > 1000) return { issue: { key, message: "debe ser un motivo de hasta 1000 caracteres" } };
    return { value: raw.trim() };
  }
  if (kind === "string") {
    if (typeof raw !== "string" || !raw.trim() || raw.trim().length > 160) return { issue: { key, message: "debe ser un texto de hasta 160 caracteres" } };
    return { value: raw.trim() };
  }
  if (kind === "positiveNumber" || kind === "nonNegativeNumber") {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw > 1_000_000_000_000 || (kind === "positiveNumber" ? raw <= 0 : raw < 0)) {
      return { issue: { key, message: kind === "positiveNumber" ? "debe ser un número mayor a cero" : "debe ser un número igual o mayor a cero" } };
    }
    return { value: raw };
  }
  if (kind === "date") {
    if (typeof raw !== "string" || !validIsoDate(raw)) return { issue: { key, message: "debe tener formato AAAA-MM-DD y ser una fecha válida" } };
    return { value: raw };
  }
  if (typeof raw !== "string") return { issue: { key, message: "tiene un valor no permitido" } };
  const normalized = normalizeEnum(raw);
  if (kind === "paymentMethod") {
    const value = paymentMethods[normalized];
    return value ? { value } : { issue: { key, message: "debe ser Transferencia, Efectivo, Débito, Crédito, Tarjeta, Cuenta corriente u Otro" } };
  }
  if (kind === "stockOperation") return stockOperations.has(normalized) ? { value: normalized } : { issue: { key, message: "debe ser in, out, waste o set" } };
  return debtCategories.has(normalized) ? { value: normalized } : { issue: { key, message: "tiene una categoría no permitida" } };
}

function validatePeriod(argumentsValue: Record<string, unknown>, from: string, to: string, issues: ValidationIssue[]) {
  if (typeof argumentsValue[from] !== "string" || typeof argumentsValue[to] !== "string") return;
  const start = new Date(`${argumentsValue[from]}T00:00:00Z`);
  const end = new Date(`${argumentsValue[to]}T00:00:00Z`);
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  if (days < 0) issues.push({ key: to, message: "no puede ser anterior a la fecha inicial" });
  else if (days > 366) issues.push({ key: to, message: "no puede superar un período de 366 días" });
}

export function validateToolCall(call: ToolCall): ToolValidation {
  if (call.name === "products.create") {
    const result = validateProductFields(call.arguments, true);
    return { call: { name: call.name, arguments: result.input }, issues: result.issues };
  }
  if (isSaleWrite(call.name)) return validateSaleCall(call);
  if (isPurchaseWrite(call.name)) return validatePurchaseCall(call);
  if (isDebtPlanTool(call.name)) return validateDebtToolCall(canonicalDebtCall(call));
  const schema = schemas[call.name];
  if (!schema || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) {
    return { call: { name: call.name, arguments: {} }, issues: [{ key: "arguments", message: "no tienen un formato válido", unexpected: true }] };
  }

  const cleaned: Record<string, unknown> = {};
  const issues: ValidationIssue[] = [];
  for (const [key, raw] of Object.entries(call.arguments)) {
    const kind = schema[key];
    if (!kind) {
      issues.push({ key, message: "no es un argumento permitido", unexpected: true });
      continue;
    }
    const result = validateField(key, kind, raw);
    if (result.issue) issues.push(result.issue);
    else if (result.value !== undefined) cleaned[key] = result.value;
  }

  if (call.name === "stock.getReplenishment") {
    if (cleaned.branchId !== undefined && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(cleaned.branchId))) issues.push({ key: "branchId", message: "debe ser un ID de sucursal válido" });
    validatePeriod(cleaned, "from", "to", issues);
    if (typeof cleaned.from === "string" && typeof cleaned.to === "string" && (Date.parse(cleaned.to) - Date.parse(cleaned.from)) / 86400000 >= 366) issues.push({ key: "to", message: "el período admite hasta 366 días inclusive" });
  }
  if (call.name === "stock.addMovement" && cleaned.quantity === 0 && cleaned.operation !== "set") {
    issues.push({ key: "quantity", message: "debe ser mayor a cero para entradas, salidas y mermas" });
  }
  if (call.name === "sales.getPeriod") validatePeriod(cleaned, "from", "to", issues);
  if (call.name === "sales.comparePeriods") {
    validatePeriod(cleaned, "from", "to", issues);
    validatePeriod(cleaned, "previousFrom", "previousTo", issues);
  }
  for (const issue of issues) delete cleaned[issue.key];
  return { call: { name: call.name, arguments: cleaned }, issues };
}
