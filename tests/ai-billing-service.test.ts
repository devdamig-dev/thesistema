import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import { createHmac } from "node:crypto";
import * as core from "../lib/billing/mercadopago";

const business = "11111111-1111-4111-8111-111111111111", user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orderId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", nonce = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const secret = "fixture-secret-with-32-characters-not-real";
const savedEnv = { ...process.env }, savedFetch = globalThis.fetch;
const order = { id: orderId, business_id: business, product_code: "starter", title: "Starter", amount_minor: 10000, currency: "ARS", collector_id: "12345", expires_at: "2099-01-01T00:00:00Z", status: "ready", preference_id: "fixture-pref", checkout_url: "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=fixture-pref" };
let role = "owner", authenticated = true, active = true, member = true, mode = true, created = true, orderVisible = true;
let attachError = false, recordError = false;
let calls: Array<{ name: string; args: Record<string, unknown> }> = [];
let fetchCalls: string[] = [];
let transport: typeof fetch;
const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, in() { return query; },
      async maybeSingle() {
        if (table === "profiles") return { error: null, data: { active } };
        if (table === "business_members") return { error: null, data: member && filters.business_id === business && filters.user_id === user ? { id: "member" } : null };
        if (table === "ai_billing_orders") return { error: null, data: orderVisible && filters.business_id === business && filters.id === orderId ? order : null };
        throw new Error("Unexpected table in billing service");
      },
    };
    return query;
  },
  async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args });
    if (name === "ai_billing_create_sandbox_order") return { error: null, data: { created, order } };
    if (name === "ai_billing_attach_sandbox_preference") return { error: attachError ? { message: "fixture internal database error" } : null, data: !attachError };
    if (name === "ai_billing_record_sandbox_payment") return { error: recordError ? { message: "fixture private payment detail" } : null, data: recordError ? null : { recorded: true } };
    throw new Error("Unexpected write; billing sandbox must not grant credits");
  },
};
type Loader = (id: string, parent: unknown, isMain: boolean) => unknown;
const loader = Module as unknown as { _load: Loader };
const originalLoad = loader._load;
const load = createRequire(__filename);
let service: typeof import("../lib/billing/server");
let route: typeof import("../app/api/ai-billing/mercadopago/route");
try {
  loader._load = function (id, parent, isMain) {
    if (id === "server-only") return {};
    if (id === "@/lib/data/auth") return { getCurrentUserContext: async () => ({ isAuthenticated: authenticated, userId: user, businessId: business, role }) };
    if (id === "@/lib/env") return { isDatabaseMode: () => mode };
    if (id === "@/lib/supabase/admin") return { createSupabaseAdminClient: () => db };
    if (id === "@/lib/billing/server") return service;
    if (id === "@/lib/billing/mercadopago") return core;
    return originalLoad.call(Module, id, parent, isMain);
  };
  service = load("../lib/billing/server") as typeof service;
  route = load("../app/api/ai-billing/mercadopago/route") as typeof route;
} finally { loader._load = originalLoad; }

beforeEach(() => {
  role = "owner"; authenticated = active = member = mode = created = orderVisible = true;
  attachError = recordError = false; calls = []; fetchCalls = [];
  Object.assign(process.env, { AI_BILLING_MODE: "sandbox", VERCEL_ENV: "preview", AI_BILLING_APP_ORIGIN: "https://qa.example.com", MERCADOPAGO_ACCESS_TOKEN: "fixture-token-not-real", MERCADOPAGO_WEBHOOK_SECRET: secret, MERCADOPAGO_COLLECTOR_ID: "12345", AI_BILLING_SANDBOX_BUSINESS_ID: business, AI_BILLING_SANDBOX_PRICES_ARS_JSON: '{"starter":10000}' });
  transport = async () => Response.json({ id: "fixture-pref", sandbox_init_point: order.checkout_url });
  globalThis.fetch = async (input, init) => { fetchCalls.push(String(input)); return transport(input, init); };
});
after(() => {
  globalThis.fetch = savedFetch;
  for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
  Object.assign(process.env, savedEnv);
});
function notification(signatureValid = true) {
  const ts = String(Date.now()), requestId = "fixture-request";
  const signature = createHmac("sha256", secret).update(`id:98765;request-id:${requestId};ts:${ts};`).digest("hex");
  return new Request("https://qa.example.com/api/ai-billing/mercadopago?data.id=98765&type=payment", { method: "POST", headers: { "x-request-id": requestId, "x-signature": `ts=${ts},v1=${signatureValid ? signature : "0".repeat(64)}` }, body: JSON.stringify({ status: "approved", amount: 1 }) });
}
function canonicalPayment(overrides: Record<string, unknown> = {}) {
  return { id: 98765, external_reference: orderId, live_mode: false, collector_id: 12345, currency_id: "ARS", transaction_amount: 100, transaction_amount_refunded: 0, status: "approved", date_last_updated: "2026-01-01T00:00:00Z", ...overrides };
}

test("service: demo, anonymous, viewer, inactive and revoked members cannot reach checkout", async () => {
  mode = false; await assert.rejects(service.beginSandboxCheckout("starter", nonce), core.BillingError); mode = true;
  authenticated = false; await assert.rejects(service.beginSandboxCheckout("starter", nonce), core.BillingError); authenticated = true;
  role = "viewer"; await assert.rejects(service.beginSandboxCheckout("starter", nonce), core.BillingError); role = "owner";
  active = false; await assert.rejects(service.beginSandboxCheckout("starter", nonce), core.BillingError); active = true;
  member = false; await assert.rejects(service.beginSandboxCheckout("starter", nonce), core.BillingError);
  assert.equal(calls.length, 0); assert.equal(fetchCalls.length, 0);
});
test("service: checkout derives actor, business and amount on server; records preference", async () => {
  const url = await service.beginSandboxCheckout("starter", nonce); assert.equal(url, order.checkout_url);
  assert.equal(calls[0].args.p_business_id, business); assert.equal(calls[0].args.p_actor_id, user); assert.equal(calls[0].args.p_amount_minor, 10000);
  assert.equal(calls[1].name, "ai_billing_attach_sandbox_preference"); assert.equal(calls[1].args.p_order_id, orderId); assert.equal(fetchCalls.length, 1);
});
test("service: request replay reuses the persisted sandbox URL without another provider POST", async () => {
  created = false; assert.equal(await service.beginSandboxCheckout("starter", nonce), order.checkout_url);
  assert.equal(fetchCalls.length, 0); assert.equal(calls.length, 1);
});
test("service: role revocation or failed persistence after provider call never yields checkout URL", async () => {
  attachError = true; await assert.rejects(service.beginSandboxCheckout("starter", nonce), core.BillingError);
  calls = []; attachError = false;
  transport = async () => { member = false; return Response.json({ id: "fixture-pref", sandbox_init_point: order.checkout_url }); };
  await assert.rejects(service.beginSandboxCheckout("starter", nonce), core.BillingError);
});
test("route: invalid signature fails before provider or database writes", async () => {
  const response = await route.POST(notification(false)); assert.equal(response.status, 400);
  assert.equal(fetchCalls.length, 0); assert.equal(calls.length, 0);
});
test("route: canonical payment overrides forged request body; sandbox only records verified metadata", async () => {
  transport = async () => Response.json(canonicalPayment());
  const response = await route.POST(notification()); assert.equal(response.status, 200);
  assert.deepEqual(fetchCalls, ["https://api.mercadopago.com/v1/payments/98765"]);
  assert.equal(calls.length, 1); assert.equal(calls[0].name, "ai_billing_record_sandbox_payment");
  assert.equal(calls[0].args.p_amount_minor, 10000); assert.equal(calls[0].args.p_live_mode, false); assert.equal(calls[0].args.p_status, "approved");
  assert.equal("p_credits" in calls[0].args, false); assert.equal("p_actor_id" in calls[0].args, false);
});
test("route: wrong tenant, live payment or changed amount cannot be recorded", async () => {
  transport = async () => Response.json(canonicalPayment()); orderVisible = false;
  assert.equal((await route.POST(notification())).status, 400); orderVisible = true;
  for (const patch of [{ live_mode: true }, { transaction_amount: 99 }, { external_reference: business }, { collector_id: 999 }]) {
    transport = async () => Response.json(canonicalPayment(patch)); assert.equal((await route.POST(notification())).status, 400);
  }
  assert.equal(calls.length, 0);
});
test("route: reconciliation failure returns retryable sanitized response", async () => {
  transport = async () => Response.json(canonicalPayment()); recordError = true;
  const response = await route.POST(notification()); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { received: false, code: "billing_reconciliation_failed" });
});
test("service/route: production mode blocks all checkout and provider calls", async () => {
  process.env.VERCEL_ENV = "production";
  await assert.rejects(service.beginSandboxCheckout("starter", nonce), core.BillingError);
  assert.equal((await route.POST(notification())).status, 503); assert.equal(fetchCalls.length, 0); assert.equal(calls.length, 0);
});
