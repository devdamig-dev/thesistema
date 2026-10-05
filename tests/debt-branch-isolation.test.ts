import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import Module from "node:module";

const businessId = "290cea71-508e-44a9-b0a3-5730d8201ca6";
const branchA = "a0000000-0000-4000-8000-000000000001";
const branchB = "b0000000-0000-4000-8000-000000000001";
let assignedBranchIds: string[] | null = [branchA];
let insertedDebt: Record<string, unknown> | null = null;

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
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let payload: Record<string, unknown> | null = null;
      const query: any = {
        select() { return query; },
        eq(column: string, value: unknown) { filters[column] = value; return query; },
        insert(value: Record<string, unknown>) { payload = value; if (table === "debts") insertedDebt = value; return query; },
        async maybeSingle() {
          if (table === "branches") {
            return filters.business_id === businessId && (filters.id === branchA || filters.id === branchB)
              ? { data: { id: filters.id }, error: null }
              : { data: null, error: null };
          }
          if (table === "debts" && payload) return { data: { id: "debt-a" }, error: null };
          return { data: null, error: null };
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
    "@/lib/supabase/server": { createSupabaseServerClient: database },
    "@/lib/data/auth": { getCurrentUserContext: async () => context() },
    "@/lib/env": { isDatabaseMode: () => true },
    "@/lib/permissions/server-action": { assertPermission: async () => null },
    "@/lib/data/activity": { logActivity: async () => {} },
    "@/lib/data/notifications": { createNotification: async () => {} },
    "next/cache": { revalidatePath: () => {} },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions = require("../app/actions/debts");
loader._load = original;

const input = (branchId: string) => ({
  branch_id: branchId,
  creditor: "Proveedor QA",
  original_amount: 1000,
  category: "supplier",
});

test("restricted debt creation rejects an unassigned branch before insert", async () => {
  assignedBranchIds = [branchA];
  insertedDebt = null;
  const result = await actions.registerDebtAction(input(branchB));
  assert.equal(result.ok, false);
  assert.equal(insertedDebt, null);
});

test("debt creation persists its authorized branch and actor", async () => {
  assignedBranchIds = [branchA];
  insertedDebt = null;
  const result = await actions.registerDebtAction(input(branchA));
  assert.equal(result.ok, true);
  assert.equal((insertedDebt as Record<string, unknown> | null)?.branch_id, branchA);
  assert.equal((insertedDebt as Record<string, unknown> | null)?.created_by, "user-a");
});

test("debt migration and WhatsApp adapter enforce branch scope", () => {
  const migration = readFileSync("supabase/migrations/20261005095540_debt_branch_isolation.sql", "utf8");
  const adapter = readFileSync("lib/whatsapp-agent/supabase-adapter.ts", "utf8");
  assert.match(migration, /alter column branch_id set not null/);
  assert.match(migration, /can_access_business_branch\(business_id, branch_id\)/);
  assert.match(migration, /debt_payments branch scoped read/);
  assert.match(adapter, /if \(call\.name === "debts\.list"\)[\s\S]*branchQuery\(query, actor\)/);
  assert.match(adapter, /if \(call\.name === "debts\.create"\)[\s\S]*branch_id: branchId/);
});

test("Inbox propagates the extraction branch to purchases and debts", () => {
  const inbox = readFileSync("app/actions/inbox.ts", "utf8");
  assert.match(inbox, /createPurchase\(db, businessId, branchId,/);
  assert.match(inbox, /createDebt\(db, businessId, branchId,/);
  assert.match(inbox, /\.insert\(\{[\s\S]*business_id: businessId,[\s\S]*branch_id: branchId/);
});
