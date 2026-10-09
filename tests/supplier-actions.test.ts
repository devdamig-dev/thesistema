import assert from "node:assert/strict";
import test from "node:test";
import Module from "node:module";
import { hasPermission } from "../lib/permissions";

const businessId = "00000000-0000-4000-8000-000000000011";
const supplierId = "00000000-0000-4000-8000-000000000031";
const version = "2026-10-09T01:02:03.123456+00:00";
let mode = true;
let context: any;
let calls: { name: string; args: any }[] = [];
let queryCalls: { table: string; filters: Record<string, unknown>; selection: string; range?: number[] }[] = [];
let rpcResult: any;
let throwRpc = false;
let revalidateThrows = false;
const row = { id: supplierId, name: "Supplier", tax_id: null, phone: null, email: null, category: null, payment_terms: null, notes: null, active: true, updated_at: version };
const fromResults: Record<string, any> = {};
const database = () => ({
  async rpc(name: string, args: any) { calls.push({ name, args }); if (throwRpc) throw new Error("response lost"); return rpcResult; },
  from(table: string) {
    const recorded = { table, filters: {} as Record<string, unknown>, selection: "", range: undefined as number[] | undefined };
    queryCalls.push(recorded);
    const query: any = {
      select(selection: string) { recorded.selection = selection; return query; },
      eq(key: string, value: unknown) { recorded.filters[key] = value; return query; },
      in(key: string, value: unknown) { recorded.filters[key] = value; return query; },
      ilike(key: string, value: unknown) { recorded.filters[`ilike:${key}`] = value; return query; },
      order() { return query; }, limit() { return query; },
      range(start: number, end: number) { recorded.range = [start, end]; return query; },
      maybeSingle() { return Promise.resolve(fromResults[table] ?? { data: null, error: null }); },
      then(resolve: (value: unknown) => void) { resolve(fromResults[table] ?? { data: [], count: 0, error: null }); },
    };
    return query;
  },
});
function reset() {
  context = { isAuthenticated: true, userId: "actor-a", businessId, role: "manager", assignedBranchIds: [] };
  mode = true; calls = []; queryCalls = []; throwRpc = false; revalidateThrows = false;
  rpcResult = { data: row, error: null };
  for (const key of Object.keys(fromResults)) delete fromResults[key];
}
const loader = Module as any;
const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, any> = {
    "@/lib/supabase/server": { createSupabaseServerClient: database },
    "@/lib/data/auth": { getCurrentUserContext: async () => context },
    "@/lib/env": { isDatabaseMode: () => mode },
    "@/lib/permissions": { hasPermission },
    "@/lib/permissions/server-action": {
      withPermission: (permission: any, handler: Function) => (input: unknown) => hasPermission(context.role, permission) ? handler(context, input) : { ok: false, persisted: false, error: "forbidden", message: "No autorizado" },
    },
    "next/cache": { revalidatePath: () => { if (revalidateThrows) throw new Error("cache failure"); } },
  };
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const actions = require("../app/actions/suppliers-page");
loader._load = original;

test("supplier creation sends normalized fields and server-derived tenant, never forged actor or active", async () => {
  reset();
  const result = await actions.createSupplierManualAction({ id: supplierId, name: " Supplier ", businessId: "forged", actorId: "forged", active: false, email: " sales@example.invalid ", paymentTerms: " 15 days " });
  assert.equal(result.ok, true);
  assert.equal(calls[0].name, "create_supplier_manual");
  assert.equal(calls[0].args.p_business_id, businessId);
  assert.equal(calls[0].args.p_name, "Supplier");
  assert.equal(calls[0].args.p_payment_terms, "15 days");
  assert.equal(calls[0].args.p_actor_id, undefined);
  assert.equal(calls[0].args.active, undefined);
  assert.equal(calls[0].args.p_id, supplierId);
});
test("only existing purchase writer roles may mutate suppliers", async () => {
  for (const role of ["viewer", "accountant", "kitchen", "marketing", "employee"]) {
    reset(); context.role = role;
    assert.equal((await actions.createSupplierManualAction({ id: supplierId, name: "X" })).ok, false);
    assert.equal((await actions.updateSupplierManualAction({ id: supplierId, expectedUpdatedAt: version, name: "X" })).ok, false);
    assert.equal((await actions.setSupplierActiveAction({ id: supplierId, expectedUpdatedAt: version, active: false })).ok, false);
    assert.equal(calls.length, 0);
  }
  for (const role of ["owner", "admin", "manager"]) {
    reset(); context.role = role;
    assert.equal((await actions.createSupplierManualAction({ id: supplierId, name: "X" })).ok, true);
  }
});
test("demo, missing session, actor and business fail closed", async () => {
  for (const change of [{ isAuthenticated: false }, { businessId: null }, { userId: null }]) {
    reset(); Object.assign(context, change);
    assert.equal((await actions.createSupplierManualAction({ id: supplierId, name: "X" })).ok, false);
    assert.equal(calls.length, 0);
  }
  reset(); mode = false;
  assert.equal((await actions.createSupplierManualAction({ id: supplierId, name: "X" })).ok, false);
  assert.equal(calls.length, 0);
});
test("invalid fields and CAS tokens are rejected before a database write", async () => {
  for (const input of [null, { id: supplierId, name: " " }, { id: "bad", name: "X" }, { id: supplierId, name: "X", phone: "invalid" }]) {
    reset(); assert.equal((await actions.createSupplierManualAction(input)).ok, false); assert.equal(calls.length, 0);
  }
  reset(); assert.equal((await actions.updateSupplierManualAction({ id: supplierId, expectedUpdatedAt: "yesterday", name: "X" })).ok, false);
  assert.equal((await actions.setSupplierActiveAction({ id: supplierId, expectedUpdatedAt: version, active: "false" })).ok, false);
  assert.equal(calls.length, 0);
});
test("edits and state transitions preserve microsecond CAS and tenant", async () => {
  reset();
  await actions.updateSupplierManualAction({ id: supplierId, expectedUpdatedAt: version, name: "Edited" });
  await actions.setSupplierActiveAction({ id: supplierId, expectedUpdatedAt: version, active: false });
  assert.equal(calls[0].name, "update_supplier_manual");
  assert.equal(calls[0].args.p_expected_updated_at, version);
  assert.equal(calls[1].args.p_active, false);
  assert.equal(calls[1].args.p_business_id, businessId);
});
test("transport failures or malformed success remain uncertain without retry", async () => {
  reset(); throwRpc = true;
  const lost = await actions.createSupplierManualAction({ id: supplierId, name: "X" });
  assert.equal(lost.persisted, null); assert.equal(lost.status, "uncertain"); assert.equal(calls.length, 1);
  reset(); rpcResult = { data: null, error: null };
  assert.equal((await actions.createSupplierManualAction({ id: supplierId, name: "X" })).persisted, null);
  assert.equal(calls.length, 1);
});
test("database CAS conflict is explicit and invalidation failure cannot hide committed success", async () => {
  reset(); rpcResult = { data: null, error: { code: "40001", message: "supplier_stale_version" } };
  assert.equal((await actions.updateSupplierManualAction({ id: supplierId, expectedUpdatedAt: version, name: "X" })).status, "conflict");
  reset(); revalidateThrows = true;
  assert.equal((await actions.createSupplierManualAction({ id: supplierId, name: "X" })).persisted, true);
});
test("list is tenant-scoped, paginated, literal-searchable and archives remain queryable", async () => {
  reset(); fromResults.suppliers = { data: [row], count: 60, error: null };
  const result = await actions.getSuppliersPageDataAction({ query: "100%_", status: "archived", page: 1 });
  assert.equal(result.ok, true); assert.equal(result.data.canManage, true);
  assert.equal(result.data.draftScope, `actor-a:${businessId}`);
  assert.deepEqual(queryCalls[0].range, [30, 59]);
  assert.equal(queryCalls[0].filters.business_id, businessId);
  assert.equal(queryCalls[0].filters.active, false);
  assert.equal(queryCalls[0].filters["ilike:name"], "%100\\%\\_%");
  reset(); await actions.getSuppliersPageDataAction({ status: "all" });
  assert.equal(queryCalls[0].filters.active, undefined);
});
test("read-only users can inspect suppliers but cannot see management controls", async () => {
  reset(); context.role = "accountant";
  const result = await actions.getSuppliersPageDataAction();
  assert.equal(result.ok, true); assert.equal(result.data.canManage, false);
});
test("reconciliation retrieves exact request ID within active tenant, never assumes absent after read failure", async () => {
  reset(); fromResults.suppliers = { data: row, error: null };
  assert.equal((await actions.getSupplierManualAction(supplierId)).supplier.id, supplierId);
  assert.equal(queryCalls[0].filters.business_id, businessId); assert.equal(queryCalls[0].filters.id, supplierId);
  fromResults.suppliers = { data: null, error: { message: "unavailable" } };
  assert.equal((await actions.getSupplierManualAction(supplierId)).ok, false);
});
test("supplier history uses only real purchases and their RLS-visible item IDs", async () => {
  reset(); fromResults.purchases = { data: [{ id: "purchase-1", purchased_at: "2026-10-08", total: "100", branches: { name: "Main" } }], error: null };
  fromResults.purchase_items = { data: [{ purchase_id: "purchase-1", qty: "2", unit: "kg", description: "Harina", ingredients: { name: "Harina real" } }], error: null };
  const result = await actions.getSupplierHistoryAction(supplierId);
  assert.equal(result.ok, true); assert.equal(result.purchases[0].items[0].ingredient, "Harina real");
  assert.equal(queryCalls[0].filters.business_id, businessId); assert.equal(queryCalls[0].filters.supplier_id, supplierId);
  assert.deepEqual(queryCalls[1].filters.purchase_id, ["purchase-1"]);
});
