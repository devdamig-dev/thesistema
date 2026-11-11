import { BillingError } from "@/lib/billing/mercadopago";
import { receiveSandboxPayment } from "@/lib/billing/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    await receiveSandboxPayment(request);
    return Response.json({ received: true, sandbox: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof BillingError ? error.code : "billing_unavailable";
    const invalid = ["invalid_notification", "invalid_signature", "expired_signature", "invalid_payment", "invalid_amount", "payment_mismatch"];
    // Retry transient provider/database failures. Never log headers, tokens or payer payloads.
    return Response.json({ received: false, code }, { status: invalid.includes(code) ? 400 : 503, headers: { "Cache-Control": "no-store" } });
  }
}
