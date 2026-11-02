import assert from "node:assert/strict";
import test from "node:test";
import { FudoApiError, FudoClient } from "../lib/integrations/fudo/client";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("Fudo client authenticates with apiKey/apiSecret and sends bearer token only to API calls", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const now = 1_800_000_000_000;

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://auth.fu.do/api") {
      return jsonResponse({ token: "token-value", exp: Math.floor((now + 86_400_000) / 1000) });
    }
    return jsonResponse({ data: [] });
  };

  const client = new FudoClient(
    { apiKey: "key-value", apiSecret: "secret-value" },
    { fetchImpl: fakeFetch, now: () => now },
  );

  await client.products({ "page[size]": 1 });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://auth.fu.do/api");
  assert.equal(calls[1].url, "https://api.fu.do/v1alpha1/products?page%5Bsize%5D=1");

  const authBody = String(calls[0].init?.body);
  assert.match(authBody, /"apiKey":"key-value"/);
  assert.match(authBody, /"apiSecret":"secret-value"/);
  assert.equal(new Headers(calls[1].init?.headers).get("authorization"), "Bearer token-value");
  assert.doesNotMatch(JSON.stringify(calls[1]), /secret-value|key-value/);
});

test("Fudo client refreshes once after a 401 and retries the same read", async () => {
  let authCount = 0;
  let apiCount = 0;
  const now = 1_800_000_000_000;

  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url === "https://auth.fu.do/api") {
      authCount += 1;
      return jsonResponse({
        token: `token-${authCount}`,
        exp: Math.floor((now + 86_400_000) / 1000),
      });
    }

    apiCount += 1;
    if (apiCount === 1) return jsonResponse({ error: "expired" }, 401);
    return jsonResponse({ data: [{ id: "1" }] });
  };

  const client = new FudoClient(
    { apiKey: "key", apiSecret: "secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );

  const result = await client.sales();
  assert.deepEqual(result, { data: [{ id: "1" }] });
  assert.equal(authCount, 2);
  assert.equal(apiCount, 2);
});

test("Fudo errors remain sanitized and distinguish permission failures", async () => {
  const fakeFetch: typeof fetch = async (input) => {
    if (String(input).includes("auth.fu.do")) {
      return jsonResponse({ token: "token", exp: 2_000_000_000 });
    }
    return jsonResponse({ error: "raw provider detail with secret" }, 403);
  };

  const client = new FudoClient(
    { apiKey: "top-secret-key", apiSecret: "top-secret-secret" },
    { fetchImpl: fakeFetch, now: () => 1_700_000_000_000 },
  );

  await assert.rejects(
    () => client.products(),
    (error: unknown) => {
      assert.ok(error instanceof FudoApiError);
      assert.equal(error.code, "forbidden");
      assert.equal(error.status, 403);
      assert.doesNotMatch(error.message, /top-secret|raw provider detail/);
      return true;
    },
  );
});

test("Fudo foundation exposes only GET/list helpers and no mutation methods", () => {
  const client = new FudoClient(
    { apiKey: "key", apiSecret: "secret" },
    { fetchImpl: (async () => jsonResponse({})) as typeof fetch },
  );

  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(client));
  assert.ok(names.includes("products"));
  assert.ok(names.includes("sales"));
  assert.ok(names.includes("testConnection"));
  assert.ok(!names.includes("create"));
  assert.ok(!names.includes("update"));
  assert.ok(!names.includes("delete"));
  assert.ok(!names.includes("post"));
  assert.ok(!names.includes("patch"));
});
