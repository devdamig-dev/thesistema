import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const migration = readFileSync("supabase/migrations/20261007020803_expense_branch_isolation.sql", "utf8");
const policyMigration = readFileSync("supabase/migrations/20261007021237_expense_branch_policy_indexes.sql", "utf8");
const actions = readFileSync("app/actions/expenses-page.ts", "utf8");
const inbox = readFileSync("app/actions/inbox.ts", "utf8");
const page = readFileSync("app/gastos/page.tsx", "utf8");

test("expense migration requires a same-business branch and branch-scoped RLS", () => {
  assert.match(migration, /alter column branch_id set not null/);
  assert.match(migration, /expense_branch_business_mismatch/);
  assert.match(migration, /can_access_business_branch\(business_id, branch_id\)/);
  assert.match(policyMigration, /expenses_branch_business_due_idx/);
  assert.match(policyMigration, /for insert to authenticated/);
  assert.match(policyMigration, /for update to authenticated/);
  assert.match(policyMigration, /for delete to authenticated/);
  assert.doesNotMatch(policyMigration, /for all to authenticated/);
});

test("manual expense reads and writes fail closed to the actor branch scope", () => {
  assert.match(actions, /expensesQuery = expensesQuery\.in\("branch_id", branchIds\)/);
  assert.match(actions, /purchasesQuery = purchasesQuery\.in\("branch_id", branchIds\)/);
  assert.match(actions, /assignedBranchIds\.includes\(input\.branchId\)/);
  assert.match(actions, /\.eq\("business_id", ctx\.businessId\)\.maybeSingle\(\)/);
  assert.match(actions, /branch_id: input\.branchId/);
});

test("inbox approvals persist the resolved branch and UI requires a real branch", () => {
  assert.match(inbox, /createExpense\(db, businessId, branchId/);
  assert.match(inbox, /branch_id: branchId/);
  assert.match(page, /Elegí una sucursal/);
  assert.match(page, /expense\.sucursal/);
});
