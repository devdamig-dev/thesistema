import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const businessId = "290cea71-508e-44a9-b0a3-5730d8201ca6";
const branchA = "a0000000-0000-4000-8000-000000000001";
const branchB = "b0000000-0000-4000-8000-000000000001";
let assignedBranchIds: string[] | null = [branchA];
let insertedPurchase: Record<string, unknown> | null = null;

const context = () => ({
  isAuthenticated: true,
  userId: "user-a",
  businessId,
  fullName: "QA",
  role: "manager",
  assignedBranchIds,
});

function database() {
  return {
    async rpc(name: string, args: any) {
      assert.equal(name, "create_purchase_manual_atomic");
      assert.equal(args.p_business_id, businessId);
      insertedPurchase = args.p_input;
      return { data: { ok: true, id: "purchase-a" }, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let payload: Record<string, unknown> | null = null;
      const query: any = {
        select() { return query; },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        insert(value: Record<string, unknown>) { payload = value; if (table === "purchases") insertedPurchase = value; return query; },
        delete() { return query; },
        async maybeSingle() {
          if (table === "suppliers") {
            return filters.business_id === businessId ? { data: { id: "supplier-a", name: "Proveedor QA" }, error: null } : { data: null, error: null };
          }
          if (table === "branches") {
            return filters.business_id === businessId && (filters.id === branchA || filters.id === branchB)
              ? { data: { id: filters.id, name: filters.id === branchA ? "Principal" : "Norte" }, error: null }
              : { data: null, error: null };
          }
          if (table === "purchases" && payload) return { data: { id: "purchase-a" }, error: null };
          return { data: null, error: null };
        },
        then(resolve: (value: unknown) => void) { resolve({ data: null, error: null }); },
      };
      return query;
    },
  };
}

const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "@/lib/supabase/server": { createSupabaseServerClient: database },
    "@/lib/data/auth": { getCurrentUserContext: async () => context() },
    "@/lib/permissions": { hasPermission: () => true },
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/permissions/server-action": {
      withPermission: (_permission: string, handler: Function) => (input: unknown) => handler(context(), input),
    },
    "@/lib/data/activity": { logActivity: async () => {} },
    "next/cache": { revalidatePath: () => {} },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions = require("../app/actions/purchases-page");
loader._load = original;

const input = (branchId: string) => ({
  requestId: "c0000000-0000-4000-8000-000000000002",
  branchId,
  supplierId: "supplier-a",
  purchasedAt: "2026-10-05",
  paymentMethod: "Transferencia",
  description: "Harina",
  qty: 2,
  unit: "kg",
  unitPrice: 1000,
});

test("restricted purchase creation rejects an unassigned branch before insert", async () => {
  assignedBranchIds = [branchA];
  insertedPurchase = null;
  const result = await actions.createPurchaseAction(input(branchB));
  assert.equal(result.ok, false);
  assert.equal(insertedPurchase, null);
});

test("purchase creation persists its authorized branch and actor", async () => {
  assignedBranchIds = [branchA];
  insertedPurchase = null;
  const result = await actions.createPurchaseAction(input(branchA));
  assert.equal(result.ok, true);
  assert.equal((insertedPurchase as Record<string, unknown> | null)?.branchId, branchA);
  assert.equal((insertedPurchase as Record<string, unknown> | null)?.requestId, input(branchA).requestId);
  assert.equal((insertedPurchase as any)?.items[0].qty, "2");
});

test("business-wide roles still reject a branch from another business", async () => {
  assignedBranchIds = null;
  insertedPurchase = null;
  const result = await actions.createPurchaseAction(input("c0000000-0000-4000-8000-000000000001"));
  assert.equal(result.ok, false);
  assert.equal(insertedPurchase, null);
});
