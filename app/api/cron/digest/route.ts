/**
 * Endpoint cron del digest matutino.
 *
 * Itera todos los businesses, arma el digest y lo envía via Resend.
 * Sin RESEND_API_KEY → corre los queries pero no manda el email
 * (devuelve `mode: "demo"`).
 *
 * Programado en vercel.json a las 11:00 UTC (8:00 ARG).
 *
 * Protección: si está seteado CRON_TOKEN, se exige Bearer.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { buildAndSendDigestForBusiness } from "@/lib/email/digest";

export async function GET(request: NextRequest) {
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

    const bizRes = requested
      ? { data: [{ id: requested }] }
      : await db.from("businesses").select("id");
    const businesses = (bizRes.data as { id: string }[] | null) ?? [];

    const results: any[] = [];
    for (const b of businesses) {
      const summary = await buildAndSendDigestForBusiness(b.id);
      if (summary) results.push(summary);
    }

    return NextResponse.json({
      ok: true,
      mode: "database",
      businesses_processed: results.length,
      results,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "unknown_error" },
      { status: 500 },
    );
  }
}
