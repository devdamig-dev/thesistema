import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import * as permissions from "../lib/permissions";

const customerId = "11111111-1111-4111-8111-111111111111";
let database = true;
let ctx = { isAuthenticated: true, businessId: "business", userId: "actor", role: "owner", enabledModules: ["customers", "sales"] };
let customer: any = { id: customerId, name: "Synthetic customer" };
let reads = 0;
let sales: any = { ok: true, data: { businessId: "business", userId: "actor", timezone: "America/Argentina/Buenos_Aires", branches: [{ id: "allowed", name: "Allowed branch" }], sales: [
  { id: "linked", customer_id: customerId, branch_id: "allowed", occurred_at: "2026-10-09T12:00:00Z", amount: "200000.25", source: "manual", status: "active", items: [{ quantity: "2", description: "Actual linked item" }] },
  { id: "unlinked", customer_id: null, branch_id: "allowed", occurred_at: "2026-10-09T12:00:00Z", amount: "99", source: null, status: "active", items: [] },
] } };
const loader = Module as any; const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, unknown> = {
    "@/lib/data/auth": { getCurrentUserContext: async () => ctx },
    "@/lib/env": { isDatabaseMode: () => database },
    "@/lib/permissions": permissions,
    "@/app/actions/sales": { getSalesWorkspaceAction: async () => sales },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ from: (table: string) => {
      reads++; assert.equal(table, "customers");
      const query = { select: () => query, eq: (key: string, value: string) => { assert.equal(value, key === "id" ? customerId : "business"); return query; }, maybeSingle: async () => ({ data: customer, error: null }) };
      return query;
    } }) },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { getCustomerSalesHistoryAction } = require("../app/actions/customer-history");
loader._load = original;

test("customer history reuses scoped sales, filters exact relation and fails closed on permission/context changes", async () => {
  assert.equal((await getCustomerSalesHistoryAction("not-an-id")).ok, false);
  database = false; assert.equal((await getCustomerSalesHistoryAction(customerId)).ok, false); database = true;
  const owner = { ...ctx };
  for (const patch of [{ isAuthenticated: false }, { businessId: null }, { role: "employee" }, { enabledModules: ["customers"] }, { enabledModules: ["sales"] }]) {
    ctx = { ...owner, ...patch } as typeof ctx;
    assert.equal((await getCustomerSalesHistoryAction(customerId)).ok, false);
  }
  assert.equal(reads, 0); ctx = owner;
  const result = await getCustomerSalesHistoryAction(customerId);
  assert.equal(result.ok, true); assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, "linked"); assert.equal(result.rows[0].amount, "200000.25"); assert.equal(result.rows[0].description, "2 × Actual linked item");
  customer = null; assert.equal((await getCustomerSalesHistoryAction(customerId)).ok, false);
  customer = { id: customerId, name: "Synthetic customer" };
  const validSales = sales;
  sales = { ...sales, data: { ...sales.data, businessId: "other" } }; assert.equal((await getCustomerSalesHistoryAction(customerId)).ok, false);
  sales = { ...validSales, data: { ...validSales.data, userId: "other" } }; assert.equal((await getCustomerSalesHistoryAction(customerId)).ok, false);
  sales = { ok: false, error: "Incomplete scoped read" }; assert.deepEqual(await getCustomerSalesHistoryAction(customerId), sales);
});
