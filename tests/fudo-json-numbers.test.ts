import assert from "node:assert/strict";
import test from "node:test";
import { FudoApiError, FudoClient } from "../lib/integrations/fudo/client";
import { assertSafeFudoJsonNumbers } from "../lib/integrations/fudo/json-numbers";
import { parseFudoPage } from "../lib/integrations/fudo/snapshot";

test("Fudo O1 rejects lossy raw JSON numbers before JSON.parse", () => {
  const invalid = [
    '{"data":[{"id":"sale-1","attributes":{"amount":1.234567890123456789}}]}',
    '{"data":[{"id":"sale-1","attributes":{"amount":-0.123456789012345678}}]}',
    '{"data":[{"id":"sale-1","attributes":{"amount":1e-999}}]}',
    '{"data":[{"id":"sale-1","attributes":{"amount":-1e999}}]}',
    '{"data":[{"id":"sale-1","attributes":{"amount":9007199254740993}}]}',
  ];
  for (const body of invalid) {
    assert.throws(() => assertSafeFudoJsonNumbers(body), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "fudo_numeric_precision_loss");
      assert.doesNotMatch(error.message, /sale-1|amount|9007199254740993/);
      return true;
    });
  }
});

test("Fudo O1 accepts conventional numbers, exact strings and quoted numeric-looking text", () => {
  const source = JSON.stringify({
    data: [{
      type: "sale",
      id: "sale-1",
      attributes: {
        amount: 12.75,
        tax: 0.15,
        tinyNonzero: 1e-12,
        largestSafeInteger: Number.MAX_SAFE_INTEGER,
        exactHighPrecisionAmount: "1.234567890123456789",
        text: 'Escaped quote " then 1e999 and 9007199254740993 are TEXT',
      },
    }],
  });
  assert.doesNotThrow(() => assertSafeFudoJsonNumbers(source));
  const snapshots = parseFudoPage(JSON.parse(source), "sales");
  assert.equal(snapshots.length, 1);
  assert.equal((snapshots[0].payload.attributes as Record<string, unknown>).amount, 12.75);
  assert.equal((snapshots[0].payload.attributes as Record<string, unknown>).exactHighPrecisionAmount,
    "1.234567890123456789");
  assert.match(snapshots[0].contentHash, /^[0-9a-f]{64}$/);
});

test("Fudo GET rejects an unsafe decimal with sanitized invalid_response, without staging it", async () => {
  const providerJson = '{"data":[{"type":"sale","id":"private-sale","attributes":{"total":1.234567890123456789}}]}';
  let resourceReads = 0;
  const now = 1_800_000_000_000;
  const fakeFetch: typeof fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      return new Response(JSON.stringify({
        token: "private-bearer",
        exp: Math.floor((now + 86_400_000) / 1000),
      }), { status: 200 });
    }
    resourceReads++;
    assert.equal(init?.method, "GET");
    return new Response(providerJson, { status: 200 });
  };
  const client = new FudoClient({ apiKey: "private-key", apiSecret: "private-secret" },
    { fetchImpl: fakeFetch, now: () => now });
  await assert.rejects(() => client.sales(), (error: unknown) => {
    assert.ok(error instanceof FudoApiError);
    assert.equal(error.code, "invalid_response");
    assert.equal(error.retryable, false);
    assert.doesNotMatch(error.message, /private-|bearer|1.234567890123456789|total/);
    return true;
  });
  assert.equal(resourceReads, 1);
});
