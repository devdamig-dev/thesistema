import { UUID, parseClosureOperation, type SaveClosure } from "./domain";
export type InboxClosureProposal = Pick<SaveClosure, "closureDate" | "grossTotal" | "netTotal" | "note"> & { branchId: string };
export type InboxClosureApproval = { extractionId: string; businessId: string; userId: string; expectedFields: Record<string, unknown>; review: InboxClosureProposal };
export type InboxClosureReview = { extractionId: string; businessId: string; userId: string; branchId: string | null; branches: { id: string; name: string }[]; expectedFields: Record<string, unknown>; closureDate: string; grossTotal: string; netTotal: string; note: string };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(value, key)!))) throw new Error("Revisión de cierre inválida.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) { if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error("La revisión contiene campos faltantes o no permitidos."); }
export function parseInboxClosureApproval(raw: unknown): InboxClosureApproval {
  const r = object(raw); exact(r, ["extractionId", "businessId", "userId", "expectedFields", "review"]);
  if (typeof r.extractionId !== "string" || !UUID.test(r.extractionId)) throw new Error("Extracción inválida.");
  const proposal = object(r.review); exact(proposal, ["branchId", "closureDate", "grossTotal", "netTotal", "note"]);
  const operation = parseClosureOperation("save", { ...proposal, requestId: r.extractionId, businessId: r.businessId, userId: r.userId, id: null, expectedVersion: null, reason: null });
  if (operation.kind !== "save") throw new Error("Revisión inválida.");
  const parsed = operation.input;
  const expected = object(r.expectedFields); const serialized = JSON.stringify(expected);
  if (serialized.length > 50000) throw new Error("La extracción supera el tamaño permitido.");
  const expectedFields = JSON.parse(serialized) as Record<string, unknown>;
  const review = { branchId: parsed.branchId!, closureDate: parsed.closureDate, grossTotal: parsed.grossTotal, netTotal: parsed.netTotal, note: parsed.note };
  return { extractionId: r.extractionId, businessId: parsed.businessId, userId: parsed.userId, expectedFields, review };
}
export function inboxClosureJournalKey(review: Pick<InboxClosureReview, "extractionId" | "businessId" | "userId">) { return `gastropilot:inbox-closure:${review.businessId}:${review.userId}:${review.extractionId}:v1`; }
export function recoverInboxClosure(raw: string | null, review: Pick<InboxClosureReview, "extractionId" | "businessId" | "userId">): InboxClosureApproval | null {
  if (raw === null) return null;
  if (raw.length > 60000) throw new Error("El intento guardado no es válido.");
  const value = parseInboxClosureApproval(JSON.parse(raw));
  if (value.businessId !== review.businessId || value.userId !== review.userId || value.extractionId !== review.extractionId) throw new Error("El intento pertenece a otro contexto.");
  return value;
}
