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
