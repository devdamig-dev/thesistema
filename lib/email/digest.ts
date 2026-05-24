/**
 * Daily digest matutino · template HTML + builder.
 *
 * Para cada business:
 *   1. Recolectamos kpis + pendientes + alertas + actividad reciente.
 *   2. Armamos el HTML.
 *   3. Mandamos al owner (y opcionalmente admin/manager).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { sendEmail, type SendEmailResult } from "./resend";

export type DigestSummary = {
  businessId: string;
  recipients: string[];
  emailResult: SendEmailResult | null;
  data: {
    salesYesterday: number;
    pendingInbox: number;
    pendingInvoices: number;
    overdueDebts: number;
    criticalStock: number;
    newRecommendations: number;
  };
};

const FROM = process.env.DIGEST_FROM_EMAIL ?? "GastroPilot <reportes@gastropilot.ai>";

export async function buildAndSendDigestForBusiness(
  businessId: string,
): Promise<DigestSummary | null> {
  if (!isDatabaseMode()) return null;
  const db = createSupabaseAdminClient() as any;

  // 1) Resolver business + owner emails
  const bizRes = await db
    .from("businesses")
    .select("name, organization_id")
    .eq("id", businessId)
    .maybeSingle();
  const biz = bizRes.data as { name: string; organization_id: string } | null;
  if (!biz) return null;

  // Recipients: roles owner/admin/manager del business
  const membersRes = await db
    .from("business_members")
    .select("user_id, role")
    .eq("business_id", businessId)
    .in("role", ["owner", "admin", "manager"]);
  const memberIds =
    ((membersRes.data as { user_id: string; role: string }[]) ?? []).map((m) => m.user_id);
  if (memberIds.length === 0) return null;

  const profilesRes = await db
    .from("profiles")
    .select("email")
    .in("id", memberIds);
  const recipients = ((profilesRes.data as { email: string | null }[]) ?? [])
    .map((p) => p.email)
    .filter((e): e is string => !!e);

  // 2) Recolectar datos
  const yesterday = new Date();
  yesterday.setHours(0, 0, 0, 0);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStart = yesterday.toISOString();
  const todayStart = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const [salesRes, inboxRes, invoicesRes, debtsRes, stockRes, recosRes] = await Promise.all([
    db
      .from("sales")
      .select("amount")
      .eq("business_id", businessId)
      .gte("occurred_at", yesterdayStart)
      .lt("occurred_at", todayStart),
    db
      .from("ai_extractions")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .in("status", ["pending", "needs_review"]),
    db
      .from("invoices")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "needs_review"),
    db
      .from("debts")
      .select("id, pending_amount", { count: "exact" })
      .eq("business_id", businessId)
      .in("status", ["overdue"]),
    db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("category", "stock")
      .is("read_at", null),
    db
      .from("ai_recommendations")
      .select("id", { count: "exact", head: true })
      .eq("business_id", businessId)
      .eq("status", "open")
      .gte("created_at", yesterdayStart),
  ]);

  const salesYesterday =
    ((salesRes.data as { amount: number }[]) ?? []).reduce(
      (s, r) => s + Number(r.amount),
      0,
    );

  const summary: DigestSummary["data"] = {
    salesYesterday,
    pendingInbox: (inboxRes as any).count ?? 0,
    pendingInvoices: (invoicesRes as any).count ?? 0,
    overdueDebts:
      ((debtsRes.data as any[]) ?? []).length ?? (debtsRes as any).count ?? 0,
    criticalStock: (stockRes as any).count ?? 0,
    newRecommendations: (recosRes as any).count ?? 0,
  };

  // 3) HTML
  const html = renderDigestHtml(biz.name, summary);

  // 4) Send
  const subject = `${biz.name} · resumen del ${yesterday.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "long",
  })}`;
  const emailResult = await sendEmail({
    from: FROM,
    to: recipients,
    subject,
    html,
    tags: [{ name: "type", value: "daily-digest" }],
  });

  return { businessId, recipients, emailResult, data: summary };
}

function fmtARS(n: number) {
  return `$${n.toLocaleString("es-AR")}`;
}

function renderDigestHtml(businessName: string, d: DigestSummary["data"]): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>GastroPilot · resumen diario</title>
</head>
<body style="margin:0;padding:24px;background:#0a0d12;color:#e2e8f0;font-family:-apple-system,system-ui,sans-serif;line-height:1.5;">
  <div style="max-width:560px;margin:0 auto;background:#0f141a;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);">
    <div style="padding:20px 24px;border-bottom:1px solid rgba(255,255,255,0.06);background:linear-gradient(180deg,rgba(249,115,22,0.12),transparent);">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;">GastroPilot AI · Resumen diario</div>
      <div style="margin-top:6px;font-size:18px;font-weight:600;color:white;">${businessName}</div>
    </div>
    <div style="padding:20px 24px;">
      <div style="font-size:13px;color:#94a3b8;margin-bottom:8px;">Lo que pasó ayer</div>
      <div style="font-size:28px;font-weight:600;color:#fb923c;">${fmtARS(d.salesYesterday)}</div>
      <div style="font-size:12px;color:#94a3b8;">facturado en el día</div>
    </div>
    <div style="padding:0 24px 24px;">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin:8px 0 10px;">Te esperan</div>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0 6px;">
        ${row("📥", "Movimientos del Inbox sin aprobar", d.pendingInbox)}
        ${row("🧾", "Facturas en revisión", d.pendingInvoices)}
        ${row("💸", "Deudas vencidas", d.overdueDebts)}
        ${row("📦", "Alertas de stock crítico", d.criticalStock)}
        ${row("✨", "Nuevas recomendaciones de IA", d.newRecommendations)}
      </table>
    </div>
    <div style="padding:18px 24px;border-top:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.02);font-size:11px;color:#94a3b8;">
      <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://gastropilot.ai"}/" style="color:#fb923c;text-decoration:none;">Abrir GastroPilot →</a>
      <br />
      Este resumen se manda todos los días a las 8:00. Cambiá tus preferencias en Ajustes → Equipo.
    </div>
  </div>
</body>
</html>`;
}

function row(emoji: string, label: string, value: number): string {
  const tone = value > 0 ? "#fb923c" : "#84cc16";
  return `<tr>
    <td style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;border-left:3px solid ${tone};">
      <span style="display:inline-block;width:24px;">${emoji}</span>
      <span style="color:#e2e8f0;font-size:13px;">${label}</span>
    </td>
    <td style="padding:10px 12px;background:rgba(255,255,255,0.03);border-radius:10px;text-align:right;width:60px;">
      <span style="color:${tone};font-size:16px;font-weight:600;">${value}</span>
    </td>
  </tr>`;
}
