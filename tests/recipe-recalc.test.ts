import assert from "node:assert/strict";
import test from "node:test";
import { calculateRecipeCost } from "../lib/recipes/quantities";
import { recalcRecipesForIngredient } from "../lib/recipes/recalc";

type Ingredient = { id: string; business_id: string; unit: string; avg_unit_cost: number };
type Product = { id: string; business_id: string; name: string; price: number; cost: number };
type Item = { id: string; recipe_id: string; ingredient_id: string | null; quantity: unknown; unit: unknown; qty?: string; unit_cost?: number };
type Records = {
  ingredients: Ingredient[];
  products: Product[];
  recipes: { id: string; product_id: string }[];
  recipe_items: Item[];
};
type Result = { data: unknown; error: { message: string } | null; count?: number | null };
type Query = { table: string; select: string; filters: [string, unknown][] };
type Options = {
  failRead?: string;
  throwRead?: string;
  count?: number | null;
  injectForeignRow?: boolean;
  rpcResults?: Record<string, Result>;
  throwRpc?: boolean;
  beforeRpc?: (records: Records) => void;
};

function fixtures(): Records {
  return {
    ingredients: [
      { id: "meat-a", business_id: "business-a", unit: "kg", avg_unit_cost: 8500 },
      { id: "bread-a", business_id: "business-a", unit: "unit", avg_unit_cost: 250 },
      { id: "foreign-b", business_id: "business-b", unit: "kg", avg_unit_cost: 999 },
    ],
    products: [
      { id: "burger-a", business_id: "business-a", name: "Hamburguesa", price: 4000, cost: 1000 },
      { id: "product-b", business_id: "business-b", name: "Otro negocio", price: 9000, cost: 5000 },
    ],
    recipes: [{ id: "recipe-a", product_id: "burger-a" }, { id: "recipe-b", product_id: "product-b" }],
    recipe_items: [
      { id: "meat-line", recipe_id: "recipe-a", ingredient_id: "meat-a", quantity: 180, unit: "g", unit_cost: 1 },
      { id: "bread-line", recipe_id: "recipe-a", ingredient_id: "bread-a", quantity: 2, unit: "unit", unit_cost: 1 },
      // Deliberately corrupt cross-tenant link: an admin client can see it, but
      // this ingredient recalculation must never discover the other business.
      { id: "foreign-line", recipe_id: "recipe-b", ingredient_id: "meat-a", quantity: 1, unit: "kg", unit_cost: 1 },
    ],
  };
}

/** Admin-style fake: no implicit RLS. Filtering must be supplied by the helper. */
function fakeDb(records = fixtures(), options: Options = {}) {
  const queries: Query[] = [];
  const calls: { name: string; args: { p_business_id: string; p_product_id: string } }[] = [];
  const updates: { productId: string; cost: number }[] = [];

  const db = {
    from(table: string) {
      const query: Query = { table, select: "", filters: [] };
      queries.push(query);
      const result = (): Result => {
        if (options.throwRead === table) throw new Error("network unavailable");
        if (options.failRead === table) return { data: null, error: { message: "database unavailable" } };
        if (table === "ingredients") {
          return { data: records.ingredients.filter((row) => query.filters.every(([column, value]) => row[column as keyof Ingredient] === value)), error: null };
        }
        assert.equal(table, "recipe_items", "The helper should use the atomic RPC rather than writing recipe costs itself");
        assert.match(query.select, /recipes!inner/);
        assert.match(query.select, /products!inner/);
        const rows = records.recipe_items.flatMap((item) => {
          const recipe = records.recipes.find((row) => row.id === item.recipe_id);
          const product = records.products.find((row) => row.id === recipe?.product_id);
          if (!recipe || !product) return [];
          return [{ ...item, recipes: { ...recipe, products: { id: product.id, business_id: product.business_id } } }];
        }).filter((row) => query.filters.every(([column, value]) => {
          if (column === "recipes.products.business_id") return options.injectForeignRow || row.recipes.products.business_id === value;
          return row[column as keyof typeof row] === value;
        }));
        return { data: rows, error: null, count: "count" in options ? options.count : rows.length };
      };
      const builder = {
        select(columns: string, opts?: { count: string }) {
          query.select = columns;
          if (table === "recipe_items") assert.equal(opts?.count, "exact");
          return builder;
        },
        eq(column: string, value: unknown) { query.filters.push([column, value]); return builder; },
        async maybeSingle() {
          const response = result();
          return { ...response, data: Array.isArray(response.data) ? response.data[0] ?? null : response.data };
        },
        then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve().then(result).then(resolve, reject);
        },
        update() { throw new Error("Direct writes bypass the authoritative transactional recalc RPC"); },
        insert() { throw new Error("No fabricated AI recommendation may be inserted"); },
      };
      return builder;
    },
    async rpc(name: string, args: { p_business_id: string; p_product_id: string }): Promise<Result> {
      calls.push({ name, args });
      assert.equal(name, "recalc_product_recipe_cost");
      if (options.throwRpc) throw new Error("connection lost");
      if (options.rpcResults?.[args.p_product_id]) return options.rpcResults[args.p_product_id];
      options.beforeRpc?.(records);
      // Model the RPC contract for wrapper tests. Transaction/authorization SQL
      // is tested separately; there is deliberately no JS persistence fallback.
      const product = records.products.find((row) => row.id === args.p_product_id && row.business_id === args.p_business_id);
      if (!product) return { data: { ok: false, error: "product_not_found" }, error: null };
      const recipe = records.recipes.find((row) => row.product_id === product.id);
      if (!recipe) return { data: { ok: false, error: "recipe_not_found" }, error: null };
      const lines = records.recipe_items.filter((row) => row.recipe_id === recipe.id);
      if (!lines.length) return { data: { ok: false, error: "recipe_empty" }, error: null };
      let newCost: number;
      try {
        newCost = calculateRecipeCost(lines.map((line) => ({
          quantity: line.quantity,
          unit: line.unit,
          ingredient: records.ingredients.find((row) => row.id === line.ingredient_id && row.business_id === args.p_business_id),
        })));
      } catch {
        return { data: { ok: false, error: "recipe_incomplete" }, error: null };
      }
      const oldCost = product.cost;
      const updated = oldCost !== newCost;
      if (updated) {
        product.cost = newCost;
        updates.push({ productId: product.id, cost: newCost });
      }
      return { data: { ok: true, product_id: product.id, product_name: product.name, old_cost: oldCost, new_cost: newCost, price: product.price, updated }, error: null };
    },
  };
  return { db, records, queries, calls, updates };
}

test("recipe recalc dispatches one tenant-bound atomic update with quantity-based costs", async () => {
  const fake = fakeDb();
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.deepEqual(fake.calls, [{ name: "recalc_product_recipe_cost", args: { p_business_id: "business-a", p_product_id: "burger-a" } }]);
  assert.deepEqual(fake.updates, [{ productId: "burger-a", cost: 2030 }]);
  assert.equal(fake.records.products[1].cost, 5000);
  assert.equal(summary.productsAffected, 1);
  assert.equal(summary.productsSkipped, 0);
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(summary.details, [{ productId: "burger-a", productName: "Hamburguesa", oldCost: 1000, newCost: 2030, oldMargin: 75, newMargin: 49.25 }]);
  assert.deepEqual(fake.queries[0].filters, [["business_id", "business-a"], ["id", "meat-a"]]);
  assert.deepEqual(fake.queries[1].filters, [["ingredient_id", "meat-a"], ["recipes.products.business_id", "business-a"]]);
});

test("recipe verification never claims historical margin alerts or fabricated sales impact", async () => {
  const fake = fakeDb();
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.equal(summary.recommendationsCreated, 0);
  assert.equal(summary.phase, "post_write_verification");
  assert.equal("marginAlerts" in summary, false);
  assert.ok(fake.queries.every((query) => query.table !== "ai_recommendations"));
  assert.doesNotMatch(JSON.stringify(summary), /estimated_impact|confidence|suggestedPrice/);
});

test("recipe recalc refuses another tenant's ingredient, even with an admin-style client", async () => {
  const fake = fakeDb();
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "foreign-b");
  assert.equal(summary.errors[0].code, "ingredient_unavailable");
  assert.equal(fake.queries.length, 1);
  assert.deepEqual(fake.calls, []);
  assert.deepEqual(fake.updates, []);
});

test("recipe recalc defensively rejects returned cross-tenant recipe rows", async () => {
  const fake = fakeDb(fixtures(), { injectForeignRow: true });
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.equal(summary.errors[0].code, "recipe_scope_mismatch");
  assert.deepEqual(fake.calls, []);
});

test("recipe recalc never writes a cost when a composition references a foreign ingredient", async () => {
  const records = fixtures();
  records.recipe_items[1].ingredient_id = "foreign-b";
  const fake = fakeDb(records);
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.equal(summary.errors[0].code, "recipe_incomplete");
  assert.equal(summary.productsSkipped, 1);
  assert.equal(summary.productsAffected, 0);
  assert.equal(records.products[0].cost, 1000);
  assert.deepEqual(fake.updates, []);
});

test("recipe recalc leaves legacy, malformed, deleted and incompatible lines unchanged", async () => {
  for (const patch of [
    { quantity: null, unit: null, qty: "180 g" },
    { quantity: NaN },
    { quantity: 0 },
    { quantity: -2 },
    { quantity: 180, unit: "ml" },
    { ingredient_id: null },
  ]) {
    const records = fixtures();
    Object.assign(records.recipe_items[1], patch);
    const fake = fakeDb(records);
    const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
    assert.equal(summary.errors[0].code, "recipe_incomplete");
    assert.equal(records.products[0].cost, 1000);
    assert.deepEqual(fake.updates, []);
  }
});

test("recipe recalc exposes database read errors without zeroing existing product costs", async () => {
  for (const table of ["ingredients", "recipe_items"]) {
    for (const mode of ["failRead", "throwRead"] as const) {
      const fake = fakeDb(fixtures(), { [mode]: table });
      const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
      assert.equal(summary.errors[0].code, table === "ingredients" ? "ingredient_read_failed" : "recipe_lookup_failed");
      assert.deepEqual(fake.calls, []);
      assert.deepEqual(fake.updates, []);
      assert.equal(fake.records.products[0].cost, 1000);
    }
  }
});

test("recipe recalc detects incomplete or uncounted lookup responses", async () => {
  for (const count of [null, 2]) {
    const fake = fakeDb(fixtures(), { count });
    const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
    assert.equal(summary.errors[0].code, "recipe_lookup_incomplete");
    assert.deepEqual(fake.calls, []);
  }
});

test("recipe recalc confirms only successful RPC results and never falls back to direct writes", async () => {
  const cases: [Options, string][] = [
    [{ throwRpc: true }, "product_recalc_failed"],
    [{ rpcResults: { "burger-a": { data: null, error: { message: "write failed" } } } }, "product_recalc_failed"],
    [{ rpcResults: { "burger-a": { data: { ok: false, error: "recipe_empty" }, error: null } } }, "recipe_empty"],
    [{ rpcResults: { "burger-a": { data: null, error: null } } }, "product_recalc_unconfirmed"],
    [{ rpcResults: { "burger-a": { data: { ok: true, product_id: "foreign-product", updated: true }, error: null } } }, "product_recalc_unconfirmed"],
    [{ rpcResults: { "burger-a": { data: { ok: true, product_id: "burger-a", product_name: "Hamburguesa", updated: true, old_cost: 1000, new_cost: null, price: 4000 }, error: null } } }, "invalid_cost"],
  ];
  for (const [options, code] of cases) {
    const fake = fakeDb(fixtures(), options);
    const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
    assert.equal(summary.errors[0].code, code);
    assert.equal(summary.productsSkipped, 1);
    assert.equal(summary.productsAffected, 0);
    assert.deepEqual(summary.details, []);
    assert.deepEqual(fake.updates, []);
  }
});

test("recipe recalc is idempotent and deduplicates repeated ingredient lines per product", async () => {
  const records = fixtures();
  records.recipe_items.push({ ...records.recipe_items[0], id: "second-meat-line", quantity: 20 });
  const fake = fakeDb(records);
  const first = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  const second = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.equal(first.productsAffected, 1);
  assert.equal(first.details[0].newCost, 2200);
  assert.equal(second.productsAffected, 0);
  assert.equal("marginAlerts" in second, false);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.updates.length, 1);
});

test("recipe recalc uses the RPC's current cost rather than stale discovery data", async () => {
  const fake = fakeDb(fixtures(), { beforeRpc(records) { records.ingredients[0].avg_unit_cost = 10000; } });
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.equal(summary.details[0].newCost, 2300);
});

test("recipe recalc keeps a zero-price product's margin undefined", async () => {
  const records = fixtures();
  records.products[0].price = 0;
  const fake = fakeDb(records);
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.equal(summary.details[0].oldMargin, null);
  assert.equal(summary.details[0].newMargin, null);
  assert.equal("marginAlerts" in summary, false);
});

test("recipe recalc continues unrelated products when one recipe is incomplete", async () => {
  const records = fixtures();
  records.products.push({ id: "second-a", business_id: "business-a", name: "Medallón", price: 2500, cost: 500 });
  records.recipes.push({ id: "second-recipe", product_id: "second-a" });
  records.recipe_items.push({ id: "second-line", recipe_id: "second-recipe", ingredient_id: "meat-a", quantity: 100, unit: "g" });
  records.recipe_items[1].quantity = null;
  const fake = fakeDb(records);
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.equal(summary.productsSkipped, 1);
  assert.equal(summary.productsAffected, 1);
  assert.equal(summary.errors[0].productId, "burger-a");
  assert.deepEqual(fake.updates, [{ productId: "second-a", cost: 850 }]);
});

test("recipe recalc validates required scope and handles an ingredient with no recipe", async () => {
  const fake = fakeDb();
  for (const [business, ingredient] of [["", "meat-a"], ["business-a", ""]]) {
    assert.equal((await recalcRecipesForIngredient(fake.db, business, ingredient)).errors[0].code, "invalid_scope");
  }
  assert.deepEqual(fake.queries, []);
  fake.records.recipe_items = [];
  const summary = await recalcRecipesForIngredient(fake.db, "business-a", "meat-a");
  assert.deepEqual(summary.errors, []);
  assert.equal(summary.productsAffected, 0);
  assert.deepEqual(fake.calls, []);
});
