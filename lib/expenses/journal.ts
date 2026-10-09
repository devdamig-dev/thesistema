import { parseExpenseState, parseSaveExpense } from "./validation";
import type { ExpenseOperation } from "./types";
export function expenseJournalKey(businessId: string, userId: string) { return `gastropilot:expenses:${businessId}:${userId}:v1`; }
export function readExpenseOperation(raw: string | null, businessId: string, userId: string): ExpenseOperation | null {
  if (raw === null) return null;
  if (raw.length > 20000) throw new Error("Intento guardado inválido.");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Object.keys(value).sort().join(",") !== "input,kind" || !["save", "void", "restore"].includes(value.kind)) throw new Error("Intento guardado inválido.");
  const input = value.kind === "save" ? parseSaveExpense(value.input) : parseExpenseState(value.input);
  if (input.businessId !== businessId || input.userId !== userId) throw new Error("El intento pertenece a otra sesión.");
  return { kind: value.kind, input } as ExpenseOperation;
}
export function retainExpenseOperation(current: ExpenseOperation | null, proposed: ExpenseOperation): ExpenseOperation {
  const copy = readExpenseOperation(JSON.stringify(proposed), proposed.input.businessId, proposed.input.userId)!;
  if (current && JSON.stringify(current) !== JSON.stringify(copy)) throw new Error("Hay un intento pendiente de confirmar.");
  return current ?? copy;
}
