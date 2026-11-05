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

test("Fudo missing exp reuses one short-lived bearer for all five read-only probes", async () => {
  let now = 1_800_000_000_000;
  let authCalls = 0;
  let reads = 0;
  const methods: string[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      authCalls++;
      assert.equal(init?.method, "POST");
      return jsonResponse({ token: `short-lease-${authCalls}` }); // No exp supplied.
    }
    methods.push(String(init?.method));
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer short-lease-${authCalls}`);
    reads++;
    return jsonResponse({ data: [], links: { next: null } });
  };
  const client = new FudoClient(
    { apiKey: "synthetic-key", apiSecret: "synthetic-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );
  const resources = ["products", "ingredients", "providers", "orders", "sales"] as const;
  const results = await client.probeReadAccess(resources);
  assert.deepEqual(results, resources.map((resource) => ({ resource, code: "available" })));
  assert.equal(authCalls, 1, "missing exp must not cause per-resource reauthentication");
  await client.testConnection();
  assert.equal(authCalls, 1, "sequential reads must share the bounded token lease");
  assert.equal(reads, 6);
  // With five-minute skew, the conservative ten-minute lease forces refresh
  // after six minutes, never treating an unknown expiry as indefinite.
  now += 6 * 60 * 1000;
  await client.testConnection();
  assert.equal(authCalls, 2);
  assert.equal(reads, 7);
  assert.ok(methods.every((method) => method === "GET"));
  assert.doesNotMatch(JSON.stringify(results), /synthetic-|short-lease-/);
});

test("Fudo rejects malformed or expired explicit auth expiry without any resource GET", async () => {
  const now = 1_800_000_000_000;
  for (const exp of ["not-a-timestamp", 0, -1, Math.floor((now - 1000) / 1000)]) {
    let authCalls = 0;
    let reads = 0;
    const fakeFetch: typeof fetch = async (input) => {
      if (String(input) === "https://auth.fu.do/api") {
        authCalls++;
        return jsonResponse({ token: "synthetic-expiry-bearer", exp });
      }
      reads++;
      return jsonResponse({ data: [] });
    };
    const client = new FudoClient(
      { apiKey: "synthetic-key", apiSecret: "synthetic-secret" },
      { fetchImpl: fakeFetch, now: () => now },
    );
    await assert.rejects(() => client.testConnection(), (error: unknown) => {
      assert.ok(error instanceof FudoApiError);
      assert.equal(error.code, "invalid_response");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /synthetic-|bearer|not-a-timestamp/i);
      return true;
    });
    assert.equal(authCalls, 1);
    assert.equal(reads, 0, "a stale or malformed explicit expiry cannot authorize GET");
  }
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

test("Fudo auth rejects JSON null, arrays and primitives as sanitized invalid responses", async () => {
  const invalidPayloads = [null, [], "not-an-object", false, 42, { token: null }];
  for (const payload of invalidPayloads) {
    let authRequests = 0;
    let apiReads = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      assert.equal(init?.redirect, "error");
      if (String(input) === "https://auth.fu.do/api") {
        authRequests++;
        return jsonResponse(payload);
      }
      apiReads++;
      return jsonResponse({ data: [{ id: "never-read" }] });
    };
    const client = new FudoClient(
      { apiKey: "private-key", apiSecret: "private-secret" },
      { fetchImpl: fakeFetch },
    );
    await assert.rejects(() => client.testConnection(), (error: unknown) => {
      assert.ok(error instanceof FudoApiError);
      assert.equal(error.code, "invalid_response");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /private-key|private-secret|not-an-object/);
      return true;
    }, JSON.stringify(payload));
    assert.equal(authRequests, 1);
    assert.equal(apiReads, 0, "invalid auth must never trigger a resource GET");
  }
});

test("Fudo rejects malformed bearer strings before sending any resource GET", async () => {
  const malformedTokens = [" ", "\r\ninjected", "token\nunsafe", "token\tbad", "a".repeat(8193)];
  for (const token of malformedTokens) {
    let authRequests = 0;
    let apiReads = 0;
    const fakeFetch: typeof fetch = async (input, init) => {
      assert.equal(init?.redirect, "error");
      if (String(input) === "https://auth.fu.do/api") {
        authRequests++;
        return jsonResponse({ token, exp: 2_000_000_000 });
      }
      apiReads++;
      return jsonResponse({ data: [] });
    };
    const client = new FudoClient(
      { apiKey: "synthetic-key", apiSecret: "synthetic-secret" },
      { fetchImpl: fakeFetch },
    );
    await assert.rejects(() => client.testConnection(), (error: unknown) => {
      assert.ok(error instanceof FudoApiError);
      assert.equal(error.code, "invalid_response");
      assert.equal(error.retryable, false);
      assert.doesNotMatch(error.message, /injected|unsafe|synthetic-/);
      return true;
    });
    assert.equal(authRequests, 1);
    assert.equal(apiReads, 0, "invalid bearer must never be forwarded to a GET");
  }
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

test("Fudo never follows auth or API redirects carrying secrets or bearer tokens", async () => {
  const seen: Array<{ method?: string; redirect?: RequestRedirect }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    seen.push({ method: init?.method, redirect: init?.redirect });
    if (String(input) === "https://auth.fu.do/api") {
      return jsonResponse({ token: "test-token", exp: 2_000_000_000 });
    }
    return jsonResponse({ data: [] });
  };
  const client = new FudoClient(
    { apiKey: "private-key", apiSecret: "private-secret" },
    { fetchImpl: fakeFetch, now: () => 1_800_000_000_000 },
  );
  await client.products();
  assert.deepEqual(seen, [
    { method: "POST", redirect: "error" },
    { method: "GET", redirect: "error" },
  ]);
});

test("Fudo preflight probes each resource without returning private records or permission details", async () => {
  let authCalls = 0;
  const requests: string[] = [];
  const now = 1_800_000_000_000;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://auth.fu.do/api") {
      authCalls++;
      assert.equal(init?.redirect, "error");
      return jsonResponse({ token: "private-bearer", exp: Math.floor((now + 86_400_000) / 1000) });
    }
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer private-bearer");
    requests.push(url);
    if (url.includes("/providers?")) return jsonResponse({ private: "do not expose" }, 403);
    if (url.includes("/orders?")) return jsonResponse({ message: "non-JSON-API response with sensitive value" });
    return jsonResponse({ data: [{ id: "example", attributes: { name: "private product data" } }] });
  };
  const client = new FudoClient(
    { apiKey: "private-key", apiSecret: "private-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );
  const results = await client.probeReadAccess(["products", "ingredients", "providers", "orders", "sales"]);
  assert.equal(authCalls, 1);
  assert.equal(requests.length, 5);
  assert.deepEqual(results.map(({ resource, code }) => [resource, code]), [
    ["products", "available"],
    ["ingredients", "available"],
    ["providers", "forbidden"],
    ["orders", "invalid_response"],
    ["sales", "available"],
  ]);
  assert.doesNotMatch(JSON.stringify(results), /private|bearer|secret|example|sensitive value/i);
});

test("Fudo connection probe rejects an HTTP 200 with incompatible JSON:API payload", async () => {
  let authCalls = 0;
  let readCalls = 0;
  const now = 1_800_000_000_000;
  const fakeFetch: typeof fetch = async (input) => {
    if (String(input) === "https://auth.fu.do/api") {
      authCalls++;
      return jsonResponse({ token: "private-bearer", exp: Math.floor((now + 86400000) / 1000) });
    }
    readCalls++;
    return jsonResponse({ message: "provider error wrapped in 200", apiKey: "PRIVATE_LEAK" });
  };
  const client = new FudoClient(
    { apiKey: "valid-looking-key", apiSecret: "valid-looking-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );

  await assert.rejects(
    () => client.testConnection(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "invalid_fudo_page");
      assert.doesNotMatch(error.message, /PRIVATE_LEAK|valid-looking/);
      return true;
    },
  );
  assert.equal(authCalls, 1);
  assert.equal(readCalls, 1);
});

test("Fudo connection probe accepts compatible empty and one-record JSON:API pages", async () => {
  let reads = 0;
  const now = 1_800_000_000_000;
  const fakeFetch: typeof fetch = async (input) => {
    if (String(input) === "https://auth.fu.do/api") {
      return jsonResponse({ token: "test", exp: Math.floor((now + 86400000) / 1000) });
    }
    reads++;
    return jsonResponse(reads === 1 ? { data: [] } : { data: [{ id: "product-1", attributes: { name: "Demo" } }] });
  };
  const client = new FudoClient(
    { apiKey: "valid-looking-key", apiSecret: "valid-looking-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );
  assert.deepEqual(await client.testConnection(), { ok: true });
  assert.deepEqual(await client.testConnection(), { ok: true });
  assert.equal(reads, 2);
});


test("Fudo five concurrent probes share one refresh after an expired bearer", async () => {
  const now = 1_800_000_000_000;
  const resources = ["products", "ingredients", "providers", "orders", "sales"] as const;
  let authCount = 0;
  let oldBearerReads = 0;
  let newBearerReads = 0;
  let releaseOldReads: () => void = () => {};
  const allOldReads = new Promise<void>((resolve) => { releaseOldReads = resolve; });

  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://auth.fu.do/api") {
      authCount++;
      return jsonResponse({
        token: `bearer-${authCount}`,
        exp: Math.floor((now + 86_400_000) / 1000),
      });
    }
    assert.equal(init?.method, "GET");
    const bearer = new Headers(init?.headers).get("authorization");
    if (bearer === "Bearer bearer-1") {
      oldBearerReads++;
      if (oldBearerReads === resources.length) releaseOldReads();
      // All first requests reach Fudo before the revoked token is rejected.
      await allOldReads;
      return jsonResponse({ error: "revoked (must not leak)" }, 401);
    }
    assert.equal(bearer, "Bearer bearer-2");
    newBearerReads++;
    return jsonResponse({ data: [] });
  };

  const client = new FudoClient(
    { apiKey: "private-test-key", apiSecret: "private-test-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );
  const checks = await client.probeReadAccess(resources);
  assert.deepEqual(checks, resources.map((resource) => ({ resource, code: "available" })));
  assert.equal(authCount, 2, "initial authentication plus ONE coalesced refresh");
  assert.equal(oldBearerReads, 5);
  assert.equal(newBearerReads, 5);
  assert.doesNotMatch(JSON.stringify(checks), /private-test|bearer|revoked/i);
});

test("Fudo failed auth single-flight is cleared so a later read can retry", async () => {
  let authCount = 0;
  const now = 1_800_000_000_000;
  const fakeFetch: typeof fetch = async (input) => {
    if (String(input) === "https://auth.fu.do/api") {
      authCount++;
      if (authCount === 1) throw new Error("temporary auth failure");
      return jsonResponse({ token: "recovered", exp: Math.floor((now + 86_400_000) / 1000) });
    }
    return jsonResponse({ data: [] });
  };
  const client = new FudoClient(
    { apiKey: "private-key", apiSecret: "private-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );

  await assert.rejects(() => client.products(), (error: unknown) => {
    assert.ok(error instanceof FudoApiError);
    assert.equal(error.code, "provider_unavailable");
    assert.doesNotMatch(error.message, /temporary auth failure|private-/);
    return true;
  });
  assert.deepEqual(await client.products(), { data: [] });
  assert.equal(authCount, 2);
});

test("Fudo connection and readiness probes reject malformed first-page pagination", async () => {
  const methods: string[] = [];
  let authCalls = 0;
  const now = 1_800_000_000_000;
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://auth.fu.do/api") {
      authCalls++;
      return jsonResponse({ token: "private-bearer", exp: Math.floor((now + 86400000) / 1000) });
    }
    methods.push(String(init?.method));
    if (new URL(url).pathname.endsWith("/products")) {
      // Valid record body, invalid JSON:API links. A green connection or
      // preflight would be misleading because the full import must fail.
      return jsonResponse({ data: [{ id: "sensitive-product" }], links: { next: true } });
    }
    return jsonResponse({ data: [], links: { next: null } });
  };
  const client = new FudoClient(
    { apiKey: "private-key", apiSecret: "private-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );

  await assert.rejects(() => client.testConnection(), /invalid_fudo_page/);
  const checks = await client.probeReadAccess(["products", "ingredients"]);
  assert.deepEqual(checks, [
    { resource: "products", code: "invalid_response" },
    { resource: "ingredients", code: "available" },
  ]);
  assert.equal(authCalls, 1);
  assert.deepEqual(methods, ["GET", "GET", "GET"]);
  assert.doesNotMatch(JSON.stringify(checks), /private|sensitive-product|bearer/);
});

test("Fudo preflight rejects a same-origin next link for another resource", async () => {
  const methods: string[] = [];
  const now = 1_800_000_000_000;
  const fakeFetch: typeof fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      return jsonResponse({ token: "synthetic-bearer", exp: Math.floor((now + 86400000) / 1000) });
    }
    methods.push(String(init?.method));
    const resource = new URL(String(input)).pathname.split("/").at(-1);
    if (resource === "products") {
      return jsonResponse({ data: [{ id: "private-product" }],
        links: { next: "/v1alpha1/orders?page[number]=2" } });
    }
    return jsonResponse({ data: [{ id: "private-ingredient" }],
      links: { next: "/v1alpha1/ingredients?page[number]=2" } });
  };
  const client = new FudoClient(
    { apiKey: "synthetic-key", apiSecret: "synthetic-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );
  await assert.rejects(() => client.testConnection(), /invalid_fudo_page/);
  const checks = await client.probeReadAccess(["products", "ingredients"]);
  assert.deepEqual(checks, [
    { resource: "products", code: "invalid_response" },
    { resource: "ingredients", code: "available" },
  ]);
  assert.deepEqual(methods, ["GET", "GET", "GET"]);
  assert.doesNotMatch(JSON.stringify(checks), /private-|synthetic-|bearer|secret/);
});

test("Fudo connection and permission probes reject overfilled HTTP 200 pages without exposing provider records", async () => {
  const methods: string[] = [];
  const now = 1_800_000_000_000;
  const fakeFetch: typeof fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      return jsonResponse({ token: "private-probe-token", exp: Math.floor((now + 86_400_000) / 1000) });
    }
    methods.push(String(init?.method));
    assert.equal(new URL(String(input)).searchParams.get("page[size]"), "1");
    // The response is syntactically JSON:API, but ignores the requested page size.
    return jsonResponse({ data: [
      { id: "private-A", attributes: { name: "do-not-leak-A" } },
      { id: "private-B", attributes: { name: "do-not-leak-B" } },
    ], links: { next: null } });
  };
  const client = new FudoClient(
    { apiKey: "synthetic-probe-key", apiSecret: "synthetic-probe-secret" },
    { fetchImpl: fakeFetch, now: () => now },
  );
  await assert.rejects(() => client.testConnection(), /invalid_fudo_page/);
  const checks = await client.probeReadAccess(["products", "sales"]);
  assert.deepEqual(checks, [
    { resource: "products", code: "invalid_response" },
    { resource: "sales", code: "invalid_response" },
  ]);
  assert.deepEqual(methods, ["GET", "GET", "GET"]);
  assert.doesNotMatch(JSON.stringify(checks), /private-|synthetic-|do-not-leak|token|secret/);
});


test("Fudo rejects an oversized authentication JSON response before any provider read", async () => {
  let authCalls = 0;
  let readCalls = 0;
  const fakeFetch: typeof fetch = async (input) => {
    if (String(input) === "https://auth.fu.do/api") {
      authCalls++;
      // A malicious/misconfigured upstream can advertise a huge body.
      // No private body or oversized response may reach the resource adapter.
      return new Response(JSON.stringify({ token: "not-forwarded" }), {
        headers: { "content-length": String(64 * 1024 + 1) },
      });
    }
    readCalls++;
    return jsonResponse({ data: [] });
  };
  const client = new FudoClient(
    { apiKey: "private-test-key", apiSecret: "private-test-secret" },
    { fetchImpl: fakeFetch },
  );
  await assert.rejects(() => client.testConnection(), (error: unknown) => {
    assert.ok(error instanceof FudoApiError);
    assert.equal(error.code, "invalid_response");
    assert.doesNotMatch(error.message, /private-test|not-forwarded|content-length/i);
    return true;
  });
  assert.equal(authCalls, 1);
  assert.equal(readCalls, 0);
});

test("Fudo aborts a streamed GET larger than its safe JSON bound even with a false short content-length", async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(65);
  let readCalls = 0;
  let emitted = 0;
  const fakeFetch: typeof fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      return jsonResponse({ token: "synthetic-only", exp: 2_000_000_000 });
    }
    readCalls++;
    assert.equal(init?.method, "GET");
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
        emitted++;
        if (emitted >= 17) controller.close();
      },
    });
    return new Response(stream, { headers: { "content-length": "1" } });
  };
  const client = new FudoClient(
    { apiKey: "private-test-key", apiSecret: "private-test-secret" },
    { fetchImpl: fakeFetch, now: () => 1_800_000_000_000 },
  );
  await assert.rejects(() => client.testConnection(), (error: unknown) => {
    assert.ok(error instanceof FudoApiError);
    assert.equal(error.code, "invalid_response");
    assert.doesNotMatch(error.message, /private-test|synthetic-only|AAAAAA/i);
    return true;
  });
  assert.equal(readCalls, 1, "never follow additional resource pages after an oversized body");
  assert.equal(emitted, 17, "stop immediately when the 16 MiB cap is exceeded");
});
