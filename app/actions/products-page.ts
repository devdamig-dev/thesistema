"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { readCatalogRows } from "@/lib/catalog/pagination";
import { withPermission } from "@/lib/permissions/server-action";
import { normalizeUnit } from "@/lib/recipes/quantities";

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

export type ProductRecipeItemInput = { ingredientId: string; quantity: number; unit: string };
export type ProductCreateInput = ProductInput & { recipeItems?: ProductRecipeItemInput[] };

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

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);

function normalizeRecipeItems(raw: unknown): { items: ProductRecipeItemInput[]; error: string | null } {
  if (raw === undefined) return { items: [], error: null };
  if (!Array.isArray(raw) || raw.length > 100) return { items: [], error: "La receta no tiene un formato válido." };
  const seen = new Set<string>();
  const items: ProductRecipeItemInput[] = [];
  for (const value of raw) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return { items: [], error: "Revisá los insumos de la receta." };
    const row = value as Record<string, unknown>;
    if (Object.keys(row).some((key) => !["ingredientId", "quantity", "unit"].includes(key)) || !uuid(row.ingredientId) ||
      typeof row.quantity !== "number" || !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 9999999999.99) {
      return { items: [], error: "Revisá los insumos, cantidades y unidades de la receta." };
    }
    const unit = normalizeUnit(row.unit);
    if (!unit || seen.has(row.ingredientId)) return { items: [], error: "Cada insumo debe aparecer una sola vez con una unidad válida." };
    seen.add(row.ingredientId);
    items.push({ ingredientId: row.ingredientId, quantity: row.quantity, unit });
  }
  return { items, error: null };
}

export const createProductAction = withPermission<[ProductCreateInput], ProductMutationResult>(
  "products.edit_price",
  async (ctx, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.isAuthenticated || !ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };
    if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input as Record<string, unknown>).some((key) => !["name", "category", "price", "cost", "active", "recipeItems"].includes(key))) {
      return { ok: false, persisted: false, error: "El producto contiene campos no permitidos." };
    }

    const raw = input as ProductCreateInput;
    const productInput: ProductInput = { name: raw.name, category: raw.category, price: raw.price, cost: raw.cost, active: raw.active };
    const validation = validateProduct(productInput);
    if (validation) return { ok: false, persisted: false, error: validation };
    const recipe = normalizeRecipeItems(raw.recipeItems);
    if (recipe.error) return { ok: false, persisted: false, error: recipe.error };

    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus productos." };

    let productId: string;
    if (recipe.items.length) {
      let response: any;
      try {
        response = await db.rpc("create_product_with_recipe_atomic", {
          p_business_id: ctx.businessId,
          p_input: {
            name: productInput.name.trim(), category: productInput.category.trim(),
            price: Number(productInput.price), cost: Number(productInput.cost), active: Boolean(productInput.active),
          },
          p_items: recipe.items,
        });
      } catch {
        return { ok: false, persisted: "unknown", error: "No pudimos confirmar el alta con su receta. Revisá Productos antes de repetirla para evitar duplicados." };
      }
      if (response?.error) {
        const deterministic = typeof response.error.code === "string" && /^(?:(?:22|23|42)[0-9A-Z]{3}|P0001)$/.test(response.error.code);
        return { ok: false, persisted: deterministic ? false : "unknown", error: deterministic
          ? "No se guardó el producto con su receta. Revisá los insumos, cantidades y permisos."
          : "No pudimos confirmar el alta con su receta. Revisá Productos antes de repetirla para evitar duplicados." };
      }
      const receipt = response?.data as Record<string, unknown> | null;
      if (!receipt || receipt.ok !== true || !uuid(receipt.id) || !uuid(receipt.recipe_id) ||
        !(typeof receipt.cost === "number" || typeof receipt.cost === "string")) {
        return { ok: false, persisted: "unknown", error: "La respuesta no confirma el producto y su receta. Revisá Productos antes de repetirla." };
      }
      productId = receipt.id;
    } else {
      const res = await db
        .from("products")
        .insert({
          business_id: ctx.businessId,
          name: productInput.name.trim(),
          category: productInput.category.trim(),
          price: Number(productInput.price),
          cost: Number(productInput.cost),
          active: Boolean(productInput.active),
        })
        .select("id")
        .maybeSingle();

      if (res.error || !res.data?.id) return { ok: false, persisted: false, error: "No pudimos registrar el producto." };
      productId = res.data.id;
    }

    try { revalidatePath("/productos"); revalidatePath("/auditoria"); } catch { /* persistence is already confirmed */ }
    return { ok: true, persisted: true, productId };
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
