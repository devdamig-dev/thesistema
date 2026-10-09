import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import * as validation from "../lib/customers/validation";
import * as service from "../lib/customers/service";
import * as permissions from "../lib/permissions";

const valid = { id: null, expectedUpdatedAt: null, name: "Test", phone: null, email: null, channel: null, notes: null, active: true };
let database = true; let calls = 0; let reads = 0; let refreshes = 0;
let context = { isAuthenticated: true, userId: "authenticated-user", businessId: "server-tenant", role: "owner", enabledModules: ["customers"] };
let customerRows: Array<Record<string, unknown>> = [];
let response: { data: unknown; error: { code?: string } | null } = { data: { ok: true, id: "new-id" }, error: null };
const loader = Module as any; const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, unknown> = {
    "next/cache": { revalidatePath: (path: string) => { assert.equal(path, "/clientes"); refreshes++; } },
    "@/lib/env": { isDatabaseMode: () => database },
    "@/lib/data/auth": { getCurrentUserContext: async () => context },
    "@/lib/permissions": permissions,
    "@/lib/customers/validation": validation,
    "@/lib/customers/service": service,
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({
      rpc: async (name: string, args: Record<string, unknown>) => { calls++; assert.equal(name, "save_customer_atomic"); assert.equal(args.p_business_id, "server-tenant"); assert.deepEqual(Object.keys(args), ["p_business_id", "p_input"]); return response; },
      from: (table: string) => {
        reads++; assert.equal(table, "customers");
        const q = { select: (fields: string) => { assert.equal(fields, "id,name,phone,email,channel,notes,active,updated_at"); return q; },
          eq: (key: string, value: string) => { assert.equal(key, "business_id"); assert.equal(value, "server-tenant"); return q; },
          order: () => q, range: async (start: number, end: number) => ({ data: customerRows.slice(start, end + 1).slice(0, 1000), count: customerRows.length, error: null }) };
        return q;
      },
    }) },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { saveCustomerAction } = require("../app/actions/customers");
const { getCustomersPageDataAction } = require("../app/actions/customers-page");
loader._load = original;

test("customer actions fail closed for malformed/demo/unauthenticated/missing-tenant/module/role", async () => {
  const owner = { ...context };
  assert.equal((await saveCustomerAction({ ...valid, business_id: "attacker" })).ok, false);
  database = false; assert.equal((await saveCustomerAction(valid)).ok, false); assert.equal((await getCustomersPageDataAction()).ok, false); database = true;
  for (const patch of [{ isAuthenticated: false }, { userId: null }, { businessId: null }, { role: "viewer" }, { role: "employee" }, { enabledModules: [] }]) {
    context = { ...owner, ...patch } as typeof context;
    assert.equal((await saveCustomerAction(valid)).ok, false);
  }
  assert.equal(calls, 0); assert.equal(reads, 0); assert.equal(refreshes, 0);
  context = owner;
  assert.equal((await saveCustomerAction(valid)).ok, true);
  assert.equal(calls, 1); assert.equal(refreshes, 1);
  response = { data: { ok: false, error: "customer_conflict" }, error: null };
  assert.equal((await saveCustomerAction(valid)).ok, false); assert.equal(refreshes, 1);
  context = { ...owner, role: "viewer" };
  assert.deepEqual(await getCustomersPageDataAction(), { ok: true, data: { customers: [], canManage: false, truncated: false } });
  assert.equal(reads, 1);
  context = { ...owner, role: "accountant" };
  assert.equal((await getCustomersPageDataAction()).ok, false); assert.equal(reads, 1);
  context = owner;
  customerRows = Array.from({ length: 1500 }, (_, index) => ({ id: String(index), name: `Customer ${index}`, phone: null, email: null, channel: null, notes: null, active: true, updated_at: "2026-10-09T00:00:00Z" }));
  const paged = await getCustomersPageDataAction();
  assert.equal(paged.ok, true); assert.equal(paged.data.customers.length, 1500); assert.equal(paged.data.truncated, false);
  customerRows = Array.from({ length: 2300 }, (_, index) => ({ id: String(index), name: `Customer ${index}`, active: true }));
  const capped = await getCustomersPageDataAction();
  assert.equal(capped.ok, true); assert.equal(capped.data.customers.length, 2000); assert.equal(capped.data.truncated, true);
});
