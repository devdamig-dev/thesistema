import { EXPENSE_UUID, EXPENSE_OPERATING_KEYS, parseSaveExpense } from "./validation";
import type { SaveExpenseInput } from "./types";
export type InboxExpenseProposal = Pick<SaveExpenseInput, "branchId" | "name" | "category" | "amount" | "dueDate" | "status" | "expenseDate" | "paymentMethod" | "supplierId" | "isRecurring" | "periodicity">;
export type InboxExpenseApproval = { extractionId: string; businessId: string; userId: string; expectedFields: Record<string, unknown>; review: InboxExpenseProposal };
export type InboxExpenseReview = { extractionId: string; businessId: string; userId: string; branchId: string | null; branches: { id: string; name: string }[]; suppliers: { id: string; name: string; active: boolean }[]; expectedFields: Record<string, unknown>; name: string; category: string; amount: string; dueDate: string | null };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) throw new Error("Revisión de gasto inválida.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error("La revisión contiene campos faltantes o no permitidos."); }
export function parseInboxExpenseApproval(raw: unknown): InboxExpenseApproval {
  const r = object(raw); exact(r, ["extractionId", "businessId", "userId", "expectedFields", "review"]);
  if (typeof r.extractionId !== "string" || !EXPENSE_UUID.test(r.extractionId)) throw new Error("Extracción inválida.");
  const proposal = object(r.review); const extended = EXPENSE_OPERATING_KEYS.some(key => Object.hasOwn(proposal, key)); exact(proposal, ["branchId", "name", "category", "amount", "dueDate", "status", ...(extended ? EXPENSE_OPERATING_KEYS : [])]);
  const parsed = parseSaveExpense({ ...proposal, requestId: r.extractionId, businessId: r.businessId, userId: r.userId, id: null, expectedVersion: null });
  const expected = object(r.expectedFields); const serialized = JSON.stringify(expected);
  if (serialized.length > 50000) throw new Error("La extracción supera el tamaño permitido.");
  const expectedFields = JSON.parse(serialized) as Record<string, unknown>;
  const review: InboxExpenseProposal = { ...(extended ? { expenseDate: parsed.expenseDate!, paymentMethod: parsed.paymentMethod!, supplierId: parsed.supplierId!, isRecurring: parsed.isRecurring!, periodicity: parsed.periodicity! } : {}), branchId: parsed.branchId, name: parsed.name, category: parsed.category, amount: parsed.amount, dueDate: parsed.dueDate, status: parsed.status };
  return { extractionId: r.extractionId, businessId: parsed.businessId, userId: parsed.userId, expectedFields, review };
}
export function inboxExpenseJournalKey(review: Pick<InboxExpenseReview, "extractionId" | "businessId" | "userId">) { return `gastropilot:inbox-expense:${review.businessId}:${review.userId}:${review.extractionId}:v1`; }
export function recoverInboxExpense(raw: string | null, review: Pick<InboxExpenseReview, "extractionId" | "businessId" | "userId">): InboxExpenseApproval | null {
  if (raw === null) return null;
  if (raw.length > 60000) throw new Error("El intento guardado no es válido.");
  const value = parseInboxExpenseApproval(JSON.parse(raw));
  if (value.businessId !== review.businessId || value.userId !== review.userId || value.extractionId !== review.extractionId) throw new Error("El intento pertenece a otro contexto.");
  return value;
}
