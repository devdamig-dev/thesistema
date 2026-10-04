import assert from "node:assert/strict";
import test from "node:test";
import { applyAdminBranchScope } from "../lib/data/branch-scope";

const branchA = "a0000000-0000-4000-8000-000000000001";
const branchB = "b0000000-0000-4000-8000-000000000001";

function queryFor(rows: Array<{ branch_id: string | null }>) {
  const filters: Array<(row: { branch_id: string | null }) => boolean> = [];
  const query: any = {
    in(column: string, values: string[]) {
      assert.equal(column, "branch_id");
      filters.push((row) => values.includes(String(row.branch_id)));
      return query;
    },
    or(expression: string) {
      const match = expression.match(/^branch_id\.in\.\(([^)]*)\),branch_id\.is\.null$/);
      assert.ok(match, `Filtro inesperado: ${expression}`);
      const allowed = match[1].split(",");
      filters.push((row) => row.branch_id === null || allowed.includes(String(row.branch_id)));
      return query;
    },
    rows() {
      return rows.filter((row) => filters.every((filter) => filter(row)));
    },
  };
  return query;
}

const rows = [{ branch_id: branchA }, { branch_id: branchB }, { branch_id: null }];

test("service-role query includes assigned and shared branch rows", () => {
  const query = applyAdminBranchScope(queryFor(rows), [branchA]);
  assert.deepEqual(query.rows(), [{ branch_id: branchA }, { branch_id: null }]);
});

test("service-role query fails closed without branch assignments", () => {
  const query = applyAdminBranchScope(queryFor(rows), []);
  assert.deepEqual(query.rows(), []);
});

test("service-role query keeps all business rows for unrestricted roles", () => {
  const query = applyAdminBranchScope(queryFor(rows), null);
  assert.deepEqual(query.rows(), rows);
});
