import assert from "node:assert/strict";
import test from "node:test";
import { buildFudoPilotEvidence } from "../lib/integrations/fudo/pilot-evidence";
import type { FudoConnectionView, FudoResourcePreflight } from "../lib/integrations/fudo/service";

const REVISION = "a".repeat(64);
const view: FudoConnectionView = {
  configured: true,
  connectionRevision: REVISION,
  status: "connected",
  lastTestedAt: "2026-11-09T04:00:00.000Z",
  lastSyncedAt: "2026-11-09T04:30:00.000Z",
  lastSyncStatus: "completed",
  lastErrorCode: "private-upstream-record",
  lastCounts: { products: 7 },
  importedCounts: { products: 7, ingredients: 0, providers: 2, orders: 1, sales: 9 },
  seenThisCycleCounts: { products: 7, ingredients: 0, providers: 2, orders: 1, sales: 9 },
  possiblyMissingCounts: { products: 0, ingredients: 0, providers: 1, orders: 0, sales: 0 },
  nextPages: { products: 0, ingredients: 0, providers: 0, orders: 0, sales: 0 },
  recentRuns: [{
    startedAt: "2026-11-09T04:25:00.000Z",
    finishedAt: "2026-11-09T04:30:00.000Z",
    status: "completed", counts: { sales: 9 }, errorCode: "private-upstream-record",
  }],
};

const probe: FudoResourcePreflight = {
  ok: true,
  message: "private-upstream-message",
  checks: ["products", "ingredients", "providers", "orders", "sales"].map(
    (resource) => ({ resource, code: "available" }),
  ) as FudoResourcePreflight["checks"],
};

test("Fudo private pilot copy shows five read-only resources, counts and explicit NO-GO", () => {
  const report = buildFudoPilotEvidence(
    view, { revision: REVISION, result: probe }, new Date("2026-11-09T05:00:00.000Z"),
  );
  assert.match(report, /GastroPilot O1.*NO-GO/);
  assert.match(report, /Generado \(UTC\): 2026-11-09T05:00:00.000Z/);
  assert.match(report, /\| Productos \| GET compatible \| 7 \| 7 \| 0 \| Ciclo leído \|/);
  assert.match(report, /\| Ingredientes \| GET compatible \| 0 \| 0 \| 0 \| Ciclo leído \|/);
  assert.match(report, /\| Proveedores \| GET compatible \| 2 \| 2 \| 1 \| Ciclo leído \|/);
  assert.match(report, /dos ciclos idempotentes/);
  assert.match(report, /aislamiento A\/B/);
  for (const privateValue of [REVISION, "private-upstream-record", "private-upstream-message"]) {
    assert.ok(!report.includes(privateValue), "report must not contain tenant revisions or upstream diagnostics");
  }
});

test("Fudo copy never reuses previous connection's green probes", () => {
  const rotated = { ...view, connectionRevision: "b".repeat(64) };
  const report = buildFudoPilotEvidence(rotated, { revision: REVISION, result: probe });
  assert.match(report, /Sin diagnóstico vigente/);
  assert.doesNotMatch(report, /GET compatible/);
});

test("Fudo copy rejects malformed probes and never turns unknown counters into zero", () => {
  const report = buildFudoPilotEvidence({
    ...view,
    importedCounts: { ...view.importedCounts, products: -3 },
    seenThisCycleCounts: { ...view.seenThisCycleCounts, products: null },
    possiblyMissingCounts: { ...view.possiblyMissingCounts, products: null },
    nextPages: { ...view.nextPages, products: 900001 },
    lastSyncedAt: "private-provider-timestamp",
  }, {
    revision: REVISION,
    result: { ...probe, checks: [probe.checks[0], probe.checks[0]] },
  });
  assert.match(report, /\| Productos \| Sin diagnóstico vigente \| No verificable \| No verificable \| No verificable \| Sin iniciar\/no verificable \|/);
  assert.match(report, /Última sincronización: No registrada/);
  assert.ok(!report.includes("private-provider-timestamp"));
});

test("Fudo disconnected state cannot certify a probe even with matching stale revision", () => {
  const disconnected: FudoConnectionView = {
    ...view, status: "disconnected", connectionRevision: REVISION,
  };
  const report = buildFudoPilotEvidence(disconnected, { revision: REVISION, result: probe });
  assert.match(report, /Conexión: Sin conexión/);
  assert.doesNotMatch(report, /GET compatible/);
  assert.match(report, /\| Productos \| Sin diagnóstico vigente \| 7 \| 7 \| No verificable \| Cursor 0 sin cierre verificable \|/);
  assert.match(report, /NO-GO/);
});

test("Fudo copy does not promote a contradictory failed diagnostic to five green GETs", () => {
  const report = buildFudoPilotEvidence(view, {
    revision: REVISION,
    result: { ...probe, ok: false },
  });
  assert.match(report, /Sin diagnóstico vigente/);
  assert.doesNotMatch(report, /GET compatible/);
});

test("Fudo copy does not present a legacy cursor 0 as a verified full scan", () => {
  const legacy = {
    ...view,
    // A pre-cycle UUID legacy cursor can be zero without any stable scan ID.
    seenThisCycleCounts: { ...view.seenThisCycleCounts, products: null },
  };
  const report = buildFudoPilotEvidence(legacy, { revision: REVISION, result: probe });
  assert.match(report, /\| Productos \| GET compatible \| 7 \| No verificable \| No verificable \| Cursor 0 sin cierre verificable \|/);
  assert.doesNotMatch(report, /\| Productos \|[^\n]*Ciclo leído/);
  assert.match(report, /\| Ingredientes \| GET compatible \| 0 \| 0 \| 0 \| Ciclo leído \|/);
});

test("Fudo copy refuses to certify cursor 0 after an incomplete or failed run", () => {
  for (const status of ["running", "partial", "failed"] as const) {
    const interrupted: FudoConnectionView = {
      ...view,
      lastSyncStatus: status,
      recentRuns: [{ ...view.recentRuns[0], status }],
    };
    const report = buildFudoPilotEvidence(interrupted, { revision: REVISION, result: probe });
    assert.match(report, /\| Productos \| GET compatible \| 7 \| 7 \| No verificable \| Cursor 0 sin cierre verificable \|/);
    assert.doesNotMatch(report, /\| Productos \|[^\n]*Ciclo leído/);
  }
});


test("pilot acta refuses a completed cursor with uncommitted or reversed run timestamps", () => {
  const baseline = buildFudoPilotEvidence(view, { revision: REVISION, result: probe });
  assert.match(baseline, /\| Productos \| GET compatible \| 7 \| 7 \| 0 \| Ciclo leído \|/);
  const variants: FudoConnectionView[] = [
    { ...view, lastSyncedAt: null },
    { ...view, lastSyncedAt: "2026-11-09T04:20:00.000Z" },
    { ...view, recentRuns: [{ ...view.recentRuns[0], finishedAt: null }] },
    { ...view, recentRuns: [{ ...view.recentRuns[0], finishedAt: "invalid" }] },
    { ...view, recentRuns: [{ ...view.recentRuns[0], finishedAt: "2026-11-09T04:20:00.000Z" }] },
  ];
  for (const bad of variants) {
    const report = buildFudoPilotEvidence(bad, { revision: REVISION, result: probe });
    assert.match(report, /\| Productos \| GET compatible \| 7 \| 7 \| No verificable \| Cursor 0 sin cierre verificable \|/);
    assert.doesNotMatch(report, /\| Productos \|[^\n]*Ciclo leído/);
  }
});
