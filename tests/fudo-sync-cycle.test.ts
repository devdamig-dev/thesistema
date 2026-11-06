import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { encryptFudoCredentials } from "../lib/integrations/fudo/crypto";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GENERATION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const KEY = Buffer.alloc(32, 23).toString("base64");
const ciphertext = encryptFudoCredentials(A, {
  apiKey: "synthetic-pilot-key", apiSecret: "synthetic-pilot-secret",
}, KEY);

type Row = Record<string, any>;
const progress: Row[] = [];
const records: Row[] = [];
let membershipActive = true;
let activeBusiness = A;
const runs: Row[] = [];
const conn: Row = {
  business_id: A, connection_generation: GENERATION, credentials_ciphertext: ciphertext,
  status: "connected", last_tested_at: null, last_synced_at: null,
  last_sync_status: null, last_error_code: null,
};

let runNumber = 0;
function matches(row: Row, filters: Record<string, unknown>): boolean {
  return Object.entries(filters).every(([key, value]) => row[key] === value);
}
function from(table: string) {
  let filters: Record<string, unknown> = {};
  let limit = Infinity;
  let countOnly = false;
  let newestFirst = false;
  let action: "select" | "update" | "delete" = "select";
  let changes: Row = {};

  const query: any = {
    select(_columns: string, options?: { count?: string; head?: boolean }) {
      countOnly = options?.head === true;
      return this;
    },
    eq(key: string, value: unknown) { filters = { ...filters, [key]: value }; return this; },
    in(_key: string, _values: string[]) { return this; },
    order(_key: string, options: { ascending?: boolean }) {
      newestFirst = table === "fudo_sync_runs" && _key === "started_at" && options?.ascending === false;
      return this;
    },
    limit(n: number) { limit = n; return this; },
    update(values: Row) { action = "update"; changes = values; return this; },
    delete() { action = "delete"; return this; },
    async upsert(values: Row | Row[], _options?: unknown) {
      if (table === "fudo_sync_progress") {
        for (const row of [values].flat()) {
          const idx = progress.findIndex((p) =>
            p.business_id === row.business_id && p.connection_generation === row.connection_generation
            && p.resource_type === row.resource_type);
          if (idx >= 0) progress[idx] = { ...progress[idx], ...row };
          else progress.push({ ...row });
        }
      } else if (table === "fudo_external_records") {
        for (const row of [values].flat()) {
          const idx = records.findIndex((p) =>
            p.business_id === row.business_id && p.connection_generation === row.connection_generation
            && p.resource_type === row.resource_type && p.external_id === row.external_id);
          if (idx >= 0) records[idx] = { ...records[idx], ...row };
          else records.push({ ...row });
        }
      } else throw Error("Unexpected staging upsert");
      return { error: null };
    },
    async maybeSingle() {
      if (table === "profiles") return { data: { active: true }, error: null };
      if (table === "business_members") return { data: membershipActive ? { id: "active-member" } : null, error: null };
      return { data: matching()[0] ?? null, error: null };
    },
    then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
      let data: Row[] | null = null;
      let count: number | null = null;
      if (action === "delete") {
        if (table !== "fudo_sync_progress") throw Error("Unexpected delete");
        for (let i = progress.length - 1; i >= 0; i--) {
          if (matches(progress[i], filters)) progress.splice(i, 1);
        }
      } else if (action === "update") {
        for (const row of matching()) Object.assign(row, changes);
      } else {
        const found = matching();
        count = countOnly ? found.length : null;
        data = countOnly ? null : found;
      }
      return Promise.resolve({ data, count, error: null }).then(resolve, reject);
    },
  };

  function matching(): Row[] {
    const source = table === "fudo_connections" ? [conn]
      : table === "fudo_sync_progress" ? progress
        : table === "fudo_external_records" ? records
          : table === "fudo_sync_runs" ? runs : [];
    const matched = source.filter((r) => matches(r, filters));
    // Supabase honors ORDER BY started_at DESC; our earlier mock ignored it.
    // A rejected run preceding valid runs must not appear as the latest run.
    return (newestFirst ? matched.reverse() : matched).slice(0, limit);
  }
  return query;
}
const db = {
  from,
  async rpc(name: string, _args: Record<string, unknown>) {
    if (name !== "fudo_begin_sync") throw Error("Unexpected RPC");
    const id = String(++runNumber);
    runs.push({
      id, business_id: A, connection_generation: GENERATION, status: "running",
      started_at: new Date().toISOString(), finished_at: null, counts: {}, error_code: null,
    });
    return { data: { code: "started", run_id: id }, error: null };
  },
};

const loader = Module as any;
const previousLoad = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/data/auth") return {
    getCurrentUserContext: async () => ({ isAuthenticated: true, userId: USER, businessId: activeBusiness, role: "owner" }),
  };
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => db };
  if (name === "@/lib/env") return { isDatabaseMode: () => true };
  return previousLoad.call(this, name, ...args);
};
const { syncFudoReadOnly, getFudoConnectionView } =
  require("../lib/integrations/fudo/service") as typeof import("../lib/integrations/fudo/service");
loader._load = previousLoad;

test("Fudo O1 refuses staging and cursor writes if owner is revoked or switches tenant during GET", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  try {
    for (const transition of ["revoked", "switched"] as const) {
      membershipActive = true;
      activeBusiness = A;
      const beforeRecords = JSON.stringify(records);
      const beforeProgress = JSON.stringify(progress);
      const beforeConnection = { ...conn };
      const providerMethods: string[] = [];
      globalThis.fetch = async (input, init) => {
        if (String(input) === "https://auth.fu.do/api") {
          assert.equal(init?.method, "POST");
          return new Response(JSON.stringify({
            token: "fixture-token", exp: Math.floor(Date.now() / 1000) + 86400,
          }), { status: 200 });
        }
        providerMethods.push(String(init?.method));
        if (transition === "revoked") membershipActive = false;
        else activeBusiness = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
        return new Response(JSON.stringify({
          data: [{ id: "must-not-stage", type: new URL(String(input)).pathname.split("/").at(-1),
            attributes: { name: "private-fixture" } }],
          links: { next: null },
        }), { status: 200 });
      };
      const outcome = await syncFudoReadOnly();
      assert.equal(outcome.ok, false, transition);
      if (!outcome.ok) {
        assert.equal(outcome.code, "forbidden", transition);
        assert.doesNotMatch(outcome.message, /fixture-token|private-fixture|must-not-stage/);
      }
      assert.equal(JSON.stringify(records), beforeRecords, "no provider snapshot persisted after actor changed");
      assert.equal(JSON.stringify(progress), beforeProgress, "no cursor advanced after actor changed");
      assert.equal(runs.at(-1)?.status, "failed", "audit run is closed for recovery");
      assert.deepEqual(conn, beforeConnection, "revoked actor cannot update connection health");
      assert.ok(providerMethods.length > 0 && providerMethods.every((verb) => verb === "GET"),
        "only safe read calls reach Fudo");
    }
  } finally {
    membershipActive = true;
    activeBusiness = A;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo O1 pagination keeps one cycle UUID then flags a provider ID absent on a full rescan", async () => {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  let phase: "first" | "resume" | "rescan" = "first";
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
    const endpoint = new URL(url);
    const page = endpoint.searchParams.get("page[number]");
    if (endpoint.pathname.endsWith("/products")) {
      if (phase === "first") {
        assert.equal(page, "1");
        return new Response(JSON.stringify({
          data: [{ id: "item-1", attributes: { name: "fixture product" } }],
          links: { next: "/v1alpha1/products?page=2" },
        }), { status: 200 });
      }
      if (phase === "resume") {
        assert.equal(page, "2");
        return new Response(JSON.stringify({
          data: [{ id: "item-2", attributes: { name: "fixture product 2" } }],
          links: { next: null },
        }), { status: 200 });
      }
      assert.equal(page, "1");
      return new Response(JSON.stringify({
        data: [{ id: "item-1", attributes: { name: "fixture product" } }],
        links: { next: null },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };

  try {
    const first = await syncFudoReadOnly();
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(progress.find((row) => row.resource_type === "products")?.next_page, 2);
    const firstCycle = progress.find((row) => row.resource_type === "products")?.cycle_id;
    assert.match(String(firstCycle), /^[a-f0-9-]{36}$/i);
    assert.equal(records.filter((row) => row.resource_type === "products").length, 1);

    phase = "resume";
    const second = await syncFudoReadOnly();
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(progress.find((row) => row.resource_type === "products")?.cycle_id, firstCycle);
    assert.equal(progress.find((row) => row.resource_type === "products")?.next_page, 0);
    assert.equal(records.filter((row) => row.resource_type === "products").length, 2);

    phase = "rescan";
    const third = await syncFudoReadOnly();
    assert.equal(third.ok, true, JSON.stringify(third));
    const newCycle = progress.find((row) => row.resource_type === "products")?.cycle_id;
    assert.notEqual(newCycle, firstCycle);
    assert.equal(records.find((row) => row.external_id === "item-1")?.last_seen_cycle_id, newCycle);
    assert.equal(records.find((row) => row.external_id === "item-2")?.last_seen_cycle_id, firstCycle);
    const view = await getFudoConnectionView();
    assert.ok(view);
    assert.equal(view.importedCounts.products, 2, "staging history is retained");
    assert.equal(view.seenThisCycleCounts.products, 1);
    assert.equal(view.possiblyMissingCounts.products, 1);
    assert.ok(providerVerbs.length > 0 && providerVerbs.every((verb) => verb === "GET"),
      "never write to provider API");
    assert.doesNotMatch(JSON.stringify(view), /synthetic-pilot|synthetic-token|credentials_ciphertext|payload/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = prevKey;
  }
});


test("Fudo O1 never advances the invalid resource cursor for a rounded numeric provider ID", async () => {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const priorProducts = records.filter((row) => row.resource_type === "products").map((row) => row.external_id).sort();
  const providerVerbs: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      return new Response(JSON.stringify({
        token: "synthetic-token", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    providerVerbs.push(String(init?.method));
    if (new URL(String(input)).pathname.endsWith("/products")) {
      return new Response(JSON.stringify({ data: [{ id: Number.MAX_SAFE_INTEGER + 1 }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    // The previous test finishes a complete cycle: starting this new one
    // clears cursors only, never the historical records.
    const outcome = await syncFudoReadOnly();
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "invalid_response");
    assert.equal(runs.at(-1)?.status, "failed");
    assert.equal(progress.find((row) => row.resource_type === "products"), undefined,
      "an invalid products page must not commit a cursor");
    assert.deepEqual(records.filter((row) => row.resource_type === "products")
      .map((row) => row.external_id).sort(), priorProducts,
      "the failed scan must not corrupt the old external_id mapping");
    assert.ok(providerVerbs.length > 0 && providerVerbs.every((method) => method === "GET"));
    assert.doesNotMatch(JSON.stringify(outcome), /synthetic-token|synthetic-pilot-secret/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = prevKey;
  }
});

test("Fudo O1 rejects malformed pagination before changing staging or cursor", async () => {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const productRecordsBefore = JSON.stringify(records.filter((row) => row.resource_type === "products"));
  const productProgressBefore = JSON.stringify(progress.filter((row) => row.resource_type === "products"));
  const providerVerbs: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST", "only bearer authentication may use POST");
      return new Response(JSON.stringify({
        token: "synthetic-token", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    providerVerbs.push(String(init?.method));
    if (new URL(url).pathname.endsWith("/products")) {
      // The record is valid and the link stays on Fudo's host, but it
      // points to a DIFFERENT resource. The whole page must be rejected
      // before staging or cursor changes.
      return new Response(JSON.stringify({
        data: [{ id: "uncommitted-product", attributes: { name: "must-not-import" } }],
        links: { next: "/v1alpha1/orders?page[number]=2" },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const outcome = await syncFudoReadOnly();
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "invalid_response");
    assert.equal(runs.at(-1)?.status, "failed");
    assert.equal(JSON.stringify(records.filter((row) => row.resource_type === "products")),
      productRecordsBefore, "an invalid page must not insert or remark provider records");
    assert.equal(JSON.stringify(progress.filter((row) => row.resource_type === "products")),
      productProgressBefore, "an invalid page must not advance its cursor");
    assert.ok(providerVerbs.length > 0 && providerVerbs.every((method) => method === "GET"),
      "no mutations to Fudo");
    assert.doesNotMatch(JSON.stringify(outcome), /synthetic-token|synthetic-pilot-secret|must-not-import/);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = prevKey;
  }
});

test("Fudo O1 rejects a cross-resource JSON:API record before staging or cursor advance", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const beforeProducts = JSON.stringify(records.filter((row) => row.resource_type === "products"));
  const beforeCursor = JSON.stringify(progress.filter((row) => row.resource_type === "products"));
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST", "POST is reserved for bearer authentication");
      return new Response(JSON.stringify({
        token: "synthetic-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    methods.push(String(init?.method));
    if (new URL(String(input)).pathname.endsWith("/products")) {
      // Structurally valid ID but from /sales: this is not a product.
      return new Response(JSON.stringify({
        data: [{ id: "must-not-stage", type: "Sale", attributes: { name: "private-fixture" } }],
        links: { next: null },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const outcome = await syncFudoReadOnly();
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "invalid_response");
    assert.equal(runs.at(-1)?.status, "failed");
    assert.equal(JSON.stringify(records.filter((row) => row.resource_type === "products")),
      beforeProducts, "never persist a cross-resource record");
    assert.equal(JSON.stringify(progress.filter((row) => row.resource_type === "products")),
      beforeCursor, "never advance the mismatched resource cursor");
    assert.ok(methods.length > 0 && methods.every((method) => method === "GET"));
    assert.doesNotMatch(JSON.stringify(outcome), /must-not-stage|synthetic-bearer|private-fixture/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  }
});


test("Fudo O1 rejects an oversized multibyte record before staging or cursor changes", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const beforeProducts = JSON.stringify(records.filter((row) => row.resource_type === "products"));
  const beforeCursor = JSON.stringify(progress.filter((row) => row.resource_type === "products"));
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "synthetic-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    methods.push(String(init?.method));
    if (new URL(String(input)).pathname.endsWith("/products")) {
      return new Response(JSON.stringify({
        data: [{ id: "multibyte-reject", type: "Product",
          attributes: { description: "ñ".repeat(70_000) } }],
        links: { next: null },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const outcome = await syncFudoReadOnly();
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "invalid_response");
    assert.equal(runs.at(-1)?.status, "failed");
    assert.equal(JSON.stringify(records.filter((row) => row.resource_type === "products")),
      beforeProducts, "an oversized provider record must never enter staging");
    assert.equal(JSON.stringify(progress.filter((row) => row.resource_type === "products")),
      beforeCursor, "no cursor advance after rejecting an oversized page");
    assert.ok(methods.length > 0 && methods.every((method) => method === "GET"));
    assert.doesNotMatch(JSON.stringify(outcome), /multibyte-reject|synthetic-bearer|ññ/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  }
});

test("Fudo O1 does not persist a mixed JSON:API data/errors page or advance its cursor", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const beforeProducts = JSON.stringify(records.filter((row) => row.resource_type === "products"));
  const beforeCursor = JSON.stringify(progress.filter((row) => row.resource_type === "products"));
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "synthetic-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    methods.push(String(init?.method));
    if (new URL(String(input)).pathname.endsWith("/products")) {
      return new Response(JSON.stringify({
        data: [{ id: "do-not-store", type: "Product" }],
        errors: [{ detail: "private-provider-error" }],
        links: { next: null },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const outcome = await syncFudoReadOnly();
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.code, "invalid_response");
    assert.equal(runs.at(-1)?.status, "failed");
    assert.equal(JSON.stringify(records.filter((row) => row.resource_type === "products")),
      beforeProducts, "a partial/error provider document cannot insert or remark a product");
    assert.equal(JSON.stringify(progress.filter((row) => row.resource_type === "products")),
      beforeCursor, "a mixed document cannot advance the products cursor");
    assert.ok(methods.length > 0 && methods.every((method) => method === "GET"));
    assert.doesNotMatch(JSON.stringify(outcome), /private-provider-error|synthetic-bearer|do-not-store/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = originalKey;
  }
});

test("Fudo O1 malformed attributes cannot overwrite staging or advance a resource cursor", async () => {
  const priorFetch = globalThis.fetch;
  const priorKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const beforeRecords = JSON.stringify(records.filter((row) => row.resource_type === "products"));
  const beforeProgress = JSON.stringify(progress.filter((row) => row.resource_type === "products"));
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "fixture-bearer", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    methods.push(String(init?.method));
    if (new URL(String(input)).pathname.endsWith("/products")) {
      return new Response(JSON.stringify({
        data: [{ id: "must-not-stage", type: "Product", attributes: ["private-fixture"] }],
        links: { next: null },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const result = await syncFudoReadOnly();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "invalid_response");
    assert.equal(runs.at(-1)?.status, "failed");
    assert.equal(JSON.stringify(records.filter((row) => row.resource_type === "products")),
      beforeRecords, "invalid attributes must never overwrite or remark staging");
    assert.equal(JSON.stringify(progress.filter((row) => row.resource_type === "products")),
      beforeProgress, "invalid attributes must never advance the cursor");
    assert.ok(methods.length > 0 && methods.every((method) => method === "GET"));
    assert.doesNotMatch(JSON.stringify(result), /must-not-stage|private-fixture|fixture-bearer/);
  } finally {
    globalThis.fetch = priorFetch;
    if (priorKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = priorKey;
  }
});
