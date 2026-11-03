import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
let role = "owner";
let tenant = A;
let validMembership = false;
let memberLookups = 0;
let storedRow: Record<string, unknown> | null = null;

const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const query: any = {
      select(_fields: string) { return this; },
      eq(field: string, value: unknown) { filters[field] = value; return this; },
      in(_field: string, _values: string[]) { return this; },
      limit(_value: number) { return Promise.resolve({ data: [], error: null }); },
      async maybeSingle() {
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
const { connectFudo } = require("../lib/integrations/fudo/service") as typeof import("../lib/integrations/fudo/service");
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
    const outcome = await connectFudo({ ...credentials, businessId: B } as any);
    assert.equal(outcome.ok, true);
    assert.equal(dataReads, 1);
    assert.equal(storedRow?.business_id, A);
    assert.equal(storedRow?.status, "connected");
    const encoded = String(storedRow?.credentials_ciphertext);
    assert.ok(encoded.startsWith("v1."));
    assert.ok(!encoded.includes(credentials.apiKey));
    assert.ok(!encoded.includes(credentials.apiSecret));
  } finally {
    globalThis.fetch = beforeFetch;
    if (beforeKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = beforeKey;
  }
});
