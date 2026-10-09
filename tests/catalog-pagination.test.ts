import test from "node:test";
import assert from "node:assert/strict";
import { readCatalogRows } from "../lib/catalog/pagination";

test("catalog pagination reads beyond the API page without silent truncation", async () => {
  const expected = Array.from({ length: 1201 }, (_, id) => ({ id }));
  const calls: number[] = [];
  const result = await readCatalogRows({ range: async (from: number, to: number) => { calls.push(from); return { data: expected.slice(from, to + 1), error: null }; } });
  assert.deepEqual(result.data, expected); assert.deepEqual(calls, [0, 500, 1000]);
});
test("catalog pagination discards partial results after an error", async () => {
  const result = await readCatalogRows({ range: async (from: number) => from === 0 ? { data: Array.from({ length: 500 }, (_, id) => ({ id })), error: null } : { data: null, error: "read_failed" } });
  assert.equal(result.data, null); assert.equal(result.error, "read_failed");
});
