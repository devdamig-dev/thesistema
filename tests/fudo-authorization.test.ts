import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let role = "owner";
let tenant = A;
let validMembership = false;
let profileActive = true;
let memberLookups = 0;
let storedRow: Record<string, unknown> | null = null;
let syncRunning = false;
let forceRpcForbidden = false;
const rpcCalls: string[] = [];

const db = {
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push(name);
    if (name === "fudo_disconnect_connection") {
      assert.equal(args.p_business_id, tenant, "disconnect tenant derives from server session");
      assert.equal(args.p_actor_id, USER, "disconnect passes authenticated actor to atomic SQL");
    }
    if (forceRpcForbidden) return { data: "forbidden", error: null };
    if (name === "fudo_replace_connection") {
      if (syncRunning) return { data: "sync_running", error: null };
      storedRow = {
        business_id: args.p_business_id,
        credentials_ciphertext: args.p_ciphertext,
        status: "connected",
      };
      return { data: "connected", error: null };
    }
    if (name === "fudo_disconnect_connection") {
      if (syncRunning) return { data: "sync_running", error: null };
      storedRow = null;
      return { data: "disconnected", error: null };
    }
    return { data: null, error: { message: "unexpected_rpc" } };
  },
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const query: any = {
      select(_fields: string) { return this; },
      eq(field: string, value: unknown) { filters[field] = value; return this; },
      in(_field: string, _values: string[]) { return this; },
      limit(_value: number) { return Promise.resolve({ data: [], error: null }); },
      async maybeSingle() {
        if (table === "profiles") return { data: { active: profileActive }, error: null };
        if (table === "business_members") {
          memberLookups++;
          return { data: validMembership && filters.business_id === tenant && filters.user_id === USER
            ? { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" } : null, error: null };
        }
        return { data: null, error: null };
      },
      async upsert(row: Record<string, unknown>) {
        if (table === "fudo_connections") storedRow = row;
        return { error: null };
      },
    };
    return query;
  },
};

const loader = Module as any;
const originalLoad = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/data/auth") return {
    getCurrentUserContext: async () => ({ isAuthenticated: true, userId: USER, businessId: tenant, role }),
  };
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => db };
  if (name === "@/lib/env") return { isDatabaseMode: () => true };
  return originalLoad.call(this, name, ...args);
};
const { connectFudo, disconnectFudo, getFudoConnectionView, testStoredFudoConnection, inspectFudoReadPermissions } = require("../lib/integrations/fudo/service") as typeof import("../lib/integrations/fudo/service");
loader._load = originalLoad;

const credentials = { apiKey: "pilot-test-api-key", apiSecret: "pilot-test-secret" };

test("Fudo connection refuses non-admin roles before accessing service credentials", async () => {
  validMembership = true;
  memberLookups = 0;
  for (const refused of ["viewer", "employee", "manager", "cashier"]) {
    role = refused;
    const outcome = await connectFudo(credentials);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "forbidden");
  }
  assert.equal(memberLookups, 0);
});

test("Fudo owner/admin without a valid membership cannot connect another tenant", async () => {
  role = "owner"; tenant = B; validMembership = false;
  const outcome = await connectFudo(credentials);
  assert.equal(outcome.ok, false);
  assert.equal(storedRow, null);
});

test("Fudo inactive owner cannot access service credentials even with an active membership", async () => {
  role = "owner"; tenant = A; validMembership = true; profileActive = false;
  try {
    const outcome = await connectFudo(credentials);
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "forbidden");
  } finally { profileActive = true; }
});

test("Fudo owner connection derives business_id from validated server session and encrypts stored data", async () => {
  role = "owner"; tenant = A; validMembership = true;
  const beforeFetch = globalThis.fetch;
  const beforeKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  let dataReads = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("auth.fu.do")) {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ token: "test-bearer", exp: Math.floor(Date.now() / 1000) + 86400 }), { status: 200 });
    }
    assert.equal(url.startsWith("https://api.fu.do/v1alpha1/products?"), true);
    assert.equal(init?.method, "GET");
    dataReads++;
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };
  try {
    const rendered = await getFudoConnectionView();
    assert.ok(rendered?.businessRevision);
    const outcome = await connectFudo({ ...credentials, businessId: B } as any, rendered.businessRevision);
    assert.equal(outcome.ok, true);
    assert.equal(dataReads, 1);
    const saved = storedRow as Record<string, unknown> | null;
    assert.ok(saved);
    assert.equal(saved.business_id, A);
    assert.equal(saved.status, "connected");
    assert.ok(rpcCalls.includes("fudo_replace_connection"));
    const encoded = String(saved.credentials_ciphertext);
    assert.ok(encoded.startsWith("v1."));
    assert.ok(!encoded.includes(credentials.apiKey));
    assert.ok(!encoded.includes(credentials.apiSecret));
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = beforeKey;
  }
});


test("Fudo connection and disconnection both defer to atomic DB lifecycle lock", async () => {
  role = "owner"; tenant = A; validMembership = true; syncRunning = true;
  const beforeFetch = globalThis.fetch;
  const beforeKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  globalThis.fetch = async (input) =>
    String(input).includes("auth.fu.do")
      ? new Response(JSON.stringify({ token: "test-bearer", exp: Math.floor(Date.now()/1000) + 86400 }), { status: 200 })
      : new Response(JSON.stringify({ data: [] }), { status: 200 });
  try {
    const blockedConnect = await connectFudo(credentials);
    assert.equal(blockedConnect.ok, false);
    if (!blockedConnect.ok) assert.equal(blockedConnect.code, "sync_running");
    const blockedDisconnect = await disconnectFudo();
    assert.equal(blockedDisconnect.ok, false);
    if (!blockedDisconnect.ok) assert.equal(blockedDisconnect.code, "sync_running");
    syncRunning = false;
    const rendered = await getFudoConnectionView();
    assert.ok(rendered?.businessRevision);
    const disconnected = await disconnectFudo(rendered.businessRevision);
    assert.equal(disconnected.ok, true);
    assert.ok(rpcCalls.includes("fudo_disconnect_connection"));
  } finally {
    syncRunning = false;
    globalThis.fetch = beforeFetch;
    if (beforeKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = beforeKey;
  }
});

test("Fudo connection does not persist credentials when HTTP 200 body is not importable", async () => {
  role = "owner"; tenant = A; validMembership = true; profileActive = true; syncRunning = false;
  storedRow = null;
  const writesBefore = rpcCalls.filter((call) => call === "fudo_replace_connection").length;
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 21).toString("base64");
  globalThis.fetch = async (input) => String(input).includes("auth.fu.do")
    ? new Response(JSON.stringify({ token: "example-token", exp: Math.floor(Date.now()/1000)+86400 }), { status: 200 })
    : new Response(JSON.stringify({ secret: "private-data", message: "unusable response" }), { status: 200 });

  try {
    const result = await connectFudo(credentials);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "invalid_response");
      assert.doesNotMatch(result.message, /private-data|example-token|pilot-test/i);
    }
    assert.equal(storedRow, null);
    assert.equal(rpcCalls.filter((call) => call === "fudo_replace_connection").length, writesBefore);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo O1 denies a connection if the actor loses membership or switches tenant during the provider probe", async () => {
  const beforeFetch = globalThis.fetch;
  const beforeKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString("base64");
  try {
    for (const change of ["membership_revoked", "tenant_switched"] as const) {
      role = "owner"; tenant = A; validMembership = true; profileActive = true;
      syncRunning = false; storedRow = null;
      const writesBefore = rpcCalls.filter((call) => call === "fudo_replace_connection").length;
      const providerVerbs: string[] = [];
      globalThis.fetch = async (input, init) => {
        const url = String(input);
        if (url === "https://auth.fu.do/api") {
          assert.equal(init?.method, "POST");
          return new Response(JSON.stringify({
            token: "synthetic-token", exp: Math.floor(Date.now() / 1000) + 86400,
          }), { status: 200 });
        }
        providerVerbs.push(String(init?.method));
        assert.ok(url.startsWith("https://api.fu.do/v1alpha1/products?"));
        if (change === "membership_revoked") validMembership = false;
        else tenant = B; // A session may switch to another authorized business.
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      };
      const result = await connectFudo(credentials);
      assert.equal(result.ok, false, change);
      if (!result.ok) {
        assert.equal(result.code, "forbidden", change);
        assert.doesNotMatch(result.message, /synthetic-token|pilot-test-api-key|pilot-test-secret/);
      }
      assert.deepEqual(providerVerbs, ["GET"], change);
      assert.equal(storedRow, null, "revoked or switched actors cannot save ciphertext");
      assert.equal(rpcCalls.filter((call) => call === "fudo_replace_connection").length,
        writesBefore, "the privileged write RPC must not be called after actor change");
    }
  } finally {
    tenant = A; role = "owner"; validMembership = true; profileActive = true;
    globalThis.fetch = beforeFetch;
    if (beforeKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = beforeKey;
  }
});

test("Fudo lifecycle surfaces a transaction-time permission denial without exposing credentials", async () => {
  role = "owner"; tenant = A; validMembership = true; profileActive = true;
  syncRunning = false; forceRpcForbidden = true;
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 27).toString("base64");
  globalThis.fetch = async (input, init) => String(input) === "https://auth.fu.do/api"
    ? new Response(JSON.stringify({ token: "synthetic-token", exp: Math.floor(Date.now() / 1000) + 86400 }), { status: 200 })
    : new Response(JSON.stringify({ data: [] }), { status: 200 });
  try {
    const before = storedRow;
    const connect = await connectFudo(credentials);
    assert.equal(connect.ok, false);
    if (!connect.ok) {
      assert.equal(connect.code, "forbidden");
      assert.doesNotMatch(connect.message, /pilot-test-api-key|pilot-test-secret|synthetic-token/);
    }
    const disconnect = await disconnectFudo();
    assert.equal(disconnect.ok, false);
    if (!disconnect.ok) assert.equal(disconnect.code, "forbidden");
    assert.deepEqual(storedRow, before, "SQL denial cannot change connection");
  } finally {
    forceRpcForbidden = false;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo O1 lifecycle actions reject a stale business tab before any provider request or privileged mutation", async () => {
  role = "owner"; tenant = A; validMembership = true; profileActive = true; syncRunning = false;
  storedRow = null;
  const viewA = await getFudoConnectionView();
  assert.ok(viewA?.businessRevision);
  assert.match(viewA.businessRevision, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(viewA.businessRevision, new RegExp(A));
  tenant = B;
  const viewB = await getFudoConnectionView();
  assert.ok(viewB?.businessRevision);
  assert.notEqual(viewA.businessRevision, viewB.businessRevision, "each business has a distinct UI fence");
  const beforeRpc = rpcCalls.length;
  const previousFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async () => { providerCalls++; throw new Error("stale tab must not call Fudo"); };
  try {
    const connected = await connectFudo(credentials, viewA.businessRevision);
    const tested = await testStoredFudoConnection(viewA.businessRevision);
    const disconnected = await disconnectFudo(viewA.businessRevision);
    const preflight = await inspectFudoReadPermissions(viewA.businessRevision);
    for (const result of [connected, tested, disconnected]) {
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "connection_changed");
    }
    assert.equal(preflight.ok, false);
    assert.deepEqual(preflight.checks, []);
    assert.match(preflight.message, /Cambiaste de negocio/);
    assert.equal(providerCalls, 0);
    assert.equal(rpcCalls.length, beforeRpc, "no connection create/rotate/disconnect RPC on newly active business");
    assert.equal(storedRow, null);
  } finally {
    globalThis.fetch = previousFetch;
    tenant = A; role = "owner"; validMembership = true; profileActive = true;
  }
});
