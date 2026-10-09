"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { withPermission } from "@/lib/permissions/server-action";
import { hasPermission } from "@/lib/permissions";
import { readCatalogRows } from "@/lib/catalog/pagination";
import { normalizeUnit } from "@/lib/recipes/quantities";

export type IngredientRow = {
  id: string; name: string; unit: string; unitCost: number | null; active: boolean;
  supplierId: string | null;
  stock: { branchId: string; branchName: string; current: number; minimum: number }[];
};
export type IngredientInput = {
  name: string; unit: string; unitCost: number; active: boolean; supplierId: string | null;
  minimums: { branchId: string; minimum: number }[];
};
export type CatalogData = {
  ingredients: IngredientRow[]; suppliers: { id: string; name: string }[];
  branches: { id: string; name: string }[]; canEdit: boolean;
};
export type RecipeData = {
  productId: string; recipeId: string | null; updatedAt: string | null;
  items: { ingredientId: string; quantity: number | null; unit: string | null; name: string }[];
};
export type RecipeInput = {
  expectedUpdatedAt: string | null;
  items: { ingredientId: string; quantity: number; unit: string }[];
};
type Failure = { ok: false; persisted: false; error: string };
const fail = (error: string): Failure => ({ ok: false, persisted: false, error });
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const dbNumber = (value: unknown): number | null => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value)) ? Number(value) : null;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown, min = 0): value is number => typeof value === "number" && Number.isFinite(value) && value >= min && value <= 9999999999.99;
const only = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every((key) => keys.includes(key));
function errorMessage(code?: string): string {
  if (code?.includes("conflict") || code?.includes("stale")) return "La información cambió mientras editabas. Volvé a cargarla antes de guardar.";
  if (code?.includes("unit_change") || code?.includes("unit_in_use")) return "La unidad de un insumo con movimientos o recetas no se puede cambiar. Creá otro insumo para conservar el historial.";
  if (code?.includes("unit") || code?.includes("quantity")) return "Revisá las cantidades y las unidades de los insumos.";
  if (code?.includes("permission") || code?.includes("forbidden")) return "No tenés permiso para cambiar este catálogo o sucursal.";
  if (code?.includes("not_found") || code?.includes("tenant")) return "No encontramos el producto, insumo, proveedor o sucursal dentro de tu negocio.";
  return "No pudimos guardar los cambios. Revisá los datos e intentá nuevamente.";
}

export const getCatalogDataAction = withPermission<[], { ok: true; data: CatalogData } | Failure>("products.view", async (ctx) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId) return fail("Necesitás un negocio activo para consultar el catálogo.");
  const db = await createSupabaseServerClient() as any;
  if (!db) return fail("No pudimos conectar con tu catálogo.");
  let branchQuery = db.from("branches").select("id,name").eq("business_id", ctx.businessId).order("name");
  if (ctx.assignedBranchIds) branchQuery = branchQuery.in("id", ctx.assignedBranchIds);
  const [ingredients, suppliers, branchResult] = await Promise.all([
    readCatalogRows(db.from("ingredients").select("id,name,unit,avg_unit_cost,active,preferred_supplier_id").eq("business_id", ctx.businessId).order("name").order("id")),
    readCatalogRows(db.from("suppliers").select("id,name").eq("business_id", ctx.businessId).order("name").order("id")), readCatalogRows(branchQuery.order("id")),
  ]);
  if (ingredients.error || suppliers.error || branchResult.error) return fail("No pudimos cargar el catálogo completo. No se muestran datos de ejemplo.");
  const branches = (branchResult.data ?? []) as { id: string; name: string }[];
  const branchIds = branches.map((b) => b.id);
  const ingredientIds = (ingredients.data ?? []).map((i: any) => i.id);
  const stocks = branchIds.length && ingredientIds.length
    ? await readCatalogRows(db.from("stock_items").select("ingredient_id,branch_id,current,min").in("branch_id", branchIds).in("ingredient_id", ingredientIds).order("id"))
    : { data: [], error: null };
  if (stocks.error) return fail("No pudimos cargar el stock y sus mínimos.");
  const branchNames = new Map(branches.map((b) => [b.id, b.name]));
  const rows: IngredientRow[] = (ingredients.data ?? []).map((row: any) => ({
    id: row.id, name: row.name, unit: row.unit, unitCost: dbNumber(row.avg_unit_cost), active: row.active,
    supplierId: row.preferred_supplier_id,
    stock: (stocks.data ?? []).filter((s: any) => s.ingredient_id === row.id).map((s: any) => ({
      branchId: s.branch_id, branchName: branchNames.get(s.branch_id) ?? "", current: Number(s.current), minimum: Number(s.min),
    })),
  }));
  return { ok: true, data: { ingredients: rows, suppliers: suppliers.data ?? [], branches, canEdit: hasPermission(ctx.role, "recipes.edit") } };
});

export const getRecipeAction = withPermission<[string], { ok: true; data: RecipeData } | Failure>("products.view", async (ctx, productId) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !uuid(productId)) return fail("No pudimos identificar el producto.");
  const db = await createSupabaseServerClient() as any;
  if (!db) return fail("No pudimos conectar con tu catálogo.");
  const product = await db.from("products").select("id").eq("id", productId).eq("business_id", ctx.businessId).maybeSingle();
  if (product.error || !product.data) return fail("No encontramos el producto en tu negocio.");
  const recipe = await db.from("recipes").select("id,updated_at").eq("product_id", productId).maybeSingle();
  if (recipe.error) return fail("No pudimos cargar la composición.");
  if (!recipe.data) return { ok: true, data: { productId, recipeId: null, updatedAt: null, items: [] } };
  const items = await db.from("recipe_items").select("ingredient_id,name,quantity,unit").eq("recipe_id", recipe.data.id).order("created_at");
  if (items.error) return fail("No pudimos cargar los ingredientes de la composición.");
  return { ok: true, data: {
    productId, recipeId: recipe.data.id, updatedAt: recipe.data.updated_at,
    items: (items.data ?? []).map((i: any) => ({ ingredientId: i.ingredient_id ?? "", name: i.name, quantity: i.quantity === null ? null : Number(i.quantity), unit: i.unit })),
  } };
});

export const saveRecipeAction = withPermission<[string, RecipeInput], { ok: true; persisted: true; cost: number } | Failure>("recipes.edit", async (ctx, productId, input) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !uuid(productId)) return fail("Necesitás un producto de tu negocio para guardar la composición.");
  if (!record(input) || !only(input, ["expectedUpdatedAt", "items"]) || !Array.isArray(input.items) || input.items.length > 100 ||
    !(input.expectedUpdatedAt === null || (typeof input.expectedUpdatedAt === "string" && Number.isFinite(Date.parse(input.expectedUpdatedAt))))) return fail("La composición no tiene un formato válido.");
  const seen = new Set<string>();
  for (const item of input.items) {
    if (!record(item) || !only(item, ["ingredientId", "quantity", "unit"]) || !uuid(item.ingredientId) || !finite(item.quantity) || item.quantity <= 0 || !normalizeUnit(item.unit) || seen.has(item.ingredientId)) return fail("Revisá los insumos, cantidades y unidades. Cada insumo puede aparecer una sola vez.");
    seen.add(item.ingredientId);
  }
  const db = await createSupabaseServerClient() as any;
  if (!db) return fail("No pudimos conectar con tu catálogo.");
  const result = await db.rpc("save_recipe_atomic", { p_business_id: ctx.businessId, p_product_id: productId, p_expected_updated_at: input.expectedUpdatedAt,
    p_items: input.items.map((i) => ({ ingredientId: i.ingredientId, quantity: i.quantity, unit: normalizeUnit(i.unit) })) });
  if (result.error || !result.data?.ok) return fail(errorMessage(result.error?.message ?? result.data?.error));
  if (dbNumber(result.data.cost) === null || !finite(Number(result.data.cost))) return fail("El guardado no devolvió un costo verificable. Actualizá el catálogo antes de reintentar.");
  revalidatePath("/productos"); revalidatePath("/auditoria");
  return { ok: true, persisted: true, cost: Number(result.data.cost) };
});

export const saveIngredientAction = withPermission<[string | null, IngredientInput], { ok: true; persisted: true; id: string } | Failure>("recipes.edit", async (ctx, id, input) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !(id === null || uuid(id))) return fail("Necesitás un negocio activo para guardar el insumo.");
  if (!record(input) || !only(input, ["name", "unit", "unitCost", "active", "supplierId", "minimums"]) || typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 200 || !normalizeUnit(input.unit) || !finite(input.unitCost) || typeof input.active !== "boolean" || !(input.supplierId === null || uuid(input.supplierId)) || !Array.isArray(input.minimums) || input.minimums.length > 200) return fail("Revisá nombre, unidad, costo y proveedor del insumo.");
  const seen = new Set<string>();
  for (const m of input.minimums) {
    if (!record(m) || !only(m, ["branchId", "minimum"]) || !uuid(m.branchId) || !finite(m.minimum) || seen.has(m.branchId)) return fail("Revisá los mínimos por sucursal.");
    if (ctx.assignedBranchIds && !ctx.assignedBranchIds.includes(m.branchId)) return fail("No tenés acceso a esa sucursal.");
    seen.add(m.branchId);
  }
  const db = await createSupabaseServerClient() as any;
  if (!db) return fail("No pudimos conectar con tu catálogo.");
  const result = await db.rpc("save_ingredient_atomic", { p_business_id: ctx.businessId, p_ingredient_id: id,
    p_input: { ...input, name: input.name.trim(), unit: normalizeUnit(input.unit) } });
  if (result.error || !result.data?.ok || !uuid(result.data?.id)) return fail(errorMessage(result.error?.message ?? result.data?.error));
  revalidatePath("/productos"); revalidatePath("/stock"); revalidatePath("/auditoria");
  return { ok: true, persisted: true, id: result.data.id };
});
