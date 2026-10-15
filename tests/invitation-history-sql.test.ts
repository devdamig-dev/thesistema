import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

test("invitation revoke/reinvite history, RLS and token acceptance work against real migrations", { timeout: 120_000 }, () => {
  const result = spawnSync(process.execPath, ["scripts/run-catalog-sql.mjs", "invitation-history"], {
    cwd: process.cwd(), encoding: "utf8", timeout: 110_000, maxBuffer: 2_000_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /PASS invitation-history SQL suite/);
});
