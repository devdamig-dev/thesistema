import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

// Browser actions must never start five read-only Fudo GETs when the visible
// tenant or connection revision is absent/invalid. This fixture makes no IO.
const calls: Array<[string, string]> = [];
const loader = Module as any;
const originalLoad = loader._load;
loader._load = function (name: string, ...args: any[]) {
  if (name === "next/cache") return { revalidatePath: () => {} };
  if (name === "@/lib/integrations/fudo/service") return {
    connectFudo: async () => ({ ok: true, message: "unused" }),
    testStoredFudoConnection: async () => ({ ok: true, message: "unused" }),
    inspectFudoReadPermissions: async (business: string, connection: string) => {
      calls.push([business, connection]);
      return { ok: true, message: "Checks passed", checks: [] };
    },
    disconnectFudo: async () => ({ ok: true, message: "unused" }),
    syncFudoReadOnly: async () => ({ ok: true, message: "unused" }),
  };
  return originalLoad.call(this, name, ...args);
};
const { inspectFudoPermissionsAction } = require("../app/actions/fudo") as typeof import("../app/actions/fudo");
loader._load = originalLoad;

test("Fudo preflight action requires both rendered revisions before calling service", async () => {
  const business = "a".repeat(64);
  const connection = "b".repeat(64);
  calls.length = 0;
  const invalid: Array<[string, string]> = [
    ["", connection], [business, ""], [business, "wrong"],
    ["invalid-business", connection], [business, "B".repeat(64)],
  ];
  for (const [b, c] of invalid) {
    const result = await inspectFudoPermissionsAction(b, c);
    assert.equal(result.ok, false);
    assert.deepEqual(result.checks, []);
  }
  assert.equal(calls.length, 0, "invalid/missing revisions must never reach service");
  const valid = await inspectFudoPermissionsAction(business, connection);
  assert.equal(valid.ok, true);
  assert.deepEqual(calls, [[business, connection]], "both fences must reach service");
});
