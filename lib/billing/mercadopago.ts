import { createHmac, timingSafeEqual } from "node:crypto";

/** Sandbox only. No caller can select a live checkout or override the API origin. */
export class BillingError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "BillingError"; }
}
export type SandboxConfig = {
  token: string; webhookSecret: string; collectorId: string;
  appOrigin: string; businessId: string; prices: Record<string, number>;
};
export type BillingOrder = {
  id: string; business_id: string; product_code: string; title: string;
  amount_minor: number; currency: "ARS"; collector_id: string; expires_at: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID = /^[1-9][0-9]{0,29}$/;
const PRODUCTS = new Set(["starter", "growth", "pro", "business", "pack_5k", "pack_15k", "pack_40k"]);
export function isBillingUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function isBillingProduct(value: unknown): value is string { return typeof value === "string" && PRODUCTS.has(value); }
export function sandboxConfig(env: Record<string, string | undefined>): SandboxConfig | null {
  // Production is deliberately not enabled by an environment typo or a live token.
  if (env.AI_BILLING_MODE !== "sandbox" || env.VERCEL_ENV === "production") return null;
  try {
    const origin = new URL(env.AI_BILLING_APP_ORIGIN ?? "");
    const token = env.MERCADOPAGO_ACCESS_TOKEN ?? "";
    const secret = env.MERCADOPAGO_WEBHOOK_SECRET ?? "";
    const collector = env.MERCADOPAGO_COLLECTOR_ID ?? "";
    const business = env.AI_BILLING_SANDBOX_BUSINESS_ID ?? "";
    if (origin.protocol !== "https:" || origin.username || origin.password || origin.port || origin.pathname !== "/" || origin.search || origin.hash
      || !token || /\s/.test(token) || secret.length < 32 || !ID.test(collector) || !isBillingUuid(business)) return null;
    const raw: unknown = JSON.parse(env.AI_BILLING_SANDBOX_PRICES_ARS_JSON ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const prices: Record<string, number> = {};
    for (const [code, amount] of Object.entries(raw)) {
      if (!PRODUCTS.has(code) || typeof amount !== "number" || !Number.isSafeInteger(amount) || amount < 100 || amount > 100_000_000) return null;
      prices[code] = amount;
    }
    if (!Object.keys(prices).length) return null;
    return { token, webhookSecret: secret, collectorId: collector, businessId: business, appOrigin: origin.origin, prices };
  } catch { return null; }
}

/** Authenticate the URL identifier, not body status/amount or return-page parameters. */
export function verifyPaymentNotification(input: {
  url: string; signature: string | null; requestId: string | null; secret: string; nowMs?: number;
}): string {
  const url = new URL(input.url);
  const ids = url.searchParams.getAll("data.id");
  const types = url.searchParams.getAll("type");
  if (ids.length !== 1 || !ID.test(ids[0]) || types.length !== 1 || types[0] !== "payment"
    || !input.requestId || !/^[a-zA-Z0-9-]{1,128}$/.test(input.requestId)
    || input.secret.length < 32 || !input.signature || input.signature.length > 256) throw new BillingError("invalid_notification");
  const parts = input.signature.split(",").map((part) => part.trim().split("="));
  if (parts.length !== 2 || parts.some((pair) => pair.length !== 2)
    || parts.filter(([key]) => key === "ts").length !== 1 || parts.filter(([key]) => key === "v1").length !== 1) throw new BillingError("invalid_signature");
  const ts = parts.find(([key]) => key === "ts")![1];
  const signature = parts.find(([key]) => key === "v1")![1];
  if (!/^\d{10}(?:\d{3})?$/.test(ts) || !/^[0-9a-f]{64}$/i.test(signature)) throw new BillingError("invalid_signature");
  const timestamp = Number(ts) * (ts.length === 10 ? 1000 : 1);
  if (Math.abs((input.nowMs ?? Date.now()) - timestamp) > 10 * 60_000) throw new BillingError("expired_signature");
  const manifest = `id:${ids[0]};request-id:${input.requestId};ts:${ts};`;
  const expected = createHmac("sha256", input.secret).update(manifest).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex"))) throw new BillingError("invalid_signature");
  return ids[0];
}

function identifier(value: unknown): string | null {
  if (typeof value === "string" && ID.test(value)) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : null;
}
/** Decimal money is converted exactly; fractional cents, exponent and NaN fail closed. */
export function toMinorUnits(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") throw new BillingError("invalid_amount");
  const raw = String(value);
  if (!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/.test(raw)) throw new BillingError("invalid_amount");
  const [whole, fraction = ""] = raw.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor)) throw new BillingError("invalid_amount");
  return minor;
}
export type VerifiedPayment = {
  paymentId: string; orderId: string; collectorId: string; amountMinor: number;
  refundedMinor: number; currency: "ARS"; status: string; updatedAt: string; liveMode: false;
};
export function verifySandboxPayment(raw: unknown, paymentId: string, order: BillingOrder): VerifiedPayment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BillingError("invalid_payment");
  const p = raw as Record<string, unknown>;
  if (identifier(p.id) !== paymentId || p.external_reference !== order.id || p.live_mode !== false
    || identifier(p.collector_id) !== order.collector_id || p.currency_id !== order.currency
    || toMinorUnits(p.transaction_amount) !== order.amount_minor) throw new BillingError("payment_mismatch");
  const statuses = ["pending", "in_process", "authorized", "approved", "rejected", "cancelled", "refunded", "charged_back", "in_mediation"];
  if (typeof p.status !== "string" || !statuses.includes(p.status)
    || typeof p.date_last_updated !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(p.date_last_updated)
    || !Number.isFinite(Date.parse(p.date_last_updated))) throw new BillingError("invalid_payment");
  const refunded = toMinorUnits(p.transaction_amount_refunded ?? 0);
  if (refunded > order.amount_minor) throw new BillingError("invalid_payment");
  return {
    paymentId, orderId: order.id, collectorId: order.collector_id, amountMinor: order.amount_minor,
    refundedMinor: refunded, currency: "ARS", status: p.status, updatedAt: new Date(p.date_last_updated).toISOString(), liveMode: false,
  };
}
export function sandboxCheckoutUrl(value: unknown, preferenceId: string): string {
  if (typeof value !== "string") throw new BillingError("invalid_checkout");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "sandbox.mercadopago.com.ar" || url.port || url.username || url.password || url.hash
    || url.pathname !== "/checkout/v1/redirect" || url.searchParams.getAll("pref_id").length !== 1
    || url.searchParams.get("pref_id") !== preferenceId) throw new BillingError("invalid_checkout");
  return url.href;
}
async function providerJson(config: SandboxConfig, path: string, init: RequestInit, transport: typeof fetch): Promise<Record<string, unknown>> {
  try {
    const response = await transport(`https://api.mercadopago.com${path}`, {
      ...init, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(12_000),
      headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", ...init.headers },
    });
    if (!response.ok) { await response.body?.cancel(); throw new BillingError("provider_unavailable"); }
    // Bound streaming as well as Content-Length; never persist/log provider payloads.
    const reader = response.body?.getReader();
    if (!reader) throw new BillingError("invalid_provider_response");
    const chunks: Uint8Array[] = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 262_144) { await reader.cancel(); throw new BillingError("invalid_provider_response"); }
      chunks.push(value);
    }
    const raw: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new BillingError("invalid_provider_response");
    return raw as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BillingError) throw error;
    throw new BillingError("provider_unavailable");
  }
}
export async function createSandboxPreference(config: SandboxConfig, order: BillingOrder, transport: typeof fetch = fetch) {
  if (order.business_id !== config.businessId || order.collector_id !== config.collectorId || !isBillingUuid(order.id)
    || !isBillingProduct(order.product_code) || config.prices[order.product_code] !== order.amount_minor || order.currency !== "ARS") throw new BillingError("invalid_order");
  const raw = await providerJson(config, "/checkout/preferences", {
    method: "POST", headers: { "X-Idempotency-Key": order.id },
    body: JSON.stringify({
      items: [{ id: order.product_code, title: `PRUEBA GastroPilot - ${order.title}`, quantity: 1, currency_id: "ARS", unit_price: order.amount_minor / 100 }],
      external_reference: order.id, notification_url: `${config.appOrigin}/api/ai-billing/mercadopago`,
      back_urls: Object.fromEntries(["success", "pending", "failure"].map((status) => [status, `${config.appOrigin}/ajustes/ia/pagos`])),
      expires: true, expiration_date_to: order.expires_at,
    }),
  }, transport);
  if (typeof raw.id !== "string" || !/^[a-zA-Z0-9-]{1,160}$/.test(raw.id)) throw new BillingError("invalid_checkout");
  return { preferenceId: raw.id, url: sandboxCheckoutUrl(raw.sandbox_init_point, raw.id) };
}
export async function readSandboxPayment(config: SandboxConfig, paymentId: string, transport: typeof fetch = fetch) {
  if (!ID.test(paymentId)) throw new BillingError("invalid_notification");
  return providerJson(config, `/v1/payments/${paymentId}`, { method: "GET" }, transport);
}
