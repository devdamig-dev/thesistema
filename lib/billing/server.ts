import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import {
  BillingError, createSandboxPreference, isBillingProduct, isBillingUuid, readSandboxPayment,
  sandboxCheckoutUrl, sandboxConfig, verifyPaymentNotification, verifySandboxPayment,
  type BillingOrder,
} from "./mercadopago";

type Actor = { businessId: string; userId: string; db: SupabaseClient };
async function authorize(): Promise<Actor> {
  if (!isDatabaseMode()) throw new BillingError("billing_unavailable");
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId || !["owner", "admin"].includes(ctx.role)) throw new BillingError("billing_forbidden");
  const db = createSupabaseAdminClient() as SupabaseClient | null;
  if (!db) throw new BillingError("billing_unavailable");
  const [member, profile] = await Promise.all([
    db.from("business_members").select("id").eq("business_id", ctx.businessId).eq("user_id", ctx.userId).in("role", ["owner", "admin"]).maybeSingle(),
    db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle(),
  ]);
  if (member.error || !member.data || profile.error || profile.data?.active !== true) throw new BillingError("billing_forbidden");
  return { businessId: ctx.businessId, userId: ctx.userId, db };
}
async function reauthorize(actor: Actor) {
  const current = await authorize();
  if (current.userId !== actor.userId || current.businessId !== actor.businessId) throw new BillingError("billing_forbidden");
}
export type BillingOffer = { code: string; title: string; kind: "plan" | "pack"; credits: number; amountMinor: number };
export type BillingHistory = { id: string; title: string; amount_minor: number; status: string; created_at: string };
export type BillingView = { enabled: boolean; reason: string; offers: BillingOffer[]; history: BillingHistory[] };
export async function getBillingView(): Promise<BillingView> {
  const unavailable = (reason: string): BillingView => ({ enabled: false, reason, offers: [], history: [] });
  try {
    const actor = await authorize();
    const config = sandboxConfig(process.env);
    if (!config || actor.businessId !== config.businessId) return unavailable("billing_unconfigured");
    const [plans, packs, history] = await Promise.all([
      actor.db.from("ai_plan_catalog").select("code,name,monthly_credits").eq("active", true).gt("price_usd_cents", 0).order("sort_order"),
      actor.db.from("ai_credit_packs").select("code,name,credits").eq("active", true).order("sort_order"),
      actor.db.from("ai_billing_orders").select("id,title,amount_minor,status,created_at").eq("business_id", actor.businessId).eq("mode", "sandbox").order("created_at", { ascending: false }).limit(20),
    ]);
    if (plans.error || packs.error || history.error) return unavailable("billing_unavailable");
    const offers: BillingOffer[] = [
      ...(plans.data ?? []).map((p) => ({ code: String(p.code), title: String(p.name), kind: "plan" as const, credits: Number(p.monthly_credits), amountMinor: config.prices[p.code] })),
      ...(packs.data ?? []).map((p) => ({ code: String(p.code), title: String(p.name), kind: "pack" as const, credits: Number(p.credits), amountMinor: config.prices[p.code] })),
    ].filter((p) => isBillingProduct(p.code) && Number.isSafeInteger(p.amountMinor) && p.amountMinor > 0 && Number.isSafeInteger(p.credits) && p.credits > 0);
    await reauthorize(actor);
    return { enabled: true, reason: "sandbox", offers, history: history.data as BillingHistory[] };
  } catch (error) {
    return unavailable(error instanceof BillingError ? error.code : "billing_unavailable");
  }
}
export async function beginSandboxCheckout(product: unknown, requestId: unknown): Promise<string> {
  if (!isBillingProduct(product) || !isBillingUuid(requestId)) throw new BillingError("billing_invalid_order");
  const actor = await authorize();
  const config = sandboxConfig(process.env);
  if (!config || actor.businessId !== config.businessId || !config.prices[product]) throw new BillingError("billing_unconfigured");
  const created = await actor.db.rpc("ai_billing_create_sandbox_order", {
    p_business_id: actor.businessId, p_actor_id: actor.userId, p_request_id: requestId,
    p_product_code: product, p_amount_minor: config.prices[product], p_collector_id: config.collectorId,
  });
  if (created.error || !created.data?.order) throw new BillingError("billing_order_unavailable");
  const result = created.data as { created: boolean; order: BillingOrder & { status: string; preference_id: string | null; checkout_url: string | null } };
  await reauthorize(actor);
  if (!result.created) {
    if (result.order.status === "ready" && result.order.preference_id && Date.parse(result.order.expires_at) > Date.now()) {
      return sandboxCheckoutUrl(result.order.checkout_url, result.order.preference_id);
    }
    // No second preference on a retry with an unknown network outcome.
    throw new BillingError("billing_order_in_progress");
  }
  const preference = await createSandboxPreference(config, result.order);
  const saved = await actor.db.rpc("ai_billing_attach_sandbox_preference", {
    p_business_id: actor.businessId, p_actor_id: actor.userId, p_order_id: result.order.id,
    p_preference_id: preference.preferenceId, p_checkout_url: preference.url,
  });
  if (saved.error || saved.data !== true) throw new BillingError("billing_order_unavailable");
  await reauthorize(actor);
  return preference.url;
}
export async function receiveSandboxPayment(request: Request): Promise<void> {
  const config = sandboxConfig(process.env);
  if (!config) throw new BillingError("billing_unconfigured");
  const paymentId = verifyPaymentNotification({
    url: request.url, signature: request.headers.get("x-signature"), requestId: request.headers.get("x-request-id"), secret: config.webhookSecret,
  });
  const raw = await readSandboxPayment(config, paymentId);
  if (!isBillingUuid(raw.external_reference)) throw new BillingError("payment_mismatch");
  const db = createSupabaseAdminClient() as SupabaseClient | null;
  if (!db) throw new BillingError("billing_unavailable");
  const result = await db.from("ai_billing_orders")
    .select("id,business_id,product_code,title,amount_minor,currency,collector_id,expires_at")
    .eq("id", raw.external_reference).eq("business_id", config.businessId).eq("mode", "sandbox").maybeSingle();
  if (result.error) throw new BillingError("billing_unavailable");
  if (!result.data) throw new BillingError("payment_mismatch");
  const payment = verifySandboxPayment(raw, paymentId, result.data as BillingOrder);
  const saved = await db.rpc("ai_billing_record_sandbox_payment", {
    p_order_id: payment.orderId, p_payment_id: payment.paymentId, p_collector_id: payment.collectorId,
    p_amount_minor: payment.amountMinor, p_currency: payment.currency, p_status: payment.status,
    p_updated_at: payment.updatedAt, p_live_mode: payment.liveMode, p_refunded_minor: payment.refundedMinor,
  });
  if (saved.error || !saved.data) throw new BillingError("billing_reconciliation_failed");
}
