import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { BillingError, createSandboxPreference, isBillingProduct, sandboxCheckoutUrl, sandboxConfig, toMinorUnits, verifyPaymentNotification, verifySandboxPayment, readSandboxPayment, type SandboxConfig, type BillingOrder } from "../lib/billing/mercadopago";

const business = "11111111-1111-4111-8111-111111111111";
const order: BillingOrder = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", business_id: business, product_code: "starter", title: "Starter", amount_minor: 10000, currency: "ARS", collector_id: "12345", expires_at: "2026-11-11T03:00:00.000Z" };
const config: SandboxConfig = { token: "fixture-not-a-provider-token", webhookSecret: "fixture-webhook-secret-not-real-123456", collectorId: "12345", businessId: business, appOrigin: "https://qa.example.com", prices: { starter: 10000 } };
const now = 1794355200000;
const raw = { id: 98765, external_reference: order.id, live_mode: false, collector_id: 12345, currency_id: "ARS", transaction_amount: 100, transaction_amount_refunded: 0, status: "approved", date_last_updated: "2026-11-11T00:00:00.000Z" };
function notification(ts = String(now), id = "98765") {
  const requestId = "fixture-request-123";
  const v1 = createHmac("sha256", config.webhookSecret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest("hex");
  return { url: `https://qa.example.com/api/ai-billing/mercadopago?data.id=${id}&type=payment`, signature: `ts=${ts},v1=${v1}`, requestId, secret: config.webhookSecret, nowMs: now };
}
function env() { return { AI_BILLING_MODE: "sandbox", VERCEL_ENV: "preview", AI_BILLING_APP_ORIGIN: config.appOrigin, MERCADOPAGO_ACCESS_TOKEN: config.token, MERCADOPAGO_WEBHOOK_SECRET: config.webhookSecret, MERCADOPAGO_COLLECTOR_ID: config.collectorId, AI_BILLING_SANDBOX_BUSINESS_ID: business, AI_BILLING_SANDBOX_PRICES_ARS_JSON: '{"starter":10000}' }; }

test("sandbox configuration is explicit, scoped and unavailable in production", () => {
  assert.ok(sandboxConfig(env()));
  for (const patch of [ { AI_BILLING_MODE: "live" }, { VERCEL_ENV: "production" }, { MERCADOPAGO_WEBHOOK_SECRET: "" }, { AI_BILLING_SANDBOX_BUSINESS_ID: "" }, { AI_BILLING_APP_ORIGIN: "http://qa.example.com" }, { AI_BILLING_APP_ORIGIN: "https://user:password@qa.example.com" }, { AI_BILLING_SANDBOX_PRICES_ARS_JSON: '{"starter":100.1}' }, { AI_BILLING_SANDBOX_PRICES_ARS_JSON: '{"unknown":10000}' }, { AI_BILLING_SANDBOX_PRICES_ARS_JSON: '{}' } ]) assert.equal(sandboxConfig({ ...env(), ...patch }), null);
  assert.equal(isBillingProduct("free"), false);
  assert.equal(isBillingProduct("pack_5k"), true);
});
test("signed URL identity accepts seconds and milliseconds", () => {
  assert.equal(verifyPaymentNotification(notification()), "98765");
  assert.equal(verifyPaymentNotification(notification(String(now / 1000))), "98765");
});
test("signature rejects tampering, missing fields, duplicates and stale replay", () => {
  const good = notification();
  const bad = [
    { ...good, url: good.url.replace("98765", "98766") }, { ...good, requestId: "different" },
    { ...good, signature: null }, { ...good, secret: "" }, { ...good, signature: `${good.signature},ts=${now}` },
    { ...good, url: `${good.url}&data.id=98765` }, { ...good, url: `${good.url}&type=payment` },
    { ...good, nowMs: now + 600001 }, { ...good, nowMs: now - 600001 },
    { ...good, signature: `ts=${now},v1=aa` }, { ...good, requestId: "injected;ts:1" },
  ];
  for (const candidate of bad) assert.throws(() => verifyPaymentNotification(candidate), BillingError);
});
test("money conversion never rounds an underpayment or accepts fractional cents", () => {
  assert.equal(toMinorUnits(12.3), 1230); assert.equal(toMinorUnits("0.01"), 1);
  for (const value of [-1, NaN, Infinity, "1e2", "12.301", " 100", {}, null]) assert.throws(() => toMinorUnits(value), BillingError);
});
test("canonical payment must match order, merchant, mode, amount and currency", () => {
  assert.equal(verifySandboxPayment(raw, "98765", order).amountMinor, 10000);
  for (const patch of [ { id: 1 }, { external_reference: business }, { live_mode: true }, { live_mode: undefined }, { collector_id: 999 }, { currency_id: "USD" }, { transaction_amount: 99.99 }, { transaction_amount: 100.001 }, { transaction_amount_refunded: 101 }, { status: "paid" }, { date_last_updated: "tomorrow" } ]) assert.throws(() => verifySandboxPayment({ ...raw, ...patch }, "98765", order), BillingError);
});
test("checkout redirect cannot escape to live, arbitrary hosts or a different preference", () => {
  const url = "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=fixture-123";
  assert.equal(sandboxCheckoutUrl(url, "fixture-123"), url);
  for (const candidate of [ url.replace("sandbox.", ""), url.replace(".com.ar", ".com.ar.evil.test"), url.replace("https:", "http:"), `${url}&pref_id=fixture-123`, url.replace("fixture-123", "other"), url.replace("sandbox.", "user:pass@sandbox.") ]) assert.throws(() => sandboxCheckoutUrl(candidate, "fixture-123"), BillingError);
});
test("checkout uses immutable server values and sandbox_init_point only", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++; assert.equal(url, "https://api.mercadopago.com/checkout/preferences"); assert.equal(init?.redirect, "error");
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.external_reference, order.id); assert.equal(payload.items[0].unit_price, 100); assert.equal(payload.items[0].currency_id, "ARS");
    assert.equal(payload.notification_url, `${config.appOrigin}/api/ai-billing/mercadopago`);
    assert.equal(payload.back_urls.success, `${config.appOrigin}/ajustes/ia/pagos`);
    assert.equal("payer" in payload, false);
    return Response.json({ id: "fixture-123", init_point: "https://www.mercadopago.com.ar/live", sandbox_init_point: "https://sandbox.mercadopago.com.ar/checkout/v1/redirect?pref_id=fixture-123" });
  };
  assert.match((await createSandboxPreference(config, order, transport)).url, /^https:\/\/sandbox\./);
  await assert.rejects(createSandboxPreference(config, { ...order, amount_minor: 1 }, transport), BillingError);
  await assert.rejects(createSandboxPreference(config, { ...order, business_id: order.id }, transport), BillingError);
  assert.equal(calls, 1);
});
test("provider reads are fixed-origin GET; errors never reflect credentials/payloads", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++; assert.equal(url, "https://api.mercadopago.com/v1/payments/98765"); assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error");
    throw new Error(`external error ${config.token}`);
  };
  await assert.rejects(readSandboxPayment(config, "98765", transport), (error: unknown) => error instanceof BillingError && error.message === "provider_unavailable" && !error.message.includes(config.token));
  await assert.rejects(readSandboxPayment(config, "../users", transport), BillingError);
  assert.equal(calls, 1);
});
test("provider response has a streaming size limit and JSON shape validation", async () => {
  const oversized: typeof fetch = async () => new Response("x".repeat(262145));
  await assert.rejects(readSandboxPayment(config, "98765", oversized), BillingError);
  const array: typeof fetch = async () => Response.json([]);
  await assert.rejects(readSandboxPayment(config, "98765", array), BillingError);
  const failed: typeof fetch = async () => new Response("sensitive provider data", { status: 500 });
  await assert.rejects(readSandboxPayment(config, "98765", failed), (error: unknown) => error instanceof BillingError && error.code === "provider_unavailable");
});
