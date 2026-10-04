import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const branchA = "a0000000-0000-4000-8000-000000000001";
const branchB = "b0000000-0000-4000-8000-000000000001";
let assignedBranchIds: string[] | null = [branchA];

const records: Record<string, any[]> = {
  businesses: [{ id: "business-a", organization_id: "org-a" }],
  invoices: [
    { id: "invoice-a", business_id: "business-a", branch_id: branchA, storage_path: "org-a/business-a/a.pdf", storage_bucket: "invoices", file_mime: "application/pdf" },
    { id: "invoice-b", business_id: "business-a", branch_id: branchB, storage_path: "org-a/business-a/b.pdf", storage_bucket: "invoices", file_mime: "application/pdf" },
    { id: "invoice-shared", business_id: "business-a", branch_id: null, storage_path: "org-a/business-a/shared.pdf", storage_bucket: "invoices", file_mime: "application/pdf" },
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
          assert.ok(match, `Filtro inesperado: ${expression}`);
          const allowed = match[1].split(",");
          filters.push((row) => row.branch_id === null || allowed.includes(row.branch_id));
          return query;
        },
        async maybeSingle() {
          const data = (records[table] ?? []).filter((row) => filters.every((filter) => filter(row)))[0] ?? null;
          return { data, error: null };
        },
      };
      return query;
    },
    storage: {
      from() {
        return { async createSignedUrl(path: string) { return { data: { signedUrl: `https://storage.test/${path}` }, error: null }; } };
      },
    },
  };
}

const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "@/lib/supabase/admin": { createSupabaseAdminClient: adminDb },
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/ocr": { extractTextFromInvoice: async () => ({ text: "" }) },
    "@/lib/ai/invoice-extract": { extractInvoiceFromText: async () => ({}) },
    "@/lib/ingredients/matching": { matchAllItems: () => [] },
    "@/lib/recipes/recalc": { recalcRecipesForIngredient: async () => ({}) },
    "@/lib/data/activity": { logActivity: async () => {} },
    "@/lib/data/notifications": { createNotification: async () => {} },
    "@/lib/data/auth": {
      getCurrentUserContext: async () => ({
        isAuthenticated: true,
        userId: "viewer-a",
        businessId: "business-a",
        role: "viewer",
        assignedBranchIds,
      }),
    },
    "@/lib/data/branch-scope": {
      applyAdminBranchScope(query: any, branchIds: string[] | null) {
        if (branchIds === null) return query;
        if (branchIds.length === 0) return query.in("branch_id", ["00000000-0000-0000-0000-000000000000"]);
        return query.or(`branch_id.in.(${branchIds.join(",")}),branch_id.is.null`);
      },
    },
    "@/lib/permissions/server-action": { assertPermission: async () => null },
    "next/cache": { revalidatePath: () => {} },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const invoiceActions = require("../app/actions/invoices");
loader._load = original;

test("invoice attachment signing respects assigned branches", async () => {
  assignedBranchIds = [branchA];
  assert.equal((await invoiceActions.getInvoiceAttachmentUrlAction("invoice-a")).ok, true);
  assert.equal((await invoiceActions.getInvoiceAttachmentUrlAction("invoice-shared")).ok, true);

  const denied = await invoiceActions.getInvoiceAttachmentUrlAction("invoice-b");
  assert.equal(denied.ok, false);
  assert.equal(denied.error, "no_attachment");
});

test("invoice attachment signing fails closed without assignments", async () => {
  assignedBranchIds = [];
  assert.equal((await invoiceActions.getInvoiceAttachmentUrlAction("invoice-a")).ok, false);
  assert.equal((await invoiceActions.getInvoiceAttachmentUrlAction("invoice-shared")).ok, false);
});
