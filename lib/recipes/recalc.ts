import { calculateGrossMargin, RecipeCalculationError } from "./quantities";

export type RecalcIssue = {
  code: string;
  message: string;
  productId?: string;
  recipeId?: string;
};

export type RecalcSummary = {
  phase: "post_write_verification";
  ingredientId: string;
  /** Repairs performed by this verification only; not the impact of the prior invoice. */
  productsAffected: number;
  /** Retained for invoice callers. Unsupported revenue estimates are not persisted. */
  recommendationsCreated: number;
  productsSkipped: number;
  errors: RecalcIssue[];
  details: {
    productId: string;
    productName: string;
    oldCost: number;
    newCost: number;
    oldMargin: number | null;
    newMargin: number | null;
  }[];
};

type AffectedItem = {
  recipe_id: string;
  ingredient_id: string;
  recipes: { id: string; product_id: string; products: { id: string; business_id: string } };
};

type RecalcRpcResult = {
  ok: boolean;
  error?: string;
  product_id?: string;
  product_name?: string;
  old_cost?: unknown;
  new_cost?: unknown;
  price?: unknown;
  updated?: boolean;
};

type QueryResult = { data: unknown; error: { message?: string } | null; count?: number | null };

class RecalcError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "RecalcError";
  }
}

const RPC_ERROR_MESSAGES: Record<string, string> = {
  recipe_incomplete: "La receta tiene cantidades, unidades o insumos incompletos; se conservó el costo anterior.",
  recipe_empty: "La receta está vacía; se conservó el costo anterior.",
  recipe_not_found: "El producto no tiene una receta disponible para recalcular.",
  product_not_found: "El producto no está disponible en este negocio.",
  ingredient_not_found: "Un insumo de la receta no está disponible en este negocio.",
  forbidden: "No tenés permiso para recalcular los costos de este negocio.",
};

async function readResult(query: PromiseLike<QueryResult>, code: string): Promise<QueryResult> {
  let result: QueryResult;
  try {
    result = await query;
  } catch {
    throw new RecalcError(code, "No se pudo confirmar la operación de costos en la base de datos.");
  }
  if (result.error) throw new RecalcError(code, result.error.message ?? "Falló la operación de costos.");
  return result;
}

function issue(error: unknown, context: { productId?: string; recipeId?: string } = {}): RecalcIssue {
  if (error instanceof RecipeCalculationError || error instanceof RecalcError) {
    return { code: error.code, message: error.message, ...context };
  }
  return { code: "recalc_failed", message: "No se pudo confirmar el recálculo del costo.", ...context };
}

/**
 * Discover affected recipes with explicit tenant filters, even for admin clients.
 * The shared transactional RPC validates the entire recipe, verifies ingredient
 * ownership, and locks/reprices the product using current ingredient base costs.
 * No read failure or incomplete legacy quantity is converted into a zero cost.
 *
 * Ingredient triggers already updated typed recipes before this verification.
 * Its before/after values describe repairs here, never the prior invoice delta.
 * It does not report margin alerts, revenue impact or confidence.
 */
export async function recalcRecipesForIngredient(
  db: any,
  businessId: string,
  ingredientId: string,
): Promise<RecalcSummary> {
  const summary: RecalcSummary = {
    phase: "post_write_verification",
    ingredientId,
    productsAffected: 0,
    recommendationsCreated: 0,
    productsSkipped: 0,
    errors: [],
    details: [],
  };
  if (!businessId || !ingredientId) {
    summary.errors.push({ code: "invalid_scope", message: "Falta el negocio o el insumo a recalcular." });
    return summary;
  }

  let items: AffectedItem[];
  try {
    const ingredientResult = await readResult(db.from("ingredients")
      .select("id, business_id")
      .eq("business_id", businessId).eq("id", ingredientId).maybeSingle(), "ingredient_read_failed");
    const ingredient = ingredientResult.data as { id: string; business_id: string } | null;
    if (!ingredient || ingredient.id !== ingredientId || ingredient.business_id !== businessId) {
      throw new RecalcError("ingredient_unavailable", "El insumo no está disponible en este negocio.");
    }

    const affected = await readResult(db.from("recipe_items")
      .select("recipe_id, ingredient_id, recipes!inner(id, product_id, products!inner(id, business_id))", { count: "exact" })
      .eq("ingredient_id", ingredientId)
      .eq("recipes.products.business_id", businessId), "recipe_lookup_failed");
    // An API row limit can truncate a successful query. Do not report partial
    // discovery as a complete recalculation of all affected recipes.
    if (!Array.isArray(affected.data) || affected.count !== affected.data.length) {
      throw new RecalcError("recipe_lookup_incomplete", "No se pudo leer la lista completa de recetas afectadas.");
    }
    items = affected.data as AffectedItem[];
    if (items.some((item) => item.ingredient_id !== ingredientId || !item.recipe_id ||
      item.recipes?.id !== item.recipe_id || !item.recipes.product_id ||
      item.recipes.products?.id !== item.recipes.product_id || item.recipes.products.business_id !== businessId)) {
      throw new RecalcError("recipe_scope_mismatch", "No se pudo verificar que las recetas pertenezcan a este negocio.");
    }
  } catch (error) {
    summary.errors.push(issue(error));
    return summary;
  }

  const recipesByProduct = new Map(items.map((item) => [item.recipes.product_id, item.recipe_id]));
  for (const [productId, recipeId] of recipesByProduct) {
    try {
      const result = await readResult(db.rpc("recalc_product_recipe_cost", {
        p_business_id: businessId,
        p_product_id: productId,
      }), "product_recalc_failed");
      const recalculated = result.data as RecalcRpcResult | null;
      if (!recalculated || recalculated.ok !== true) {
        const code = typeof recalculated?.error === "string" ? recalculated.error : "product_recalc_unconfirmed";
        throw new RecalcError(code, RPC_ERROR_MESSAGES[code] ?? "No se pudo completar el recálculo del producto.");
      }
      if (recalculated.product_id !== productId || typeof recalculated.product_name !== "string" ||
        typeof recalculated.updated !== "boolean") {
        throw new RecalcError("product_recalc_unconfirmed", "La base de datos no confirmó el resultado del producto esperado.");
      }
      const oldMargin = calculateGrossMargin(recalculated.price, recalculated.old_cost);
      const newMargin = calculateGrossMargin(recalculated.price, recalculated.new_cost);
      if (recalculated.updated) summary.productsAffected++;
      summary.details.push({
        productId,
        productName: recalculated.product_name,
        oldCost: Number(recalculated.old_cost),
        newCost: Number(recalculated.new_cost),
        oldMargin,
        newMargin,
      });

    } catch (error) {
      summary.productsSkipped++;
      summary.errors.push(issue(error, { productId, recipeId }));
    }
  }
  return summary;
}
