"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { readProductCatalogSnapshot } from "../../lib/catalog/snapshot";
import { withPermission } from "@/lib/permissions/server-action";
import { createCatalogProduct, validateProductFields, type ProductInput } from "../../lib/catalog/products";
export type { ProductInput } from "../../lib/catalog/products";

export type ProductRow = {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  active: boolean;
  recipeId: string | null;
  ingredientCount: number;
  recipeNeedsReview?: boolean;
  costRefreshPending?: boolean;
};

type ProductMutationResult =
  | { ok: true; persisted: true; productId: string }
  | { ok: false; persisted: false | "unknown"; error: string };

export const getProductsPageDataAction = withPermission<[],
  | { ok: true; data: ProductRow[] }
  | { ok: false; persisted: false; error: string }
>("products.view", async (ctx) => {
  if (!isDatabaseMode()) return { ok: true, data: [] };
  if (!ctx.isAuthenticated || !ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };

  const db = await createSupabaseServerClient() as any;
  if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus productos." };

  return readProductCatalogSnapshot(db, ctx.businessId, ctx.assignedBranchIds !== null);
});

function validateProduct(input: ProductInput): string | null {
  return validateProductFields(input).issues[0]?.message ?? null;
}

export const createProductAction = withPermission<[ProductInput], ProductMutationResult>(
  "products.edit_price",
  async (ctx, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.isAuthenticated || !ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };
    const validation = validateProduct(input);
    if (validation) return { ok: false, persisted: false, error: validation };

    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus productos." };

    const result = await createCatalogProduct(db, { businessId: ctx.businessId, source: "manual" }, input);
    if (!result.ok) return result;
    // Cache invalidation is not part of the already committed product/audit.
    try { revalidatePath("/productos"); revalidatePath("/auditoria"); } catch { /* The confirmed receipt remains authoritative. */ }
    return { ok: true, persisted: true, productId: result.productId };
  },
);

export const updateProductAction = withPermission<[string, ProductInput], ProductMutationResult>(
  "products.edit_price",
  async (ctx, productId, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.isAuthenticated || !ctx.businessId || typeof productId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(productId)) return { ok: false, persisted: false, error: "No pudimos identificar el producto." };
    const validation = validateProduct(input);
    if (validation) return { ok: false, persisted: false, error: validation };

    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus productos." };

    const res = await db
      .from("products")
      .update({
        name: input.name.trim(),
        category: input.category.trim(),
        price: Number(input.price),
        cost: Number(input.cost),
        active: Boolean(input.active),
      })
      .eq("id", productId)
      .eq("business_id", ctx.businessId)
      .select("id")
      .maybeSingle();

    if (res.error || !res.data?.id) {
      return { ok: false, persisted: false, error: "No pudimos actualizar el producto." };
    }


    revalidatePath("/productos");
    revalidatePath("/auditoria");
    return { ok: true, persisted: true, productId };
  },
);
