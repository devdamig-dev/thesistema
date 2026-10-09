import { PURCHASE_UUID } from "./inbox";
export type PurchaseCommitResult = { ok: true; persisted: true; id: string; replayed: boolean; kind: "summary" | "detailed"; source: "manual" | "inbox" | "whatsapp" } | { ok: false; persisted: false | "unknown"; error: string };
export function purchaseCommitResult(response: any, expected?: { source: "manual" | "inbox" | "whatsapp"; kind: "summary" | "detailed" }): PurchaseCommitResult {
  if (response?.error) {
    // Only complete SQLSTATE codes known to abort the transaction prove no
    // commit. Timeouts, transport failures and malformed receipts stay frozen.
    const known = typeof response.error.code === "string" && /^(?:(?:22|23|42)[0-9A-Z]{3}|P0001)$/.test(response.error.code);
    return { ok: false, persisted: known ? false : "unknown", error: known ? "No se guardaron cambios. Revisá permisos, datos y que la extracción siga disponible." : "No pudimos confirmar la compra. Reintentá esta misma revisión sin cambiar los datos." };
  }
  const r = response?.data;
  if (r?.ok !== true || typeof r.id !== "string" || !PURCHASE_UUID.test(r.id) || typeof r.replayed !== "boolean" || !["summary", "detailed"].includes(r.kind) || !["manual", "inbox", "whatsapp"].includes(r.source) || (expected && (r.source !== expected.source || r.kind !== expected.kind))) return { ok: false, persisted: "unknown", error: "La respuesta no confirma el resultado. Conservá esta misma revisión para verificarla." };
  return { ok: true, persisted: true, id: r.id, replayed: r.replayed, kind: r.kind, source: r.source };
}
