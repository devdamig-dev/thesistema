export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ClosureRecord = {
  id: string; business_id: string; branch_id: string | null; closure_date: string;
  raw_text: string; parsed: Record<string, unknown> | null; inconsistencies: unknown[] | null;
  gross_total: string; net_total: string; status: string; source: string | null; manual_note: string | null;
  version: number; created_at: string; archived_at: string | null; archive_reason: string | null;
};
export type ClosureWorkspace = { businessId: string; userId: string; timezone: string; branches: { id: string; name: string }[]; closures: ClosureRecord[]; canManage: boolean };
export type ClosureHistory = { request_id: string; operation: string; actor_role: string; created_at: string; reason: string | null; before_snapshot: ClosureRecord | null; after_snapshot: ClosureRecord; result: { version: number } };
export type SaveClosure = { requestId: string; businessId: string; userId: string; id: string | null; expectedVersion: number | null; branchId: string | null; closureDate: string; grossTotal: string; netTotal: string; note: string; reason: string | null };
export type ArchiveClosure = { requestId: string; businessId: string; userId: string; id: string; expectedVersion: number; reason: string };
export type ClosureOperation = { kind: "save"; input: SaveClosure } | { kind: "archive"; input: ArchiveClosure };
export type ClosureResult = { ok: true; persisted: true; id: string; version: number } | { ok: false; persisted: false | "unknown"; error: string };
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Datos de cierre inválidos."); return value as Record<string, unknown>; }
function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) throw new Error("Identificador inválido."); return value; }
function text(value: unknown, max: number, required = false): string { if (typeof value !== "string" || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || required && !value.trim()) throw new Error(required ? "Completá el motivo de la operación." : "Revisá las notas del cierre."); return value.trim(); }
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).length !== allowed.length || Object.keys(value).some(k => !allowed.includes(k))) throw new Error("Datos de cierre inválidos."); }
export function closureAmount(value: unknown, signed = false): string {
  if (typeof value !== "string" || !(signed ? /^-?(0|[1-9]\d{0,9})(\.\d{1,2})?$/ : /^(0|[1-9]\d{0,9})(\.\d{1,2})?$/).test(value)) throw new Error("Ingresá importes válidos con hasta dos decimales, sin separador de miles.");
  return value;
}
export function parseClosureOperation(kind: "save" | "archive", input: unknown): ClosureOperation {
  const p = object(input); keys(p, kind === "save" ? ["requestId", "businessId", "userId", "id", "expectedVersion", "branchId", "closureDate", "grossTotal", "netTotal", "note", "reason"] : ["requestId", "businessId", "userId", "id", "expectedVersion", "reason"]);
  const base = { requestId: uuid(p.requestId), businessId: uuid(p.businessId), userId: uuid(p.userId), id: p.id === null ? null : uuid(p.id), expectedVersion: p.expectedVersion as number | null };
  if (base.id === null ? base.expectedVersion !== null : !Number.isSafeInteger(base.expectedVersion) || Number(base.expectedVersion) < 0) throw new Error("La versión del cierre no es válida. Volvé a cargarlo.");
  if (kind === "archive") { if (!base.id || base.expectedVersion === null) throw new Error("Elegí el cierre a archivar."); return { kind, input: { ...base, id: base.id, expectedVersion: base.expectedVersion, reason: text(p.reason, 1000, true) } }; }
  if (typeof p.closureDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(p.closureDate) || Number(p.closureDate.slice(0, 4)) < 1900 || (Number.isNaN(new Date(`${p.closureDate}T12:00:00Z`).getTime()) ? "" : new Date(`${p.closureDate}T12:00:00Z`).toISOString().slice(0, 10)) !== p.closureDate) throw new Error("Ingresá una fecha de cierre válida.");
  const branchId = p.branchId === null ? null : uuid(p.branchId); if (!base.id && !branchId) throw new Error("Elegí una sucursal.");
  return { kind, input: { ...base, branchId, closureDate: p.closureDate, grossTotal: closureAmount(p.grossTotal), netTotal: closureAmount(p.netTotal, true), note: text(p.note, 4000), reason: base.id ? text(p.reason, 1000, true) : p.reason === null ? null : text(p.reason, 1000) } };
}
export const closureJournalKey = (businessId: string, userId: string) => `gp:closures:v1:${businessId}:${userId}`;
export function readClosureOperation(raw: string | null, businessId: string, userId: string): ClosureOperation | null {
  if (raw === null) return null; const p = object(JSON.parse(raw)); keys(p, ["kind", "input"]); if (p.kind !== "save" && p.kind !== "archive") throw new Error("Referencia de operación inválida.");
  const operation = parseClosureOperation(p.kind, p.input); if (operation.input.businessId !== businessId || operation.input.userId !== userId) throw new Error("La operación pertenece a otra sesión."); return operation;
}
const ERRORS: Record<string, string> = {
  closure_extraction_changed: "La extracción cambió desde la revisión. Abrila nuevamente.", closure_extraction_closed: "La extracción ya está cerrada. Revisá Cierres antes de crear otro registro.",
  closure_permission_denied: "No tenés permiso para gestionar cierres.", closure_module_disabled: "El módulo Cierres está deshabilitado.", closure_branch_forbidden: "La sucursal no está autorizada.", closure_context_changed: "Cambió el negocio o la sesión. Recargá para continuar.", closure_conflict: "El cierre cambió. Cerrá el formulario y actualizá antes de corregirlo.", closure_archived: "Este cierre ya está archivado.", closure_idempotency_conflict: "La referencia ya se utilizó con otros datos. Conservá el intento y revisá el historial.", closure_not_found: "No se encontró el cierre en el negocio activo.", closure_invalid_date: "La fecha no es válida o está en el futuro.", closure_branch_immutable: "La sucursal original se conserva. Archivá el cierre y creá uno nuevo si fue incorrecta.", closure_invalid_input: "Revisá los datos y el motivo del cierre.",
};
export type ClosuresDatabase = { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
export function closureRpcResult(response: { data: unknown; error: unknown }): ClosureResult {
    const data = response.data as { ok?: boolean; id?: string; version?: number; error?: string } | null;
    if (!response.error && data?.ok === true && typeof data.id === "string" && UUID.test(data.id) && Number.isSafeInteger(data.version) && data.version! >= 1) return { ok: true, persisted: true, id: data.id, version: data.version! };
    if (!response.error && data?.ok === false && typeof data.error === "string") return { ok: false, persisted: false, error: ERRORS[data.error ?? ""] ?? "No se guardó el cierre. Revisá los datos y permisos." };
  return { ok: false, persisted: "unknown", error: "No pudimos confirmar el resultado. Reintentá el mismo intento para verificarlo sin duplicar el cierre." };
}
export async function mutateClosure(db: ClosuresDatabase, context: { businessId: string; userId: string }, kind: "save" | "archive", input: unknown): Promise<ClosureResult> {
  let operation: ClosureOperation; try { operation = parseClosureOperation(kind, input); } catch (error) { return { ok: false, persisted: false, error: error instanceof Error ? error.message : "Datos inválidos." }; }
  if (operation.input.businessId !== context.businessId || operation.input.userId !== context.userId) return { ok: false, persisted: false, error: ERRORS.closure_context_changed };
  try {
    const response = await db.rpc(kind === "save" ? "save_closure_atomic" : "archive_closure_atomic", { p_business_id: context.businessId, p_input: operation.input });
    return closureRpcResult(response);
  } catch { /* The transaction may have committed before the response was lost. */ }
  return { ok: false, persisted: "unknown", error: "No pudimos confirmar el resultado. Reintentá el mismo intento para verificarlo sin duplicar el cierre." };
}
