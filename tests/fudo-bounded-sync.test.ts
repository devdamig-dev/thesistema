import assert from "node:assert/strict";
import test from "node:test";
import { FUDO_SYNC_UI_BATCH_LIMIT, runFudoSyncBatches } from "../lib/integrations/fudo/action-feedback";

test("Fudo O1 continues bounded read-only pages and stops at completed cycle", async () => {
  let calls = 0;
  const result = await runFudoSyncBatches(async () => {
    calls++;
    return { ok: true, message: "tanda validada", hasMorePages: calls < 3 };
  });
  assert.equal(calls, 3);
  assert.deepEqual({ ok: result.ok, batches: result.completedBatches, pending: result.hasMorePages },
    { ok: true, batches: 3, pending: false });
  assert.match(result.message, /Fudo real|conciliar/);
});

test("Fudo O1 pauses at the foreground limit, preserving resumable pages", async () => {
  let calls = 0;
  const result = await runFudoSyncBatches(async () => {
    calls++;
    return { ok: true, message: "next page", hasMorePages: true };
  });
  assert.equal(calls, FUDO_SYNC_UI_BATCH_LIMIT);
  assert.equal(result.ok, true);
  assert.equal(result.hasMorePages, true);
  assert.equal(result.completedBatches, FUDO_SYNC_UI_BATCH_LIMIT);
  assert.match(result.message, /volvé a sincronizar/);
});

test("Fudo O1 never retries an uncertain or failed Server Action automatically", async () => {
  let calls = 0;
  const result = await runFudoSyncBatches(async () => {
    calls++;
    if (calls === 2) throw new Error("private provider key must not escape");
    return { ok: true, message: "page saved", hasMorePages: true };
  });
  assert.equal(calls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.completedBatches, 1);
  assert.equal(result.hasMorePages, false);
  assert.doesNotMatch(result.message, /private provider key/);
  assert.match(result.message, /Revisá tu conexión/);
});

test("Fudo O1 stops on explicit sanitized failures without another provider read", async () => {
  let calls = 0;
  const result = await runFudoSyncBatches(async () => {
    calls++;
    return { ok: false, message: "No tenés permisos.", hasMorePages: true };
  });
  assert.equal(calls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.completedBatches, 0);
  assert.match(result.message, /permisos/);
});

test("Fudo O1 rejects missing or malformed continuation flags without parsing success copy", async () => {
  for (const flag of [undefined, "false", 0, null]) {
    let calls = 0;
    const result = await runFudoSyncBatches(async () => {
      calls++;
      return { ok: true, message: "Se importó correctamente", hasMorePages: flag as boolean };
    });
    assert.equal(calls, 1);
    assert.equal(result.ok, false);
    assert.equal(result.completedBatches, 0);
    assert.equal(result.hasMorePages, false);
  }
});

test("Fudo O1 cannot bypass the max batch limit", async () => {
  let calls = 0;
  const action = async () => {
    calls++;
    return { ok: true, message: "page", hasMorePages: true };
  };
  for (const limit of [0, -1, 1.5, 6, Infinity, NaN]) {
    const result = await runFudoSyncBatches(action, limit);
    assert.equal(result.ok, false);
    assert.equal(result.completedBatches, 0);
  }
  assert.equal(calls, 0);
});
