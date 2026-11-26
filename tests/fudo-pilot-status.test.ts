import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const CYCLE_A = "a1111111-1111-4111-8111-111111111111";
const CYCLE_B = "b2222222-2222-4222-8222-222222222222";
let tenant = A;
let role = "owner";
let isMember = true;
let profileActive = true;
let duringProgressRead: (() => void) | null = null;
let duringConnectionRead: (() => void) | null = null;
// Synthetic PostgREST HEAD count overrides: undefined = ordinary exact count.
let historicalProductsCountOverride: unknown = undefined;
let cycleProductsCountOverride: unknown = undefined;

const connections = [
  { business_id: A, connection_generation: GA, status: "connected", last_tested_at: null,
    last_synced_at: null, last_sync_status: "partial", last_error_code: null,
    credentials_ciphertext: "PRIVATE_CIPHERTEXT_A" },
  { business_id: B, connection_generation: GB, status: "connected", last_tested_at: null,
    last_synced_at: null, last_sync_status: "completed", last_error_code: null,
    credentials_ciphertext: "PRIVATE_CIPHERTEXT_B" },
];
const runs: Array<Record<string, any>> = [
  { id: "run-a", business_id: A, connection_generation: GA, started_at: "2026-11-03T09:00:00Z",
    finished_at: "2026-11-03T09:01:00Z", status: "partial",
    counts: { products: 20, ingredients: 2 }, error_code: null, raw_secret: "NEVER_SEND" },
  { id: "run-b", business_id: B, connection_generation: GB, started_at: "2026-11-03T08:00:00Z",
    finished_at: "2026-11-03T08:01:00Z", status: "completed",
    counts: { products: 12 }, error_code: "another_tenant" },
];
const progress = [
  { business_id: A, connection_generation: GA, resource_type: "products", next_page: 3, cycle_id: CYCLE_A },
  { business_id: A, connection_generation: GA, resource_type: "ingredients", next_page: 0, cycle_id: CYCLE_A },
  { business_id: A, connection_generation: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    resource_type: "sales", next_page: 99 },
  { business_id: B, connection_generation: GB, resource_type: "products", next_page: 0, cycle_id: CYCLE_B },
];
const records = [
  { business_id: A, connection_generation: GA, resource_type: "products", id: "1", last_seen_cycle_id: CYCLE_A, payload: { secret: "PRIVATE_PAYLOAD_A" } },
  { business_id: A, connection_generation: GA, resource_type: "products", id: "2", last_seen_cycle_id: CYCLE_B },
  { business_id: A, connection_generation: GA, resource_type: "ingredients", id: "3", last_seen_cycle_id: CYCLE_A },
  { business_id: A, connection_generation: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    resource_type: "products", id: "4" },
  { business_id: B, connection_generation: GB, resource_type: "products", id: "5", last_seen_cycle_id: CYCLE_B, payload: { secret: "PRIVATE_PAYLOAD_B" } },
];

function query(table: string) {
  const filters: Record<string, unknown> = {};
  let countOnly = false;
  let max = Infinity;
  const get = () => {
    if (table === "profiles") return [{ active: profileActive }];
    if (table === "business_members") return isMember && filters.business_id === tenant && filters.user_id === USER ? [{ id: "member" }] : [];
    const all = table === "fudo_connections" ? connections
      : table === "fudo_sync_runs" ? runs
        : table === "fudo_sync_progress" ? progress
          : table === "fudo_external_records" ? records : [];
    const matches = all.filter((row) =>
      Object.entries(filters).every(([key,value]) => (row as any)[key] === value));
    return matches.slice(0,max);
  };
  const q: any = {
    select(_fields: string, opts?: { count?: string; head?: boolean }) { countOnly = !!opts?.head; return this; },
    eq(key: string, value: unknown) { filters[key] = value; return this; },
    in(_key: string, _values: unknown[]) { return this; },
    order(_key: string, _value: unknown) { return this; },
    limit(value: number) { max = value; return this; },
    async maybeSingle() {
      const data = get()[0] ?? null;
      if (table === "fudo_connections") duringConnectionRead?.();
      return { data, error: null };
    },
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
      // PostgREST returns independent JSON snapshots; do not let a simulated
      // concurrent write mutate data already returned by a previous query.
      const data = get().map((row) => table === "fudo_sync_runs" ? { ...row } : row);
      if (table === "fudo_sync_progress") duringProgressRead?.();
      let count: unknown = countOnly ? data.length : null;
      if (countOnly && table === "fudo_external_records" && filters.resource_type === "products") {
        const cycleQuery = Object.prototype.hasOwnProperty.call(filters, "last_seen_cycle_id");
        const override = cycleQuery ? cycleProductsCountOverride : historicalProductsCountOverride;
        if (override !== undefined) count = override;
      }
      return Promise.resolve({ data: countOnly ? null : data, count, error: null }).then(resolve,reject);
    },
  };
  return q;
}

const loader = Module as any;
const originalLoad = loader._load;
loader._load = function(name: string, ...args: any[]) {
  if (name === "@/lib/data/auth") return {
    getCurrentUserContext: async () => ({ isAuthenticated: true, userId: USER, businessId: tenant, role }),
  };
  if (name === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => ({ from: query }) };
  if (name === "@/lib/env") return { isDatabaseMode: () => true };
  return originalLoad.call(this,name,...args);
};
const { getFudoConnectionView } = require("../lib/integrations/fudo/service") as typeof import("../lib/integrations/fudo/service");
loader._load = originalLoad;

test("Fudo pilot report returns only current tenant/current generation aggregates", async () => {
  tenant = A; role = "owner"; isMember = true;
  const report = await getFudoConnectionView();
  assert.ok(report);
  assert.equal(report.status, "connected");
  assert.equal(report.importedCounts.products, 2);
  assert.equal(report.importedCounts.ingredients, 1);
  assert.equal(report.importedCounts.sales, 0);
  assert.equal(report.seenThisCycleCounts.products, 1, "only records from this scan count");
  assert.equal(report.possiblyMissingCounts.products, null, "partial pages cannot claim removals");
  assert.equal(report.seenThisCycleCounts.ingredients, 1);
  assert.equal(report.possiblyMissingCounts.ingredients, 0, "completed current cycle has no missing IDs");
  assert.equal(report.seenThisCycleCounts.sales, null, "unstarted resource has no cycle");
  assert.equal(report.recentRuns.length, 1);
  assert.equal(report.recentRuns[0].status, "partial");
  assert.deepEqual(report.lastCounts, { products: 20, ingredients: 2 });
  assert.equal(report.nextPages.products, 3);
  assert.equal(report.nextPages.ingredients, 0);
  assert.equal(report.nextPages.sales, null, "old-generation cursor must never leak");
  assert.equal(report.nextPages.providers, null);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|NEVER_SEND|another_tenant|payload|credentials_ciphertext/i);
});

test("Fudo pilot report rejects non-admin and unrelated memberships", async () => {
  tenant = A; role = "employee"; isMember = true;
  assert.equal(await getFudoConnectionView(), null);
  role = "owner"; isMember = false;
  assert.equal(await getFudoConnectionView(), null);
  tenant = B; role = "admin"; isMember = true;
  const report = await getFudoConnectionView();
  assert.ok(report);
  assert.equal(report.importedCounts.products, 1);
  assert.equal(report.seenThisCycleCounts.products, 1);
  assert.equal(report.possiblyMissingCounts.products, 0);
  assert.equal(report.recentRuns.length, 1);
  assert.equal(report.recentRuns[0].errorCode, "another_tenant");
  assert.equal(report.nextPages.products, 0);
  assert.equal(report.nextPages.ingredients, null);
  assert.equal(report.nextPages.sales, null);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_CIPHERTEXT_A|PRIVATE_PAYLOAD_A/);
});


test("Fudo completed rescans flag possibly removed IDs without deleting staging or crossing tenants", async () => {
  tenant = A; role = "owner"; isMember = true;
  const prior = progress[0].next_page;
  try {
    // Once the product cursor is complete, the old product is a possible
    // provider removal; no row deletion or provider mutation occurs here.
    progress[0].next_page = 0;
    const report = await getFudoConnectionView();
    assert.ok(report);
    assert.equal(report.importedCounts.products, 2);
    assert.equal(report.seenThisCycleCounts.products, 1);
    assert.equal(report.possiblyMissingCounts.products, 1);
    assert.equal(report.possiblyMissingCounts.sales, null);
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_|NEVER_SEND|another_tenant/);
  } finally {
    progress[0].next_page = prior;
  }
});


test("Fudo reconciliation never claims absences while a run is active or failed", async () => {
  tenant = A; role = "owner"; isMember = true;
  const previousPage = progress[0].next_page;
  const previousStatus = runs[0].status;
  try {
    progress[0].next_page = 0;
    for (const status of ["running", "failed"]) {
      runs[0].status = status;
      const report = await getFudoConnectionView();
      assert.ok(report);
      assert.equal(report.importedCounts.products, 2, "historical records remain");
      assert.equal(report.seenThisCycleCounts.products, 1, "cycle records remain visible");
      assert.equal(report.possiblyMissingCounts.products, null, "no absence claims before a successful run");
      assert.equal(report.possiblyMissingCounts.ingredients, null, "failure must also suppress completed-cursor claims");
    }
    runs[0].status = "partial";
    const settled = await getFudoConnectionView();
    assert.ok(settled);
    assert.equal(settled.possiblyMissingCounts.products, 1, "a settled batch may report possible absences");
  } finally {
    progress[0].next_page = previousPage;
    runs[0].status = previousStatus;
  }
});

test("Fudo status rejects a stale connection generation rotated during aggregate reads", async () => {
  tenant = A; role = "owner"; isMember = true;
  const originalGeneration = connections[0].connection_generation;
  const rotatedGeneration = "77777777-7777-4777-8777-777777777777";
  try {
    duringProgressRead = () => {
      duringProgressRead = null;
      connections[0].connection_generation = rotatedGeneration;
    };
    const result = await getFudoConnectionView();
    assert.equal(result, null, "the report must not claim a rotated connection is current");
  } finally {
    duringProgressRead = null;
    connections[0].connection_generation = originalGeneration;
  }
});

test("Fudo status rejects a connection disconnected during aggregate reads", async () => {
  tenant = A; role = "owner"; isMember = true;
  const original = connections[0];
  try {
    duringProgressRead = () => {
      duringProgressRead = null;
      connections.splice(0, 1);
    };
    const result = await getFudoConnectionView();
    assert.equal(result, null, "the report must not expose results from a disconnected generation");
  } finally {
    duringProgressRead = null;
    if (!connections.some((row) => row.business_id === A)) connections.unshift(original);
  }
});


test("Fudo pilot report rejects a concurrent retest within the SAME credential generation", async () => {
  tenant = A; role = "owner"; isMember = true;
  const original = { status: connections[0].status, lastTestedAt: connections[0].last_tested_at };
  try {
    // A successful retest can update its timestamp while leaving credentials
    // and connection_generation unchanged. Do not return an obsolete revision.
    duringProgressRead = () => {
      duringProgressRead = null;
      Object.assign(connections[0], { last_tested_at: "2026-11-04T21:01:00Z" });
    };
    assert.equal(await getFudoConnectionView(), null,
      "report must be discarded after a same-generation retest");

    // An invalid retest can also mark the connection as error without rotating it.
    Object.assign(connections[0], { last_tested_at: original.lastTestedAt });
    duringProgressRead = () => {
      duringProgressRead = null;
      connections[0].status = "error";
    };
    assert.equal(await getFudoConnectionView(), null,
      "report must not keep a green connected state after an invalid retest");
  } finally {
    duringProgressRead = null;
    Object.assign(connections[0], { status: original.status, last_tested_at: original.lastTestedAt });
  }
});

test("Fudo pilot report rejects a concurrent sync status change without credential rotation", async () => {
  tenant = A; role = "owner"; isMember = true;
  const original = connections[0].last_sync_status;
  try {
    duringProgressRead = () => {
      duringProgressRead = null;
      connections[0].last_sync_status = "failed";
    };
    assert.equal(await getFudoConnectionView(), null,
      "report must not combine old successful cursors with newly failed sync state");
  } finally {
    duringProgressRead = null;
    connections[0].last_sync_status = original;
  }
});

test("Fudo report discards a completed run replaced by a new running sync during reads", async () => {
  tenant = A; role = "owner"; isMember = true;
  const newRun = {
    id: "run-new", business_id: A, connection_generation: GA,
    started_at: "2026-11-04T22:00:00Z", finished_at: null, status: "running",
    counts: {}, error_code: null,
  };
  try {
    // fudo_begin_sync inserts a run before updating fudo_connections. A view
    // must not combine the previous completed run with the newer cursors.
    duringProgressRead = () => {
      duringProgressRead = null;
      runs.unshift(newRun);
    };
    assert.equal(await getFudoConnectionView(), null,
      "new run identity invalidates the prior readiness snapshot");
  } finally {
    duringProgressRead = null;
    const index = runs.indexOf(newRun);
    if (index >= 0) runs.splice(index, 1);
  }
});

test("Fudo report discards a run which settles while progress is being read", async () => {
  tenant = A; role = "owner"; isMember = true;
  const before = { status: runs[0].status, finished_at: runs[0].finished_at };
  try {
    duringProgressRead = () => {
      duringProgressRead = null;
      runs[0].status = "failed";
      runs[0].finished_at = "2026-11-04T22:01:00Z";
    };
    assert.equal(await getFudoConnectionView(), null,
      "a changed run status must not be reported as an earlier settled run");
  } finally {
    duringProgressRead = null;
    Object.assign(runs[0], before);
  }
});

test("Fudo preflight revision stays tenant-scoped even for identical connection metadata", async () => {
  role = "owner"; isMember = true;
  const original = { ...connections[1] };
  try {
    // Simulate two tenants with the same generation, health and test time.
    // Browser state from A must still be distinguishable from B.
    connections[1].connection_generation = connections[0].connection_generation;
    connections[1].status = connections[0].status;
    connections[1].last_tested_at = connections[0].last_tested_at;
    tenant = A;
    const statusA = await getFudoConnectionView();
    tenant = B;
    const statusB = await getFudoConnectionView();
    assert.ok(statusA && statusB);
    assert.match(statusA.connectionRevision ?? "", /^[a-f0-9]{64}$/);
    assert.match(statusB.connectionRevision ?? "", /^[a-f0-9]{64}$/);
    assert.notEqual(statusA.connectionRevision, statusB.connectionRevision,
      "switching tenants must invalidate earlier permission probes");
    assert.doesNotMatch(String(statusA.connectionRevision), new RegExp(A));
    assert.doesNotMatch(String(statusB.connectionRevision), new RegExp(B));
  } finally {
    Object.assign(connections[1], original);
    tenant = A;
  }
});

test("Fudo report rejects aggregates if authorization changes during privileged reads", async () => {
  for (const change of ["membership_revoked", "role_downgraded", "profile_disabled", "tenant_switched"] as const) {
    tenant = A; role = "owner"; isMember = true; profileActive = true;
    try {
      duringProgressRead = () => {
        duringProgressRead = null;
        if (change === "membership_revoked") isMember = false;
        if (change === "role_downgraded") role = "employee";
        if (change === "profile_disabled") profileActive = false;
        if (change === "tenant_switched") tenant = B;
      };
      const result = await getFudoConnectionView();
      assert.equal(result, null, `must discard all aggregates after ${change}`);
    } finally {
      duringProgressRead = null;
      tenant = A; role = "owner"; isMember = true; profileActive = true;
    }
  }
});

test("Fudo disconnected view also rejects a revoked owner after the connection lookup", async () => {
  tenant = A; role = "owner"; isMember = true; profileActive = true;
  const original = connections.find((row) => row.business_id === A);
  assert.ok(original);
  try {
    // No connection for A: only the empty-status branch is exercised.
    connections.splice(connections.indexOf(original), 1);
    duringConnectionRead = () => {
      duringConnectionRead = null;
      isMember = false;
    };
    assert.equal(await getFudoConnectionView(), null,
      "a detached owner must not receive even the previous business' empty integration view");
  } finally {
    duringConnectionRead = null;
    if (!connections.includes(original)) connections.unshift(original);
    tenant = A; role = "owner"; isMember = true; profileActive = true;
  }
});


test("Fudo O1 reports unknown SQL count metrics as unverified, never zero or removed", async () => {
  tenant = A; role = "owner"; isMember = true;
  const originalPage = progress[0].next_page;
  try {
    // Cursor zero would otherwise allow an inferred removal total.
    progress[0].next_page = 0;
    for (const invalidCount of [null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      historicalProductsCountOverride = invalidCount;
      cycleProductsCountOverride = undefined;
      const report = await getFudoConnectionView();
      assert.ok(report);
      assert.equal(report.importedCounts.products, undefined, "unknown totals cannot become zero");
      assert.equal(report.seenThisCycleCounts.products, 1);
      assert.equal(report.possiblyMissingCounts.products, null, "unknown history cannot certify absences");
      assert.equal(report.importedCounts.ingredients, 1, "other resources keep their valid counts");
    }

    historicalProductsCountOverride = undefined;
    for (const invalidCount of [null, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      cycleProductsCountOverride = invalidCount;
      const report = await getFudoConnectionView();
      assert.ok(report);
      assert.equal(report.importedCounts.products, 2);
      assert.equal(report.seenThisCycleCounts.products, null, "unknown cycle count is not an empty cycle");
      assert.equal(report.possiblyMissingCounts.products, null, "cannot infer absences without a verified cycle");
    }

    historicalProductsCountOverride = 0;
    cycleProductsCountOverride = 0;
    const genuinelyEmpty = await getFudoConnectionView();
    assert.ok(genuinelyEmpty);
    assert.equal(genuinelyEmpty.importedCounts.products, 0, "a genuine exact SQL zero stays zero");
    assert.equal(genuinelyEmpty.seenThisCycleCounts.products, 0);
    assert.equal(genuinelyEmpty.possiblyMissingCounts.products, 0);
  } finally {
    historicalProductsCountOverride = undefined;
    cycleProductsCountOverride = undefined;
    progress[0].next_page = originalPage;
  }
});

test("Fudo O1 refuses fractional or unsafe per-run counts in the private report", async () => {
  tenant = A; role = "owner"; isMember = true;
  const previous = runs[0].counts;
  try {
    runs[0].counts = { products: 1.5, ingredients: Number.MAX_SAFE_INTEGER + 1, sales: 0 };
    const report = await getFudoConnectionView();
    assert.ok(report);
    assert.equal(report.lastCounts.products, undefined);
    assert.equal(report.lastCounts.ingredients, undefined);
    assert.equal(report.lastCounts.sales, 0);
  } finally {
    runs[0].counts = previous;
  }
});
