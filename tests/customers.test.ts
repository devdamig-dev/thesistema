import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateCustomerInput, type CustomerInput } from "../lib/customers/validation";
import { saveCustomer } from "../lib/customers/service";
import { hasPermission, type Role } from "../lib/permissions";

const input: CustomerInput = { id: null, expectedUpdatedAt: null, name: " Ana Pérez ", phone: " +54 11 1234 ", email: " ana@example.invalid ", channel: " Local ", notes: " Preferencia de contacto\nPor la tarde ", active: true };
const id = "00000000-0000-4000-8000-000000000001";
test("customer validator trims ordinary fields and keeps multiline notes", () => {
  const result = validateCustomerInput(input);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value.name, "Ana Pérez");
    assert.equal(result.value.notes, "Preferencia de contacto\nPor la tarde");
    assert.equal(result.value.email, "ana@example.invalid");
  }
  assert.equal(validateCustomerInput({ ...input, phone: "", email: "", channel: null, notes: null }).ok, true);
  assert.equal(validateCustomerInput({ ...input, id, expectedUpdatedAt: "2026-10-09T00:30:00.123456+00:00", active: false }).ok, true);
});
test("customer runtime schema rejects coercion, spoofed security/aggregate fields and stale identity", () => {
  for (const value of [null, undefined, [], 12, "customer", {}, { ...input, name: " " }, { ...input, name: [] },
    { ...input, name: "a".repeat(201) }, { ...input, name: "Ana\nPérez" }, { ...input, phone: false }, { ...input, phone: "Call me" },
    { ...input, email: "bad-email" }, { ...input, email: 12 }, { ...input, channel: {} }, { ...input, channel: "x".repeat(81) },
    { ...input, notes: "a".repeat(2001) }, { ...input, notes: "a\0b" }, { ...input, notes: [] }, { ...input, active: "true" },
    { ...input, active: false }, { ...input, id: "foreign" }, { ...input, id, expectedUpdatedAt: null },
    { ...input, id, expectedUpdatedAt: "yesterday" }, { ...input, id, expectedUpdatedAt: "infinity" }, { ...input, business_id: id },
    { ...input, actor_id: id }, { ...input, source: "whatsapp" }, { ...input, visits: 99 }, { ...input, total_spend: 500 },
    { ...input, branch_id: id }, { ...input, expectedUpdatedAt: "2026-10-09T00:00:00Z" }]) {
    assert.equal(validateCustomerInput(value).ok, false, JSON.stringify(value));
  }
});
test("role policy matches existing customers.manage matrix exactly", () => {
  for (const role of ["owner", "admin", "manager", "marketing"] as Role[]) assert.equal(hasPermission(role, "customers.manage"), true);
  for (const role of ["accountant", "employee", "kitchen", "cashier", "waiter", "delivery", "viewer"] as Role[]) assert.equal(hasPermission(role, "customers.manage"), false);
});
test("shared domain validates before RPC and sends only server tenant plus validated input", async () => {
  let calls = 0;
  const db = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls++; assert.equal(name, "save_customer_atomic"); assert.equal(args.p_business_id, "server-tenant");
    assert.equal((args.p_input as CustomerInput).name, "Ana Pérez");
    assert.equal(Object.keys(args).length, 2);
    return { data: { ok: true, id }, error: null };
  } };
  assert.equal((await saveCustomer(db, "server-tenant", { ...input, actor_id: id })).ok, false);
  assert.equal(calls, 0);
  assert.deepEqual(await saveCustomer(db, "server-tenant", input), { ok: true, persisted: true, id });
  assert.equal(calls, 1);
});
test("domain reports conflicts, missing migration, rejected and uncertain results without fake success", async () => {
  for (const response of [
    { data: { ok: false, error: "customer_conflict" }, error: null },
    { data: { ok: false, error: "permission_denied" }, error: null },
    { data: { ok: false, error: "customer_not_found" }, error: null },
    { data: null, error: { code: "PGRST202" } },
    { data: { ok: true }, error: null },
  ]) {
    const result = await saveCustomer({ rpc: async () => response }, "tenant", input);
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.error.length > 10);
  }
  const failed = await saveCustomer({ rpc: async () => { throw new Error("network"); } }, "tenant", input);
  assert.equal(failed.ok, false);
  if (!failed.ok) {
    assert.equal(failed.persisted, "unknown");
    assert.match(failed.error, /comprobar si se guardó antes de reintentar/);
  }
});
test("database route exposes manual actions and never reads fabricated aggregates", () => {
  const layout = readFileSync("app/clientes/layout.tsx", "utf8");
  const page = readFileSync("app/clientes/page.tsx", "utf8");
  const client = readFileSync("app/clientes/customers-client.tsx", "utf8");
  const read = readFileSync("app/actions/customers-page.ts", "utf8");
  assert.match(layout, /return children/);
  assert.match(page, /if \(databaseMode\)[\s\S]*return <CustomersClient databaseMode initial=/);
  assert.doesNotMatch(read, /demo|mock-data|total_spend|last_visit_at|segment|visits|ticket/);
  assert.match(read, /\.eq\("business_id", ctx.businessId\)/);
  assert.match(client, /saveCustomerAction\(validation.value\)/);
  assert.match(client, /busyRef.current/);
  assert.match(client, /Nuevo cliente/); assert.match(client, /Archivar/); assert.match(client, /Restaurar/);
  assert.doesNotMatch(client, /comingSoon|\.delete\(/);
});

test("transport errors returned as RPC errors preserve uncertain persistence", async () => {
  const result = await saveCustomer({ rpc: async () => ({ data: null, error: { code: "" } }) }, "tenant", input);
  assert.equal(result.ok,false); if (!result.ok) assert.equal(result.persisted,"unknown");
  const client = readFileSync("app/clientes/customers-client.tsx", "utf8");
  assert.match(client, /saved.persisted === "unknown"/);
  assert.match(client, /if \(busyRef.current \|\| verificationRef.current\) return/);
  assert.match(client, /type="submit" variant="primary" disabled=\{busy \|\| verificationRequired\}/);
});
