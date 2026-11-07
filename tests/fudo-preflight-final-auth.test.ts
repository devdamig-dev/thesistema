import assert from "node:assert/strict";
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
              connection_generation: GENERATION,
              status: "connected",
              last_tested_at: "2026-11-07T00:00:00Z",
            }
          : null;
        // The first authorization after provider GETs has already passed.
        // A concurrent revocation lands during the LAST connection metadata
        // read, before the preflight would otherwise publish five green checks.
        if (connectionReads === 2) duringFinalConnectionRead?.();
        return { data: row, error: null };
      },
    };
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
const { inspectFudoReadPermissions } = require("../lib/integrations/fudo/service") as typeof import("../lib/integrations/fudo/service");
loader._load = originalLoad;

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
      assert.equal(connectionReads, 2, `must reach final reread: ${scenario}`);
      assert.deepEqual(verbs, Array(5).fill("GET"), `Fudo must remain read-only: ${scenario}`);
      assert.equal(result.ok, false, scenario);
      assert.deepEqual(result.checks, [], `must discard all five checks: ${scenario}`);
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
    assert.deepEqual(verbs, Array(5).fill("GET"));
  } finally {
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    duringFinalConnectionRead = null;
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  }
});
