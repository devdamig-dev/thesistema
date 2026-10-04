import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const branchA = "a0000000-0000-4000-8000-000000000001";
const branchA2 = "a0000000-0000-4000-8000-000000000002";
const branchB = "b0000000-0000-4000-8000-000000000001";

let ctx: any = {
  isAuthenticated: true,
  userId: "restricted-user",
  businessId: "business-a",
  role: "employee",
  assignedBranchIds: [branchA],
};

const records: Record<string, any[]> = {
  sales: [
    { business_id: "business-a", branch_id: branchA, occurred_at: "2026-10-04T10:00:00-03:00", channel: "salon", amount: 100, branches: { name: "Principal" } },
    { business_id: "business-a", branch_id: branchA2, occurred_at: "2026-10-04T11:00:00-03:00", channel: "delivery", amount: 200, branches: { name: "Norte" } },
    { business_id: "business-a", branch_id: null, occurred_at: "2026-10-04T12:00:00-03:00", channel: "whatsapp", amount: 50, branches: null },
    { business_id: "business-b", branch_id: branchB, occurred_at: "2026-10-04T13:00:00-03:00", channel: "salon", amount: 900, branches: { name: "Otro negocio" } },
  ],
  invoices: [
    { business_id: "business-a", branch_id: branchA, invoice_date: "2026-10-04", number: "A-1", total: 110, suppliers: { name: "Proveedor A" } },
    { business_id: "business-a", branch_id: branchA2, invoice_date: "2026-10-04", number: "A-2", total: 220, suppliers: { name: "Proveedor Norte" } },
    { business_id: "business-a", branch_id: null, invoice_date: "2026-10-04", number: "A-3", total: 55, suppliers: { name: "Proveedor común" } },
    { business_id: "business-b", branch_id: branchB, invoice_date: "2026-10-04", number: "B-1", total: 990, suppliers: { name: "Proveedor ajeno" } },
  ],
};

function adminDb() {
  return {
    from(table: string) {
      const filters: Array<(row: any) => boolean> = [];
      const query: any = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return query; },
        in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return query; },
        or(expression: string) {
          const match = expression.match(/^branch_id\.in\.\(([^)]*)\),branch_id\.is\.null$/);
          assert.ok(match, `Filtro de sucursal inesperado: ${expression}`);
          const ids = match[1].split(",");
          filters.push((row) => row.branch_id === null || ids.includes(row.branch_id));
          return query;
        },
        order() { return query; },
        limit() { return query; },
        then(resolve: any, reject: any) {
          const data = (records[table] ?? []).filter((row) => filters.every((filter) => filter(row)));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "@/lib/supabase/admin": { createSupabaseAdminClient: adminDb },
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/permissions/server-action": { assertPermission: async () => null },
    "@/lib/data/activity": { logActivity: async () => {} },
    "@/lib/data/auth": { getCurrentUserContext: async () => ctx },
    "@/lib/data/branch-scope": {
      applyAdminBranchScope(query: any, branchIds: string[] | null) {
        if (branchIds === null) return query;
        if (branchIds.length === 0) {
          return query.in("branch_id", ["00000000-0000-0000-0000-000000000000"]);
        }
        return query.or(`branch_id.in.(${branchIds.join(",")}),branch_id.is.null`);
      },
    },
    "@/lib/csv": {
      csvFilename: (name: string) => `${name}.csv`,
      buildCsv: (_headers: unknown, rows: unknown) => JSON.stringify(rows),
    },
    "@/lib/mock-data": {
      invoices: [], dailySalesTable: [], employees: [], debts: [], DEBT_CATEGORY_LABELS: {},
    },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const exportsActions = require("../app/actions/exports");
loader._load = original;

test("restricted exports include only assigned and business-level rows", async () => {
  ctx = { ...ctx, assignedBranchIds: [branchA] };

  const sales = await exportsActions.exportSalesCsvAction();
  assert.equal(sales.ok, true);
  assert.equal(sales.rows, 2);
  assert.match(sales.content, /100/);
  assert.match(sales.content, /50/);
  assert.doesNotMatch(sales.content, /200/);
  assert.doesNotMatch(sales.content, /900/);

  const purchases = await exportsActions.exportPurchasesCsvAction();
  assert.equal(purchases.ok, true);
  assert.equal(purchases.rows, 2);
  assert.match(purchases.content, /Proveedor A/);
  assert.match(purchases.content, /Proveedor común/);
  assert.doesNotMatch(purchases.content, /Proveedor Norte/);
  assert.doesNotMatch(purchases.content, /Proveedor ajeno/);
});

test("restricted exports without branch assignments fail closed to zero rows", async () => {
  ctx = { ...ctx, assignedBranchIds: [] };
  assert.equal((await exportsActions.exportSalesCsvAction()).rows, 0);
  assert.equal((await exportsActions.exportPurchasesCsvAction()).rows, 0);
});

test("business-wide roles export every row in their business only", async () => {
  ctx = { ...ctx, role: "manager", assignedBranchIds: null };
  assert.equal((await exportsActions.exportSalesCsvAction()).rows, 3);
  assert.equal((await exportsActions.exportPurchasesCsvAction()).rows, 3);
});
