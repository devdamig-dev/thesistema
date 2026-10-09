import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { createCatalogProduct, validateProductFields } from "../lib/catalog/products";
import { hasPermission, permissionsFor } from "../lib/permissions";
import { WHATSAPP_TOOLS, toolsForActor } from "../lib/whatsapp-agent/registry";
import { interpretHeuristically, getMissingArguments } from "../lib/whatsapp-agent/interpreter";
import { validateToolCall } from "../lib/whatsapp-agent/validation";
import { runAgent } from "../lib/whatsapp-agent/core";
import type { AgentActor, AgentDependencies, PendingOperation, ToolCall } from "../lib/whatsapp-agent/types";

const businessId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";
const input = { name: "  Hamburguesa  ", category: "  Comida  ", price: 14500.25, cost: 4321.50, active: false };
const normalized = { ...input, name: "Hamburguesa", category: "Comida" };
const actor: AgentActor = { businessId, userId: actorId, memberId: "member", role: "owner", branchIds: null, name: "Owner", phone: "5491111111111", enabledModules: ["products"] };
const state = { role: "owner", authenticated: true, database: true, failRefresh: false, response: undefined as any, calls: [] as any[] };
const db = {
  from() { throw new Error("Product creation must use the shared RPC, never direct inserts"); },
  async rpc(name: string, args: any) {
    state.calls.push({ name, args });
    return state.response ?? { data: { ok: true, id: productId, source: args.p_actor_id ? "whatsapp" : "manual", actor_id: actorId }, error: null };
  },
};
const loader = Module as any; const original = loader._load;
loader._load = function(name: string, ...args: any[]) {
  const mocks: Record<string, unknown> = {
    "next/cache": { revalidatePath() { if (state.failRefresh) throw new Error("cache_unavailable"); } },
    "@/lib/data/auth": { getCurrentUserContext: async () => ({ role: state.role, isAuthenticated: state.authenticated, businessId, userId: actorId }) },
    "@/lib/env": { isDatabaseMode: () => state.database },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => db },
    "@/lib/permissions": { hasPermission, permissionsFor },
  };
  if (name === "@/lib/permissions/server-action") return original.call(this, require.resolve("../lib/permissions/server-action"), ...args);
  if (name === "@/lib/catalog/pagination") return original.call(this, require.resolve("../lib/catalog/pagination"), ...args);
  return name in mocks ? mocks[name] : original.call(this, name, ...args);
};
const { createProductAction } = require("../app/actions/products-page");
const { executeTool } = require("../lib/whatsapp-agent/supabase-adapter");
loader._load = original;
function reset() { state.role = "owner"; state.authenticated = true; state.database = true; state.failRefresh = false; state.response = undefined; state.calls = []; }

function harness(call?: ToolCall) {
  let pending: PendingOperation | null = null;
  const executions: ToolCall[] = [];
  const deps: AgentDependencies = {
    resolveActor: async () => actor, claimMessage: async () => true,
    getPending: async () => pending, savePending: async operation => pending = { ...operation, id: "pending" },
    consumePending: async id => { if (!pending || pending.id !== id) return false; pending = null; return true; },
    interpret: call ? async () => call : interpretHeuristically,
    execute: async (_actor, command) => { executions.push(command); return { id: productId }; },
    audit: async () => {}, now: () => new Date("2026-10-09T00:00:00Z"),
  };
  const run = (text: string) => runAgent({ messageId: text, senderPhone: actor.phone, recipientPhone: "5491111111112", text }, deps);
  return { deps, run, executions, pending: () => pending };
}

test("manual and agent product creation use identical validated payload and shared RPC", async () => {
  reset(); assert.equal((await createProductAction(input)).ok, true);
  assert.deepEqual(state.calls, [{ name: "create_product_atomic", args: { p_business_id: businessId, p_input: normalized, p_actor_id: null } }]);
  state.calls = [];
  assert.deepEqual(await executeTool(db, actor, { name: "products.create", arguments: input }), { id: productId, source: "whatsapp" });
  assert.deepEqual(state.calls, [{ name: "create_product_atomic", args: { p_business_id: businessId, p_input: normalized, p_actor_id: actorId } }]);
});

test("both product transports reject missing/defaulted values and forged provenance", async () => {
  const partial = { name: "Product", price: 50 };
  const bad = [partial, { ...input, category: "" }, { ...input, cost: undefined }, { ...input, active: undefined }, { ...input, price: -1 }, { ...input, cost: NaN }, { ...input, price: "10" }, { ...input, active: "false" }, { ...input, name: "n".repeat(201) }, { ...input, category: "c".repeat(101) }, { ...input, price: 1e10 },
    ...["actorId", "created_by", "businessId", "business_id", "source", "role", "branchId", "recipe", "ingredients"].map(key => ({ ...input, [key]: "forged" }))];
  for (const value of bad) {
    reset(); assert.equal((await createProductAction(value)).ok, false);
    await assert.rejects(() => executeTool(db, actor, { name: "products.create", arguments: value }), /product_write_rejected|business_id_not_allowed/);
    assert.deepEqual(state.calls, []);
  }
});

test("explicit zero price/cost and inactive state survive validation without conversion", () => {
  const value = { ...input, price: 0, cost: 0, active: false };
  assert.deepEqual(validateProductFields(value).input, { ...normalized, price: 0, cost: 0 });
  assert.deepEqual(validateToolCall({ name: "products.create", arguments: value }).issues, []);
  assert.deepEqual(getMissingArguments({ name: "products.create", arguments: value }, WHATSAPP_TOOLS), []);
});

test("product roles and modules remain restricted and manual demo/auth gates persist", async () => {
  for (const role of ["manager", "viewer", "kitchen", "employee", "accountant", "marketing"] as const) {
    reset(); state.role = role; assert.equal((await createProductAction(input)).ok, false);
    await assert.rejects(() => executeTool(db, { ...actor, role }, { name: "products.create", arguments: input }), /product_write_forbidden/);
    assert.equal(toolsForActor({ ...actor, role }).some(tool => tool.name === "products.create"), false);
    assert.equal(state.calls.length, 0);
  }
  reset(); await assert.rejects(() => executeTool(db, { ...actor, enabledModules: [] }, { name: "products.create", arguments: input }), /product_write_forbidden/);
  for (const field of ["authenticated", "database"] as const) { reset(); state[field] = false; assert.equal((await createProductAction(input)).ok, false); assert.equal(state.calls.length, 0); }
});

test("product creation fails closed on mismatched or uncertain receipts and never retries", async () => {
  for (const response of [{ data: null, error: null }, { data: { ok: true, id: productId, source: "manual", actor_id: actorId }, error: null }, { data: { ok: true, id: productId, source: "whatsapp", actor_id: productId }, error: null }, { data: null, error: { message: "timeout" } }]) {
    reset(); state.response = response;
    await assert.rejects(() => executeTool(db, actor, { name: "products.create", arguments: input }), /product_result_unconfirmed/);
    assert.equal(state.calls.length, 1);
  }
  reset(); state.response = { data: null, error: { code: "42501", message: "forbidden" } };
  const rejected = await createCatalogProduct(db, { businessId, source: "manual" }, input);
  assert.equal(rejected.ok, false); assert.equal(rejected.persisted, false);
  const unknown = await createCatalogProduct({ rpc() { throw new Error("network"); } }, { businessId, source: "manual" }, input);
  assert.equal(unknown.persisted, "unknown");
});

test("WhatsApp asks for category, explicit cost and state before creating a product", async () => {
  const h = harness();
  const start = await h.run("Creá Hamburguesa a $14.500."); assert.equal(start.status, "needs_input"); assert.match(start.text, /categoría/);
  const category = await h.run("Comida"); assert.equal(category.status, "needs_input"); assert.match(category.text, /costo/);
  assert.equal((await h.run("No sé")).status, "needs_input");
  assert.equal(h.executions.length, 0);
  const cost = await h.run("$4.321,50"); assert.equal(cost.status, "needs_input"); assert.match(cost.text, /activo o inactivo/);
  assert.equal((await h.run("Sí")).status, "needs_input");
  const done = await h.run("inactivo"); assert.equal(done.status, "completed");
  assert.deepEqual(h.executions, [{ name: "products.create", arguments: { name: "Hamburguesa", price: 14500, category: "Comida", cost: 4321.50, active: false } }]);
});

test("unsupported recipe requests are rejected whole, never discarded or converted into products", async () => {
  for (const value of [{ ...input, recipe: [{ ingredientId: productId, quantity: 0.125, unit: "g" }] }, { ...input, ingredients: [] }]) {
    const h = harness({ name: "products.create", arguments: value });
    const result = await h.run("Create"); assert.equal(result.status, "rejected"); assert.match(result.text, /composición.*Productos/); assert.equal(h.executions.length, 0);
  }
  const h = harness(); const result = await h.run("Creá Hamburguesa a $14.500 con 180 g de carne y 1 pan.");
  assert.equal(result.status, "rejected"); assert.equal(h.executions.length, 0);
});

test("racing final product clarifications execute once and uncertain writes are described honestly", async () => {
  const h = harness();
  await h.run("Creá Hamburguesa a $14.500."); await h.run("Comida"); await h.run("$4321,50");
  const replies = await Promise.all([h.run("inactivo"), h.run("false")]);
  assert.equal(h.executions.length, 1); assert.deepEqual(replies.map(r => r.status).sort(), ["completed", "rejected"]);
  const failed = harness({ name: "products.create", arguments: input });
  failed.deps.execute = async () => { throw new Error("product_result_unconfirmed"); };
  const reply = await failed.run("Create"); assert.equal(reply.status, "failed"); assert.match(reply.text, /Revisá Productos.*duplicados/); assert.doesNotMatch(reply.text, /No se realizó ningún cambio/);
});


test("failed cache refresh does not turn a committed product into a failed create", async () => {
  reset(); state.failRefresh = true;
  const result = await createProductAction(input);
  assert.equal(result.ok, true); assert.equal(result.persisted, true); assert.equal(state.calls.length, 1);
});


test("product amounts never come from digits in a name or ambiguous cost ranges", async () => {
  const call = await interpretHeuristically("Creá Hamburguesa 2 pisos a $14.500.", [...WHATSAPP_TOOLS]);
  assert.equal(call?.arguments.name, "Hamburguesa 2 pisos"); assert.equal(call?.arguments.price, 14500);
  const pending: PendingOperation = { id: "pending", actor, kind: "clarification", toolCall: { name: "products.create", arguments: { name: "Hamburguesa", price: 14500, category: "Comida" } }, expiresAt: "2026-10-09T00:00:00Z" };
  for (const text of ["entre 100 y 200", "100 kg de carne", "unos 100", "100 más 200"]) {
    assert.equal((await interpretHeuristically(text, [...WHATSAPP_TOOLS], pending))?.arguments.cost, undefined);
  }
});
