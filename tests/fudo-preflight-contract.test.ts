import assert from "node:assert/strict";
import test from "node:test";
import { buildFudoPilotEvidence } from "../lib/integrations/fudo/pilot-evidence";
import {
  evaluateFudoPilotReadiness, isWellFormedFudoPreflight,
} from "../lib/integrations/fudo/readiness";
import type { FudoConnectionView, FudoResourcePreflight } from "../lib/integrations/fudo/service";

const REVISION = "a".repeat(64);
const view: FudoConnectionView = {
  configured: true,
  connectionRevision: REVISION,
  status: "connected",
  lastTestedAt: "2026-11-09T05:00:00.000Z",
  lastSyncedAt: null,
  lastSyncStatus: null,
  lastErrorCode: null,
  lastCounts: {},
  importedCounts: {},
  seenThisCycleCounts: {},
  possiblyMissingCounts: {},
  nextPages: {},
  recentRuns: [],
};

const green: FudoResourcePreflight = {
  ok: true,
  connectionRevision: REVISION,
  message: "provider diagnostic must not be copied",
  checks: [
    { resource: "products", code: "available" },
    { resource: "ingredients", code: "available" },
    { resource: "providers", code: "available" },
    { resource: "orders", code: "available" },
    { resource: "sales", code: "available" },
  ],
};

const state = (diagnostic: FudoResourcePreflight | null) =>
  evaluateFudoPilotReadiness(view, diagnostic).find((step) => step.id === "permissions")?.state;
const copy = (diagnostic: FudoResourcePreflight) =>
  buildFudoPilotEvidence(view, { revision: REVISION, result: diagnostic });

test("O1 reports five exact unique compatible GETs as only a partial permission check", () => {
  assert.equal(isWellFormedFudoPreflight(green), true);
  assert.equal(state(green), "done");
  assert.match(copy(green), /\| Ventas \| GET compatible \|/);
  assert.match(copy(green), /NO-GO/);
});

test("O1 never marks a six-row contradictory permission probe green", () => {
  // Previous UI accepted this because each resource appeared at least once,
  // despite an extra forbidden copy of a resource and a contradictory ok flag.
  const contradictory: FudoResourcePreflight = {
    ...green,
    checks: [...green.checks, { resource: "sales", code: "forbidden" }],
  };
  assert.equal(isWellFormedFudoPreflight(contradictory), false);
  assert.equal(state(contradictory), "blocked");
  const report = copy(contradictory);
  assert.doesNotMatch(report, /GET compatible/);
  assert.match(report, /Sin diagnóstico vigente/);
});

test("O1 refuses missing, unknown and logically inconsistent preflight checks", () => {
  const malformed: FudoResourcePreflight[] = [
    { ...green, checks: green.checks.slice(0, 4) },
    { ...green, checks: [...green.checks.slice(0, 4), { resource: "sales", code: "mystery" } as any] },
    { ...green, checks: [...green.checks.slice(0, 4), { resource: "other" as any, code: "available" }] },
    { ...green, ok: false },
    { ...green, checks: green.checks.map((check) =>
      check.resource === "sales" ? { ...check, code: "forbidden" as const } : check) },
  ];
  for (const diagnostic of malformed) {
    assert.equal(isWellFormedFudoPreflight(diagnostic), false);
    assert.equal(state(diagnostic), "blocked");
    assert.doesNotMatch(copy(diagnostic), /GET compatible/);
  }
});

test("O1 keeps legitimate 403 statuses visible without inventing permission success", () => {
  const denied: FudoResourcePreflight = {
    ...green, ok: false,
    checks: green.checks.map((check) =>
      check.resource === "providers" ? { ...check, code: "forbidden" as const } : check),
  };
  assert.equal(isWellFormedFudoPreflight(denied), true);
  assert.equal(state(denied), "blocked");
  const report = copy(denied);
  assert.match(report, /\| Proveedores \| Sin permiso \|/);
  assert.match(report, /\| Productos \| GET compatible \|/);
  assert.doesNotMatch(report, /provider diagnostic must not be copied/);
});

test("O1 readiness never carries a green result after disconnection", () => {
  const disconnected = { ...view, status: "disconnected" as const };
  assert.equal(
    evaluateFudoPilotReadiness(disconnected, green).find((step) => step.id === "permissions")?.state,
    "pending",
  );
  assert.doesNotMatch(buildFudoPilotEvidence(disconnected, {
    revision: REVISION, result: green,
  }), /GET compatible/);
});
