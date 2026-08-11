/**
 * Endpoint de cron / re-chequeo.
 *
 * Corre los checks de deudas y stock para todos los businesses
 * (o uno específico vía ?business=...). Devuelve resumen.
 *
 * Protección:
 *   - En database mode exige Authorization: Bearer <secret>.
 *   - Usa CRON_SECRET (Vercel Cron) y mantiene CRON_TOKEN como fallback legacy.
 *   - Si no hay ningún secret configurado, falla cerrado y no ejecuta queries admin.
 *   - En demo mode devuelve OK noop sin tocar datos.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import {
  checkCriticalMarginForBusiness,
  checkDebtsForBusiness,
  checkInvoicesWithoutAttachmentForBusiness,
  checkPendingExtractionsForBusiness,
  checkStockForBusiness,
  checkTaxDebtsForBusiness,
} from "@/lib/data/notification-checks";

function authorizeCron(request: NextRequest): NextResponse | null {
  const cronSecret = process.env.CRON_SECRET || process.env.CRON_TOKEN;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, reason: "cron_secret_not_configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "");
  if (provided !== cronSecret) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  return null;
}

export async function GET(request: NextRequest) {
  if (!isDatabaseMode()) {
    return NextResponse.json({ ok: true, mode: "demo", noop: true });
  }

  const authError = authorizeCron(request);
  if (authError) return authError;

  try {
    const db = createSupabaseAdminClient() as any;
    const requested = request.nextUrl.searchParams.get("business");

    const businessesRes = requested
      ? { data: [{ id: requested }] }
      : await db.from("businesses").select("id");
    const businesses = (businessesRes.data as { id: string }[] | null) ?? [];

    const results: Record<
      string,
      {
        debts: any;
        stock: any;
        pendingInbox: any;
        margin: any;
        taxDebts: any;
        invoicesNoAttachment: any;
      }
    > = {};
    for (const b of businesses) {
      const debts = await checkDebtsForBusiness(b.id);
      const stock = await checkStockForBusiness(b.id);
      const pendingInbox = await checkPendingExtractionsForBusiness(b.id);
      const margin = await checkCriticalMarginForBusiness(b.id);
      const taxDebts = await checkTaxDebtsForBusiness(b.id);
      const invoicesNoAttachment = await checkInvoicesWithoutAttachmentForBusiness(b.id);
      results[b.id] = { debts, stock, pendingInbox, margin, taxDebts, invoicesNoAttachment };
    }

    return NextResponse.json({
      ok: true,
      mode: "database",
      businesses_checked: businesses.length,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unknown_error" },
      { status: 500 },
    );
  }
}
