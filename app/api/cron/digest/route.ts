/**
 * Endpoint cron del digest matutino.
 *
 * Itera todos los businesses, arma el digest y lo envía via Resend.
 * Sin RESEND_API_KEY → corre los queries pero no manda el email.
 *
 * Programado en vercel.json a las 11:00 UTC (8:00 ARG).
 *
 * Protección:
 *   - En database mode exige Authorization: Bearer <secret>.
 *   - Usa CRON_SECRET (Vercel Cron) y mantiene CRON_TOKEN como fallback legacy.
 *   - Si no hay ningún secret configurado, falla cerrado y no procesa negocios.
 */

import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { buildAndSendDigestForBusiness } from "@/lib/email/digest";

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
