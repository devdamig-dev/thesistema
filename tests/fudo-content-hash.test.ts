import assert from "node:assert/strict";
import test from "node:test";
import { parseFudoPage } from "../lib/integrations/fudo/snapshot";

function snapshot(body: Record<string, unknown>) {
  return parseFudoPage({ data: [body] }, "products")[0];
}

test("Fudo O1 hash is stable under provider JSON object key reordering", () => {
  const original = {
    type: "product",
    id: "product-synthetic",
    attributes: {
      name: "Menú de prueba",
      price: 1250.5,
      nested: { category: "test", options: [{ id: "a", quantity: 2 }, { id: "b", quantity: 3 }] },
    },
    meta: { source: "synthetic", revision: 2 },
  };
  const reordered = {
    meta: { revision: 2, source: "synthetic" },
    attributes: {
      nested: { options: [{ quantity: 2, id: "a" }, { quantity: 3, id: "b" }], category: "test" },
      price: 1250.5,
      name: "Menú de prueba",
    },
    id: "product-synthetic",
    type: "product",
  };

  assert.notEqual(JSON.stringify(original), JSON.stringify(reordered),
    "regression fixture must differ in source field order");
  const first = snapshot(original);
  const second = snapshot(reordered);
  assert.equal(first.externalId, second.externalId);
  assert.equal(first.contentHash, second.contentHash,
    "semantically equal JSONB objects must not produce a phantom content change");
  assert.match(first.contentHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.payload, original, "the raw provider payload must not be replaced by its canonical hash input");
  assert.deepEqual(second.payload, reordered);
});

test("Fudo O1 canonical hash still detects value changes and array reordering", () => {
  const base = {
    type: "product",
    id: "product-synthetic",
    attributes: { name: "Example", prices: [100, 200], variants: [{ code: "x" }, { code: "y" }] },
  };
  const baseHash = snapshot(base).contentHash;
  assert.notEqual(snapshot({
    ...base,
    attributes: { ...base.attributes, prices: [100, 201] },
  }).contentHash, baseHash);
  assert.notEqual(snapshot({
    ...base,
    attributes: { ...base.attributes, variants: [{ code: "y" }, { code: "x" }] },
  }).contentHash, baseHash, "array element order remains meaningful");
});
