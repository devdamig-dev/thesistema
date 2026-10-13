import type { ChangeExpenseStateInput, ExpenseStatus, ExpenseOperatingFields, ExpensePeriodicity, SaveExpenseInput } from "./types";
export const EXPENSE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) throw new Error("Datos de gasto inválidos.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, expected: string[]) { if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) throw new Error("El gasto contiene campos faltantes o no permitidos."); }
function uuid(value: unknown): string { if (typeof value !== "string" || !EXPENSE_UUID.test(value)) throw new Error("Referencia inválida."); return value; }
function text(value: unknown, max: number): string { if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > max || /[\x00-\x1F\x7F]/.test(value)) throw new Error("Completá los textos en una sola línea y respetá el largo máximo."); return value.trim(); }
function version(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= 2147483647) throw new Error("Versión de gasto inválida."); return Number(value); }
export function expenseAmount(value: unknown): string {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(value)) throw new Error("Ingresá un monto con hasta dos decimales, sin separadores de miles.");
  const [whole, fraction = ""] = value.split(".");
  if (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")) <= 0n) throw new Error("Ingresá un monto mayor a cero.");
  return value;
}
export const EXPENSE_PERIODICITIES = { daily: "Diaria", weekly: "Semanal", fortnightly: "Quincenal", monthly: "Mensual", quarterly: "Trimestral", semiannual: "Semestral", yearly: "Anual" } as const;
export const EXPENSE_OPERATING_KEYS = ["expenseDate", "paymentMethod", "supplierId", "isRecurring", "periodicity"];
function date(value: unknown, label = "vencimiento"): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") || !Number.isFinite(new Date(`${value}T12:00:00Z`).getTime()) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error(`Ingresá una fecha de ${label} válida.`);
  return value;
}
export function parseSaveExpense(input: unknown): SaveExpenseInput {
  const r = record(input); const extended = EXPENSE_OPERATING_KEYS.some(key => Object.hasOwn(r, key));
  keys(r, ["requestId", "businessId", "userId", "id", "expectedVersion", "branchId", "name", "category", "amount", "dueDate", "status", ...(extended ? EXPENSE_OPERATING_KEYS : [])]);
  const id = r.id === null ? null : uuid(r.id); const expectedVersion = r.expectedVersion === null ? null : version(r.expectedVersion);
  if ((id === null) !== (expectedVersion === null)) throw new Error("Recargá el gasto para obtener su versión actual.");
  if (!["pending", "scheduled", "paid"].includes(r.status as string)) throw new Error("Elegí un estado válido.");
  let operating: Partial<ExpenseOperatingFields> = {};
  if (extended) {
    if (id === null && (r.expenseDate === null || r.paymentMethod === null || r.isRecurring === null)) throw new Error("Completá fecha del gasto, medio de pago y si es recurrente.");
    if (r.isRecurring !== null && typeof r.isRecurring !== "boolean") throw new Error("Indicá si el gasto es recurrente.");
    if (r.isRecurring === true ? typeof r.periodicity !== "string" || !Object.hasOwn(EXPENSE_PERIODICITIES, r.periodicity) : r.periodicity !== null) throw new Error("Elegí una periodicidad sólo si el gasto es recurrente.");
    operating = { expenseDate: date(r.expenseDate, "gasto"), paymentMethod: r.paymentMethod === null ? null : text(r.paymentMethod, 80), supplierId: r.supplierId === null ? null : uuid(r.supplierId), isRecurring: r.isRecurring as boolean | null, periodicity: r.periodicity as ExpensePeriodicity | null };
  }
  return { ...operating, requestId: uuid(r.requestId), businessId: uuid(r.businessId), userId: uuid(r.userId), id, expectedVersion, branchId: uuid(r.branchId), name: text(r.name, 200), category: text(r.category, 80), amount: expenseAmount(r.amount), dueDate: date(r.dueDate), status: r.status as ExpenseStatus };
}
export function parseExpenseState(input: unknown): ChangeExpenseStateInput {
  const r = record(input); keys(r, ["requestId", "businessId", "userId", "id", "expectedVersion", "reason"]);
  return { requestId: uuid(r.requestId), businessId: uuid(r.businessId), userId: uuid(r.userId), id: uuid(r.id), expectedVersion: version(r.expectedVersion), reason: text(r.reason, 1000) };
}
