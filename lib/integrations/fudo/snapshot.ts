import { createHash } from "node:crypto";

export const FUDO_SYNC_RESOURCES = ["products", "ingredients", "providers", "orders", "sales"] as const;
export type FudoSyncResource = typeof FUDO_SYNC_RESOURCES[number];
export const FUDO_SYNC_PAGE_SIZE = 100;

export type FudoSnapshot = {
  externalId: string;
  payload: Record<string, unknown>;
  contentHash: string;
  sourceUpdatedAt: string | null;
};

export function parseFudoPage(value: unknown): FudoSnapshot[] {
  const raw = Array.isArray(value)
    ? value
    : value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>).data
      : null;
  if (!Array.isArray(raw) || raw.length > FUDO_SYNC_PAGE_SIZE) throw new Error("invalid_fudo_page");

  const seen = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("invalid_fudo_record");
    const body = item as Record<string, unknown>;
    const id = typeof body.id === "string" || typeof body.id === "number" ? String(body.id).trim() : "";
    if (!id || id.length > 256 || seen.has(id)) throw new Error("invalid_fudo_record");
    seen.add(id);

    const attributes = body.attributes && typeof body.attributes === "object" && !Array.isArray(body.attributes)
      ? body.attributes as Record<string, unknown> : {};
    const rawDate = attributes.updatedAt ?? attributes.updated_at;
    const sourceUpdatedAt = typeof rawDate === "string" && !Number.isNaN(Date.parse(rawDate))
      ? new Date(rawDate).toISOString() : null;
    const serialized = JSON.stringify(body);
    if (serialized.length > 131072) throw new Error("fudo_record_too_large");
    return {
      externalId: id,
      payload: body,
      contentHash: createHash("sha256").update(serialized).digest("hex"),
      sourceUpdatedAt,
    };
  });
}


/**
 * Resolve page-number progress using the provider's explicit JSON:API next link
 * when available. A provider may cap page size below our requested 100 records:
 * a short response alone must not be treated as the end of that resource.
 *
 * We NEVER fetch provider-supplied links (which could point off-origin).
 * Instead, they are only a continuation signal for our allowlisted, fixed
 * Fudo endpoint and incremented numeric page parameter.
 */
export function nextFudoPage(response: unknown, currentPage: number, recordCount: number): number {
  if (!Number.isSafeInteger(currentPage) || currentPage < 1 || currentPage > 100000
    || !Number.isSafeInteger(recordCount) || recordCount < 0 || recordCount > FUDO_SYNC_PAGE_SIZE) {
    throw new Error("invalid_fudo_page");
  }
  if (response && typeof response === "object" && !Array.isArray(response)) {
    const links = (response as Record<string, unknown>).links;
    if (links !== undefined) {
      if (!links || typeof links !== "object" || Array.isArray(links)) {
        throw new Error("invalid_fudo_page");
      }
      if (Object.prototype.hasOwnProperty.call(links, "next")) {
        const next = (links as Record<string, unknown>).next;
        if (next === null) return 0;
        const href = typeof next === "string" ? next
          : next && typeof next === "object" && !Array.isArray(next)
            ? (next as Record<string, unknown>).href
            : null;
        if (typeof href !== "string" || href.trim().length === 0
          || recordCount === 0 || currentPage === 100000) {
          throw new Error("invalid_fudo_page");
        }
        return currentPage + 1;
      }
    }
  }
  // Backwards-compatible fallback only when next-link metadata is absent.
  if (recordCount !== FUDO_SYNC_PAGE_SIZE) return 0;
  if (currentPage === 100000) throw new Error("invalid_fudo_page");
  return currentPage + 1;
}
