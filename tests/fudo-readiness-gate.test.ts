import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFudoPilotReadiness, fudoConnectionRevision, selectCurrentFudoPreflight } from "../lib/integrations/fudo/readiness";
import { FUDO_SYNC_RESOURCES } from "../lib/integrations/fudo/snapshot";
import type { FudoConnectionView, FudoResourcePreflight } from "../lib/integrations/fudo/service";

function view(): FudoConnectionView {
  return {
    configured: true, connectionRevision: null, status: "disconnected",
    lastTestedAt: null, lastSyncedAt: null, lastSyncStatus: null, lastErrorCode: null,
    lastCounts: {}, importedCounts: {}, seenThisCycleCounts: {}, possiblyMissingCounts: {},
    nextPages: {}, recentRuns: [],
  };
}
const allAvailable: FudoResourcePreflight = {
  ok: true, message: "synthetic",
  checks: FUDO_SYNC_RESOURCES.map((resource) => ({ resource, code: "available" })),
};

test("pilot readiness never says a product-only connection or a completed cursor equals go-live", () => {
  const result = view();
  result.status = "connected";
  let steps = evaluateFudoPilotReadiness(result);
  assert.deepEqual(steps.map((step) => step.state), ["done", "pending", "pending", "pending"]);

  result.lastSyncStatus = "completed";
  result.lastSyncedAt = "2026-11-04T12:00:01Z";
  result.nextPages = Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0]));
  // Every completed cursor must correspond to a cycle with an actual UUID.
  // The server returns a number (including zero for an empty resource) only
  // if it could query the current cycle; legacy cursors return null.
  result.seenThisCycleCounts = Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0]));
  result.recentRuns = [{
    startedAt: "2026-11-04T12:00:00Z", finishedAt: "2026-11-04T12:00:01Z",
    status: "completed", counts: {}, errorCode: null,
  }];
  steps = evaluateFudoPilotReadiness(result, allAvailable);
  assert.deepEqual(steps.map((step) => step.state), ["done", "done", "done", "pending"],
    "synthetic checks and imported cursors cannot prove production E2E or multiempresa");
});

test("pilot never marks a legacy cursor with unknown cycle provenance as a complete import", () => {
  const result = view();
  result.status = "connected";
  result.lastSyncStatus = "completed";
  result.lastSyncedAt = "2026-11-06T03:01:00Z";
  result.recentRuns = [{
    startedAt: "2026-11-06T03:00:00Z", finishedAt: "2026-11-06T03:01:00Z",
    status: "completed", counts: {}, errorCode: null,
  }];
  result.nextPages = Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0]));
  result.seenThisCycleCounts = Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0]));

  // SQL exposes null when a prior schema's cursor lacks cycle_id, not when
  // the resource is merely empty. A completed run cannot repair that.
  result.seenThisCycleCounts.orders = null;
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[2].state, "pending",
    "unknown cycle identity cannot be called a completed import");
  result.seenThisCycleCounts.orders = Number.NaN;
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[2].state, "pending");
  result.seenThisCycleCounts.orders = 0;
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[2].state, "done",
    "an empty but traceable resource is a valid completed scan");
});

test("pilot readiness is fail-closed for incomplete data, failed sync and partial permissions", () => {
  const result = view();
  result.status = "connected";
  result.lastSyncStatus = "failed";
  result.nextPages = Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0]));
  result.recentRuns = [{
    startedAt: "2026-11-04T12:00:00Z", finishedAt: "2026-11-04T12:00:01Z",
    status: "failed", counts: {}, errorCode: "invalid_response",
  }];
  const incomplete: FudoResourcePreflight = {
    ok: false, message: "synthetic",
    checks: FUDO_SYNC_RESOURCES.map((resource, i) => ({
      resource, code: i === 0 ? "forbidden" : "available",
    })),
  };
  assert.deepEqual(evaluateFudoPilotReadiness(result, incomplete).map((step) => step.state),
    ["done", "blocked", "blocked", "pending"]);
  result.lastSyncStatus = "completed";
  result.recentRuns[0].status = "completed";
  result.nextPages.sales = 2;
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[2].state, "pending");
  result.status = "error";
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[0].state, "blocked");
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[2].state, "pending");
});

test("pilot readiness never accepts stale green permissions for a disconnected or failed connection", () => {
  const result = view();
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[1].state, "pending",
    "a stale success must not pass when there are no stored credentials");
  result.status = "error";
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[1].state, "pending",
    "a failed retest cannot borrow an earlier successful permission probe");
  result.status = "connected";
  assert.equal(evaluateFudoPilotReadiness(result, allAvailable)[1].state, "done");
});


test("permission probes are scoped to the current rendered connection revision", () => {
  const status = view();
  status.status = "connected";
  status.lastTestedAt = "2026-11-04T14:00:00Z";
  status.connectionRevision = "a".repeat(64);
  const previous = { revision: fudoConnectionRevision(status)!, result: allAvailable };
  assert.equal(selectCurrentFudoPreflight(status, previous), allAvailable);
  status.lastTestedAt = "2026-11-04T14:01:00Z";
  status.connectionRevision = "b".repeat(64);
  assert.equal(selectCurrentFudoPreflight(status, previous), null,
    "a second admin's rotation/retest must invalidate older results on refresh");
  status.status = "disconnected";
  status.lastTestedAt = null;
  status.connectionRevision = null;
  assert.equal(selectCurrentFudoPreflight(status, previous), null);
});

test("permission probes cannot cross businesses with the same status and last test timestamp", () => {
  const businessA = view();
  businessA.status = "connected";
  businessA.lastTestedAt = "2026-11-05T05:00:00Z";
  businessA.connectionRevision = "a".repeat(64);
  const businessB = { ...businessA, connectionRevision: "b".repeat(64) };
  const previous = { revision: fudoConnectionRevision(businessA)!, result: allAvailable };
  assert.equal(selectCurrentFudoPreflight(businessA, previous), allAvailable);
  assert.equal(selectCurrentFudoPreflight(businessB, previous), null,
    "business A permissions must never be reused after selecting business B");
  assert.equal(selectCurrentFudoPreflight({ ...businessB, connectionRevision: null }, previous), null,
    "missing server revision must fail closed");
});

test("pilot rejects a completed run without a verified, chronological SQL closure", () => {
  const base = view();
  base.status = "connected";
  base.lastSyncStatus = "completed";
  base.lastSyncedAt = "2026-11-09T12:05:00Z";
  base.nextPages = Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0]));
  base.seenThisCycleCounts = Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0]));
  base.recentRuns = [{
    startedAt: "2026-11-09T12:00:00Z", finishedAt: "2026-11-09T12:05:00Z",
    status: "completed", counts: {}, errorCode: null,
  }];
  assert.equal(evaluateFudoPilotReadiness(base, allAvailable)[2].state, "done");
  for (const bad of [
    { ...base, lastSyncedAt: null },
    { ...base, lastSyncedAt: "2026-11-09T11:59:00Z" },
    { ...base, recentRuns: [{ ...base.recentRuns[0], finishedAt: null }] },
    { ...base, recentRuns: [{ ...base.recentRuns[0], finishedAt: "invalid" }] },
    { ...base, recentRuns: [{ ...base.recentRuns[0], finishedAt: "2026-11-09T11:59:00Z" }] },
  ]) {
    assert.equal(evaluateFudoPilotReadiness(bad, allAvailable)[2].state, "pending",
      "a status or cursor is not a durable completed-cycle certificate");
  }
});

