import Link from "next/link";
import {
  CheckCircle2,
  Inbox,
  MessageSquareText,
  ReceiptText,
  ShoppingCart,
  Sparkles,
  Wallet,
} from "lucide-react";
import { ActivityFeedReal } from "@/components/common/activity-feed-real";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RealtimeRefresher } from "@/components/realtime/realtime-refresher";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { formatARS } from "@/lib/format";

function sumAmounts(rows: { amount?: number | string | null; total?: number | string | null }[]) {
  return rows.reduce((sum, row) => sum + Number(row.amount ?? row.total ?? 0), 0);
}

export default async function DatabaseDashboard() {
  const ctx = await getCurrentUserContext();
  const supabase = createSupabaseServerClient();
  const db = supabase as any;

  const todayAR = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const monthAR = todayAR.slice(0, 7);
  const todayStart = `${todayAR}T00:00:00-03:00`;
  const monthStart = `${monthAR}-01T00:00:00-03:00`;
  const todayLabel = new Intl.DateTimeFormat("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires",
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  let businessName = "Tu negocio";
  let salesToday: any[] = [];
  let salesMonth: any[] = [];
  let purchasesMonth: any[] = [];
  let pendingCount = 0;
  let approvedToday = 0;
  let whatsappConnected = false;

  if (db && ctx.businessId) {
    const [bizRes, todayRes, monthRes, purchasesRes, pendingRes, approvedRes] = await Promise.all([
      db.from("businesses").select("name, whatsapp_connected").eq("id", ctx.businessId).maybeSingle(),
      db.from("sales").select("amount").eq("business_id", ctx.businessId).gte("occurred_at", todayStart),
      db.from("sales").select("amount").eq("business_id", ctx.businessId).gte("occurred_at", monthStart),
      db.from("purchases").select("total").eq("business_id", ctx.businessId).gte("purchased_at", `${monthAR}-01`),
      db.from("ai_extractions").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId).eq("status", "pending"),
      db.from("ai_extractions").select("id", { count: "exact", head: true }).eq("business_id", ctx.businessId).eq("status", "approved").gte("approved_at", todayStart),
    ]);

    businessName = bizRes.data?.name ?? businessName;
    whatsappConnected = Boolean(bizRes.data?.whatsapp_connected);
    salesToday = todayRes.data ?? [];
    salesMonth = monthRes.data ?? [];
    purchasesMonth = purchasesRes.data ?? [];
    pendingCount = pendingRes.count ?? 0;
    approvedToday = approvedRes.count ?? 0;
  }

  const ventasHoy = sumAmounts(salesToday);
  const ventasMes = sumAmounts(salesMonth);
  const comprasMes = sumAmounts(purchasesMonth);
  const ticketsHoy = salesToday.length;
  const ticketPromedio = ticketsHoy > 0 ? ventasHoy / ticketsHoy : 0;
  const hasOperationalData = salesMonth.length > 0 || purchasesMonth.length > 0 || pendingCount > 0 || approvedToday > 0;

  return (
    <div className="space-y-8">
      <RealtimeRefresher tables={["sales", "purchases", "notifications", "ai_extractions", "invoices"]} />

      <header className="flex flex-col gap-4 border-b border-line pb-6 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="eyebrow mb-1">Cabina de control</div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Buen día, {ctx.fullName || "👋"}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Estado real de {businessName}. Si todavía no cargaste movimientos, los indicadores permanecen en cero.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={whatsappConnected ? "success" : "default"}>
            <MessageSquareText className="h-3 w-3" />
            WhatsApp {whatsappConnected ? "conectado" : "pendiente"}
          </Badge>
          <Link href="/inbox"><Button size="sm" variant="ai"><Sparkles className="h-4 w-4" /> Inbox</Button></Link>
        </div>
      </header>

      <section className="relative overflow-hidden rounded-3xl border border-line bg-bg-elevated/60 p-6 md:p-8">
        <div className="absolute inset-0 grid-dots opacity-40" />
        <div className="relative grid gap-6 md:grid-cols-[1.25fr_1fr]">
          <div>
            <div className="mb-2 text-[11px] font-medium capitalize text-success-400">Hoy · {todayLabel}</div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              {ventasHoy > 0 ? (
                <>Tu negocio lleva facturado <span className="text-gradient-brand">{formatARS(ventasHoy)}</span> hoy.</>
              ) : (
                <>Todavía no hay ventas cargadas hoy.</>
              )}
            </h2>
            <p className="mt-3 max-w-xl text-sm text-ink-muted">
              {hasOperationalData
                ? "Los indicadores se calculan únicamente con información registrada en tu base real."
                : "Empezá cargando ventas, compras o aprobaciones. Cuando exista historial suficiente, aparecerán comparaciones y tendencias reales."}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/inbox"><Button variant="primary" size="md"><Inbox className="h-4 w-4" /> Revisar {pendingCount} pendientes</Button></Link>
              <Link href="/compras"><Button variant="ghost" size="md"><ShoppingCart className="h-4 w-4" /> Cargar operación</Button></Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <RealStat icon={ReceiptText} label="Tickets hoy" value={String(ticketsHoy)} />
            <RealStat icon={Wallet} label="Ticket prom." value={formatARS(ticketPromedio)} />
            <RealStat icon={CheckCircle2} label="Aprobados hoy" value={String(approvedToday)} />
            <RealStat icon={Inbox} label="Pendientes" value={String(pendingCount)} />
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Metric label="Ventas hoy" value={formatARS(ventasHoy)} hint={ticketsHoy ? `${ticketsHoy} tickets registrados` : "Sin movimientos todavía"} />
        <Metric label="Ventas del mes" value={formatARS(ventasMes)} hint="Acumulado real del mes" />
        <Metric label="Compras del mes" value={formatARS(comprasMes)} hint="Compras registradas en Supabase" />
      </section>

      {!hasOperationalData && (
        <section className="rounded-2xl border border-dashed border-line p-6">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-5 w-5 text-ai-400" />
            <div>
              <h2 className="text-sm font-semibold text-ink">Todavía no hay suficiente información para generar recomendaciones</h2>
              <p className="mt-1 text-xs text-ink-muted">
                No mostramos porcentajes, proyecciones ni alertas de ejemplo. La inteligencia operativa se habilita cuando exista historial real.
              </p>
            </div>
          </div>
        </section>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Actividad reciente</CardTitle>
            <p className="mt-0.5 text-xs text-ink-muted">Aprobaciones y cambios reales del negocio.</p>
          </div>
          <Link href="/inbox" className="text-xs text-brand-400 hover:text-brand-300">Ver inbox</Link>
        </CardHeader>
        <CardContent>
          <ErrorBoundaryCard module="Actividad reciente">
            <ActivityFeedReal limit={8} fallbackToMock={false} />
          </ErrorBoundaryCard>
        </CardContent>
      </Card>
    </div>
  );
}

function RealStat({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="card-quiet p-3.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-subtle"><Icon className="h-3 w-3" />{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card p-5">
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-1 text-[1.6rem] font-semibold leading-none tracking-tight text-ink tabular-nums">{value}</div>
      <p className="mt-3 text-[11px] text-ink-subtle">{hint}</p>
    </div>
  );
}
