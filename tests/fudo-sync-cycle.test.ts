import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
let denyPageCommit = false;
let denyFinish = false;
let switchBusinessOnConnectionRead = false;
let beginSyncCalls = 0;
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
    update(values: Row) {
      if (table === "fudo_sync_runs" || table === "fudo_connections") {
        throw new Error("Sync finalization must use fudo_finish_sync RPC, not separate table writes");
      }
      action = "update"; changes = values; return this;
    },
    delete() { throw new Error("Direct Fudo cursor deletes must use the authorized begin_sync RPC"); },
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
  async rpc(name: string, args: Record<string, any>) {
    if (name === "fudo_begin_sync") {
      if (!membershipActive || activeBusiness !== A
        || args.p_business_id !== A || args.p_actor_id !== USER) {
        return { data: { code: "forbidden" }, error: null };
      }
      // SQL handles a full five-resource rescan atomically with starting
      // the run. A revoked actor can never clear completed cursors.
      const resources = ["products", "ingredients", "providers", "orders", "sales"];
      if (resources.every((resource) => progress.some((item) =>
        item.business_id === A && item.connection_generation === GENERATION
          && item.resource_type === resource && item.next_page === 0))) {
        for (let i = progress.length - 1; i >= 0; i--) {
          if (progress[i].business_id === A
            && progress[i].connection_generation === GENERATION) progress.splice(i, 1);
        }
      }
      const id = String(++runNumber);
      runs.push({
        id, business_id: A, connection_generation: GENERATION, status: "running",
        started_at: new Date().toISOString(), finished_at: null, counts: {}, error_code: null,
      });
      return { data: { code: "started", run_id: id }, error: null };
    }
    if (name === "fudo_finish_sync") {
      const run = runs.find((entry) => entry.id === args.p_run_id &&
        entry.business_id === A && entry.connection_generation === GENERATION &&
        entry.status === "running");
      if (!run || args.p_business_id !== A || args.p_actor_id !== USER) {
        return { data: { code: "run_changed" }, error: null };
      }
      const allowed = membershipActive && activeBusiness === A && !denyFinish;
      if (args.p_status !== "failed" && !allowed) {
        return { data: { code: "forbidden" }, error: null };
      }
      // The audit close and connection health update occur in one SQL txn.
      run.status = args.p_status;
      run.counts = args.p_counts;
      run.error_code = args.p_error_code;
      run.finished_at = new Date().toISOString();
      if (allowed && args.p_update_connection) {
        if (args.p_status !== "failed") conn.status = "connected";
        conn.last_sync_status = args.p_status;
        conn.last_error_code = args.p_error_code;
        if (args.p_status !== "failed") conn.last_synced_at = run.finished_at;
      }
      return { data: { code: "finished" }, error: null };
    }
    if (name !== "fudo_commit_sync_page") throw Error("Unexpected RPC");
    // Simulate the SQL transaction checking membership AFTER the app's last
    // async reauthorization, and committing staging+cursor as one operation.
    if (denyPageCommit || !membershipActive || activeBusiness !== A
      || args.p_business_id !== A || args.p_actor_id !== USER) {
      return { data: { code: "forbidden" }, error: null };
    }
    if (args.p_expected_generation !== GENERATION) {
      return { data: { code: "connection_changed" }, error: null };
    }
    if (!runs.some((r) => r.id === args.p_run_id && r.status === "running")) {
      return { data: { code: "run_changed" }, error: null };
    }
    const current = progress.find((p) => p.business_id === A
      && p.connection_generation === GENERATION && p.resource_type === args.p_resource_type);
    if ((current?.next_page ?? 1) !== args.p_expected_page) {
      return { data: { code: "stale_page" }, error: null };
    }
    if (args.p_expected_page > 1
      && (current?.cycle_id ?? null) !== args.p_cycle_id) {
      return { data: { code: "cycle_changed" }, error: null };
    }
    const seenAt = new Date().toISOString();
    const entries = args.p_rows as Row[];
    // Mirror the PostgreSQL same-cycle collision fence: a normal second
    // full scan may re-see an ID, but overlapping pages within ONE scan fail.
    if (args.p_expected_page > 1 && entries.some((entry) => records.some((prior) =>
      prior.business_id === A && prior.connection_generation === GENERATION
      && prior.resource_type === args.p_resource_type && prior.external_id === entry.external_id
      && prior.last_seen_cycle_id === args.p_cycle_id))) {
      return { data: { code: "duplicate_in_cycle" }, error: null };
    }
    for (const entry of entries) {
      const row = {
        business_id: A, connection_generation: GENERATION, provider: "fudo",
        resource_type: args.p_resource_type, external_id: entry.external_id,
        payload: entry.payload, content_hash: entry.content_hash,
        last_seen_cycle_id: args.p_cycle_id,
        source_updated_at: entry.source_updated_at, last_seen_at: seenAt,
      };
      const index = records.findIndex((p) => p.business_id === A
        && p.connection_generation === GENERATION
        && p.resource_type === row.resource_type && p.external_id === row.external_id);
      if (index >= 0) records[index] = { ...records[index], ...row };
      else records.push(row);
    }
    const next = {
      business_id: A, connection_generation: GENERATION, resource_type: args.p_resource_type,
      next_page: args.p_next_page, cycle_id: args.p_cycle_id,
      cycle_started_at: args.p_cycle_started_at,
      last_complete_at: args.p_next_page === 0 ? seenAt : null,
      updated_at: seenAt,
    };
    if (current) Object.assign(current, next);
    else progress.push(next);
    return { data: { code: "saved" }, error: null };
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
      assert.ok(providerMethods.length <= 3,
        "the aborted run must not start fresh GETs after the initial concurrent batch");
    }
  } finally {
    membershipActive = true;
    activeBusiness = A;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo O1 SQL page fence denies a revocation after app preflight with no snapshot or cursor write", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const recordSnapshot = JSON.stringify(records);
  const progressSnapshot = JSON.stringify(progress);
  const connectionSnapshot = { ...conn };
  denyPageCommit = true;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      return new Response(JSON.stringify({
        token: "synthetic-token", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({
      data: [{ id: "must-not-write", type: new URL(String(input)).pathname.split("/").at(-1),
        attributes: { name: "private-mock" } }],
      links: { next: null },
    }), { status: 200 });
  };
  try {
    const result = await syncFudoReadOnly();
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.code, "forbidden");
      assert.doesNotMatch(result.message, /private-mock|synthetic-token|must-not-write/);
    }
    assert.equal(JSON.stringify(records), recordSnapshot);
    assert.equal(JSON.stringify(progress), progressSnapshot);
    assert.deepEqual(conn, connectionSnapshot, "revoked SQL transaction never changes connection health");
    assert.equal(runs.at(-1)?.status, "failed", "failed audit run still closes");
  } finally {
    denyPageCommit = false;
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});

test("Fudo O1 finalization denies revoked owner before changing connection health", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  membershipActive = true;
  activeBusiness = A;
  denyFinish = true;
  const healthBefore = { ...conn };
  const providerMethods: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "synthetic-token", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    providerMethods.push(String(init?.method));
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const result = await syncFudoReadOnly();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "forbidden");
    assert.equal(runs.at(-1)?.status, "failed", "audit run closes after denied success");
    assert.deepEqual(conn, healthBefore, "revoked finalize cannot mark connection successful");
    assert.ok(providerMethods.every((method) => method === "GET"), "Fudo remains read-only");
  } finally {
    denyFinish = false;
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
          // A non-terminal 100-row read may safely continue with size 100.
          // A short first page cannot prove the provider's effective offset.
          data: Array.from({ length: 100 }, (_, index) => ({
            id: `item-${index + 1}`, attributes: { name: "fixture product" },
          })),
          links: { next: "/v1alpha1/products?page=2" },
        }), { status: 200 });
      }
      if (phase === "resume") {
        assert.equal(page, "2");
        return new Response(JSON.stringify({
          data: [{ id: "item-101", attributes: { name: "fixture product 101" } }],
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
    assert.equal(records.filter((row) => row.resource_type === "products").length, 100);

    phase = "resume";
    const second = await syncFudoReadOnly();
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.equal(progress.find((row) => row.resource_type === "products")?.cycle_id, firstCycle);
    assert.equal(progress.find((row) => row.resource_type === "products")?.next_page, 0);
    assert.equal(records.filter((row) => row.resource_type === "products").length, 101);

    phase = "rescan";
    const third = await syncFudoReadOnly();
    assert.equal(third.ok, true, JSON.stringify(third));
    const newCycle = progress.find((row) => row.resource_type === "products")?.cycle_id;
    assert.notEqual(newCycle, firstCycle);
    assert.equal(records.find((row) => row.external_id === "item-1")?.last_seen_cycle_id, newCycle);
    assert.equal(records.find((row) => row.external_id === "item-101")?.last_seen_cycle_id, firstCycle);
    const view = await getFudoConnectionView();
    assert.ok(view);
    assert.equal(view.importedCounts.products, 101, "staging history is retained");
    assert.equal(view.seenThisCycleCounts.products, 1);
    assert.equal(view.possiblyMissingCounts.products, 100);
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
    if (!outcome.ok) {
      assert.equal(outcome.code, "invalid_response");
      assert.match(outcome.message, /paginación no verificable/);
    }
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

test("Fudo O1 rejects a nonempty short page without next metadata before staging or cursor", async () => {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const beforeRecords = JSON.stringify(records.filter((row) => row.resource_type === "products"));
  const beforeProgress = JSON.stringify(progress.filter((row) => row.resource_type === "products"));
  const verbs: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "synthetic-token", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    verbs.push(String(init?.method));
    if (new URL(String(input)).pathname.endsWith("/products")) {
      return new Response(JSON.stringify({
        // A valid row with no links: we cannot know whether the provider
        // silently limited the requested 100-record page to one record.
        data: [{ id: "uncommitted-short-product", attributes: { name: "synthetic-only" } }],
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const outcome = await syncFudoReadOnly();
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.code, "invalid_response");
      assert.match(outcome.message, /paginación no verificable/);
      assert.doesNotMatch(outcome.message, /synthetic-token|uncommitted-short-product/);
    }
    assert.equal(runs.at(-1)?.status, "failed", "ambiguous provider pagination is an auditable failed run");
    assert.equal(JSON.stringify(records.filter((row) => row.resource_type === "products")), beforeRecords,
      "no partial staging persisted");
    assert.equal(JSON.stringify(progress.filter((row) => row.resource_type === "products")), beforeProgress,
      "the resource cursor must not advance or close");
    assert.ok(verbs.length > 0 && verbs.every((verb) => verb === "GET"), "Fudo stays GET-only");
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = prevKey;
  }
});

test("Fudo O1 rejects a short page with numbered next metadata before staging or cursor", async () => {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  const beforeRecords = JSON.stringify(records.filter((row) => row.resource_type === "products"));
  const beforeProgress = JSON.stringify(progress.filter((row) => row.resource_type === "products"));
  const verbs: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({
        token: "synthetic-token", exp: Math.floor(Date.now() / 1000) + 86400,
      }), { status: 200 });
    }
    verbs.push(String(init?.method));
    if (new URL(String(input)).pathname.endsWith("/products")) {
      return new Response(JSON.stringify({
        // Provider may cap a 100-row request to one row but advertise page 2.
        // Continuing with page[size]=100 could skip source records 2..100.
        data: [{ id: "uncommitted-short-product", attributes: { name: "synthetic-only" } }],
        links: { next: "/v1alpha1/products?page[number]=2&page[size]=100" },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const outcome = await syncFudoReadOnly();
    assert.equal(outcome.ok, false);
    if (!outcome.ok) {
      assert.equal(outcome.code, "invalid_response");
      assert.match(outcome.message, /paginación no verificable/);
      assert.doesNotMatch(outcome.message, /synthetic-token|uncommitted-short-product/);
    }
    assert.equal(runs.at(-1)?.status, "failed", "ambiguous provider pagination is an auditable failed run");
    assert.equal(JSON.stringify(records.filter((row) => row.resource_type === "products")), beforeRecords,
      "no partial staging persisted");
    assert.equal(JSON.stringify(progress.filter((row) => row.resource_type === "products")), beforeProgress,
      "the resource cursor must not advance or close");
    assert.ok(verbs.length > 0 && verbs.every((verb) => verb === "GET"), "Fudo stays GET-only");
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


test("Fudo O1 overlapping pages fail before staging and cursor, without leaking provider records", async () => {
  const prevFetch = globalThis.fetch;
  const prevKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  progress.length = 0;
  records.length = 0;
  runs.length = 0;
  membershipActive = true;
  activeBusiness = A;
  denyPageCommit = false;
  denyFinish = false;
  conn.status = "connected";
  conn.connection_generation = GENERATION;
  const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://auth.fu.do/api") {
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ token: "synthetic-bearer",
        exp: Math.floor(Date.now() / 1000) + 86400 }), { status: 200 });
    }
    methods.push(String(init?.method));
    const url = new URL(String(input));
    if (url.pathname.endsWith("/products")) {
      const second = url.searchParams.get("page[number]") === "2";
      return new Response(JSON.stringify({
        data: second
          ? [{ id: "overlap-id-fixture", type: "Product", attributes: { name: "must-not-stage" } }]
          : Array.from({ length: 100 }, (_, index) => ({
            id: index === 0 ? "overlap-id-fixture" : `first-page-${index}`,
            type: "Product", attributes: { name: "original" },
          })),
        links: { next: second ? null : "https://api.fu.do/v1alpha1/products?page[number]=2&page[size]=100" },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
  };
  try {
    const first = await syncFudoReadOnly();
    assert.equal(first.ok, true, "first page is valid but incomplete");
    if (first.ok) assert.equal(first.hasMorePages, true);
    const beforeRecords = JSON.stringify(records.filter((row) => row.resource_type === "products"));
    const beforeCursor = JSON.stringify(progress.filter((row) => row.resource_type === "products"));
    assert.equal(records.filter((row) => row.resource_type === "products").length, 100);
    const second = await syncFudoReadOnly();
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.code, "invalid_response");
      assert.doesNotMatch(second.message, /overlap-id-fixture|must-not-stage|synthetic-bearer/);
    }
    assert.equal(runs.at(-1)?.status, "failed", "colliding page is recorded as failed");
    assert.equal(JSON.stringify(records.filter((row) => row.resource_type === "products")), beforeRecords,
      "overlap cannot overwrite or remark an existing provider record");
    assert.equal(JSON.stringify(progress.filter((row) => row.resource_type === "products")), beforeCursor,
      "overlap cannot finish or advance the provider cursor");
    assert.ok(methods.length > 0 && methods.every((method) => method === "GET"));
  } finally {
    globalThis.fetch = prevFetch;
    if (prevKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = prevKey;
  }
});


test("Fudo O1 blocks a stale foreground tenant/credential revision before any provider read or staging", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
  process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = KEY;
  membershipActive = true;
  activeBusiness = A;
  conn.status = "connected";
  conn.connection_generation = GENERATION;
  conn.last_tested_at = null;
  progress.length = 0;
  records.length = 0;
  runs.length = 0;
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests++;
    throw new Error("no Fudo request must be issued");
  };
  try {
    // Different tenant/rotated connection revision from the UI:
    // the server must not start a new run or call auth.fu.do.
    const rejected = await syncFudoReadOnly("0".repeat(64));
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.code, "connection_changed");
    assert.equal(providerRequests, 0);
    assert.equal(runs.length, 0);
    assert.equal(progress.length, 0);
    assert.equal(records.length, 0);

    // A matching server-derived revision must still permit a normal read-only
    // cycle; reject only stale tenant/connection context, not valid pilots.
    const revision = createHash("sha256")
      .update(JSON.stringify([A, GENERATION, "connected", null]))
      .digest("hex");
    globalThis.fetch = async (input, init) => {
      providerRequests++;
      if (String(input) === "https://auth.fu.do/api") {
        assert.equal(init?.method, "POST");
        return new Response(JSON.stringify({ token: "synthetic-token",
          exp: Math.floor(Date.now() / 1000) + 86400 }), { status: 200 });
      }
      assert.equal(init?.method, "GET");
      return new Response(JSON.stringify({ data: [], links: { next: null } }), { status: 200 });
    };
    const accepted = await syncFudoReadOnly(revision);
    assert.equal(accepted.ok, true);
    assert.equal(runs.length, 1);
    assert.ok(providerRequests >= 6, "one auth and five read-only resource probes");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.FUDO_CREDENTIALS_ENCRYPTION_KEY = previousKey;
  }
});
