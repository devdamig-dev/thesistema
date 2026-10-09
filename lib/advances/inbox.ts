import { expenseAmount, EXPENSE_UUID } from "../expenses/validation";
import { isEmployeeVersion } from "../employees/domain";
export type AdvanceProposal = { employeeId: string; expectedEmployeeUpdatedAt: string; branchId: string; amount: string; date: string; note: string };
export type AdvanceApproval = { extractionId: string; businessId: string; userId: string; expectedFields: Record<string, unknown>; review: AdvanceProposal };
export type AdvanceReview = { extractionId: string; businessId: string; userId: string; branchId: string | null; employees: { id: string; fullName: string; role: string; branchId: string; branchName: string; updatedAt: string }[]; expectedFields: Record<string, unknown>; closed: boolean; targetAdvanceId: string | null; detectedName: string; amount: string; date: string };
export type AdvanceResult = { ok: true; persisted: true; advanceId: string } | { ok: false; persisted: false | "unknown"; error: string };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) throw new Error("Revisión de adelanto inválida.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).length !== allowed.length || Object.keys(value).some(key => !allowed.includes(key))) throw new Error("Revisá los campos obligatorios del adelanto."); }
function uuid(value: unknown): string { if (typeof value !== "string" || !EXPENSE_UUID.test(value)) throw new Error("Elegí el empleado exacto y su sucursal."); return value; }
export function parseAdvanceApproval(raw: unknown): AdvanceApproval {
  const p = object(raw); keys(p, ["extractionId", "businessId", "userId", "expectedFields", "review"]); const review = object(p.review); keys(review, ["employeeId", "expectedEmployeeUpdatedAt", "branchId", "amount", "date", "note"]);
  if (!isEmployeeVersion(review.expectedEmployeeUpdatedAt)) throw new Error("Recargá la ficha del empleado antes de continuar.");
  const date = review.date;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 1900 || !Number.isFinite(new Date(`${date}T12:00:00Z`).getTime()) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Ingresá la fecha completa del adelanto.");
  if (typeof review.note !== "string" || review.note.length > 1000 || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(review.note)) throw new Error("Revisá la nota del adelanto.");
  const expected = object(p.expectedFields); const serialized = JSON.stringify(expected); if (serialized.length > 50000) throw new Error("La extracción supera el tamaño permitido.");
  return { extractionId: uuid(p.extractionId), businessId: uuid(p.businessId), userId: uuid(p.userId), expectedFields: JSON.parse(serialized), review: { employeeId: uuid(review.employeeId), expectedEmployeeUpdatedAt: review.expectedEmployeeUpdatedAt, branchId: uuid(review.branchId), amount: expenseAmount(review.amount), date, note: review.note.trim() } };
}
const ERRORS: Record<string, string> = { advance_permission_denied: "No tenés permiso para registrar adelantos.", advance_module_disabled: "El módulo Equipo o Inbox está deshabilitado.", advance_not_found: "La extracción no está disponible.", advance_branch_forbidden: "El empleado y el mensaje deben pertenecer a la misma sucursal.", advance_employee_forbidden: "Elegí un empleado activo del negocio y la sucursal del mensaje.", advance_employee_changed: "La ficha cambió desde la revisión. Volvé a abrirla antes de confirmar.", advance_extraction_changed: "La extracción cambió. Abrí una nueva revisión.", advance_extraction_closed: "La extracción ya está cerrada. Revisá la auditoría.", advance_idempotency_conflict: "Esta extracción ya tiene otra revisión confirmada. Verificá la auditoría antes de continuar.", advance_invalid_date: "La fecha del adelanto es inválida o futura.", advance_invalid_input: "Revisá empleado, fecha e importe del adelanto." };
export function advanceRpcResult(response: { data: unknown; error: unknown }): AdvanceResult {
  const data = response.data as { ok?: boolean; id?: unknown; error?: string } | null;
  if (!response.error && data?.ok === true && typeof data.id === "string" && EXPENSE_UUID.test(data.id)) return { ok: true, persisted: true, advanceId: data.id };
  if (!response.error && data?.ok === false && typeof data.error === "string") return { ok: false, persisted: false, error: ERRORS[data.error] ?? "No se guardó el adelanto. Revisá los datos." };
  return { ok: false, persisted: "unknown", error: "No pudimos confirmar el resultado. Conservá esta revisión y reintentá sus mismos datos para evitar duplicados." };
}
export const advanceJournalKey = (review: Pick<AdvanceReview, "extractionId" | "businessId" | "userId">) => `gastropilot:inbox-advance:${review.businessId}:${review.userId}:${review.extractionId}:v1`;
export function recoverAdvance(raw: string | null, review: Pick<AdvanceReview, "extractionId" | "businessId" | "userId">): AdvanceApproval | null {
  if (raw === null) return null; if (raw.length > 60000) throw new Error("Revisión guardada inválida."); const value = parseAdvanceApproval(JSON.parse(raw));
  if (value.businessId !== review.businessId || value.userId !== review.userId || value.extractionId !== review.extractionId) throw new Error("La revisión pertenece a otro contexto.");
  return value;
}
