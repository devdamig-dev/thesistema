export type CatalogSnapshotProduct = {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  active: boolean;
  recipeId: string | null;
  ingredientCount: number;
  recipeNeedsReview: boolean;
  costRefreshPending: boolean;
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const money = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;

/** One RPC, one database snapshot. Never fall back to independently read rows. */
export async function readProductCatalogSnapshot(db: any, businessId: string, branchRestricted: boolean): Promise<
  { ok: true; data: CatalogSnapshotProduct[] } | { ok: false; persisted: false; error: string }
> {
  const failed = { ok: false, persisted: false, error: "No pudimos cargar los productos y verificar sus costos. Volvé a intentar." } as const;
  try {
    const response = await db.rpc("read_product_catalog_snapshot", { p_business_id: businessId });
    const snapshot: unknown = response?.data;
    if (response?.error || !record(snapshot) || snapshot.businessId !== businessId
      || typeof snapshot.costRefreshPending !== "boolean" || !Array.isArray(snapshot.products)
      || snapshot.products.length > 50000) return failed;
    const data: CatalogSnapshotProduct[] = [];
    const ids = new Set<string>();
    for (const row of snapshot.products) {
      if (!record(row) || typeof row.id !== "string" || !uuid.test(row.id) || ids.has(row.id)
        || typeof row.name !== "string" || typeof row.category !== "string"
        || !money(row.price) || !money(row.cost) || typeof row.active !== "boolean"
        || !(row.recipeId === null || typeof row.recipeId === "string" && uuid.test(row.recipeId))
        || typeof row.ingredientCount !== "number" || !Number.isSafeInteger(row.ingredientCount) || row.ingredientCount < 0
        || typeof row.recipeNeedsReview !== "boolean"
        || row.recipeId === null && (row.ingredientCount !== 0 || row.recipeNeedsReview)) return failed;
      ids.add(row.id);
      data.push({ id: row.id, name: row.name, category: row.category, price: row.price, cost: row.cost,
        active: row.active, recipeId: row.recipeId, ingredientCount: row.ingredientCount,
        recipeNeedsReview: row.recipeNeedsReview,
        costRefreshPending: snapshot.costRefreshPending || branchRestricted });
    }
    return { ok: true, data };
  } catch {
    return failed;
  }
}
