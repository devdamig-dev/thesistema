import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { hasPermission } from "../lib/permissions";

const businessId = "a0000000-0000-4000-8000-000000000001";
const productId = "b0000000-0000-4000-8000-000000000001";
const ingredientId = "c0000000-0000-4000-8000-000000000001";
const branchId = "d0000000-0000-4000-8000-000000000001";
const recipeId = "e0000000-0000-4000-8000-000000000001";
const otherId = "f0000000-0000-4000-8000-000000000001";
const state = { role: "owner", authenticated: true, database: true, businessId: businessId as string | null, branches: null as string[] | null, failTable: "", rpcError: "", queries: [] as any[], rpcs: [] as any[] };
const context = () => ({ role: state.role, isAuthenticated: state.authenticated, businessId: state.businessId, userId: "actor", assignedBranchIds: state.branches });
function db() {
  return {
    from(table: string) {
      const q = { table, filters: {} as Record<string, unknown> }; state.queries.push(q);
      const query: any = {
        select() { return query; }, range() { return query; }, eq(k: string, v: unknown) { q.filters[k] = v; return query; },
        in(k: string, v: unknown) { q.filters[k] = v; return query; }, order() { return query; },
        result(single = false) {
          if (state.failTable === table) return { data: null, error: { message: "read_failed" } };
          let rows: any[] = [];
          if (table === "products" && q.filters.id === productId && q.filters.business_id === businessId) rows = [{ id: productId }];
          if (table === "recipes" && q.filters.product_id === productId) rows = [{ id: recipeId, updated_at: "2026-10-09T00:00:00Z" }];
          if (table === "recipe_items" && q.filters.recipe_id === recipeId) rows = [{ ingredient_id: ingredientId, quantity: null, unit: null, name: "Legacy" }];
          if (table === "branches" && q.filters.business_id === businessId) rows = [{ id: branchId, name: "Sucursal" }];
          if (table === "ingredients" && q.filters.business_id === businessId) rows = [{ id: ingredientId, name: "Harina", unit: "kg", avg_unit_cost: 1000, active: true, preferred_supplier_id: null }];
          return { data: single ? rows[0] ?? null : rows, error: null };
        },
        async maybeSingle() { return query.result(true); },
        then(resolve: any) { return Promise.resolve(query.result()).then(resolve); },
      };
      return query;
    },
    async rpc(name: string, args: unknown) {
      state.rpcs.push({ name, args });
      if (state.rpcError) return { data: { ok: false, error: state.rpcError }, error: null };
      return { data: name === "save_recipe_atomic" ? { ok: true, cost: 250 } : { ok: true, id: ingredientId }, error: null };
    },
  };
}
const loader = Module as any; const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "next/cache": { revalidatePath() {} },
    "@/lib/data/auth": { getCurrentUserContext: async () => context() },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => db() },
    "@/lib/env": { isDatabaseMode: () => state.database },
    "@/lib/permissions": { hasPermission },
  };
  if (name === "@/lib/permissions/server-action") return original.call(this, require.resolve("../lib/permissions/server-action"), ...args);
  if (name === "@/lib/catalog/pagination") return original.call(this, require.resolve("../lib/catalog/pagination"), ...args);
  if (name === "@/lib/recipes/quantities") return original.call(this, require.resolve("../lib/recipes/quantities"), ...args);
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions = require("../app/actions/catalog");
const products = require("../app/actions/products-page");
loader._load = original;
function reset() { state.role = "owner"; state.authenticated = true; state.database = true; state.businessId = businessId; state.branches = null; state.failTable = ""; state.rpcError = ""; state.queries = []; state.rpcs = []; }
const recipe = () => ({ expectedUpdatedAt: null, items: [{ ingredientId, quantity: 250, unit: "g" }] });
const ingredient = () => ({ name: " Harina ", unit: "kg", unitCost: 1000, active: true, supplierId: null, minimums: [{ branchId, minimum: 5 }] });

test("catalog mutations reject unauthorized roles before database writes", async () => {
  for (const role of ["viewer", "manager", "employee", "accountant", "marketing"]) {
    reset(); state.role = role;
    assert.equal((await actions.saveRecipeAction(productId, recipe())).ok, false);
    assert.equal((await actions.saveIngredientAction(null, ingredient())).ok, false);
    assert.equal(state.rpcs.length, 0);
  }
});
test("catalog never mutates in demo or missing authentication/business", async () => {
  for (const setup of [() => { state.database = false; }, () => { state.authenticated = false; }, () => { state.businessId = null; }]) {
    reset(); setup(); assert.equal((await actions.saveRecipeAction(productId, recipe())).ok, false); assert.equal(state.rpcs.length, 0);
  }
});
test("recipe validates runtime values and duplicate ingredients before RPC", async () => {
  const bad = [null, {}, { ...recipe(), businessId: otherId }, { ...recipe(), items: [recipe().items[0], recipe().items[0]] }, ...[NaN, Infinity, -1, 0, "1"].map((quantity) => ({ ...recipe(), items: [{ ingredientId, quantity, unit: "kg" }] })), { ...recipe(), items: [{ ingredientId, quantity: 1, unit: "unknown" }] }];
  for (const input of bad) { reset(); assert.equal((await actions.saveRecipeAction(productId, input)).ok, false); assert.equal(state.rpcs.length, 0); }
});
test("recipe writes use server tenant and one atomic service call", async () => {
  reset(); const result = await actions.saveRecipeAction(productId, recipe()); assert.equal(result.ok, true); assert.equal(result.cost, 250);
  assert.deepEqual(state.rpcs, [{ name: "save_recipe_atomic", args: { p_business_id: businessId, p_product_id: productId, p_expected_updated_at: null, p_items: recipe().items } }]);
});
test("recipe CAS conflict is surfaced and never retried automatically", async () => {
  reset(); state.rpcError = "recipe_conflict"; const result = await actions.saveRecipeAction(productId, recipe()); assert.equal(result.ok, false); assert.match(result.error, /cambió/); assert.equal(state.rpcs.length, 1);
});
test("ingredient minimums cannot cross branch assignments or be duplicated", async () => {
  reset(); state.branches = [otherId]; assert.equal((await actions.saveIngredientAction(null, ingredient())).ok, false); assert.equal(state.rpcs.length, 0);
  reset(); const input = ingredient(); input.minimums.push(input.minimums[0]); assert.equal((await actions.saveIngredientAction(null, input)).ok, false); assert.equal(state.rpcs.length, 0);
});
test("ingredient update carries no stock-current field and validates shape", async () => {
  reset(); assert.equal((await actions.saveIngredientAction(ingredientId, { ...ingredient(), current: 25 })).ok, false); assert.equal(state.rpcs.length, 0);
  assert.equal((await actions.saveIngredientAction(ingredientId, ingredient())).ok, true);
  assert.deepEqual(state.rpcs[0].args, { p_business_id: businessId, p_ingredient_id: ingredientId, p_input: { ...ingredient(), name: "Harina" } });
});
test("recipe reads first verify parent product in current tenant", async () => {
  reset(); assert.equal((await actions.getRecipeAction(otherId)).ok, false); assert.deepEqual(state.queries.map((q) => q.table), ["products"]);
  reset(); const result = await actions.getRecipeAction(productId); assert.equal(result.ok, true); assert.equal(result.data.items[0].quantity, null); assert.equal(result.data.items[0].unit, null);
});
test("catalog applies business and branch filters, errors never produce demo", async () => {
  reset(); state.branches = [branchId]; const result = await actions.getCatalogDataAction(); assert.equal(result.ok, true); assert.equal(result.data.ingredients.length, 1);
  assert.equal(state.queries.find((q) => q.table === "ingredients").filters.business_id, businessId);
  assert.deepEqual(state.queries.find((q) => q.table === "branches").filters.id, [branchId]);
  assert.deepEqual(state.queries.find((q) => q.table === "stock_items").filters.ingredient_id, [ingredientId]);
  reset(); state.failTable = "ingredients"; assert.equal((await actions.getCatalogDataAction()).ok, false);
});


test("product mutations reject invalid runtime payloads before persistence", async () => {
  const valid = { name: "Pan", category: "Panadería", price: 100, cost: 25, active: true };
  const bad = [null, {}, { ...valid, name: 3 }, { ...valid, price: "100" }, { ...valid, cost: NaN }, { ...valid, active: "false" }, { ...valid, business_id: otherId }];
  for (const input of bad) { reset(); assert.equal((await products.createProductAction(input)).ok, false); assert.equal((await products.updateProductAction(productId,input)).ok, false); assert.equal(state.queries.length,0); }
});
test("product mutation fails closed without authentication even with stale context", async () => {
  reset(); state.authenticated=false;
  assert.equal((await products.createProductAction({ name:"Pan",category:"Panadería",price:100,cost:20,active:true })).ok,false);
  assert.equal(state.queries.length,0);
});
