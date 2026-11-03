import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { encryptFudoCredentials } from "../lib/integrations/fudo/crypto";

const BUSINESS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORIGINAL_GENERATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ROTATED_GENERATION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const KEY = Buffer.alloc(32, 17).toString("base64");
const originalCiphertext = encryptFudoCredentials(
  BUSINESS, { apiKey: "fixture-fudo-api-key", apiSecret: "fixture-fudo-api-secret" }, KEY,
);
let connection = {
  business_id: BUSINESS,
  connection_generation: ORIGINAL_GENERATION,
  credentials_ciphertext: originalCiphertext,
  status: "connected",
  last_error_code: null as string | null,
};
const filtersSeen: string[] = [];
let writes = 0;

const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let updateValues: Partial<typeof connection> | null = null;
    return {
      select(_columns: string) { return this; },
      update(values: Partial<typeof connection>) { updateValues = values; return this; },
      eq(column: string, value: unknown) {
        filtersSeen.push(column);
        filters[column] = value;
        return this;
      },
      in(_column: string, _values: string[]) { return this; },
      async maybeSingle() {
        if (table === "business_members") return { error: null, data: { id: "active-member" } };
        if (table === "profiles") return { error: null, data: { active: true } };
        if (table !== "fudo_connections") throw Error("Unexpected table");
        const matching = Object.entries(filters).every(([field, value]) =>
          (connection as unknown as Record<string, unknown>)[field] === value);
        if (!matching) return { error: null, data: null };
        if (updateValues) {
          writes++;
          connection = { ...connection, ...updateValues };
          return { error: null, data: { business_id: BUSINESS } };
        }
        return { error: null, data: { ...connection } };
      },
    };
  },
};

const loader = Module as any;
const originalLoad = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/data/auth") return {
    getCurrentUserContext: async () => ({
      isAuthenticated: true, userId: USER, businessId: BUSINESS, role: "owner",
    }),
  };
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => db };
  if (name === "@/lib/env") return { isDatabaseMode: () => true };
  return originalLoad.call(this, name, ...args);
};
const { testStoredFudoConnection } = require("../lib/integrations/fudo/service") as typeof import("../lib/integrations/fudo/service");
loader._load = originalLoad;

test("Fudo retest fences stale results after credential rotation, without ciphertext URL filters", async () => {
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  const previousFetch = globalThis.fetch;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  try {
    for (const outcome of ["ok", "forbidden"] as const) {
      connection = {
        business_id: BUSINESS, connection_generation: ORIGINAL_GENERATION,
        credentials_ciphertext: originalCiphertext,
        status: "connected", last_error_code: null,
      };
      filtersSeen.length = 0;
      writes = 0;
      globalThis.fetch = async (input) => {
        if (String(input).includes("auth.fu.do")) {
          return new Response(JSON.stringify({
            token: "fixture-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
          }), { status: 200 });
        }
        // A different owner rotates the credentials while this HTTP read is in flight.
        connection = { ...connection, connection_generation: ROTATED_GENERATION };
        return outcome === "ok"
          ? new Response(JSON.stringify({ data: [] }), { status: 200 })
          : new Response(JSON.stringify({ error: "secret-provider-payload" }), { status: 403 });
      };
      const result = await testStoredFudoConnection();
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.equal(result.code, "connection_changed");
        assert.doesNotMatch(result.message, /secret-provider-payload|fixture-bearer|api-secret/);
      }
      assert.equal(writes, 0, "old probe may not update a newly rotated connection");
      assert.equal(connection.status, "connected");
      assert.equal(connection.last_error_code, null);
      assert.equal(connection.connection_generation, ROTATED_GENERATION);
      assert.ok(filtersSeen.includes("connection_generation"));
      assert.ok(!filtersSeen.includes("credentials_ciphertext"), "ciphertext must not be used as a URL filter");
    }

    // Normal retest of an unchanged generation must still persist success.
    connection = { ...connection, connection_generation: ORIGINAL_GENERATION };
    writes = 0;
    globalThis.fetch = async (input) => String(input).includes("auth.fu.do")
      ? new Response(JSON.stringify({
        token: "fixture-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 })
      : new Response(JSON.stringify({ data: [] }), { status: 200 });
    const success = await testStoredFudoConnection();
    assert.equal(success.ok, true);
    assert.equal(writes, 1);
    assert.equal(connection.status, "connected");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
