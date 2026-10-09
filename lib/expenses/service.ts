import { EXPENSE_UUID, parseExpenseState, parseSaveExpense } from "./validation";
import type { ExpenseResult } from "./types";
export type ExpensesDatabase = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
const ERRORS: Record<string, string> = {
  expense_permission_denied: "No tenés permiso para gestionar gastos.", expense_branch_forbidden: "La sucursal no está disponible para tu usuario.",
  expense_module_disabled: "El módulo Gastos está deshabilitado.", expense_context_changed: "Cambió la sesión o el negocio activo. Recargá antes de continuar.",
  expense_conflict: "El gasto cambió. Recargá y revisá los cambios antes de editarlo.", expense_state_conflict: "El estado del gasto cambió. Recargá antes de continuar.",
  expense_idempotency_conflict: "Esta referencia ya se usó con otros datos. Conservá el intento y revisá el historial.",
  expense_extraction_changed: "La extracción cambió desde la revisión. Abrila nuevamente.", expense_extraction_closed: "La extracción ya está cerrada. Revisá Gastos antes de crear otro registro.",
  expense_supplier_forbidden: "El proveedor no está disponible en este negocio. Elegí uno activo o conservá el proveedor histórico.",
  expense_not_found: "El gasto no está disponible en este negocio.", expense_invalid_input: "Revisá los datos del gasto.",
};
export function expenseRpcResult(response: { data: unknown; error: unknown }): ExpenseResult {
  const data = response.data as { ok?: boolean; id?: unknown; version?: unknown; error?: string } | null;
  if (!response.error && data?.ok === true && typeof data.id === "string" && EXPENSE_UUID.test(data.id) && Number.isSafeInteger(data.version) && Number(data.version) > 0) return { ok: true, persisted: true, expenseId: data.id, version: Number(data.version) };
  if (!response.error && data?.ok === false && typeof data.error === "string") return { ok: false, persisted: false, error: ERRORS[data.error] ?? "No se guardó el gasto. Revisá los datos y permisos." };
  return { ok: false, persisted: "unknown", error: "No pudimos confirmar el resultado. Conservá este intento y reintentá los mismos datos para evitar duplicados." };
}
/** Every transport calls the same identity-bound transaction engine. */
export async function mutateExpense(db: ExpensesDatabase, context: { businessId: string; userId: string; source: "manual" | "whatsapp" }, operation: "save" | "void" | "restore", input: unknown): Promise<ExpenseResult> {
  let parsed;
  try { if (!["save", "void", "restore"].includes(operation)) throw new Error("Operación inválida."); parsed = operation === "save" ? parseSaveExpense(input) : parseExpenseState(input); }
  catch (error) { return { ok: false, persisted: false, error: error instanceof Error ? error.message : "Datos inválidos." }; }
  if (parsed.businessId !== context.businessId || parsed.userId !== context.userId) return { ok: false, persisted: false, error: ERRORS.expense_context_changed };
  try {
    return expenseRpcResult(await db.rpc(context.source === "manual" ? `${operation}_expense_atomic` : "mutate_expense_for_agent", context.source === "manual" ? { p_business_id: context.businessId, p_input: parsed } : { p_business_id: context.businessId, p_actor_id: context.userId, p_operation: operation, p_input: parsed }));
  } catch { return { ok: false, persisted: "unknown", error: "Se interrumpió la conexión. Reintentá este mismo intento para verificarlo sin duplicar el gasto." }; }
}
