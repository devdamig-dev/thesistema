import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

// Server-only fixture: no browser, customer credentials, database or Fudo GET.
let businessRevision = "a".repeat(64);
const loader = Module as any;
const originalLoad = loader._load;
loader._load = function (name: string, ...args: any[]) {
  if (name === "./fudo-settings-client") {
    return { FudoSettingsClient: function FudoSettingsClient() { return null; } };
  }
  if (name === "@/lib/integrations/fudo/service") {
    return { getFudoConnectionView: async () => ({
      configured: true,
      businessRevision,
      connectionRevision: null,
      status: "disconnected",
      lastTestedAt: null,
      lastSyncedAt: null,
      lastSyncStatus: null,
      lastErrorCode: null,
      lastCounts: {},
      importedCounts: {},
      seenThisCycleCounts: {},
      possiblyMissingCounts: {},
      nextPages: {},
      recentRuns: [],
    }) };
  }
  if (name === "@/components/ui/section-header") {
    return { SectionHeader: function SectionHeader() { return null; } };
  }
  return originalLoad.call(this, name, ...args);
};
const { default: FudoSettingsPage } = require("../app/ajustes/integraciones/fudo/page") as typeof import("../app/ajustes/integraciones/fudo/page");
loader._load = originalLoad;

async function getFormKey(): Promise<string | null> {
  const page = await FudoSettingsPage();
  // The second child of the layout is the client form or the authorization error.
  const child = (page.props as { children: Array<{ key: string | null }> }).children[1];
  return child.key;
}

test("Fudo form is remounted on business switch so hidden credentials from A cannot survive into B", async () => {
  businessRevision = "a".repeat(64);
  const a = await getFormKey();
  assert.equal(a, businessRevision);
  // A same-business refresh must preserve the form for ordinary retry.
  assert.equal(await getFormKey(), a);

  businessRevision = "b".repeat(64);
  const b = await getFormKey();
  assert.equal(b, businessRevision);
  assert.notEqual(b, a, "new business must receive a new React component identity");

  businessRevision = "a".repeat(64);
  assert.equal(await getFormKey(), a);
});
