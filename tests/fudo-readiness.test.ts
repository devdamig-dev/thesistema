import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { encryptFudoCredentials } from "../lib/integrations/fudo/crypto";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECRET_KEY = Buffer.alloc(32, 19).toString("base64");
const ciphertextA = encryptFudoCredentials(A, { apiKey: "pilot-key-business-A", apiSecret: "pilot-secret-business-A" }, SECRET_KEY);
const ciphertextB = encryptFudoCredentials(B, { apiKey: "pilot-key-business-B", apiSecret: "pilot-secret-business-B" }, SECRET_KEY);
const ORIGINAL_GENERATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ROTATED_GENERATION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const GENERATION_B = "ffffffff-ffff-4fff-8fff-ffffffffffff";
let currentGenerationA = ORIGINAL_GENERATION;
let connectedA = true;
let connectionStatusA = "connected";
let lastTestedAtA: string | null = "2026-11-04T19:00:00Z";

let tenant = A;
let role = "owner";
let isMember = true;
let active = true;
let readsOfConnections = 0;
const query = (table: string) => {
  const filters: Record<string, unknown> = {};
  return {
    select(_fields: string) { return this; },
    eq(column: string, value: unknown) { filters[column] = value; return this; },
    in(_column: string, _values: string[]) { return this; },
    async maybeSingle() {
      if (table === "profiles") return { error: null, data: { active } };
      if (table === "business_members") return { error: null, data:
        isMember && filters.business_id === tenant && filters.user_id === USER ? { id: "member" } : null };
      if (table === "fudo_connections") {
        readsOfConnections++;
        const stored = filters.business_id === A && connectedA
          ? { credentials_ciphertext: ciphertextA, connection_generation: currentGenerationA,
              status: connectionStatusA, last_tested_at: lastTestedAtA }
          : filters.business_id === B
            ? { credentials_ciphertext: ciphertextB, connection_generation: GENERATION_B,
                status: "connected", last_tested_at: "2026-11-04T19:00:00Z" }
            : null;
        return { error: null, data: stored };
      }
      return { error: { code: "unexpected_table" }, data: null };
    },
  };
};

const loader = Module as any;
const load = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/data/auth") return {
    getCurrentUserContext: async () => ({ isAuthenticated: true, userId: USER, businessId: tenant, role }),
  };
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => ({ from: query }) };
  if (name === "@/lib/env") return { isDatabaseMode: () => true };
  return load.call(this, name, ...args);
};
const { inspectFudoReadPermissions } = require("../lib/integrations/fudo/service") as typeof import("../lib/integrations/fudo/service");
loader._load = load;

test("Fudo readiness checks deny unprivileged and non-member users before loading ciphertext", async () => {
  readsOfConnections = 0;
  tenant = A; role = "employee"; isMember = true; active = true;
  const deniedRole = await inspectFudoReadPermissions();
  assert.equal(deniedRole.ok, false);
  assert.deepEqual(deniedRole.checks, []);
  role = "owner"; isMember = false;
  const deniedMembership = await inspectFudoReadPermissions();
  assert.equal(deniedMembership.ok, false);
  role = "admin"; isMember = true; active = false;
  const deniedInactive = await inspectFudoReadPermissions();
  assert.equal(deniedInactive.ok, false);
  assert.equal(readsOfConnections, 0);
});

test("Fudo readiness isolates each business and only returns sanitized resource codes", async () => {
  const oldKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const oldFetch = globalThis.fetch;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = SECRET_KEY;
  let authCalls = 0;
  let resourceCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://auth.fu.do/api") {
      authCalls++;
      const body = JSON.parse(String(init?.body)) as { apiKey: string };
      const token = body.apiKey.endsWith("-A") ? "token-A" : "token-B";
      return new Response(JSON.stringify({ token, exp: Math.floor(Date.now() / 1000) + 86400 }), { status: 200 });
    }
    resourceCalls++;
    const bearer = new Headers(init?.headers).get("authorization");
    if (bearer === "Bearer token-A" && url.includes("/providers?")) {
      return new Response(JSON.stringify({ message: "SECRET provider details" }), { status: 403 });
    }
    return new Response(JSON.stringify({
      data: [{ id: "private-id", attributes: { customer: "SECRET customer" } }],
    }), { status: 200 });
  };
  try {
    tenant = A; role = "owner"; isMember = true; active = true;
    const a = await inspectFudoReadPermissions();
    assert.equal(a.ok, false);
    assert.equal(a.checks.length, 5);
    assert.equal(a.checks.find((check) => check.resource === "providers")?.code, "forbidden");

    tenant = B; role = "admin";
    const b = await inspectFudoReadPermissions();
    assert.equal(b.ok, true);
    assert.equal(b.checks.length, 5);
    assert.equal(b.checks.find((check) => check.resource === "providers")?.code, "available");
    assert.equal(authCalls, 2);
    assert.equal(resourceCalls, 10);
    assert.doesNotMatch(JSON.stringify(a) + JSON.stringify(b), /SECRET|private-id|customer|token-[AB]|pilot-key/i);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = oldKey;
  }
});

test("Fudo preflight rejects resource checks from a rotated or disconnected connection", async () => {
  const oldKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const oldFetch = globalThis.fetch;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = SECRET_KEY;
  tenant = A; role = "owner"; isMember = true; active = true;
  try {
    for (const change of ["rotation", "disconnection"] as const) {
      currentGenerationA = ORIGINAL_GENERATION;
      connectedA = true;
      let resourceReads = 0;
      globalThis.fetch = async (input) => {
        if (String(input) === "https://auth.fu.do/api") {
          return new Response(JSON.stringify({
            token: "private-fixture-token", exp: Math.floor(Date.now() / 1000) + 86400,
          }), { status: 200 });
        }
        resourceReads++;
        // Another admin changes the connection during an external read.
        if (change === "rotation") currentGenerationA = ROTATED_GENERATION;
        else connectedA = false;
        return new Response(JSON.stringify({
          data: [{ id: "private-provider-id", attributes: { name: "private-provider-record" } }],
        }), { status: 200 });
      };
      const result = await inspectFudoReadPermissions();
      assert.equal(resourceReads, 5, "all read probes settled before the generation check");
      assert.equal(result.ok, false);
      assert.deepEqual(result.checks, [], "stale provider permissions must not be shown");
      assert.match(result.message, /conexión Fudo cambió/i);
      assert.doesNotMatch(JSON.stringify(result), /private-provider|private-fixture-token|pilot-secret/i);
    }

    currentGenerationA = ORIGINAL_GENERATION;
    connectedA = true;
    globalThis.fetch = async (input) => String(input) === "https://auth.fu.do/api"
      ? new Response(JSON.stringify({
          token: "private-fixture-token", exp: Math.floor(Date.now() / 1000) + 86400,
        }), { status: 200 })
      : new Response(JSON.stringify({ data: [] }), { status: 200 });
    const unchanged = await inspectFudoReadPermissions();
    assert.equal(unchanged.ok, true);
    assert.equal(unchanged.checks.length, 5);
    assert.ok(unchanged.checks.every((check) => check.code === "available"));
  } finally {
    currentGenerationA = ORIGINAL_GENERATION;
    connectedA = true;
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = oldKey;
  }
});


test("Fudo preflight discards permissions when a same-generation retest changes status or test time", async () => {
  const oldKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const oldFetch = globalThis.fetch;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = SECRET_KEY;
  tenant = A; role = "owner"; isMember = true; active = true;
  try {
    for (const change of ["successful-retest", "failed-retest"] as const) {
      currentGenerationA = ORIGINAL_GENERATION;
      connectedA = true;
      connectionStatusA = "connected";
      lastTestedAtA = "2026-11-04T19:00:00Z";
      let calls = 0;
      globalThis.fetch = async (input) => {
        if (String(input) === "https://auth.fu.do/api") {
          return new Response(JSON.stringify({
            token: "fixture-private-token", exp: Math.floor(Date.now() / 1000) + 86400,
          }), { status: 200 });
        }
        calls++;
        // Credentials and generation remain unchanged, but another owner
        // completes a retest while our permissions check is in flight.
        lastTestedAtA = "2026-11-04T19:01:00Z";
        if (change === "failed-retest") connectionStatusA = "error";
        return new Response(JSON.stringify({
          data: [{ id: "private-provider-id", attributes: { name: "private-provider-record" } }],
        }), { status: 200 });
      };
      const result = await inspectFudoReadPermissions();
      assert.equal(calls, 5, "the five GETs remain read-only and bounded");
      assert.equal(result.ok, false);
      assert.deepEqual(result.checks, [], "outdated green checks must not leave the server");
      assert.match(result.message, /conexión Fudo cambió/i);
      assert.doesNotMatch(JSON.stringify(result), /fixture-private-token|private-provider|pilot-secret/i);
    }

    // Unchanged connection remains usable; the fencing check is not a
    // blanket denial of valid provider permissions.
    connectionStatusA = "connected";
    lastTestedAtA = "2026-11-04T19:02:00Z";
    globalThis.fetch = async (input) => String(input) === "https://auth.fu.do/api"
      ? new Response(JSON.stringify({
          token: "fixture-private-token", exp: Math.floor(Date.now() / 1000) + 86400,
        }), { status: 200 })
      : new Response(JSON.stringify({ data: [] }), { status: 200 });
    const current = await inspectFudoReadPermissions();
    assert.equal(current.ok, true);
    assert.equal(current.checks.length, 5);
  } finally {
    currentGenerationA = ORIGINAL_GENERATION;
    connectedA = true;
    connectionStatusA = "connected";
    lastTestedAtA = "2026-11-04T19:00:00Z";
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = oldKey;
  }
});

test("Fudo preflight never returns stale permissions after membership revocation or business switch", async () => {
  const oldKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const oldFetch = globalThis.fetch;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = SECRET_KEY;
  try {
    for (const transition of ["revoked", "switched"] as const) {
      tenant = A; role = "owner"; isMember = true; active = true;
      currentGenerationA = ORIGINAL_GENERATION; connectedA = true;
      connectionStatusA = "connected"; lastTestedAtA = "2026-11-04T19:00:00Z";
      const methods: string[] = [];
      globalThis.fetch = async (input, init) => {
        if (String(input) === "https://auth.fu.do/api") {
          assert.equal(init?.method, "POST");
          return new Response(JSON.stringify({
            token: "synthetic-private-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
          }), { status: 200 });
        }
        methods.push(String(init?.method));
        if (transition === "revoked") isMember = false;
        else tenant = B;
        return new Response(JSON.stringify({
          data: [{ id: "PRIVATE_ID", attributes: { title: "PRIVATE_PROVIDER_DATA" } }],
        }), { status: 200 });
      };
      const result = await inspectFudoReadPermissions();
      assert.equal(result.ok, false, transition);
      assert.deepEqual(result.checks, [], "revoked actor must not see provider permission checks");
      assert.match(result.message, /acceso al negocio cambió/i);
      assert.equal(methods.length, 5);
      assert.ok(methods.every((method) => method === "GET"));
      assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|synthetic-private-bearer|pilot-secret/i);
    }
  } finally {
    tenant = A; role = "owner"; isMember = true; active = true;
    currentGenerationA = ORIGINAL_GENERATION; connectedA = true;
    connectionStatusA = "connected"; lastTestedAtA = "2026-11-04T19:00:00Z";
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = oldKey;
  }
});
