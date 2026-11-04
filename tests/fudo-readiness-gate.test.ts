import assert from "node:assert/strict";
import test from "node:test";
import { evaluateFudoPilotReadiness } from "../lib/integrations/fudo/readiness";
import { FUDO_SYNC_RESOURCES } from "../lib/integrations/fudo/snapshot";
import type { FudoConnectionView, FudoResourcePreflight } from "../lib/integrations/fudo/service";

function view(): FudoConnectionView {
  return {
    configured: true, status: "disconnected",
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
  result.nextPages = Object.fromEntries(FUDO_SYNC_RESOURCES.map((resource) => [resource, 0]));
  result.recentRuns = [{
    startedAt: "2026-11-04T12:00:00Z", finishedAt: "2026-11-04T12:00:01Z",
    status: "completed", counts: {}, errorCode: null,
  }];
  steps = evaluateFudoPilotReadiness(result, allAvailable);
  assert.deepEqual(steps.map((step) => step.state), ["done", "done", "done", "pending"],
    "synthetic checks and imported cursors cannot prove production E2E or multiempresa");
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
