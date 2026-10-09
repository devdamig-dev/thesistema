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

test("manual expense reads and atomic writes fail closed to tenant and branch", () => {
  const atomic = readFileSync("supabase/migrations/20261009201230_atomic_manual_expenses.sql", "utf8");
  assert.match(actions, /ctx\.assignedBranchIds === null \? query : query\.in\("branch_id"/);
  assert.match(actions, /scope\(db\.from\("expenses"\)/);
  assert.match(actions, /scope\(db\.from\("purchases"\)/);
  assert.match(actions, /mutateExpense\(current\.db/);
  assert.match(atomic, /where id=p_branch and business_id=p_business for share/);
  assert.match(atomic, /where id=v_id and business_id=p_business for update/);
  assert.match(atomic, /role::text not in \('owner','admin','manager'\)/);
  assert.match(atomic, /revoke insert,update,delete,truncate,references,trigger on public\.expenses/);
});

test("inbox approvals persist the resolved branch and UI requires a real branch", () => {
  assert.match(inbox, /extraction\.type === "expense".*expense_review_required/);
  assert.doesNotMatch(inbox, /async function createExpense/);
  assert.match(inbox, /branch_id: branchId/);
  assert.match(page, /Seleccioná una sucursal/);
  assert.match(page, /row\.sucursal/);
});
