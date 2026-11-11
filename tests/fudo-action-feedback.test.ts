import assert from "node:assert/strict";
import test from "node:test";
import { runFudoActionSafely, runFudoPreflightSafely } from "../lib/integrations/fudo/action-feedback";
import type { FudoResourcePreflight } from "../lib/integrations/fudo/service";

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


test("Fudo preflight preserves well-formed partial diagnostics but cannot invent a five-resource success", async () => {
  const resources = ["products", "ingredients", "providers", "orders", "sales"] as const;
  const valid = { ok: true, message: "Cinco lecturas compatibles.", checks: resources.map(
    (resource) => ({ resource, code: "available" as const }),
  ) };
  assert.deepEqual(await runFudoPreflightSafely(async () => valid), valid);
  const partial = { ok: false, message: "Hay recursos sin permiso.", checks: [
    { resource: "products" as const, code: "available" as const },
    { resource: "sales" as const, code: "forbidden" as const },
  ] };
  assert.deepEqual(await runFudoPreflightSafely(async () => partial), partial);
});

test("Fudo preflight rejects malformed, duplicated or unverified checks without false green status", async () => {
  const resources = ["products", "ingredients", "providers", "orders", "sales"] as const;
  const validChecks = resources.map((resource) => ({ resource, code: "available" }));
  const malformed: unknown[] = [
    null, undefined, { ok: true, message: "Success" },
    { ok: true, message: "Success", checks: null },
    { ok: true, message: "Success", checks: {} },
    { ok: true, message: "Success", checks: [] },
    { ok: true, message: "Success", checks: validChecks.slice(0, 4) },
    { ok: true, message: "Success", checks: [...validChecks, validChecks[0]] },
    { ok: true, message: "Success", checks: [...validChecks.slice(0, 4), { resource: "sales", code: "forbidden" }] },
    { ok: true, message: "Success", checks: [...validChecks.slice(0, 4), { resource: "other", code: "available" }] },
    { ok: true, message: "Success", checks: [...validChecks.slice(0, 4), { resource: "sales", code: "unexpected" }] },
    { ok: false, message: "Failed", checks: [null] },
    { ok: false, message: "Failed", checks: [42] },
  ];
  for (const response of malformed) {
    const result = await runFudoPreflightSafely(async () => response as FudoResourcePreflight);
    assert.equal(result.ok, false, JSON.stringify(response));
    assert.deepEqual(result.checks, [], JSON.stringify(response));
    assert.match(result.message, /Revisá tu conexión/);
  }
  const leaked = "sensitive-provider-exception";
  const thrown = await runFudoPreflightSafely(async () => {
    throw new Error(leaked);
  });
  assert.equal(thrown.ok, false);
  assert.deepEqual(thrown.checks, []);
  assert.ok(!JSON.stringify(thrown).includes(leaked));
});


test("Fudo action feedback preserves the server revision for the five-resource UI gate", async () => {
  const revision = "a".repeat(64);
  const resources = ["products", "ingredients", "providers", "orders", "sales"] as const;
  const raw: FudoResourcePreflight = {
    ok: true, message: "cinco recursos verificados", connectionRevision: revision,
    checks: resources.map((resource) => ({ resource, code: "available" })),
  };
  assert.deepEqual(await runFudoPreflightSafely(async () => raw), raw,
    "the sanitizer must not silently discard the server's credential generation fence");
  for (const bad of ["", "old-revision", "A".repeat(64), "a".repeat(65), 123] as unknown[]) {
    const corrupted = await runFudoPreflightSafely(async () => ({
      ...raw, connectionRevision: bad,
    } as FudoResourcePreflight));
    assert.equal(corrupted.ok, false, "a forged or malformed revision cannot authorize green UI checks");
    assert.deepEqual(corrupted.checks, []);
    assert.equal(corrupted.connectionRevision, undefined);
  }
});
