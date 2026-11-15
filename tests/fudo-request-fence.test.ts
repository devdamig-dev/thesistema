import assert from "node:assert/strict";
import test from "node:test";
import { FudoClient } from "../lib/integrations/fudo/client";

const credentials = { apiKey: "synthetic-request-key", apiSecret: "synthetic-request-secret" };
const authUrl = "https://auth.fu.do/api";
const productsUrl = "https://api.fu.do/v1alpha1/products";

function providerJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requireActive(isActive: () => boolean): () => Promise<void> {
  return async () => {
    if (!isActive()) throw new Error("fudo_actor_revoked");
  };
}

test("Fudo request fence denies revoked actors before the initial technical auth POST", async () => {
  const calls: string[] = [];
  const client = new FudoClient(credentials, {
    beforeRequest: requireActive(() => false),
    fetchImpl: async (input) => {
      calls.push(String(input));
      throw new Error("HTTP should never be started");
    },
  });
  await assert.rejects(client.products(), { message: "fudo_actor_revoked" });
  assert.deepEqual(calls, []);
});

test("Fudo request fence denies a GET if access is revoked while parsing an auth response", async () => {
  let active = true;
  const calls: string[] = [];
  const client = new FudoClient(credentials, {
    beforeRequest: requireActive(() => active),
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === authUrl) {
        active = false;
        return providerJson({ token: "synthetic-bearer" });
      }
      throw new Error("No GET should be sent after revocation");
    },
  });
  await assert.rejects(client.products(), { message: "fudo_actor_revoked" });
  assert.deepEqual(calls, [authUrl]);
});

test("Fudo 401 retry cannot authenticate or send another GET after a role revocation", async () => {
  let active = true;
  const calls: string[] = [];
  const client = new FudoClient(credentials, {
    beforeRequest: requireActive(() => active),
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === authUrl) return providerJson({ token: "synthetic-bearer" });
      if (url.startsWith(productsUrl)) {
        active = false;
        return providerJson({ error: "not-authorized" }, 401);
      }
      throw new Error("Unexpected provider request");
    },
  });
  await assert.rejects(client.products(), { message: "fudo_actor_revoked" });
  assert.equal(calls.filter((url) => url === authUrl).length, 1);
  assert.equal(calls.filter((url) => url.startsWith(productsUrl)).length, 1);
});

test("Fudo request fence preserves authorized read-only authentication and GET", async () => {
  const calls: Array<{ url: string; method: string | undefined }> = [];
  let checks = 0;
  const client = new FudoClient(credentials, {
    beforeRequest: async () => { checks += 1; },
    fetchImpl: async (input, init) => {
      const url = String(input);
      calls.push({ url, method: init?.method });
      return url === authUrl
        ? providerJson({ token: "synthetic-bearer" })
        : providerJson({ data: [], links: { next: null } });
    },
  });
  await client.testConnection();
  assert.equal(checks, 2);
  assert.deepEqual(calls.map(({ method }) => method), ["POST", "GET"]);
  assert.equal(calls[0].url, authUrl);
  assert.match(calls[1].url, /^https:\/\/api\.fu\.do\/v1alpha1\/products\?/);
});
