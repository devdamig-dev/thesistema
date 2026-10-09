/** Quantities are explicit. Legacy `qty` descriptions are never parsed here. */
export const RECIPE_UNITS = ["unit", "kg", "g", "l", "ml"] as const;
export type CanonicalUnit = (typeof RECIPE_UNITS)[number];

export type RecipeCalculationErrorCode =
  | "invalid_quantity"
  | "invalid_unit"
  | "incompatible_units"
  | "invalid_cost"
  | "invalid_price"
  | "missing_ingredient"
  | "empty_recipe"
  | "calculation_overflow";

export class RecipeCalculationError extends Error {
  constructor(public readonly code: RecipeCalculationErrorCode, message: string) {
    super(message);
    this.name = "RecipeCalculationError";
  }
}

const UNIT_DEFINITIONS: Record<CanonicalUnit, { dimension: string; factor: number }> = {
  unit: { dimension: "count", factor: 1 },
  kg: { dimension: "mass", factor: 1000 },
  g: { dimension: "mass", factor: 1 },
  l: { dimension: "volume", factor: 1000 },
  ml: { dimension: "volume", factor: 1 },
};

/** Only documented aliases are accepted; a slice/portion has no implicit weight. */
export function normalizeUnit(input: unknown): CanonicalUnit | null {
  if (typeof input !== "string") return null;
  const value = input.trim().toLowerCase();
  if (value === "u" || value === "unidad" || value === "unidades") return "unit";
  return (RECIPE_UNITS as readonly string[]).includes(value) ? value as CanonicalUnit : null;
}

function numberValue(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  // Postgres numeric values may be strings. Never coerce an empty/null/boolean
  // value, localized thousands separator or quantity description to a number.
  if (typeof input !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input.trim())) return null;
  const value = Number(input.trim());
  return Number.isFinite(value) ? value : null;
}

function finiteResult(value: number): number {
  if (!Number.isFinite(value)) {
    throw new RecipeCalculationError("calculation_overflow", "El cálculo excede el rango numérico permitido.");
  }
  return value;
}

function nonNegativeNumber(input: unknown, code: "invalid_cost" | "invalid_price"): number {
  const value = numberValue(input);
  if (value === null || value < 0) {
    throw new RecipeCalculationError(code, code === "invalid_cost"
      ? "El costo debe ser un número finito mayor o igual a cero."
      : "El precio debe ser un número finito mayor o igual a cero.");
  }
  return value;
}

/** Converts only within count, mass or volume, preserving fractional quantities. */
export function convertQuantity(quantity: unknown, fromUnit: unknown, toUnit: unknown): number {
  const amount = numberValue(quantity);
  if (amount === null || amount <= 0) {
    throw new RecipeCalculationError("invalid_quantity", "La cantidad debe ser un número finito mayor que cero.");
  }
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!from || !to) {
    throw new RecipeCalculationError("invalid_unit", "La unidad debe ser unidad, kg, g, l o ml.");
  }
  if (UNIT_DEFINITIONS[from].dimension !== UNIT_DEFINITIONS[to].dimension) {
    throw new RecipeCalculationError("incompatible_units", "La unidad de la receta no es compatible con la unidad base del insumo.");
  }
  const converted = finiteResult(amount * (UNIT_DEFINITIONS[from].factor / UNIT_DEFINITIONS[to].factor));
  if (converted <= 0) {
    throw new RecipeCalculationError("invalid_quantity", "La cantidad es demasiado pequeña para calcularse de forma fiable.");
  }
  return converted;
}

/** Ingredient cost is per ingredient base unit, never per line or display `qty`. */
export function calculateIngredientCost(
  quantity: unknown,
  recipeUnit: unknown,
  ingredientUnit: unknown,
  avgUnitCost: unknown,
): number {
  const converted = convertQuantity(quantity, recipeUnit, ingredientUnit);
  return finiteResult(converted * nonNegativeNumber(avgUnitCost, "invalid_cost"));
}

export type RecipeCostItem = {
  quantity: unknown;
  unit: unknown;
  ingredient: { unit: unknown; avg_unit_cost: unknown } | null | undefined;
};

/** Round the complete recipe once, keeping sub-cent ingredient costs intact. */
export function calculateRecipeCost(items: readonly RecipeCostItem[]): number {
  if (items.length === 0) {
    throw new RecipeCalculationError("empty_recipe", "La receta no tiene insumos para calcular su costo.");
  }
  let total = 0;
  for (const item of items) {
    if (!item.ingredient) {
      throw new RecipeCalculationError("missing_ingredient", "Falta un insumo de la receta o no pertenece al negocio.");
    }
    total = finiteResult(total + calculateIngredientCost(
      item.quantity, item.unit, item.ingredient.unit, item.ingredient.avg_unit_cost,
    ));
  }
  return finiteResult(Math.round((total + Number.EPSILON * Math.max(1, total)) * 100) / 100);
}

/** Gross margin percentage; a zero sale price has no defined gross margin. */
export function calculateGrossMargin(price: unknown, cost: unknown): number | null {
  const salePrice = nonNegativeNumber(price, "invalid_price");
  const productCost = nonNegativeNumber(cost, "invalid_cost");
  if (salePrice === 0) return null;
  return finiteResult(((salePrice - productCost) / salePrice) * 100);
}
