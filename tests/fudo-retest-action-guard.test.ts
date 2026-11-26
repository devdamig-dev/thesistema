import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

// Browser Server Actions must refuse missing/invalid connection revisions before
// touching the service. No database, credentials, or network requests in this fixture.
const calls: Array<[string, string]> = [];
const loader = Module as any;
const originalLoad = loader._load;
loader._load = function (name: string, ...args: any[]) {
  if (name === "next/cache") return { revalidatePath: () => {} };
  if (name === "@/lib/integrations/fudo/service") return {
    connectFudo: async () => ({ ok: true, message: "unused" }),
    testStoredFudoConnection: async (business: string, connection: string) => {
      calls.push([business, connection]);
      return { ok: true, message: "Test successful" };
    },
    inspectFudoReadPermissions: async () => ({ ok: true, message: "", checks: [] }),
    disconnectFudo: async () => ({ ok: true, message: "" }),
    syncFudoReadOnly: async () => ({ ok: true, message: "" }),
  };
  return originalLoad.call(this, name, ...args);
};
const { testFudoConnectionAction } = require("../app/actions/fudo") as typeof import("../app/actions/fudo");
loader._load = originalLoad;

test("Fudo browser retest requires the rendered business and connection revisions", async () => {
  const business = "a".repeat(64);
  const connection = "b".repeat(64);
  calls.length = 0;
  for (const [b, c] of [
    ["", connection], [business, ""], [business, "malformed"], ["not-a-business", connection],
  ]) {
    const invalid = await testFudoConnectionAction(b, c);
    assert.equal(invalid.ok, false);
    if (!invalid.ok) assert.equal(invalid.code, "connection_changed");
  }
  assert.equal(calls.length, 0, "bad or omitted revision may not enter the service");
  const ok = await testFudoConnectionAction(business, connection);
  assert.equal(ok.ok, true);
  assert.deepEqual(calls, [[business, connection]], "both revision fences must reach the service");
});
