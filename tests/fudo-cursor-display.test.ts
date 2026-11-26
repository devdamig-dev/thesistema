import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateFudoPilotReadiness, formatVerifiedFudoCount,
  fudoCursorDisplay, hasVerifiableFudoFullCycle,
} from "../lib/integrations/fudo/readiness";
import { FUDO_SYNC_RESOURCES } from "../lib/integrations/fudo/snapshot";
import type { FudoConnectionView } from "../lib/integrations/fudo/service";

function completedFixture(): FudoConnectionView {
  return {
    configured: true, connectionRevision: null, status: "connected",
    lastTestedAt: null, lastSyncedAt: "2026-11-09T20:01:00-03:00",
    lastSyncStatus: "completed", lastErrorCode: null,
    lastCounts: {}, importedCounts: {},
    nextPages: Object.fromEntries(FUDO_SYNC_RESOURCES.map((r) => [r, 0])),
    // Zero seen records is valid when the current cycle UUID was counted.
    seenThisCycleCounts: Object.fromEntries(FUDO_SYNC_RESOURCES.map((r) => [r, 0])),
    possiblyMissingCounts: {},
    recentRuns: [{
      startedAt: "2026-11-09T22:59:00Z",
      finishedAt: "2026-11-09T23:01:00Z",
      status: "completed", counts: {}, errorCode: null,
    }],
  };
}

test("a genuinely closed five-resource scan may show a verified cursor", () => {
  const view = completedFixture();
  assert.equal(hasVerifiableFudoFullCycle(view), true);
  for (const resource of FUDO_SYNC_RESOURCES) {
    assert.deepEqual(fudoCursorDisplay(view, resource), { label: "Ciclo leído", verified: true });
  }
  assert.equal(evaluateFudoPilotReadiness(view)[2].state, "done");
});

test("zero cursor after an interrupted or failed run is not a green import", () => {
  const view = completedFixture();
  const scenarios = [
    () => { view.lastSyncStatus = "failed"; view.recentRuns[0].status = "failed"; },
    () => { view.lastSyncStatus = "completed"; view.recentRuns[0].status = "completed";
      view.recentRuns[0].finishedAt = null; },
    () => { view.recentRuns[0].finishedAt = "2026-11-09T25:01:00Z"; },
    () => { view.recentRuns[0].finishedAt = "2026-11-09T23:01:00Z";
      view.seenThisCycleCounts.sales = null; },
  ];
  for (const mutate of scenarios) {
    mutate();
    assert.equal(hasVerifiableFudoFullCycle(view), false);
    assert.deepEqual(fudoCursorDisplay(view, "products"),
      { label: "Cursor 0 sin cierre verificable", verified: false });
    assert.notEqual(evaluateFudoPilotReadiness(view)[2].state, "done");
  }
});

test("partial runs and pending pages cannot claim a completed scan", () => {
  const view = completedFixture();
  view.lastSyncStatus = "partial";
  view.recentRuns[0].status = "partial";
  view.nextPages.orders = 3;
  assert.deepEqual(fudoCursorDisplay(view, "orders"), { label: "Pendiente: página 3", verified: false });
  assert.deepEqual(fudoCursorDisplay(view, "products"),
    { label: "Cursor 0 sin cierre verificable", verified: false });
  view.nextPages.orders = null;
  assert.deepEqual(fudoCursorDisplay(view, "orders"), { label: "Sin iniciar", verified: false });
  assert.equal(hasVerifiableFudoFullCycle(view), false);
});

test("unknown imported totals never render as an observed zero", () => {
  assert.equal(formatVerifiedFudoCount(undefined), "No verificable");
  assert.equal(formatVerifiedFudoCount(null), "No verificable");
  assert.equal(formatVerifiedFudoCount(Number.NaN), "No verificable");
  assert.equal(formatVerifiedFudoCount(-1), "No verificable");
  assert.equal(formatVerifiedFudoCount(1.5), "No verificable");
  assert.equal(formatVerifiedFudoCount(Number.MAX_SAFE_INTEGER + 1), "No verificable");
  assert.equal(formatVerifiedFudoCount(0), "0");
  assert.equal(formatVerifiedFudoCount(1234), (1234).toLocaleString("es-AR"));
});
