import {
  ArrowUpRight,
  BadgePercent,
  Calendar,
  ChevronRight,
  DollarSign,
  Download,
  ReceiptText,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SalesAreaChart } from "@/components/charts/sales-area-chart";
import { ExpensesDonut } from "@/components/charts/expenses-donut";
import { InsightCard } from "@/components/common/insight-card";
import { ActivityFeed } from "@/components/common/activity-feed";
import {
  dashboardKpis,
  expensesByCategory,
  insights,
  salesByDay,
} from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";

export default function DashboardPage() {
  const k = dashboardKpis;
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Dashboard"
        title="Buen día, Mateo 👋"
        description="Resumen ejecutivo de La Birra Burger. Los datos se actualizan en tiempo real desde WhatsApp."
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
                <Sparkles className="h-4 w-4" />
                3 movimientos por aprobar
              </Button>
            </Link>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Ventas de hoy"
          value={formatARS(k.ventasHoy)}
          delta={k.ventasHoyDelta}
          icon={<ArrowUpRight />}
          tone="brand"
          hint="Jueves 16 · 11 tickets"
          delay={0.02}
        />
        <KpiCard
          label="Ventas del mes"
          value={formatARS(k.ventasMes, { compact: true })}
          delta={k.ventasMesDelta}
          icon={<TrendingUp />}
          hint="Proyección: $24,2M"
          delay={0.06}
        />
        <KpiCard
          label="Margen estimado"
          value={formatPercent(k.margenEstimado)}
          delta={k.margenDelta}
          icon={<BadgePercent />}
          tone={k.margenDelta >= 0 ? "success" : "danger"}
          hint="vs 33,0% mes anterior"
          delay={0.1}
        />
        <KpiCard
          label="Costos cargados"
          value={formatARS(k.costosMes, { compact: true })}
          delta={k.costosDelta}
          icon={<ReceiptText />}
          tone="default"
          hint="68,8% de las ventas"
          delay={0.14}
        />
      </div>

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
