/**
 * Endpoint de cron / re-chequeo.
 *
 * Corre los checks de deudas y stock para todos los businesses
 * (o uno específico vía ?business=...). Devuelve resumen.
 *
 * Protección:
 *   - En production conviene pedir `Authorization: Bearer ${CRON_TOKEN}`.
 *   - Sin token, en demo mode siempre devuelve OK noop.
 *
 * Programación sugerida en Supabase / Vercel cron:
 *   cada 15-30 minutos.
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

export async function GET(request: NextRequest) {
  // Protección por token (opcional)
  const cronToken = process.env.CRON_TOKEN;
  if (cronToken) {
    const auth = request.headers.get("authorization") ?? "";
    const provided = auth.replace(/^Bearer\s+/i, "");
    if (provided !== cronToken) {
      return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
    }
  }

  if (!isDatabaseMode()) {
    return NextResponse.json({ ok: true, mode: "demo", noop: true });
  }

  try {
    const db = createSupabaseAdminClient() as any;
    const requested = request.nextUrl.searchParams.get("business");

    // Si se pide uno específico, sólo ese; si no, todos.
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
