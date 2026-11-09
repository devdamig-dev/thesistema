import assert from "node:assert/strict";
import test from "node:test";
import { assertUniqueFudoJsonKeys } from "../lib/integrations/fudo/json-keys";

test("Fudo JSON guard rejects repeated object keys before lossy JSON.parse", () => {
  for (const json of [
    '{"data":[{"id":"x","attributes":{"price":1,"price":2}}]}',
    '{"data":[{"id":"x"},{"id":"x","id":"y"}]}',
    String.raw`{"id":"x","\u0069d":"y"}`,
    String.raw`{"obj":{"\u0061":1,"a":2}}`,
  ]) {
    assert.throws(() => assertUniqueFudoJsonKeys(json), /fudo_json_duplicate_key/);
  }
});

test("Fudo JSON guard permits keys repeated across distinct objects and escaped string content", () => {
  for (const json of [
    '{"data":[{"id":"a"},{"id":"b"}]}',
    String.raw`{"data":[{"id":"x","notes":"{ \"id\": 7 }"},{"id":"y","notes":"colon: and \"quoted\""}]}`,
    '{"first":{"name":"a"},"second":{"name":"b"}}',
    '{"value":[{"key":1},{"key":2}]}',
  ]) {
    assert.doesNotThrow(() => assertUniqueFudoJsonKeys(json));
    assert.doesNotThrow(() => JSON.parse(json));
  }
});
