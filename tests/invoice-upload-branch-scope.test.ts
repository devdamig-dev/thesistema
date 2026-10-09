import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const businessId = "290cea71-508e-44a9-b0a3-5730d8201ca6";
const branchA = "a0000000-0000-4000-8000-000000000001";
const branchB = "b0000000-0000-4000-8000-000000000001";
let assignedBranchIds: string[] | null = [branchA];
let uploaded = false;
let insertedInvoice: Record<string, unknown> | null = null;

function adminDb() {
  return {
    async rpc(name: string) {
      assert.equal(name, "finalize_invoice_extraction_atomic");
      return { data: { ok: true, item_count: 0 }, error: null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let mutation: "insert" | "update" | null = null;
      let payload: any = null;
      const query: any = {
        select() { return query; },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        order() { return query; },
        limit() { return query; },
        insert(value: any) {
          mutation = "insert";
          payload = value;
          if (table === "invoices") insertedInvoice = value;
          return query;
        },
        update(value: any) { mutation = "update"; payload = value; return query; },
        async maybeSingle() {
          if (table === "profiles") return { data: { active: true }, error: null };
          if (table === "businesses") return { data: { organization_id: "org-a" }, error: null };
          if (table === "branches") {
            const valid = filters.id === branchA || filters.id === branchB;
            return {
              data: valid && filters.business_id === businessId ? { id: filters.id } : null,
              error: null,
            };
          }
          if (table === "invoices" && mutation === "insert") {
            assert.equal(payload.branch_id, filters.branch_id ?? payload.branch_id);
            return { data: { id: "invoice-a" }, error: null };
          }
          if (table === "invoices" && mutation === "update") {
            return { data: { id: "invoice-a" }, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve: (value: unknown) => void) {
          resolve({ data: table === "ingredients" ? [] : null, error: null });
        },
      };
      return query;
    },
    storage: {
      from() {
        return {
          async upload() { uploaded = true; return { data: {}, error: null }; },
          async createSignedUrl() { return { data: { signedUrl: "https://storage.test/invoice" }, error: null }; },
          async remove() { return { data: {}, error: null }; },
        };
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
    "@/lib/ocr": {
      extractTextFromInvoice: async () => ({
        text: "factura controlada",
        provider: "test",
        confidence: 1,
        durationMs: 1,
      }),
    },
    "@/lib/ai/invoice-extract": {
      extractInvoiceFromText: async () => ({
        supplier: "Proveedor QA",
        tax_id: null,
        invoice_type: "B",
        invoice_number: "QA-1",
        invoice_date: "2026-10-04",
        due_date: null,
        payment_method: "Transferencia",
        subtotal: 100,
        tax: 21,
        total: 121,
        confidence: 0.9,
        source: "heuristic",
        items: [],
      }),
    },
    "@/lib/ingredients/matching": { matchAllItems: () => [] },
    "@/lib/recipes/recalc": { recalcRecipesForIngredient: async () => ({}) },
    "@/lib/data/auth": {
      getCurrentUserContext: async () => ({
        isAuthenticated: true,
        userId: "user-a",
        businessId,
        role: "manager",
        enabledModules: ["invoices_ocr"],
        assignedBranchIds,
      }),
    },
    "@/lib/data/branch-scope": { applyAdminBranchScope: (query: any) => query },
    "@/lib/permissions/server-action": { assertPermission: async () => null },
    "next/cache": { revalidatePath: () => {} },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const invoiceActions = require("../app/actions/invoices");
loader._load = original;

function invoiceForm(branchId?: string) {
  const form = new FormData();
  form.append("file", new File(["invoice"], "invoice.pdf", { type: "application/pdf" }));
  if (branchId) form.append("branch_id", branchId);
  return form;
}

test("restricted invoice upload rejects missing and unassigned branches before storage", async () => {
  assignedBranchIds = [branchA];
  uploaded = false;
  insertedInvoice = null;

  const missing = await invoiceActions.uploadInvoiceAction(invoiceForm());
  assert.equal(missing.ok, false);
  assert.equal(uploaded, false);

  const crossed = await invoiceActions.uploadInvoiceAction(invoiceForm(branchB));
  assert.equal(crossed.ok, false);
  assert.equal(uploaded, false);
  assert.equal(insertedInvoice, null);
});

test("restricted invoice upload persists its authorized branch", async () => {
  assignedBranchIds = [branchA];
  uploaded = false;
  insertedInvoice = null;

  const result = await invoiceActions.uploadInvoiceAction(invoiceForm(branchA));
  assert.equal(result.ok, true);
  assert.equal(uploaded, true);
  assert.equal((insertedInvoice as Record<string, unknown> | null)?.branch_id, branchA);
  assert.equal((insertedInvoice as Record<string, unknown> | null)?.created_by, "user-a");
});

test("business-wide invoice upload still rejects a branch from another business", async () => {
  assignedBranchIds = null;
  uploaded = false;
  insertedInvoice = null;
  const foreignBranch = "c0000000-0000-4000-8000-000000000001";

  const result = await invoiceActions.uploadInvoiceAction(invoiceForm(foreignBranch));
  assert.equal(result.ok, false);
  assert.equal(uploaded, false);
  assert.equal(insertedInvoice, null);
});
