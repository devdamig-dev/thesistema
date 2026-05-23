"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BadgePercent,
  Banknote,
  Boxes,
  ChevronRight,
  Download,
  HandCoins,
  PieChart as PieChartIcon,
  Receipt,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { IncomeVsExpense } from "@/components/charts/income-vs-expense";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Snapshot = {
  ventasMes: number;
  comprasMes: number;
  gastosMes: number;
  sueldosMes: number;
  retirosMes: number;
  deudasPendientes: number;
  pagosDeudaMes: number;
  stockValorizado: number;
  cajaEstimada: number;
  margenBrutoPct: number;
  resultadoOperativo: number;
  resultadoNeto: number;
};

type MonthlyPoint = { mes: string; ingresos: number; egresos: number; resultado: number };

type Recommendation = {
  tone: "warn" | "info" | "success" | "danger";
  title: string;
  detail: string;
};

export default function BalancesClient({
  snapshot,
  monthly,
  recommendations,
}: {
  snapshot: Snapshot;
  monthly: MonthlyPoint[];
  recommendations: Recommendation[];
}) {
  const { toast } = useToast();
  const positivoOperativo = snapshot.resultadoOperativo >= 0;
  const positivoNeto = snapshot.resultadoNeto >= 0;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Operación · Balances"
        title="El estado del negocio, de un vistazo."
        description="Cruzamos ventas, compras, gastos, sueldos, retiros y deudas para mostrarte el resultado operativo y la caja estimada del mes."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toast(ToastPresets.exported())}
            >
              <Download className="h-4 w-4" />
              Exportar
            </Button>
            <Link href="/reportes">
              <Button size="sm" variant="ai">
                <Sparkles className="h-4 w-4" />
                Análisis con IA
              </Button>
            </Link>
          </>
        }
      />

      {/* Hero ejecutivo */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-bg-elevated/60 surface-raised">
        <div className="absolute inset-0 grid-dots opacity-50" />
        <div className="absolute -left-32 -top-32 h-80 w-80 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="absolute -right-24 -bottom-32 h-80 w-80 rounded-full bg-success-500/10 blur-3xl" />
        <div className="relative grid grid-cols-1 gap-6 p-6 md:grid-cols-[1.3fr_1fr] md:gap-10 md:p-10">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-success-500/30 bg-success-500/10 px-2.5 py-1 text-[11px] font-medium text-success-400">
              <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-success-500" />
              Mes en curso · datos en vivo
            </div>
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Resultado neto estimado:{" "}
              <span className={positivoNeto ? "text-success-400" : "text-danger-400"}>
                {formatARS(snapshot.resultadoNeto, { compact: true })}
              </span>
            </h2>
            <p className="mt-3 max-w-xl text-sm text-ink-muted">
              Después de pagar compras, gastos, sueldos, retiros y deuda. Tu margen bruto promedio del mes está en {formatPercent(snapshot.margenBrutoPct, 1)}.
            </p>
            <div className="mt-5 grid grid-cols-3 gap-3 text-xs">
              <ResultMicro label="Resultado operativo" value={snapshot.resultadoOperativo} positive={positivoOperativo} />
              <ResultMicro label="Margen bruto" value={snapshot.margenBrutoPct} percent />
              <ResultMicro label="Caja estimada" value={snapshot.cajaEstimada} positive />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MicroStat icon={TrendingUp} label="Ventas" value={snapshot.ventasMes} tone="brand" />
            <MicroStat icon={ShoppingCart} label="Compras" value={snapshot.comprasMes} tone="default" />
            <MicroStat icon={Receipt} label="Gastos" value={snapshot.gastosMes} tone="default" />
            <MicroStat icon={Users} label="Sueldos" value={snapshot.sueldosMes} tone="ai" />
            <MicroStat icon={Wallet} label="Retiros" value={snapshot.retirosMes} tone="warn" />
            <MicroStat icon={HandCoins} label="Pagos deuda" value={snapshot.pagosDeudaMes} tone="default" />
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Evolución mensual · ingresos vs egresos</CardTitle>
              <p className="mt-0.5 text-xs text-ink-muted">
                Últimos 6 meses. La línea verde marca el resultado del período.
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-brand-500" />
                Ingresos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-ai-500" />
                Egresos
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success-500" />
                Resultado
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <IncomeVsExpense data={monthly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HandCoins className="h-4 w-4" />
              Deudas pendientes
            </CardTitle>
            <Link href="/deudas" className="text-xs text-brand-300 hover:text-brand-200">
              Ver detalle →
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Saldo total</div>
              <div className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">
                {formatARS(snapshot.deudasPendientes)}
              </div>
              <div className="mt-1 text-xs text-ink-muted">
                Representa el {formatPercent(
                  (snapshot.deudasPendientes / Math.max(snapshot.ventasMes, 1)) * 100,
                  1,
                )} de la facturación mensual.
              </div>
            </div>

            <div className="card-quiet p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
                    Pagos del mes
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-ink">
                    {formatARS(snapshot.pagosDeudaMes)}
                  </div>
                </div>
                <ArrowDownRight className="h-4 w-4 text-success-400" />
              </div>
            </div>

            <div className="card-quiet p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
                    Stock valorizado
                  </div>
                  <div className="text-sm font-semibold tabular-nums text-ink">
                    {formatARS(snapshot.stockValorizado)}
                  </div>
                </div>
                <Boxes className="h-4 w-4 text-ink-muted" />
              </div>
            </div>

            <Link href="/deudas">
              <Button variant="ghost" size="sm" className="w-full">
                Gestionar deudas
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Recomendaciones */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="eyebrow mb-1 flex items-center gap-1.5 text-ai-400">
              <Sparkles className="h-3 w-3" />
              Recomendaciones del copiloto
            </div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Qué hacer con tu balance esta semana
            </h2>
          </div>
          <Badge tone="ai">{recommendations.length} insights</Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {recommendations.map((r, i) => (
            <RecommendationCard key={i} reco={r} />
          ))}
        </div>
      </section>
    </div>
  );
}

function MicroStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: number;
  tone: "brand" | "default" | "ai" | "warn";
}) {
  const accent = {
    brand: "text-brand-300",
    default: "text-ink",
    ai: "text-ai-400",
    warn: "text-warn-400",
  }[tone];
  return (
    <div className="card-quiet p-3.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-ink-subtle">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn("mt-1 text-lg font-semibold tabular-nums", accent)}>
        {formatARS(value, { compact: true })}
      </div>
    </div>
  );
}

function ResultMicro({
  label,
  value,
  positive,
  percent,
}: {
  label: string;
  value: number;
  positive?: boolean;
  percent?: boolean;
}) {
  const isNeg = !percent && value < 0;
  const color = percent
    ? "text-ink"
    : positive === undefined
      ? isNeg
        ? "text-danger-400"
        : "text-success-400"
      : positive
        ? "text-success-400"
        : "text-danger-400";
  return (
    <div className="card-quiet p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className={cn("mt-1 text-base font-semibold tabular-nums", color)}>
        {percent ? formatPercent(value, 1) : formatARS(value, { compact: true })}
      </div>
    </div>
  );
}

function RecommendationCard({ reco }: { reco: Recommendation }) {
  const cfg = {
    warn: { ring: "border-warn-500/25 bg-warn-500/[0.06]", dot: "bg-warn-500", icon: AlertTriangle, color: "text-warn-400" },
    danger: { ring: "border-danger-500/25 bg-danger-500/[0.06]", dot: "bg-danger-500", icon: AlertTriangle, color: "text-danger-400" },
    info: { ring: "border-ai-400/25 bg-ai-500/[0.06]", dot: "bg-ai-500", icon: Sparkles, color: "text-ai-400" },
    success: { ring: "border-success-500/25 bg-success-500/[0.06]", dot: "bg-success-500", icon: BadgePercent, color: "text-success-400" },
  }[reco.tone];
  const Icon = cfg.icon;
  return (
    <div className={cn("card relative overflow-hidden p-4", cfg.ring)}>
      <div className="flex items-start gap-3">
        <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-current/30 bg-current/10", cfg.color)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink leading-snug">{reco.title}</h3>
          <p className="mt-1 text-xs text-ink-muted leading-relaxed">{reco.detail}</p>
        </div>
      </div>
    </div>
  );
}
