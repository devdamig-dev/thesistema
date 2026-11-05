import assert from "node:assert/strict";
import test from "node:test";
import { runFudoActionSafely } from "../lib/integrations/fudo/action-feedback";

test("Fudo UI keeps sanitized result returned by the server", async () => {
  assert.deepEqual(await runFudoActionSafely(async () => ({
    ok: true, message: "Conexión validada.",
  })), { ok: true, message: "Conexión validada." });
  assert.deepEqual(await runFudoActionSafely(async () => ({
    ok: false, message: "Fudo rechazó las credenciales.",
  })), { ok: false, message: "Fudo rechazó las credenciales." });
});

test("Fudo UI handles network/server action rejection without leaking exception details", async () => {
  const sensitive = "provider-secret-is-never-displayed";
  const result = await runFudoActionSafely(async () => {
    throw new Error("Network failed: " + sensitive);
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /Revisá tu conexión/);
  assert.ok(!result.message.includes(sensitive));
});

test("Fudo UI does not mistake malformed action responses for success", async () => {
  const malformed: unknown[] = [null, undefined, "", { ok: true }, { ok: "true", message: "Listo" },
    { ok: true, message: "" }, { ok: true, message: 123 }];
  for (const value of malformed) {
    const result = await runFudoActionSafely(async () => value as { ok: boolean; message: string });
    assert.equal(result.ok, false, JSON.stringify(value));
    assert.match(result.message, /Revisá tu conexión/);
  }
});
