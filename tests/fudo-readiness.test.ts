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
        const stored = filters.business_id === A ? ciphertextA :
          filters.business_id === B ? ciphertextB : null;
        return { error: null, data: stored ? { credentials_ciphertext: stored } : null };
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
