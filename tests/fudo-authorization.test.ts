import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { createHash } from "node:crypto";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let role = "owner";
let tenant = A;
let validMembership = false;
let profileActive = true;
let memberLookups = 0;
let storedRow: Record<string, unknown> | null = null;
let nextGeneration = 1;
let syncRunning = false;
let forceRpcForbidden = false;
let rotateDuringDisconnectRpc = false;
const disconnectRevision = () => {
  assert.ok(storedRow, "fixture needs a configured connection");
  return createHash("sha256").update(JSON.stringify([
    tenant, storedRow.connection_generation, storedRow.status, storedRow.last_tested_at ?? null,
  ])).digest("hex");
};
const rpcCalls: string[] = [];

const db = {
  async rpc(name: string, args: Record<string, unknown>) {
    rpcCalls.push(name);
    if (name === "fudo_disconnect_connection_guarded") {
      assert.equal(args.p_business_id, tenant, "disconnect tenant derives from server session");
      assert.equal(args.p_actor_id, USER, "disconnect passes authenticated actor to atomic SQL");
      if (rotateDuringDisconnectRpc && storedRow) {
        rotateDuringDisconnectRpc = false;
        storedRow = { ...storedRow,
          connection_generation: "00000000-0000-4000-8000-000000000099" };
      }
    }
    if (forceRpcForbidden) return { data: "forbidden", error: null };
    if (name === "fudo_replace_connection_guarded") {
      if (syncRunning) return { data: "sync_running", error: null };
      // Simulate the atomic SQL guard, including a competing admin's rotation
      // or disconnect between the provider GET and the privileged commit.
      if ((args.p_expected_generation ?? null) !== (storedRow?.connection_generation ?? null)
        || (args.p_expected_last_tested_at ?? null) !== (storedRow?.last_tested_at ?? null)) {
        return { data: "connection_changed", error: null };
      }
      storedRow = {
        business_id: args.p_business_id,
        credentials_ciphertext: args.p_ciphertext,
        status: "connected",
        connection_generation: `00000000-0000-4000-8000-${String(nextGeneration++).padStart(12, "0")}`,
        last_tested_at: new Date(Date.UTC(2026, 10, 13, 7, 0, nextGeneration)).toISOString(),
      };
      return { data: "connected", error: null };
    }
    if (name === "fudo_disconnect_connection_guarded") {
      if ((args.p_expected_generation ?? null) !== (storedRow?.connection_generation ?? null)
        || (args.p_expected_last_tested_at ?? null) !== (storedRow?.last_tested_at ?? null)
        || !storedRow) return { data: "connection_changed", error: null };
      if (syncRunning) return { data: "sync_running", error: null };
      storedRow = null;
      return { data: "disconnected", error: null };
    }
    return { data: null, error: { message: "unexpected_rpc" } };
  },
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let selection = "";
    const query: any = {
      select(fields: string) { selection = fields; return this; },
      eq(field: string, value: unknown) { filters[field] = value; return this; },
      in(_field: string, _values: string[]) { return this; },
      limit(_value: number) { return Promise.resolve({ data: [], error: null }); },
      async maybeSingle() {
        if (table === "profiles") return { data: { active: profileActive }, error: null };
        // Only the new CAS snapshot query needs a real stored row. Other
        // fixture queries keep their established empty-view behavior.
        if (table === "fudo_connections" && selection === "connection_generation,status,last_tested_at") {
          return { data: storedRow, error: null };
        }
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
    assert.ok(rpcCalls.includes("fudo_replace_connection_guarded"));
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
  storedRow = {
    business_id: A, status: "connected", credentials_ciphertext: "synthetic-encrypted",
    connection_generation: "00000000-0000-4000-8000-000000000010", last_tested_at: null,
  };
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
    const blockedDisconnect = await disconnectFudo(undefined, disconnectRevision());
    assert.equal(blockedDisconnect.ok, false);
    if (!blockedDisconnect.ok) assert.equal(blockedDisconnect.code, "sync_running");
    syncRunning = false;
    const disconnected = await disconnectFudo(undefined, disconnectRevision());
    assert.equal(disconnected.ok, true);
    assert.ok(rpcCalls.includes("fudo_disconnect_connection_guarded"));
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
  const writesBefore = rpcCalls.filter((call) => call === "fudo_replace_connection_guarded").length;
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
    assert.equal(rpcCalls.filter((call) => call === "fudo_replace_connection_guarded").length, writesBefore);
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
      const writesBefore = rpcCalls.filter((call) => call === "fudo_replace_connection_guarded").length;
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
      assert.equal(rpcCalls.filter((call) => call === "fudo_replace_connection_guarded").length,
        writesBefore, "the privileged write RPC must not be called after actor change");
    }
  } finally {
    tenant = A; role = "owner"; validMembership = true; profileActive = true;
    globalThis.fetch = beforeFetch;
    if (beforeKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = beforeKey;
  }
});


test("Fudo stale same-business form and late provider response cannot overwrite newer credentials", async () => {
  role = "owner"; tenant = A; validMembership = true; profileActive = true; syncRunning = false;
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const previousFetch = globalThis.fetch;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 43).toString("base64");
  const later = {
    business_id: A, status: "connected", credentials_ciphertext: "fixture-only",
    connection_generation: "00000000-0000-4000-8000-000000000091",
    last_tested_at: "2026-11-13T07:01:00.000Z",
  };
  try {
    storedRow = null;
    const disconnected = await getFudoConnectionView();
    assert.ok(disconnected?.businessRevision);
    assert.equal(disconnected.connectionRevision, null);
    // Someone else connects after our tab rendered. Reject before any
    // upstream auth/GET, and leave that other admin's credentials unchanged.
    storedRow = { ...later };
    const beforeRpc = rpcCalls.length;
    let requests = 0;
    globalThis.fetch = async () => { requests++; throw new Error("unexpected provider request"); };
    const stale = await connectFudo(credentials, disconnected.businessRevision, null);
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.code, "connection_changed");
    assert.equal(requests, 0);
    assert.equal(rpcCalls.length, beforeRpc);
    assert.equal(storedRow.credentials_ciphertext, "fixture-only");

    // Two initial connects can also race while the first server waits on Fudo.
    // SQL compares the observed null generation under the business lock.
    storedRow = null;
    globalThis.fetch = async (input, init) => {
      assert.ok(["POST", "GET"].includes(String(init?.method)));
      if (String(input).includes("auth.fu.do")) {
        return new Response(JSON.stringify({
          token: "synthetic-token", exp: Math.floor(Date.now()/1000) + 86400,
        }), { status: 200 });
      }
      storedRow = { ...later };
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const raced = await connectFudo(credentials, disconnected.businessRevision, null);
    assert.equal(raced.ok, false);
    if (!raced.ok) assert.equal(raced.code, "connection_changed");
    assert.equal((storedRow as Record<string, unknown> | null)?.credentials_ciphertext, "fixture-only");
    assert.equal(rpcCalls.at(-1), "fudo_replace_connection_guarded");
  } finally {
    storedRow = null;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo lifecycle surfaces a transaction-time permission denial without exposing credentials", async () => {
  role = "owner"; tenant = A; validMembership = true; profileActive = true;
  syncRunning = false; forceRpcForbidden = true;
  storedRow = {
    business_id: A, status: "connected", credentials_ciphertext: "synthetic-encrypted",
    connection_generation: "00000000-0000-4000-8000-000000000020", last_tested_at: null,
  };
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
    const disconnect = await disconnectFudo(undefined, disconnectRevision());
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

test("Fudo same-business stale disconnect cannot delete newer credentials, even at SQL commit time", async () => {
  role = "owner"; tenant = A; validMembership = true; profileActive = true; syncRunning = false;
  storedRow = {
    business_id: A, status: "connected", credentials_ciphertext: "synthetic-old",
    connection_generation: "00000000-0000-4000-8000-000000000030",
    last_tested_at: "2026-11-13T07:00:00.000Z",
  };
  const oldRevision = disconnectRevision();
  const beforeCalls = rpcCalls.length;
  storedRow = { ...storedRow, connection_generation: "00000000-0000-4000-8000-000000000031",
    credentials_ciphertext: "synthetic-new" };
  const stale = await disconnectFudo(undefined, oldRevision);
  assert.equal(stale.ok, false);
  if (!stale.ok) assert.equal(stale.code, "connection_changed");
  assert.equal(rpcCalls.length, beforeCalls, "stale UI rejected before invoking SQL");
  assert.equal(storedRow.credentials_ciphertext, "synthetic-new");

  const beforeRetest = disconnectRevision();
  storedRow = { ...storedRow, last_tested_at: "2026-11-13T07:01:00.000Z" };
  const staleRetest = await disconnectFudo(undefined, beforeRetest);
  assert.equal(staleRetest.ok, false);
  if (!staleRetest.ok) assert.equal(staleRetest.code, "connection_changed");
  assert.equal(storedRow.credentials_ciphertext, "synthetic-new");

  const currentRevision = disconnectRevision();
  rotateDuringDisconnectRpc = true;
  const raced = await disconnectFudo(undefined, currentRevision);
  assert.equal(raced.ok, false);
  if (!raced.ok) assert.equal(raced.code, "connection_changed");
  assert.equal(storedRow.credentials_ciphertext, "synthetic-new",
    "transaction-time change preserves newly rotated ciphertext");

  const latest = await disconnectFudo(undefined, disconnectRevision());
  assert.equal(latest.ok, true);
  assert.equal(storedRow, null, "current confirmation deletes credentials");
  const replay = await disconnectFudo(undefined, currentRevision);
  assert.equal(replay.ok, false, "replayed stale confirmation cannot disconnect anything");
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
