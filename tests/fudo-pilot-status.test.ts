import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const GA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
let tenant = A;
let role = "owner";
let isMember = true;

const connections = [
  { business_id: A, connection_generation: GA, status: "connected", last_tested_at: null,
    last_synced_at: null, last_sync_status: "partial", last_error_code: null,
    credentials_ciphertext: "PRIVATE_CIPHERTEXT_A" },
  { business_id: B, connection_generation: GB, status: "connected", last_tested_at: null,
    last_synced_at: null, last_sync_status: "completed", last_error_code: null,
    credentials_ciphertext: "PRIVATE_CIPHERTEXT_B" },
];
const runs = [
  { business_id: A, connection_generation: GA, started_at: "2026-11-03T09:00:00Z",
    finished_at: "2026-11-03T09:01:00Z", status: "partial",
    counts: { products: 20, ingredients: 2 }, error_code: null, raw_secret: "NEVER_SEND" },
  { business_id: B, connection_generation: GB, started_at: "2026-11-03T08:00:00Z",
    finished_at: "2026-11-03T08:01:00Z", status: "completed",
    counts: { products: 12 }, error_code: "another_tenant" },
];
const progress = [
  { business_id: A, connection_generation: GA, resource_type: "products", next_page: 3 },
  { business_id: A, connection_generation: GA, resource_type: "ingredients", next_page: 0 },
  { business_id: A, connection_generation: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    resource_type: "sales", next_page: 99 },
  { business_id: B, connection_generation: GB, resource_type: "products", next_page: 0 },
];
const records = [
  { business_id: A, connection_generation: GA, resource_type: "products", id: "1", payload: { secret: "PRIVATE_PAYLOAD_A" } },
  { business_id: A, connection_generation: GA, resource_type: "products", id: "2" },
  { business_id: A, connection_generation: GA, resource_type: "ingredients", id: "3" },
  { business_id: A, connection_generation: "ffffffff-ffff-4fff-8fff-ffffffffffff",
    resource_type: "products", id: "4" },
  { business_id: B, connection_generation: GB, resource_type: "products", id: "5", payload: { secret: "PRIVATE_PAYLOAD_B" } },
];

function query(table: string) {
  const filters: Record<string, unknown> = {};
  let countOnly = false;
  let max = Infinity;
  const get = () => {
    if (table === "profiles") return [{ active: true }];
    if (table === "business_members") return isMember && filters.business_id === tenant && filters.user_id === USER ? [{ id: "member" }] : [];
    const all = table === "fudo_connections" ? connections
      : table === "fudo_sync_runs" ? runs
        : table === "fudo_sync_progress" ? progress
          : table === "fudo_external_records" ? records : [];
    const matches = all.filter((row) => Object.entries(filters).every(([key,value]) => (row as any)[key] === value));
    return matches.slice(0,max);
  };
  const q: any = {
    select(_fields: string, opts?: { count?: string; head?: boolean }) { countOnly = !!opts?.head; return this; },
    eq(key: string, value: unknown) { filters[key] = value; return this; },
    in(_key: string, _values: unknown[]) { return this; },
    order(_key: string, _value: unknown) { return this; },
    limit(value: number) { max = value; return this; },
    async maybeSingle() { return { data: get()[0] ?? null, error: null }; },
    then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
      const data = get();
      return Promise.resolve({ data: countOnly ? null : data, count: countOnly ? data.length : null, error: null }).then(resolve,reject);
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
  assert.equal(report.recentRuns.length, 1);
  assert.equal(report.recentRuns[0].errorCode, "another_tenant");
  assert.equal(report.nextPages.products, 0);
  assert.equal(report.nextPages.ingredients, null);
  assert.equal(report.nextPages.sales, null);
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE_CIPHERTEXT_A|PRIVATE_PAYLOAD_A/);
});
