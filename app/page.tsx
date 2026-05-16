import {
  ArrowRight,
  ArrowUpRight,
  BadgePercent,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Download,
  Inbox,
  ReceiptText,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { SalesAreaChart } from "@/components/charts/sales-area-chart";
import { ExpensesDonut } from "@/components/charts/expenses-donut";
import { InsightCard } from "@/components/common/insight-card";
import { ActivityFeed } from "@/components/common/activity-feed";
import { AttentionItem } from "@/components/common/attention-item";
import {
  attentionItems,
  dashboardKpis,
  expensesByCategory,
  insights,
  kpiSparklines,
  salesByDay,
  todaySnapshot,
} from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";

export default function DashboardPage() {
  const k = dashboardKpis;
  const t = todaySnapshot;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Cabina de control"
        title="Buen día, Mateo 👋"
        description="Lo que está pasando en La Birra Burger, en tiempo real. Datos cargados por WhatsApp y ordenados por la IA."
        actions={
          <>
            <Button size="sm" variant="ghost">
              <Calendar className="h-4 w-4" />
              Mayo 2026
            </Button>
            <Button size="sm" variant="ghost">
              <Download className="h-4 w-4" />
              Exportar
            </Button>
            <Link href="/inbox">
              <Button size="sm" variant="ai">
                <Sparkles className="h-4 w-4" />3 por aprobar
              </Button>
            </Link>
          </>
        }
      />

      {/* HOY EN EL NEGOCIO — hero strip */}
      <TodayHero today={t} />

      {/* KPIs con sparklines */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiSparkCard
          label="Ventas hoy"
          value={formatARS(k.ventasHoy)}
          delta={k.ventasHoyDelta}
          data={kpiSparklines.ventasHoy}
          tone="brand"
          hint="Proyección a cierre"
        />
        <KpiSparkCard
          label="Ventas del mes"
          value={formatARS(k.ventasMes, { compact: true })}
          delta={k.ventasMesDelta}
          data={kpiSparklines.ventasMes}
          tone="brand"
          hint="Proyección: $24,2M"
        />
        <KpiSparkCard
          label="Margen estimado"
          value={formatPercent(k.margenEstimado)}
          delta={k.margenDelta}
          data={kpiSparklines.margen}
          tone={k.margenDelta >= 0 ? "success" : "danger"}
          hint="vs 33,0% mes anterior"
        />
        <KpiSparkCard
          label="Costos cargados"
          value={formatARS(k.costosMes, { compact: true })}
          delta={k.costosDelta}
          data={kpiSparklines.costos}
          tone="ai"
          hint="68,8% de las ventas"
        />
      </div>

      {/* QUÉ NECESITA ATENCIÓN HOY */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="eyebrow mb-1">Foco del día</div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Qué necesita atención hoy
            </h2>
          </div>
          <Link
            href="/reportes"
            className="inline-flex items-center gap-1 text-xs text-brand-300 hover:text-brand-200"
          >
            Ver todas las recomendaciones
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {attentionItems.map((a, idx) => (
            <AttentionItem key={a.id} {...a} delay={idx * 0.04} />
          ))}
        </div>
      </section>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Ventas por día</CardTitle>
              <p className="mt-0.5 text-xs text-ink-muted">
                Últimos 11 días · Ventas vs costos
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-brand-500" />
                Ventas
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-ai-500" />
                Costo
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <SalesAreaChart data={salesByDay} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Gastos por categoría</CardTitle>
              <p className="mt-0.5 text-xs text-ink-muted">Mes en curso</p>
            </div>
          </CardHeader>
          <CardContent>
            <ExpensesDonut data={expensesByCategory} />
          </CardContent>
        </Card>
      </div>

      {/* AI recommendations + Activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-ai-400" />
                Recomendaciones de la IA
              </CardTitle>
              <p className="mt-0.5 text-xs text-ink-muted">
                Patrones detectados esta semana
              </p>
            </div>
            <Badge tone="ai">4 nuevas</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {insights.map((i, idx) => (
              <InsightCard
                key={i.id}
                tone={i.tone}
                icon={i.icon}
                title={i.title}
                detail={i.detail}
                delay={0.04 * idx}
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Actividad reciente</CardTitle>
              <p className="mt-0.5 text-xs text-ink-muted">
                Movimientos detectados por IA
              </p>
            </div>
            <Link
              href="/inbox"
              className="inline-flex items-center gap-1 text-xs text-brand-400 hover:text-brand-300"
            >
              Ver inbox
              <ChevronRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            <ActivityFeed />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function TodayHero({ today: t }: { today: typeof todaySnapshot }) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-bg-elevated/60 surface-raised">
      <div className="absolute inset-0 grid-dots opacity-50" />
      <div className="absolute -left-32 -top-32 h-64 w-64 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="absolute -right-24 -bottom-24 h-64 w-64 rounded-full bg-ai-500/15 blur-3xl" />
      <div className="relative grid grid-cols-1 gap-6 p-6 md:grid-cols-[1.2fr_1fr] md:gap-10 md:p-8">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-success-500/30 bg-success-500/10 px-2.5 py-1 text-[11px] font-medium text-success-400">
            <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-success-500" />
            Hoy · jueves 16 · 14:32
          </div>
          <h2 className="text-balance text-2xl font-semibold tracking-tight text-ink md:text-3xl">
            Tu negocio lleva facturado{" "}
            <span className="text-gradient-brand">{formatARS(t.ventasHoy)}</span>{" "}
            hoy.{" "}
            <span className="text-ink-muted">
              Vas un 12% arriba del jueves promedio.
            </span>
          </h2>
          <p className="mt-3 max-w-xl text-sm text-ink-muted">
            Menos planillas. Más decisiones. La IA está atenta a tus mensajes de WhatsApp y registra todo en tiempo real.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href="/inbox">
              <Button variant="primary" size="md">
                <Inbox className="h-4 w-4" />
                Revisar {t.movimientosPendientes} movimientos pendientes
              </Button>
            </Link>
            <Link href="/reportes">
              <Button variant="ghost" size="md">
                <Sparkles className="h-4 w-4 text-ai-400" />
                Preguntale al copiloto
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-2">
          <MicroStat icon={ReceiptText} label="Tickets" value={String(t.tickets)} />
          <MicroStat icon={Wallet} label="Ticket prom." value={formatARS(t.ticketProm)} />
          <MicroStat icon={BadgePercent} label="Margen hoy" value={formatPercent(t.margenHoy)} tone="success" />
          <MicroStat icon={CheckCircle2} label="Aprobados hoy" value="14" tone="ai" />
        </div>
      </div>
    </div>
  );
}

function MicroStat({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: any;
  label: string;
  value: string;
  tone?: "default" | "success" | "ai";
}) {
  const accent =
    tone === "success"
      ? "text-success-400"
      : tone === "ai"
        ? "text-ai-400"
        : "text-ink";
  return (
    <div className="card-quiet p-3.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-subtle">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${accent}`}>
        {value}
      </div>
    </div>
  );
}

function KpiSparkCard({
  label,
  value,
  delta,
  data,
  tone,
  hint,
}: {
  label: string;
  value: string;
  delta: number;
  data: number[];
  tone: "brand" | "ai" | "success" | "danger";
  hint?: string;
}) {
  const positive = delta >= 0;
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
            {label}
          </div>
          <div className="mt-1 text-[1.6rem] font-semibold leading-none tracking-tight text-ink tabular-nums">
            {value}
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-0.5 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
            positive
              ? "border-success-500/30 bg-success-500/10 text-success-400"
              : "border-danger-500/30 bg-danger-500/10 text-danger-400"
          }`}
        >
          {positive ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : (
            <TrendingUp className="h-3 w-3 rotate-180" />
          )}
          {formatPercent(Math.abs(delta))}
        </span>
      </div>
      <div className="mt-3 -mx-1">
        <Sparkline data={data} tone={tone} height={36} />
      </div>
      {hint && <p className="mt-2 text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
}
