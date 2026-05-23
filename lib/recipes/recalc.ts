/**
 * Motor de recálculo de costos.
 *
 * Cuando cambia el `avg_unit_cost` de un ingrediente (porque entró una
 * nueva compra/factura), recalculamos:
 *   1. El costo de cada producto que tiene una receta con ese
 *      ingrediente → `products.cost`.
 *   2. El margen estimado y, si baja más del threshold, generamos
 *      un `ai_recommendation` para que el operador lo revise.
 *
 * Esta función se llama desde `approveInvoiceAction` luego de
 * insertar los purchase_items y de correr la RPC
 * `recalc_ingredient_cost`.
 */

const MARGIN_ALERT_THRESHOLD_PCT = 5;

export type RecalcSummary = {
  ingredientId: string;
  productsAffected: number;
  recommendationsCreated: number;
  details: {
    productId: string;
    productName: string;
    oldCost: number;
    newCost: number;
    oldMargin: number;
    newMargin: number;
  }[];
};

/**
 * Recalcula recetas y márgenes para todos los productos que usan el
 * ingrediente dado. Si el margen baja más del threshold, crea una
 * recomendación.
 *
 * Usa el supabase admin client (saltea RLS) para poder actualizar y
 * crear recommendations desde server actions.
 */
export async function recalcRecipesForIngredient(
  db: any,
  businessId: string,
  ingredientId: string,
): Promise<RecalcSummary> {
  const summary: RecalcSummary = {
    ingredientId,
    productsAffected: 0,
    recommendationsCreated: 0,
    details: [],
  };

  // 1) Traer ingredient con su nuevo avg_unit_cost.
  const ingRes = await db
    .from("ingredients")
    .select("id, name, avg_unit_cost")
    .eq("id", ingredientId)
    .maybeSingle();
  const ingredient = ingRes.data as
    | { id: string; name: string; avg_unit_cost: number }
    | null;
  if (!ingredient) return summary;

  // 2) Recetas que contienen este ingrediente.
  const riRes = await db
    .from("recipe_items")
    .select("id, recipe_id, ingredient_id, qty, unit_cost")
    .eq("ingredient_id", ingredientId);
  const recipeItems =
    (riRes.data as
      | { id: string; recipe_id: string; ingredient_id: string; qty: string; unit_cost: number }[]
      | null) ?? [];
  if (recipeItems.length === 0) return summary;

  // 3) Recetas únicas → producto asociado.
  const recipeIds = [...new Set(recipeItems.map((ri) => ri.recipe_id))];
  const recipesRes = await db
    .from("recipes")
    .select("id, product_id")
    .in("id", recipeIds);
  const recipes =
    (recipesRes.data as { id: string; product_id: string }[] | null) ?? [];

  // 4) Por cada producto: recalcular costo total = suma de
  //    recipe_items.unit_cost (que actualizamos al nuevo precio del
  //    ingredient).
  const productIds = recipes.map((r) => r.product_id);
  const productsRes = await db
    .from("products")
    .select("id, name, price, cost, business_id")
    .in("id", productIds);
  const products =
    (productsRes.data as
      | { id: string; name: string; price: number; cost: number; business_id: string }[]
      | null) ?? [];

  // 5) Update recipe_items.unit_cost de las filas afectadas con el
  //    nuevo precio del ingrediente. (Usamos el precio promedio
  //    como proxy del costo unitario por kg/u del insumo.)
  await db
    .from("recipe_items")
    .update({ unit_cost: ingredient.avg_unit_cost })
    .eq("ingredient_id", ingredientId);

  // 6) Para cada producto afectado, sumar todos sus recipe_items y
  //    actualizar products.cost.
  for (const product of products) {
    const recipe = recipes.find((r) => r.product_id === product.id);
    if (!recipe) continue;

    const allItemsRes = await db
      .from("recipe_items")
      .select("unit_cost")
      .eq("recipe_id", recipe.id);
    const allItems = (allItemsRes.data as { unit_cost: number }[] | null) ?? [];
    const newCost = allItems.reduce((s, ri) => s + Number(ri.unit_cost ?? 0), 0);

    const oldMargin =
      product.price > 0 ? ((product.price - Number(product.cost)) / product.price) * 100 : 0;
    const newMargin =
      product.price > 0 ? ((product.price - newCost) / product.price) * 100 : 0;
    const marginDeltaPct = oldMargin - newMargin;

    await db
      .from("products")
      .update({ cost: newCost })
      .eq("id", product.id);

    summary.details.push({
      productId: product.id,
      productName: product.name,
      oldCost: Number(product.cost),
      newCost,
      oldMargin,
      newMargin,
    });
    summary.productsAffected++;

    // 7) Si el margen bajó > threshold, generar recomendación IA.
    if (marginDeltaPct >= MARGIN_ALERT_THRESHOLD_PCT) {
      const suggestedPrice = Math.round(newCost / (oldMargin / 100));
      await db.from("ai_recommendations").insert({
        business_id: businessId,
        area: "product",
        priority: marginDeltaPct >= 8 ? "high" : "medium",
        title: `${product.name} perdió ${marginDeltaPct.toFixed(1)}% de margen`,
        detail: `El aumento de ${ingredient.name} llevó el costo de $${product.cost.toLocaleString("es-AR")} a $${newCost.toLocaleString("es-AR")}. Subir el precio a $${suggestedPrice.toLocaleString("es-AR")} recupera el margen original.`,
        estimated_impact: Math.round((suggestedPrice - product.price) * 50), // proxy: 50 ventas/mes
        confidence: 0.85,
        status: "open",
      });
      summary.recommendationsCreated++;
    }
  }

  return summary;
}
