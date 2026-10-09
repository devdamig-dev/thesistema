import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { hasPermission } from "../lib/permissions";
import type { ManualStockInput } from "../app/actions/stock-page";

const businessId = "a0000000-0000-4000-8000-000000000001";
const ingredientId = "b0000000-0000-4000-8000-000000000001";
const branchId = "c0000000-0000-4000-8000-000000000001";
const otherId = "d0000000-0000-4000-8000-000000000001";
const actorId = "e0000000-0000-4000-8000-000000000001";
const state = {
  role: "owner", authenticated: true, database: true, businessId: businessId as string | null,
  assignedBranches: null as string[] | null, active: true, failTable: "", baseUnit: "kg",
  rpcError: "", rpcData: { stock_item_id: "stock-id", new_current: "7.5", delta: "-2.5" } as unknown,
  rpcThrows: false, revalidateThrows: false, countMissing: false,
  movements: [] as any[], queries: [] as any[], rpcs: [] as any[],
};
function movement(index: number, legacy = false) {
  return {
    id: `movement-${index}`, created_at: "2026-10-09T00:00:00Z", ingredient_id: ingredientId, branch_id: branchId,
    qty: "-2.5", reason: legacy ? "manual_adjust" : "waste", source: legacy ? null : "manual",
    operation: legacy ? null : "waste", reason_note: legacy ? null : "Vencimiento", actor_name: legacy ? null : "Operador",
    actor_role: legacy ? null : "employee", input_quantity: legacy ? null : "2500", input_unit: legacy ? null : "g",
    base_unit: legacy ? null : "kg", balance_before: legacy ? null : "10", balance_after: legacy ? null : "7.5",
    branches: { name: "Principal", business_id: businessId }, ingredients: { name: "Harina", business_id: businessId },
  };
}
function db() {
  return {
    from(table: string) {
      const q = { table, select: "", filters: {} as Record<string, unknown>, order: [] as unknown[], range: null as number[] | null };
      state.queries.push(q);
      const query: any = {
        select(value: string) { q.select = value; return query; },
        eq(key: string, value: unknown) { q.filters[key] = value; return query; },
        in(key: string, value: unknown) { q.filters[key] = value; return query; },
        order(key: string, value: unknown) { q.order.push([key, value]); return query; },
        range(start: number, end: number) { q.range = [start, end]; return query; },
        result(single = false) {
          if (state.failTable === table) return { data: null, error: { message: "read_failed" }, count: null };
          let rows: any[] = [];
          if (table === "profiles" && q.filters.id === actorId) rows = [{ active: state.active }];
          if (table === "branches" && q.filters.business_id === businessId && (!q.filters.id || q.filters.id === branchId || Array.isArray(q.filters.id))) rows = [{ id: branchId, name: "Principal", business_id: businessId }];
          if (table === "ingredients" && q.filters.business_id === businessId && (!q.filters.id || q.filters.id === ingredientId)) rows = [{ id: ingredientId, name: "Harina", unit: state.baseUnit, business_id: businessId }];
          if (table === "stock_items") rows = [{ id: "stock-id", ingredient_id: ingredientId, branch_id: branchId, current: 10, min: 5, updated_at: "2026-10-09T00:00:00Z" }];
          if (table === "stock_movements") rows = state.movements;
          const count = state.countMissing ? null : rows.length;
          if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
          return { data: single ? rows[0] ?? null : rows, error: null, count };
        },
        async maybeSingle() { return query.result(true); },
        then(resolve: any) { return Promise.resolve(query.result()).then(resolve); },
      };
      return query;
    },
    async rpc(name: string, args: unknown) {
      state.rpcs.push({ name, args });
      if (state.rpcThrows) throw new Error("network_interruption");
      return { data: state.rpcData, error: state.rpcError ? { message: state.rpcError } : null };
    },
  };
}
const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, unknown> = {
    "next/cache": { revalidatePath() { if (state.revalidateThrows) throw new Error("revalidate_failed"); } },
    "@/lib/data/auth": { getCurrentUserContext: async () => ({ role: state.role, isAuthenticated: state.authenticated, userId: actorId, businessId: state.businessId, assignedBranchIds: state.assignedBranches }) },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => db() },
    "@/lib/env": { isDatabaseMode: () => state.database },
    "@/lib/permissions": { hasPermission },
    "@/lib/data/activity": { logActivity() { throw new Error("duplicate_external_audit"); } },
  };
  if (name === "@/lib/permissions/server-action") return original.call(this, require.resolve("../lib/permissions/server-action"), ...args);
  if (name === "@/lib/catalog/pagination") return original.call(this, require.resolve("../lib/catalog/pagination"), ...args);
  if (name === "@/lib/recipes/quantities") return original.call(this, require.resolve("../lib/recipes/quantities"), ...args);
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions = require("../app/actions/stock-page");
loader._load = original;
function reset() {
  state.role = "owner"; state.authenticated = true; state.database = true; state.businessId = businessId;
  state.assignedBranches = null; state.active = true; state.failTable = ""; state.baseUnit = "kg";
  state.rpcError = ""; state.rpcData = { stock_item_id: "stock-id", new_current: "7.5", delta: "-2.5" };
  state.rpcThrows = false; state.revalidateThrows = false; state.countMissing = false;
  state.movements = [movement(0), movement(1, true)]; state.queries = []; state.rpcs = [];
}
const input = (): ManualStockInput => ({ ingredientId, branchId, operation: "waste", quantity: 2500, reason: " Vencimiento ", unit: "g" });

test("manual stock requires authenticated database context and current role permission", async () => {
  for (const configure of [() => { state.role = "viewer"; }, () => { state.role = "accountant"; }, () => { state.role = "marketing"; }, () => { state.authenticated = false; }, () => { state.businessId = null; }, () => { state.database = false; }]) {
    reset(); configure(); assert.equal((await actions.adjustStockManualAction(input())).ok, false); assert.equal(state.rpcs.length, 0);
  }
});
test("inactive or unverifiable profiles cannot read or write stock", async () => {
  for (const configure of [() => { state.active = false; }, () => { state.failTable = "profiles"; }]) {
    reset(); configure();
    assert.equal((await actions.adjustStockManualAction(input())).ok, false);
    assert.equal((await actions.getStockPageDataAction()).ok, false);
    assert.equal((await actions.getStockMovementHistoryAction({ page: 1 })).ok, false);
    assert.equal(state.rpcs.length, 0);
    assert.equal(state.queries.some((q) => q.table !== "profiles"), false);
  }
});
test("manual stock rejects malformed payloads, missing reason and invalid quantity before RPC", async () => {
  const invalid = [null, {}, { ...input(), ingredientId: otherId.slice(1) }, { ...input(), reason: " " }, { ...input(), reason: "a".repeat(1001) }, { ...input(), operation: "adjust" }, { ...input(), actor_id: otherId }, { ...input(), unit: true }, { ...input(), unit: "" }, ...["2", null, true, NaN, Infinity, -1, 0].map((quantity) => ({ ...input(), quantity }))];
  for (const value of invalid) { reset(); assert.equal((await actions.adjustStockManualAction(value)).ok, false); assert.equal(state.rpcs.length, 0); }
});
test("branch assignment and both tenant parent lookups protect mutations", async () => {
  reset(); state.assignedBranches = [otherId]; assert.equal((await actions.adjustStockManualAction(input())).ok, false); assert.equal(state.rpcs.length, 0);
  reset(); assert.equal((await actions.adjustStockManualAction({ ...input(), branchId: otherId })).ok, false); assert.equal(state.rpcs.length, 0);
  reset(); assert.equal((await actions.adjustStockManualAction({ ...input(), ingredientId: otherId })).ok, false); assert.equal(state.rpcs.length, 0);
  reset(); await actions.adjustStockManualAction(input());
  for (const table of ["branches", "ingredients"]) assert.equal(state.queries.find((q) => q.table === table).filters.business_id, businessId);
});
test("waste calls one atomic RPC with original quantity/unit and trimmed required reason", async () => {
  reset(); state.role = "employee"; state.assignedBranches = [branchId];
  assert.deepEqual(await actions.adjustStockManualAction(input()), { ok: true, persisted: true, newCurrent: 7.5, delta: -2.5 });
  assert.deepEqual(state.rpcs, [{ name: "adjust_stock_manual", args: { p_ingredient_id: ingredientId, p_branch_id: branchId, p_operation: "waste", p_quantity: 2500, p_reason: "Vencimiento", p_unit: "g" } }]);
});
test("entry, exit and exact correction retain their operation including zero correction", async () => {
  for (const operation of ["in", "out", "set"]) {
    reset(); const result = await actions.adjustStockManualAction({ ...input(), operation, quantity: operation === "set" ? 0 : 1, unit: null });
    assert.equal(result.ok, true); assert.equal(state.rpcs[0].args.p_operation, operation); assert.equal(state.rpcs[0].args.p_unit, null);
  }
});
test("units support documented aliases and compatible mass/volume only", async () => {
  for (const [base, unit] of [["kg", "g"], ["g", "kg"], ["l", "ml"], ["ml", "l"], ["u", "unidades"], ["unidad", "unit"]]) {
    reset(); state.baseUnit = base; assert.equal((await actions.adjustStockManualAction({ ...input(), unit })).ok, true);
  }
  for (const [base, unit] of [["kg", "ml"], ["g", "unit"], ["unit", "kg"], ["fetas", "fetas"], ["kg", "cajas"]]) {
    reset(); state.baseUnit = base; assert.equal((await actions.adjustStockManualAction({ ...input(), unit })).ok, false); assert.equal(state.rpcs.length, 0);
  }
  reset(); state.baseUnit = "g"; assert.equal((await actions.adjustStockManualAction({ ...input(), quantity: Number.MAX_VALUE, unit: "kg" })).ok, false); assert.equal(state.rpcs.length, 0);
});
test("incompatible units remain invalid when correction quantity is zero", async () => {
  reset(); assert.equal((await actions.adjustStockManualAction({ ...input(), quantity: 0, operation: "set", unit: "ml" })).ok, false); assert.equal(state.rpcs.length, 0);
});
test("RPC rejection is surfaced without retries or external audit", async () => {
  reset(); state.rpcError = "insufficient_stock";
  const result = await actions.adjustStockManualAction(input()); assert.equal(result.ok, false); assert.match(result.error, /stock disponible/); assert.equal(state.rpcs.length, 1);
});
test("malformed or interrupted RPC response stays uncertain rather than fabricating zero/success", async () => {
  reset(); state.rpcData = null; await assert.rejects(actions.adjustStockManualAction(input()), /unconfirmed/); assert.equal(state.rpcs.length, 1);
  reset(); state.rpcError = "Failed to fetch"; await assert.rejects(actions.adjustStockManualAction(input()), /unconfirmed/); assert.equal(state.rpcs.length, 1);
  reset(); state.rpcThrows = true; await assert.rejects(actions.adjustStockManualAction(input()), /network_interruption/); assert.equal(state.rpcs.length, 1);
});
test("revalidation failure cannot report an atomic saved mutation as a failure", async () => {
  reset(); state.revalidateThrows = true; assert.equal((await actions.adjustStockManualAction(input())).ok, true); assert.equal(state.rpcs.length, 1);
});
test("history uses exact count, stable ordering, current tenant parent joins and assigned branches", async () => {
  reset(); state.assignedBranches = [branchId];
  const result = await actions.getStockMovementHistoryAction({ page: 2, branchId, ingredientId }); assert.equal(result.ok, true);
  const q = state.queries.find((q) => q.table === "stock_movements");
  assert.match(q.select, /branches!inner/); assert.match(q.select, /ingredients!inner/);
  assert.equal(q.filters["branches.business_id"], businessId); assert.equal(q.filters["ingredients.business_id"], businessId);
  assert.equal(q.filters.branch_id, branchId); assert.equal(q.filters.ingredient_id, ingredientId);
  assert.deepEqual(q.range, [25, 49]);
  assert.deepEqual(q.order, [["created_at", { ascending: false }], ["id", { ascending: false }]]);
});
test("history is paginated beyond the previous 5000-row cutoff", async () => {
  reset(); state.movements = Array.from({ length: 5003 }, (_, index) => movement(index));
  const result = await actions.getStockMovementHistoryAction({ page: 201 });
  assert.equal(result.ok, true); assert.equal(result.data.total, 5003); assert.equal(result.data.items.length, 3); assert.equal(result.data.items[0].id, "movement-5000");
});
test("history preserves legacy null audit metadata without inventing actor, unit, balance or source", async () => {
  reset(); const result = await actions.getStockMovementHistoryAction({ page: 1 });
  assert.equal(result.ok, true); const current = result.data.items[0]; const legacy = result.data.items[1];
  assert.equal(current.legacy, false); assert.equal(current.balanceBefore, 10); assert.equal(current.balanceAfter, 7.5); assert.equal(current.delta, -2.5);
  assert.equal(legacy.legacy, true);
  for (const key of ["operation", "source", "actorName", "actorRole", "baseUnit", "inputQuantity", "inputUnit", "balanceBefore", "balanceAfter", "reasonNote"]) assert.equal(legacy[key], null);
  assert.equal(legacy.delta, -2.5);
});
test("history rejects unauthorized roles, invalid pages and outside assignments", async () => {
  for (const configure of [() => { state.role = "marketing"; }, () => { state.database = false; }, () => { state.authenticated = false; }, () => { state.businessId = null; }]) {
    reset(); configure(); assert.equal((await actions.getStockMovementHistoryAction({ page: 1 })).ok, false);
    assert.equal(state.queries.some((q) => q.table === "stock_movements"), false);
  }
  for (const value of [null, {}, { page: 0 }, { page: -1 }, { page: 1.5 }, { page: "1" }, { page: Infinity }, { page: Number.MAX_SAFE_INTEGER }, { page: 1, branchId: "bad" }, { page: 1, business_id: otherId }]) {
    reset(); assert.equal((await actions.getStockMovementHistoryAction(value)).ok, false); assert.equal(state.queries.length, 0);
  }
  reset(); state.assignedBranches = [otherId]; assert.equal((await actions.getStockMovementHistoryAction({ page: 1, branchId })).ok, false);
});
test("no assigned branches returns no history or stock rather than broadening access", async () => {
  reset(); state.assignedBranches = [];
  const history = await actions.getStockMovementHistoryAction({ page: 1 }); assert.equal(history.ok, true); assert.equal(history.data.total, 0);
  const stock = await actions.getStockPageDataAction(); assert.equal(stock.ok, true); assert.deepEqual(stock.data.items, []); assert.equal(stock.data.canAdjust, true);
  assert.equal(state.queries.some((q) => q.table === "stock_movements" || q.table === "stock_items"), false);
});
test("history and stock query failures are explicit and never return demo records", async () => {
  reset(); state.failTable = "stock_movements"; assert.equal((await actions.getStockMovementHistoryAction({ page: 1 })).ok, false);
  reset(); state.countMissing = true; assert.equal((await actions.getStockMovementHistoryAction({ page: 1 })).ok, false);
  for (const table of ["branches", "ingredients", "stock_items"]) { reset(); state.failTable = table; assert.equal((await actions.getStockPageDataAction()).ok, false); }
});
test("stock page reports current adjust permission and scopes stock ingredients to tenant", async () => {
  reset(); const owner = await actions.getStockPageDataAction(); assert.equal(owner.ok, true); assert.equal(owner.data.canAdjust, true);
  assert.equal(state.queries.find((q) => q.table === "stock_items").filters["ingredients.business_id"], businessId);
  reset(); state.role = "viewer"; const viewer = await actions.getStockPageDataAction(); assert.equal(viewer.ok, true); assert.equal(viewer.data.canAdjust, false);
});
