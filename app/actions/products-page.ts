"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { readCatalogRows } from "@/lib/catalog/pagination";
import { withPermission } from "@/lib/permissions/server-action";

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
};

export type ProductInput = {
  name: string;
  category: string;
  price: number;
  cost: number;
  active: boolean;
};

type ProductMutationResult =
  | { ok: true; persisted: true; productId: string }
  | { ok: false; persisted: false; error: string };

export const getProductsPageDataAction = withPermission<[],
  | { ok: true; data: ProductRow[] }
  | { ok: false; persisted: false; error: string }
>("products.view", async (ctx) => {
  if (!isDatabaseMode()) return { ok: true, data: [] };
  if (!ctx.isAuthenticated || !ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };

  const db = await createSupabaseServerClient() as any;
  if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus productos." };

  const productsRes = await readCatalogRows(db
    .from("products")
    .select("id,name,category,price,cost,active")
    .eq("business_id", ctx.businessId)
    .order("active", { ascending: false })
    .order("name", { ascending: true }).order("id"));

  if (productsRes.error) {
    return { ok: false, persisted: false, error: "No pudimos cargar los productos." };
  }

  const productIds = (productsRes.data ?? []).map((row: any) => row.id);
  const recipeMap = new Map<string, { id: string; count: number; needsReview: boolean }>();

  if (productIds.length > 0) {
    const recipesRes = await readCatalogRows(db
      .from("recipes")
      .select("id,product_id")
      .in("product_id", productIds).order("id"));

    if (recipesRes.error) return { ok: false, persisted: false, error: "No pudimos cargar las composiciones." };
    {
      const recipes = recipesRes.data ?? [];
      const recipeIds = recipes.map((row: any) => row.id);
      const counts = new Map<string, number>();
      const needsReview = new Set<string>();

      if (recipeIds.length > 0) {
        const itemsRes = await readCatalogRows(db.from("recipe_items").select("recipe_id,ingredient_id,quantity,unit").in("recipe_id", recipeIds).order("id"));
        if (itemsRes.error) return { ok: false, persisted: false, error: "No pudimos cargar los ingredientes de las composiciones." };
        {
          for (const item of itemsRes.data ?? []) {
            if (!item.ingredient_id || item.quantity === null || !item.unit) needsReview.add(item.recipe_id);
            counts.set(item.recipe_id, (counts.get(item.recipe_id) ?? 0) + 1);
          }
        }
      }

      for (const recipe of recipes) {
        recipeMap.set(recipe.product_id, { id: recipe.id, count: counts.get(recipe.id) ?? 0, needsReview: needsReview.has(recipe.id) });
      }
    }
  }

  const data: ProductRow[] = (productsRes.data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    category: row.category,
    price: Number(row.price ?? 0),
    cost: Number(row.cost ?? 0),
    active: Boolean(row.active),
    recipeId: recipeMap.get(row.id)?.id ?? null,
    ingredientCount: recipeMap.get(row.id)?.count ?? 0,
    recipeNeedsReview: recipeMap.get(row.id)?.needsReview ?? false,
  }));

  return { ok: true, data };
});

function validateProduct(input: ProductInput): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Ingresá un producto válido.";
  if (Object.keys(input).some((key) => !["name", "category", "price", "cost", "active"].includes(key))) return "El producto contiene campos no permitidos.";
  if (typeof input.active !== "boolean") return "Elegí un estado válido.";
  if (typeof input.name !== "string" || input.name.length > 200 || !input.name.trim()) return "Ingresá el nombre del producto.";
  if (typeof input.category !== "string" || input.category.length > 100 || !input.category.trim()) return "Ingresá una categoría.";
  if (typeof input.price !== "number" || !Number.isFinite(input.price) || input.price < 0 || input.price > 9999999999.99) return "Ingresá un precio válido.";
  if (typeof input.cost !== "number" || !Number.isFinite(input.cost) || input.cost < 0 || input.cost > 9999999999.99) return "Ingresá un costo válido.";
  return null;
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

    const res = await db
      .from("products")
      .insert({
        business_id: ctx.businessId,
        name: input.name.trim(),
        category: input.category.trim(),
        price: Number(input.price),
        cost: Number(input.cost),
        active: Boolean(input.active),
      })
      .select("id")
      .maybeSingle();

    if (res.error || !res.data?.id) {
      return { ok: false, persisted: false, error: "No pudimos registrar el producto." };
    }


    revalidatePath("/productos");
    revalidatePath("/auditoria");
    return { ok: true, persisted: true, productId: res.data.id };
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
