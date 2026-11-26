import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import Module from "node:module";
import { encryptFudoCredentials } from "../lib/integrations/fudo/crypto";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GENERATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const KEY = Buffer.alloc(32, 19).toString("base64");
const CIPHERTEXT = encryptFudoCredentials(
  A, { apiKey: "synthetic-api-key", apiSecret: "synthetic-api-secret" }, KEY,
);

let tenant = A;
let role = "owner";
let isMember = true;
let profileActive = true;
let connectionReads = 0;
let connectionStatus: "connected" | "error" = "connected";
let connectionGeneration = GENERATION;
let connectionTestedAt = "2026-11-07T00:00:00Z";
let duringInitialConnectionRead: (() => void) | null = null;
let duringFinalConnectionRead: (() => void) | null = null;

const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    return {
      select(_fields: string) { return this; },
      eq(field: string, value: unknown) { filters[field] = value; return this; },
      in(_field: string, _values: string[]) { return this; },
      async maybeSingle() {
        if (table === "profiles") {
          return { data: { active: profileActive }, error: null };
        }
        if (table === "business_members") {
          return {
            data: isMember && filters.business_id === tenant && filters.user_id === USER
              ? { id: "synthetic-member" } : null,
            error: null,
          };
        }
        if (table !== "fudo_connections") throw new Error("Unexpected privileged read");
        connectionReads++;
        const row = filters.business_id === A
          ? {
              credentials_ciphertext: CIPHERTEXT,
              connection_generation: connectionGeneration,
              status: connectionStatus,
              last_tested_at: connectionTestedAt,
            }
          : null;
        // The first authorization after provider GETs has already passed.
        // A concurrent revocation lands during the LAST connection metadata
        // read, before the preflight would otherwise publish five green checks.
        if (connectionReads === 1) duringInitialConnectionRead?.();
        if (connectionReads === 8) duringFinalConnectionRead?.();
        return { data: row, error: null };
      },
    };
  },
  async rpc(name: string, args: Record<string, unknown>) {
    assert.equal(name, "fudo_record_connection_test", "only the stored retest may update metadata");
    if (args.p_expected_generation !== connectionGeneration
      || args.p_expected_last_tested_at !== connectionTestedAt) {
      return { data: "connection_changed", error: null };
    }
    if (!isMember || role !== "owner" && role !== "admin" || !profileActive || tenant !== A) {
      return { data: "forbidden", error: null };
    }
    return { data: "recorded", error: null };
  },
};

const loader = Module as any;
const originalLoad = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/data/auth") return {
    getCurrentUserContext: async () => ({
      isAuthenticated: true, userId: USER, businessId: tenant, role,
    }),
  };
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => db };
  if (name === "@/lib/env") return { isDatabaseMode: () => true };
  return originalLoad.call(this, name, ...args);
};
const { inspectFudoReadPermissions, testStoredFudoConnection } =
  require("../lib/integrations/fudo/service") as typeof import("../lib/integrations/fudo/service");
loader._load = originalLoad;

test("Fudo stored retest stops product GET after a concurrent connection rotation or retest", async () => {
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const previousFetch = globalThis.fetch;
  const initialTestAt = "2026-11-07T00:00:00Z";
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  try {
    for (const transition of ["rotation", "retest", "stable"] as const) {
      tenant = A; role = "owner"; isMember = true; profileActive = true;
      connectionStatus = "connected"; connectionGeneration = GENERATION;
      connectionTestedAt = initialTestAt; connectionReads = 0;
      duringInitialConnectionRead = null; duringFinalConnectionRead = null;
      let authPosts = 0;
      let productGets = 0;
      globalThis.fetch = async (url, init) => {
        if (String(url) === "https://auth.fu.do/api") {
          assert.equal(init?.method, "POST");
          authPosts++;
          if (transition === "rotation") {
            connectionGeneration = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
          } else if (transition === "retest") {
            connectionTestedAt = "2026-11-07T00:00:01Z";
          }
          return new Response(JSON.stringify({
            token: "synthetic-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
          }), { status: 200 });
        }
        assert.ok(String(url).startsWith("https://api.fu.do/v1alpha1/products"));
        assert.equal(init?.method, "GET", "no Fudo business writes are permitted");
        productGets++;
        return new Response(JSON.stringify({
          data: [], links: { next: null },
        }), { status: 200 });
      };
      const result = await testStoredFudoConnection();
      assert.equal(authPosts, 1, transition);
      if (transition === "stable") {
        assert.equal(result.ok, true, "unchanged stored credentials remain testable");
        assert.equal(productGets, 1, "products probe still performs one read-only GET");
      } else {
        assert.equal(result.ok, false, transition);
        if (!result.ok) assert.equal(result.code, "connection_changed", transition);
        assert.equal(productGets, 0, "no new GET with obsolete Fudo credentials");
      }
      assert.doesNotMatch(JSON.stringify(result), /synthetic-bearer|synthetic-api-key|synthetic-api-secret/);
    }
  } finally {
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    connectionStatus = "connected"; connectionGeneration = GENERATION;
    connectionTestedAt = initialTestAt; connectionReads = 0;
    duringInitialConnectionRead = null; duringFinalConnectionRead = null;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo preflight rejects checks if owner is revoked during its last privileged reread", async () => {
  const originalKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const originalFetch = globalThis.fetch;
  const verbs: string[] = [];
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "synthetic-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    assert.ok(String(input).startsWith("https://api.fu.do/v1alpha1/"));
    verbs.push(String(init?.method));
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };

  try {
    for (const scenario of ["membership", "role", "profile", "tenant"] as const) {
      tenant = A; role = "owner"; isMember = true; profileActive = true;
      connectionReads = 0;
      verbs.length = 0;
      duringFinalConnectionRead = () => {
        duringFinalConnectionRead = null;
        if (scenario === "membership") isMember = false;
        if (scenario === "role") role = "employee";
        if (scenario === "profile") profileActive = false;
        if (scenario === "tenant") tenant = B;
      };
      const result = await inspectFudoReadPermissions();
      assert.equal(connectionReads, 8, `must recheck the connection before each provider HTTP and at final reread: ${scenario}`);
      assert.deepEqual(verbs, Array(5).fill("GET"), `Fudo must remain read-only: ${scenario}`);
      assert.equal(result.ok, false, scenario);
      assert.deepEqual(result.checks, [], `must discard all five checks: ${scenario}`);
      assert.equal(result.connectionRevision, undefined, "revoked owner must not receive a success revision");
      assert.doesNotMatch(result.message, /synthetic-bearer|synthetic-api-key|synthetic-api-secret/);
    }

    tenant = A; role = "owner"; isMember = true; profileActive = true;
    connectionReads = 0;
    verbs.length = 0;
    duringFinalConnectionRead = null;
    const success = await inspectFudoReadPermissions();
    assert.equal(success.ok, true, "unchanged authorized owner still gets the five status checks");
    assert.equal(success.checks.length, 5);
    assert.ok(success.checks.every((check) => check.code === "available"));
    const expectedRevision = createHash("sha256")
      .update(JSON.stringify([A, GENERATION, "connected", "2026-11-07T00:00:00Z"]))
      .digest("hex");
    assert.equal(success.connectionRevision, expectedRevision,
      "five validated GETs must identify the actual server-side credential revision");
    assert.deepEqual(verbs, Array(5).fill("GET"));
  } finally {
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    duringFinalConnectionRead = null;
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  }
});

test("Fudo O1 preflight refuses errored connections before decrypting or contacting provider", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  let outboundRequests = 0;
  tenant = A; role = "owner"; isMember = true; profileActive = true;
  connectionStatus = "error";
  connectionReads = 0;
  duringFinalConnectionRead = null;
  delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  globalThis.fetch = async () => {
    outboundRequests++;
    throw new Error("No Fudo HTTP request should be initiated on a failed connection");
  };
  try {
    const result = await inspectFudoReadPermissions();
    assert.equal(result.ok, false);
    assert.deepEqual(result.checks, [], "no stale green checks when last retest failed");
    assert.match(result.message, /test exitoso/);
    assert.equal(connectionReads, 1, "only a tenant-scoped connection metadata read is needed");
    assert.equal(outboundRequests, 0, "no provider auth POST or resource GET");
  } finally {
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    connectionStatus = "connected";
    duringFinalConnectionRead = null;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo permission probe refuses stale same-business rotation/retest before auth POST or five GETs", async () => {
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const previousFetch = globalThis.fetch;
  const originalTestTime = "2026-11-07T00:00:00Z";
  const renderedRevision = createHash("sha256")
    .update(JSON.stringify([A, GENERATION, "connected", originalTestTime]))
    .digest("hex");
  const rotatedGeneration = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  let outbound = 0;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  globalThis.fetch = async (url, init) => {
    outbound++;
    if (String(url) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "synthetic-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    for (const scenario of ["rotation", "retest", "invalid"] as const) {
      tenant = A; role = "owner"; isMember = true; profileActive = true;
      connectionStatus = "connected";
      connectionGeneration = scenario === "rotation" ? rotatedGeneration : GENERATION;
      connectionTestedAt = scenario === "retest" ? "2026-11-07T00:00:01Z" : originalTestTime;
      connectionReads = 0; outbound = 0; duringFinalConnectionRead = null;
      const result = await inspectFudoReadPermissions(
        undefined, scenario === "invalid" ? "not-a-revision" : renderedRevision,
      );
      assert.equal(result.ok, false, scenario);
      assert.deepEqual(result.checks, [], scenario);
      assert.equal(result.connectionRevision, undefined, scenario);
      assert.match(result.message, /conexión Fudo cambió/i);
      assert.equal(connectionReads, 1, "only the initial tenant-scoped connection may be read");
      assert.equal(outbound, 0, "must refuse before decrypt/auth POST and all GETs");
    }
    connectionGeneration = GENERATION; connectionTestedAt = originalTestTime;
    connectionReads = 0; outbound = 0;
    const fresh = await inspectFudoReadPermissions(undefined, renderedRevision);
    assert.equal(fresh.ok, true, "unchanged revision still probes five resources");
    assert.equal(fresh.connectionRevision, renderedRevision);
    assert.equal(fresh.checks.length, 5);
    assert.equal(outbound, 6, "one auth POST and five read-only GETs");
    assert.equal(connectionReads, 8, "six per-HTTP generation checks and the final revision fence must remain active");
  } finally {
    connectionGeneration = GENERATION;
    connectionTestedAt = originalTestTime;
    connectionStatus = "connected";
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    duringFinalConnectionRead = null;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo permissions never authenticate after context changes during initial connection read", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  let outbound = 0;
  // The old flow would decrypt before noticing revocation; without a key
  // that fails locally. Keep a synthetic key so the test detects HTTP too.
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  globalThis.fetch = async () => {
    outbound++;
    throw new Error("Revoked actors must not contact Fudo");
  };
  try {
    for (const scenario of ["membership", "role", "profile", "tenant"] as const) {
      tenant = A; role = "owner"; isMember = true; profileActive = true;
      connectionStatus = "connected"; connectionGeneration = GENERATION;
      connectionReads = 0; outbound = 0; duringFinalConnectionRead = null;
      duringInitialConnectionRead = () => {
        duringInitialConnectionRead = null;
        if (scenario === "membership") isMember = false;
        if (scenario === "role") role = "employee";
        if (scenario === "profile") profileActive = false;
        if (scenario === "tenant") tenant = B;
      };
      const result = await inspectFudoReadPermissions();
      assert.equal(result.ok, false, scenario);
      assert.deepEqual(result.checks, [], scenario);
      assert.equal(result.connectionRevision, undefined, scenario);
      assert.equal(outbound, 0, "no provider auth POST or resource GET: " + scenario);
      assert.equal(connectionReads, 1, "must stop after first connection read: " + scenario);
      assert.doesNotMatch(result.message, /synthetic-api-key|synthetic-api-secret/);
    }
  } finally {
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    connectionStatus = "connected"; connectionGeneration = GENERATION;
    duringInitialConnectionRead = null; duringFinalConnectionRead = null;
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  }
});

test("Fudo five-resource probe stops new GETs when credentials rotate during auth", async () => {
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const previousFetch = globalThis.fetch;
  const rotatedGeneration = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  tenant = A; role = "owner"; isMember = true; profileActive = true;
  connectionStatus = "connected"; connectionGeneration = GENERATION;
  connectionTestedAt = "2026-11-07T00:00:00Z";
  connectionReads = 0;
  let authPosts = 0;
  let resourceGets = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      authPosts++;
      // Disconnect or rotation succeeds while auth HTTP is in flight.
      connectionGeneration = rotatedGeneration;
      return new Response(JSON.stringify({
        token: "synthetic-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    resourceGets++;
    throw new Error("Old connection must not initiate any GET after rotation");
  };
  try {
    const result = await inspectFudoReadPermissions();
    assert.equal(result.ok, false);
    assert.deepEqual(result.checks, [], "old generation cannot produce usable permission evidence");
    assert.equal(result.connectionRevision, undefined);
    assert.equal(authPosts, 1, "only technical authentication was already in flight");
    assert.equal(resourceGets, 0, "no resource GET under rotated credentials");
    assert.doesNotMatch(result.message, /synthetic-bearer|synthetic-api-key|synthetic-api-secret/);
  } finally {
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    connectionStatus = "connected"; connectionGeneration = GENERATION;
    connectionTestedAt = "2026-11-07T00:00:00Z";
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo five-resource probe refuses later GETs after mid-probe disconnect", async () => {
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const previousFetch = globalThis.fetch;
  const rotatedGeneration = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  tenant = A; role = "owner"; isMember = true; profileActive = true;
  connectionStatus = "connected"; connectionGeneration = GENERATION;
  connectionTestedAt = "2026-11-07T00:00:00Z";
  connectionReads = 0;
  let resourceGets = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "synthetic-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    assert.equal(init?.method, "GET");
    resourceGets++;
    if (resourceGets === 1) connectionGeneration = rotatedGeneration;
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const result = await inspectFudoReadPermissions();
    assert.equal(result.ok, false);
    assert.deepEqual(result.checks, [], "do not publish evidence from old credentials");
    assert.equal(result.connectionRevision, undefined);
    assert.ok(resourceGets >= 1 && resourceGets <= 3,
      "only already-launched bounded GETs may complete; later resources must be fenced");
  } finally {
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    connectionStatus = "connected"; connectionGeneration = GENERATION;
    connectionTestedAt = "2026-11-07T00:00:00Z";
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
