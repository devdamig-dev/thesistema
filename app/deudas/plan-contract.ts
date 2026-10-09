/** Strict, shared UI/server request boundaries. No actor or business comes from a form. */
import { DebtPlanError, MAX_DEBT_MONEY_CENTS, generateDebtPlan, type DebtAllocationChoice, type DebtPlanInput } from "../../lib/debts/plans";

export const CREDITOR_TYPES = { supplier: "Proveedor", bank: "Banco", card: "Tarjeta", government: "Organismo", person: "Persona", other: "Otro" } as const;
export const DEBT_CATEGORIES = { supplier: "Proveedor", tax: "Impuesto", loan: "Préstamo", rent: "Alquiler", utility: "Servicio", payroll: "Sueldos", other: "Otro" } as const;
export type CreatePlanRequest = { requestId: string; branchId: string; creditor: string; creditorType: keyof typeof CREDITOR_TYPES; concept?: string; takenAt: string; category?: keyof typeof DEBT_CATEGORIES; reference?: string; notes?: string; expectedPaymentMethod?: string; planInput: DebtPlanInput; scheduleConfirmed: true };
export type PaymentPlanRequest = { requestId: string; debtId: string; expectedVersion: number; amountCents: number; paidAt: string; paymentMethod: string; allocation: DebtAllocationChoice; reference?: string; notes?: string };
export type VoidPlanRequest = { requestId: string; debtId: string; paymentId: string; expectedVersion: number; reason: string };
export type CancelPlanRequest = { requestId: string; debtId: string; expectedVersion: number; reason: string; administrativeOnlyConfirmed: true };
export function parseCancelPlanRequest(value: unknown): CancelPlanRequest {
  const raw = record(value, ["requestId", "debtId", "expectedVersion", "reason", "administrativeOnlyConfirmed"]);
  if (raw.administrativeOnlyConfirmed !== true) fail("administrativeOnlyConfirmed");
  return { requestId: requestUuid(raw.requestId, "requestId"), debtId: requestUuid(raw.debtId, "debtId"), expectedVersion: version(raw.expectedVersion), reason: text(raw.reason, "reason", 1000), administrativeOnlyConfirmed: true };
}
export type PlanActionResult = { ok: true; persisted: true; debtId: string; paymentId?: string; version?: number } | { ok: false; persisted: false; error: string; code: string; uncertain?: boolean; definitiveRejected?: true };

function fail(path: string): never { throw new DebtPlanError("invalid_request", path); }
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("request");
  for (const key of Reflect.ownKeys(value)) if (typeof key !== "string" || !keys.includes(key) || !("value" in Object.getOwnPropertyDescriptor(value, key)!)) fail(`request.${String(key)}`);
  return value as Record<string, unknown>;
}
export function requestUuid(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(path);
  return value;
}
function text(value: unknown, path: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail(path);
  return value.trim();
}
function date(value: unknown, path: string, minimum = "2000-01-01"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < minimum || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) fail(path);
  return value;
}
function choice<T extends string>(value: unknown, keys: readonly T[], path: string): T { if (typeof value !== "string" || !keys.includes(value as T)) fail(path); return value as T; }
function version(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail("expectedVersion"); return value; }
function optional(raw: Record<string, unknown>, key: string, max: number): Record<string, string> { return Object.hasOwn(raw, key) ? { [key]: text(raw[key], key, max) } : {}; }

export function parseCreatePlanRequest(value: unknown): CreatePlanRequest {
  const raw = record(value, ["requestId", "branchId", "creditor", "creditorType", "concept", "takenAt", "category", "reference", "notes", "expectedPaymentMethod", "planInput", "scheduleConfirmed"]);
  if (raw.scheduleConfirmed !== true) fail("scheduleConfirmed");
  generateDebtPlan(raw.planInput); // validates every nested field and monetary invariant
  return { requestId: requestUuid(raw.requestId, "requestId"), branchId: requestUuid(raw.branchId, "branchId"), creditor: text(raw.creditor, "creditor", 200), creditorType: choice(raw.creditorType, Object.keys(CREDITOR_TYPES) as (keyof typeof CREDITOR_TYPES)[], "creditorType"), takenAt: date(raw.takenAt, "takenAt"), ...(Object.hasOwn(raw, "category") ? { category: choice(raw.category, Object.keys(DEBT_CATEGORIES) as (keyof typeof DEBT_CATEGORIES)[], "category") } : {}), ...optional(raw, "concept", 1000), ...optional(raw, "reference", 200), ...optional(raw, "notes", 1000), ...optional(raw, "expectedPaymentMethod", 80), planInput: structuredClone(raw.planInput) as DebtPlanInput, scheduleConfirmed: true };
}
export function parsePaymentPlanRequest(value: unknown): PaymentPlanRequest {
  const raw = record(value, ["requestId", "debtId", "expectedVersion", "amountCents", "paidAt", "paymentMethod", "allocation", "reference", "notes"]);
  if (typeof raw.amountCents !== "number" || !Number.isSafeInteger(raw.amountCents) || raw.amountCents < 1 || raw.amountCents > MAX_DEBT_MONEY_CENTS) fail("amountCents");
  const allocation = record(raw.allocation, ["rule", "installmentId"]);
  const rule = choice(allocation.rule, ["selected_installment", "oldest_due"], "allocation.rule");
  if (rule === "oldest_due" && Object.hasOwn(allocation, "installmentId")) fail("allocation.installmentId");
  return { requestId: requestUuid(raw.requestId, "requestId"), debtId: requestUuid(raw.debtId, "debtId"), expectedVersion: version(raw.expectedVersion), amountCents: raw.amountCents, paidAt: date(raw.paidAt, "paidAt"), paymentMethod: text(raw.paymentMethod, "paymentMethod", 80), allocation: rule === "oldest_due" ? { rule } : { rule, installmentId: requestUuid(allocation.installmentId, "allocation.installmentId") }, ...optional(raw, "reference", 200), ...optional(raw, "notes", 1000) };
}
export function parseVoidPlanRequest(value: unknown): VoidPlanRequest {
  const raw = record(value, ["requestId", "debtId", "paymentId", "expectedVersion", "reason"]);
  return { requestId: requestUuid(raw.requestId, "requestId"), debtId: requestUuid(raw.debtId, "debtId"), paymentId: requestUuid(raw.paymentId, "paymentId"), expectedVersion: version(raw.expectedVersion), reason: text(raw.reason, "reason", 1000) };
}
export function debtErrorMessage(error: unknown): string {
  if (!(error instanceof DebtPlanError)) return "No pudimos validar estos datos. Revisalos antes de continuar.";
  const messages: Record<string, string> = { amount_exceeds_pending: "El pago supera el saldo de la deuda.", amount_exceeds_installment_pending: "El pago supera el saldo de la cuota elegida. Elegí imputación global si corresponde.", invalid_decimal_money: "Ingresá importes sin separador de miles, con punto decimal y hasta 2 decimales.", inconsistent_financing: "El total financiado no coincide con las cuotas o con el anticipo y los cargos confirmados.", financed_amount_required: "Indicá el total financiado o el monto por cuota.", dates_not_increasing: "Las fechas personalizadas deben estar ordenadas y no repetirse.", installment_count_mismatch: "Debe haber una fecha por cada cuota.", invalid_date: "Revisá las fechas del cronograma.", down_payment_exceeds_original: "El anticipo no puede superar el capital original.", version_conflict: "El saldo cambió. Actualizá y revisá la imputación antes de confirmar." };
  return messages[error.code] ?? `Revisá el campo ${error.path.replace(/^request\./, "")}. No se guardó la operación.`;
}

export type EditPlanRequest = { requestId: string; debtId: string; expectedVersion: number; notes: string | null } & ({ kind: "notes" } | { kind: "installment"; installmentId: string; dueDate: string | null });
export function parseEditPlanRequest(value: unknown): EditPlanRequest {
  const raw = record(value, ["kind", "requestId", "debtId", "expectedVersion", "notes", "installmentId", "dueDate"]);
  const kind = choice(raw.kind, ["notes", "installment"], "kind");
  if (kind === "notes" && (Object.hasOwn(raw, "installmentId") || Object.hasOwn(raw, "dueDate"))) fail("kind");
  if (!Object.hasOwn(raw, "notes") || (raw.notes !== null && (typeof raw.notes !== "string" || raw.notes.length > 1000))) fail("notes");
  const common = { requestId: requestUuid(raw.requestId, "requestId"), debtId: requestUuid(raw.debtId, "debtId"), expectedVersion: version(raw.expectedVersion), notes: raw.notes === null ? null : (raw.notes as string).trim() || null };
  return kind === "notes" ? { ...common, kind } : { ...common, kind, installmentId: requestUuid(raw.installmentId, "installmentId"), dueDate: raw.dueDate === null ? null : date(raw.dueDate, "dueDate", "0001-01-01") };
}

export type ExpectedDebtSession = { actorId: string; businessId: string };
