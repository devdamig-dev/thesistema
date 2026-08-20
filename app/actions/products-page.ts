"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { withPermission } from "@/lib/permissions/server-action";
import { logActivity } from "@/lib/data/activity";

export type ProductRow = {
  id: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  active: boolean;
  recipeId: string | null;
  ingredientCount: number;
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
  if (!ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };

  const db = createSupabaseServerClient() as any;
  if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus productos." };

  const productsRes = await db
    .from("products")
    .select("id,name,category,price,cost,active")
    .eq("business_id", ctx.businessId)
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  if (productsRes.error) {
    return { ok: false, persisted: false, error: "No pudimos cargar los productos." };
  }

  const productIds = (productsRes.data ?? []).map((row: any) => row.id);
  const recipeMap = new Map<string, { id: string; count: number }>();

  if (productIds.length > 0) {
    const recipesRes = await db
      .from("recipes")
      .select("id,product_id")
      .in("product_id", productIds);

    if (!recipesRes.error) {
      const recipes = recipesRes.data ?? [];
      const recipeIds = recipes.map((row: any) => row.id);
      const counts = new Map<string, number>();

      if (recipeIds.length > 0) {
        const itemsRes = await db.from("recipe_items").select("recipe_id").in("recipe_id", recipeIds);
        if (!itemsRes.error) {
          for (const item of itemsRes.data ?? []) {
            counts.set(item.recipe_id, (counts.get(item.recipe_id) ?? 0) + 1);
          }
        }
      }

      for (const recipe of recipes) {
        recipeMap.set(recipe.product_id, { id: recipe.id, count: counts.get(recipe.id) ?? 0 });
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
  }));

  return { ok: true, data };
});

function validateProduct(input: ProductInput): string | null {
  if (!input.name.trim()) return "Ingresá el nombre del producto.";
  if (!input.category.trim()) return "Ingresá una categoría.";
  if (!Number.isFinite(Number(input.price)) || Number(input.price) < 0) return "Ingresá un precio válido.";
  if (!Number.isFinite(Number(input.cost)) || Number(input.cost) < 0) return "Ingresá un costo válido.";
  return null;
}

export const createProductAction = withPermission<[ProductInput], ProductMutationResult>(
  "products.edit_price",
  async (ctx, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };
    const validation = validateProduct(input);
    if (validation) return { ok: false, persisted: false, error: validation };

    const db = createSupabaseServerClient() as any;
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

    await logActivity({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorName: ctx.fullName,
      actorRole: ctx.role,
      action: "product.created",
      targetType: "products",
      targetId: res.data.id,
      summary: `Producto creado · ${input.name.trim()}`,
      data: { category: input.category.trim(), price: Number(input.price), cost: Number(input.cost), active: Boolean(input.active) },
    });

    revalidatePath("/productos");
    revalidatePath("/auditoria");
    return { ok: true, persisted: true, productId: res.data.id };
  },
);

export const updateProductAction = withPermission<[string, ProductInput], ProductMutationResult>(
  "products.edit_price",
  async (ctx, productId, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.businessId || !productId) return { ok: false, persisted: false, error: "No pudimos identificar el producto." };
    const validation = validateProduct(input);
    if (validation) return { ok: false, persisted: false, error: validation };

    const db = createSupabaseServerClient() as any;
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

    await logActivity({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorName: ctx.fullName,
      actorRole: ctx.role,
      action: "product.updated",
      targetType: "products",
      targetId: productId,
      summary: `Producto actualizado · ${input.name.trim()}`,
      data: { category: input.category.trim(), price: Number(input.price), cost: Number(input.cost), active: Boolean(input.active) },
    });

    revalidatePath("/productos");
    revalidatePath("/auditoria");
    return { ok: true, persisted: true, productId };
  },
);
