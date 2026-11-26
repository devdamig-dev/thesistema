import assert from "node:assert/strict";
import test from "node:test";
import { parseStrictFudoTimestamp } from "../lib/integrations/fudo/timestamp";
import { parseFudoPage, FUDO_SYNC_RESOURCES } from "../lib/integrations/fudo/snapshot";
import { evaluateFudoPilotReadiness, hasVerifiableFudoRunClosure } from "../lib/integrations/fudo/readiness";
import { buildFudoPilotEvidence } from "../lib/integrations/fudo/pilot-evidence";
import type { FudoConnectionView } from "../lib/integrations/fudo/service";

function completedView(): FudoConnectionView {
  return {
    configured: true, connectionRevision: null, status: "connected",
    lastTestedAt: "2026-11-04T12:00:00Z",
    lastSyncedAt: "2026-11-04T12:01:00Z",
    lastSyncStatus: "completed", lastErrorCode: null, lastCounts: {},
    importedCounts: {}, possiblyMissingCounts: {},
    seenThisCycleCounts: Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0])),
    nextPages: Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0])),
    recentRuns: [{
      startedAt: "2026-11-04T12:00:00Z", finishedAt: "2026-11-04T12:01:00Z",
      status: "completed", counts: {}, errorCode: null,
    }],
  };
}

test("O1 requires a calendar-valid, zoned SQL timestamp before asserting a completed cycle", () => {
  const view = completedView();
  assert.equal(hasVerifiableFudoRunClosure(view), true);
  assert.equal(evaluateFudoPilotReadiness(view)[2].state, "done");
  const invalid = [
    "2026-02-30T12:01:00Z",  // Date.parse may normalize an impossible day.
    "2026-11-04T12:01:00",   // A server-local timestamp is ambiguous.
    "2026-11-04T12:01:00+15:00",
    "2026-11-04T25:01:00Z",
    "2026-11-04",
    "2026-11-04T12:01:60Z",
  ];
  for (const timestamp of invalid) {
    for (const field of ["startedAt", "finishedAt"] as const) {
      const changed = completedView();
      changed.recentRuns[0][field] = timestamp;
      assert.equal(hasVerifiableFudoRunClosure(changed), false, `${field}: ${timestamp}`);
      assert.equal(evaluateFudoPilotReadiness(changed)[2].state, "pending");
      const report = buildFudoPilotEvidence(changed, null);
      assert.match(report, /Cursor 0 sin cierre verificable/);
      assert.doesNotMatch(report, /\| Productos \|[^\n]*\| Ciclo leído \|/);
    }
    const changed = completedView();
    changed.lastSyncedAt = timestamp;
    assert.equal(hasVerifiableFudoRunClosure(changed), false);
    assert.match(buildFudoPilotEvidence(changed, null), /Última sincronización: No registrada/);
  }
});

test("O1 accepts unambiguous RFC3339 offsets while preserving chronological comparison", () => {
  const view = completedView();
  view.recentRuns[0].startedAt = "2026-11-04T09:00:00-03:00";
  view.recentRuns[0].finishedAt = "2026-11-04T09:01:00-03:00";
  view.lastSyncedAt = "2026-11-04T12:01:00.000000Z";
  assert.equal(hasVerifiableFudoRunClosure(view), true);
  assert.equal(parseStrictFudoTimestamp(view.recentRuns[0].finishedAt), "2026-11-04T12:01:00.000Z");
  view.lastSyncedAt = "2026-11-04T12:00:59.999Z";
  assert.equal(hasVerifiableFudoRunClosure(view), false);
});

test("shared timestamp validation retains source provenance and rejects invalid provider calendar dates", () => {
  const record = (timestamp: string) => ({ data: [{
    type: "product", id: "synthetic-product",
    attributes: { updatedAt: timestamp },
  }] });
  const valid = record("2026-11-04T09:01:00-03:00");
  const parsed = parseFudoPage(valid, "products")[0];
  assert.equal(parsed.sourceUpdatedAt, "2026-11-04T12:01:00.000Z");
  assert.equal((parsed.payload.attributes as Record<string, unknown>).updatedAt, "2026-11-04T09:01:00-03:00");
  assert.equal(parseFudoPage(record("2026-02-30T12:01:00Z"), "products")[0].sourceUpdatedAt, null);
});
