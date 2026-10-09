import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateGrossMargin,
  calculateIngredientCost,
  calculateRecipeCost,
  convertQuantity,
  normalizeUnit,
  RecipeCalculationError,
  type RecipeCalculationErrorCode,
} from "../lib/recipes/quantities";

function throwsCode(callback: () => unknown, code: RecipeCalculationErrorCode) {
  assert.throws(callback, (error: unknown) => error instanceof RecipeCalculationError && error.code === code);
}

test("recipe units normalize only canonical units and documented count aliases", () => {
  for (const unit of ["unit", "u", "unidad", "unidades", " UNIDADES "]) assert.equal(normalizeUnit(unit), "unit");
  for (const unit of ["kg", "g", "l", "ml"] as const) assert.equal(normalizeUnit(` ${unit.toUpperCase()} `), unit);
  for (const unit of ["feta", "feto", "porcion", "porción", "pack", "caja", "oz", "kilos", "litros", "", null, undefined, 1, true]) {
    assert.equal(normalizeUnit(unit), null);
  }
});

test("recipe quantities convert grams and kilograms in both directions", () => {
  assert.equal(convertQuantity(180, "g", "kg"), 0.18);
  assert.equal(convertQuantity("0.18", "kg", "g"), 180);
  assert.equal(convertQuantity(1250, "g", "kg"), 1.25);
  assert.equal(convertQuantity(2, "unidad", "unit"), 2);
});

test("recipe quantities convert milliliters and liters in both directions", () => {
  assert.equal(convertQuantity(250, "ml", "l"), 0.25);
  assert.equal(convertQuantity("1.5", "l", "ml"), 1500);
  assert.equal(convertQuantity(0.5, "l", "l"), 0.5);
});

test("recipe quantities never invent density or portion and package equivalences", () => {
  for (const [from, to] of [["kg", "l"], ["ml", "g"], ["unit", "kg"], ["l", "unidad"]]) {
    throwsCode(() => convertQuantity(1, from, to), "incompatible_units");
  }
  for (const unit of ["feta", "porcion", "caja", null, ""]) {
    throwsCode(() => convertQuantity(1, unit, "unit"), "invalid_unit");
  }
});

test("recipe quantities reject zero, negatives, NaN, infinity and coercion traps", () => {
  for (const quantity of [0, -1, NaN, Infinity, -Infinity, "NaN", "Infinity", "", " ", null, undefined, true, false, [], {}, "180 g", "1,5", "0x10", "1e3"]) {
    throwsCode(() => convertQuantity(quantity, "g", "kg"), "invalid_quantity");
  }
  throwsCode(() => convertQuantity(Number.MAX_VALUE, "kg", "g"), "calculation_overflow");
  throwsCode(() => convertQuantity(Number.MIN_VALUE, "g", "kg"), "invalid_quantity");
});

test("ingredient costs multiply actual quantity in the ingredient base unit", () => {
  assert.equal(calculateIngredientCost(180, "g", "kg", 8500), 1530);
  assert.equal(calculateIngredientCost(250, "ml", "l", 1200), 300);
  assert.equal(calculateIngredientCost(2, "unidad", "unit", "150.50"), 301);
  assert.equal(calculateIngredientCost(0.5, "kg", "g", 8), 4000);
  assert.equal(calculateIngredientCost(1, "unit", "unit", 0), 0);
});

test("missing or invalid ingredient cost is never coerced into free stock", () => {
  for (const cost of [null, undefined, "", " ", false, NaN, Infinity, -1, "1200 pesos", "1,200"]) {
    throwsCode(() => calculateIngredientCost(1, "unit", "unit", cost), "invalid_cost");
  }
  throwsCode(() => calculateIngredientCost(Number.MAX_VALUE, "unit", "unit", 2), "calculation_overflow");
});

test("recipe cost includes all quantified ingredient contributions", () => {
  assert.equal(calculateRecipeCost([
    { quantity: 1, unit: "unit", ingredient: { unit: "u", avg_unit_cost: 250 } },
    { quantity: 180, unit: "g", ingredient: { unit: "kg", avg_unit_cost: 8500 } },
    { quantity: 30, unit: "g", ingredient: { unit: "kg", avg_unit_cost: 2000 } },
  ]), 1840);
});

test("recipe cost rounds only the aggregate to cents", () => {
  assert.equal(calculateRecipeCost([
    { quantity: 1, unit: "g", ingredient: { unit: "kg", avg_unit_cost: 5 } },
    { quantity: 1, unit: "g", ingredient: { unit: "kg", avg_unit_cost: 5 } },
  ]), 0.01);
  assert.equal(calculateRecipeCost([
    { quantity: 1, unit: "unit", ingredient: { unit: "unit", avg_unit_cost: 1.005 } },
  ]), 1.01);
});

test("empty, deleted and legacy untyped recipe lines fail closed", () => {
  throwsCode(() => calculateRecipeCost([]), "empty_recipe");
  throwsCode(() => calculateRecipeCost([{ quantity: 1, unit: "unit", ingredient: null }]), "missing_ingredient");
  const legacy = { qty: "180 g", quantity: null, unit: null, ingredient: { unit: "kg", avg_unit_cost: 8500 } };
  throwsCode(() => calculateRecipeCost([legacy]), "invalid_quantity");
  throwsCode(() => calculateRecipeCost([{ ...legacy, quantity: 180 }]), "invalid_unit");
});

test("gross margin compares cost with selling price, not markup", () => {
  assert.equal(calculateGrossMargin(100, 40), 60);
  assert.equal(calculateGrossMargin("100", "120"), -20);
  assert.equal(calculateGrossMargin(100, 0), 100);
  assert.equal(calculateGrossMargin(0, 40), null);
  assert.equal(calculateGrossMargin(0, 0), null);
  for (const price of [NaN, Infinity, -1, null, "", true]) throwsCode(() => calculateGrossMargin(price, 10), "invalid_price");
  throwsCode(() => calculateGrossMargin(100, null), "invalid_cost");
});
