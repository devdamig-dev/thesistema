"use client";

import { useEffect, useState, useTransition } from "react";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import { ArrowDownRight, ArrowUpRight, Calendar, Download, Loader2, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChannelBar } from "@/components/charts/channel-bar";
import { SalesAreaChart } from "@/components/charts/sales-area-chart";
import { InsightCard } from "@/components/common/insight-card";
import { useToast } from "@/components/ui/toast";
import { exportSalesCsvAction } from "@/app/actions/exports";
import {
  getSalesPageDataAction,
  type SalesPageData,
  type SalesPeriod,
} from "@/app/actions/sales-page";
import { triggerCsvDownload } from "@/lib/csv-download";
import {
  dailySalesTable as demoDailySalesTable,
  salesByChannel as demoSalesByChannel,
  salesByDay as demoSalesByDay,
} from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";

const PERIOD_OPTIONS: Array<{ value: SalesPeriod; label: string }> = [
  { value: "current_month", label: "Mes actual" },
  { value: "previous_month", label: "Mes anterior" },
  { value: "last_30_days", label: "Últimos 30 días" },
];

export default function VentasPage() {
  const { toast } = useToast();
  const [exporting, startExport] = useTransition();
  const [period, setPeriod] = useState<SalesPeriod>("current_month");
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseData, setDatabaseData] = useState<SalesPageData | null>(null);

  useEffect(() => {
    if (!IS_DATABASE) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    void getSalesPageDataAction(period)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(res.error);
          setDatabaseData(null);
          return;
        }
        setDatabaseData(res.data);
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled) setLoadError("No pudimos cargar las ventas.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const dailySalesTable = IS_DATABASE ? databaseData?.dailySalesTable ?? [] : demoDailySalesTable;
  const salesByChannel = IS_DATABASE ? databaseData?.salesByChannel ?? [] : demoSalesByChannel;
  const salesByDay = IS_DATABASE ? databaseData?.salesByDay ?? [] : demoSalesByDay;
  const total = salesByChannel.reduce((s, c) => s + c.total, 0);
  const weightedTickets = salesByChannel.reduce((s, c) => s + c.ticket * c.share, 0);
  const shares = salesByChannel.reduce((s, c) => s + c.share, 0);
  const ticketPromedio = shares > 0 ? weightedTickets / shares : 0;
  const totalTickets = IS_DATABASE ? databaseData?.totalTickets ?? 0 : 1486;
  const bestDay = IS_DATABASE ? databaseData?.bestDay ?? null : { label: "Sáb 11/05", total: 1_320_000 };

  function handleExport() {
    startExport(async () => {
      const res = await exportSalesCsvAction();
      if (res.ok) {
        triggerCsvDownload(res.filename, res.content);
        toast({ tone: "success", title: "Exportación lista", description: `${res.rows} filas · ${res.filename}` });
      } else {
        toast({ tone: "warn", title: "No pudimos exportar", description: res.error });
      }
    });
  }

  return (
    <ErrorBoundaryCard module="Ventas">
      <div className="space-y-8">
        <SectionHeader
          eyebrow="Ventas"
          title="Ventas por canal y ritmo diario"
          description={IS_DATABASE
            ? "Analizá el rendimiento de tus ventas y compará períodos con información de tu negocio."
            : "Vista unificada de salón, delivery propio, apps y WhatsApp. La IA detecta patrones de demanda y oportunidades."}
          actions={
            <>
              {IS_DATABASE ? (
                <label className="relative inline-flex h-9 items-center rounded-lg border border-line bg-bg-elevated text-sm text-ink-muted">
                  <Calendar className="pointer-events-none absolute left-3 h-4 w-4" />
                  <select
                    value={period}
                    onChange={(event) => setPeriod(event.target.value as SalesPeriod)}
                    className="h-full appearance-none bg-transparent pl-9 pr-8 text-sm font-medium text-ink outline-none"
                    aria-label="Período de ventas"
                    disabled={loading}
                  >
                    {PERIOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <Button size="sm" variant="ghost" disabled>
                  <Calendar className="h-4 w-4" /> Mayo 2026
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={handleExport} disabled={exporting}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {exporting ? "Generando…" : "Exportar ventas"}
              </Button>
            </>
          }
        />

        {IS_DATABASE && loadError && (
          <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
            <div className="text-sm font-semibold text-ink">No pudimos cargar Ventas</div>
            <p className="mt-1 text-xs text-ink-muted">{loadError} Intentá nuevamente en unos minutos.</p>
          </div>
        )}

        {IS_DATABASE && loading ? (
          <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando ventas…
          </div>
        ) : loadError ? null : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard label="Ventas del período" value={formatARS(total, { compact: true })} delta={IS_DATABASE ? undefined : 8.7} tone="brand" />
              <KpiCard label="Ticket promedio" value={formatARS(Math.round(ticketPromedio))} delta={IS_DATABASE ? undefined : 4.2} />
              <KpiCard label="Tickets totales" value={totalTickets.toLocaleString("es-AR")} delta={IS_DATABASE ? undefined : 6.1} />
              <KpiCard label="Mejor día" value={bestDay?.label ?? "—"} hint={bestDay ? formatARS(bestDay.total) : "Sin datos todavía"} />
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
              <Card className="lg:col-span-3">
                <CardHeader><div><CardTitle>Ritmo de ventas</CardTitle><p className="mt-0.5 text-xs text-ink-muted">Últimos 11 días con movimientos del período</p></div></CardHeader>
                <CardContent>{salesByDay.length === 0 ? <EmptyState text="Todavía no hay ventas para graficar en este período." /> : <SalesAreaChart data={salesByDay} />}</CardContent>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader><div><CardTitle>Ventas por canal</CardTitle><p className="mt-0.5 text-xs text-ink-muted">Período seleccionado</p></div></CardHeader>
                <CardContent>{salesByChannel.length === 0 ? <EmptyState text="Todavía no hay ventas por canal en este período." /> : <ChannelBar data={salesByChannel.map((c) => ({ canal: c.canal, total: c.total }))} />}</CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader><CardTitle>Detalle por canal</CardTitle>{!IS_DATABASE && <Badge tone="ai"><Sparkles className="h-3 w-3" /> Insights activos</Badge>}</CardHeader>
              {salesByChannel.length === 0 ? (
                <CardContent><EmptyState text="Sin movimientos de venta registrados en este período." /></CardContent>
              ) : (
                <div className="overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle"><tr><th className="px-5 py-2.5 font-medium">Canal</th><th className="px-5 py-2.5 font-medium">Participación</th><th className="px-5 py-2.5 text-right font-medium">Ticket prom.</th><th className="px-5 py-2.5 text-right font-medium">Variación</th><th className="px-5 py-2.5 text-right font-medium">Total período</th></tr></thead>
                    <tbody>{salesByChannel.map((c) => (<tr key={c.canal} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle"><td className="px-5 py-3 font-medium text-ink">{c.canal}</td><td className="px-5 py-3"><span className="text-xs text-ink-muted tabular-nums">{c.share.toFixed(1)}%</span></td><td className="px-5 py-3 text-right tabular-nums text-ink">{formatARS(c.ticket)}</td><td className="px-5 py-3 text-right">{IS_DATABASE ? <span className="text-xs text-ink-subtle">—</span> : <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", c.delta >= 0 ? "text-success-400" : "text-danger-400")}>{c.delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{formatPercent(Math.abs(c.delta))}</span>}</td><td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">{formatARS(c.total)}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
            </Card>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Ventas diarias</CardTitle><p className="text-xs text-ink-muted">Últimos 7 días con movimientos del período</p></CardHeader>
                {dailySalesTable.length === 0 ? <CardContent><EmptyState text="Todavía no hay ventas diarias registradas en este período." /></CardContent> : (
                  <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle"><tr><th className="px-5 py-2.5 font-medium">Día</th><th className="px-5 py-2.5 text-right font-medium">Salón</th><th className="px-5 py-2.5 text-right font-medium">Delivery</th><th className="px-5 py-2.5 text-right font-medium">PedidosYa</th><th className="px-5 py-2.5 text-right font-medium">WhatsApp</th><th className="px-5 py-2.5 text-right font-medium">Total</th></tr></thead><tbody>{dailySalesTable.map((d) => (<tr key={d.fecha} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle"><td className="px-5 py-3 text-ink">{d.fecha}</td><td className="px-5 py-3 text-right tabular-nums text-ink-muted">{formatARS(d.salon)}</td><td className="px-5 py-3 text-right tabular-nums text-ink-muted">{formatARS(d.delivery)}</td><td className="px-5 py-3 text-right tabular-nums text-ink-muted">{formatARS(d.pya)}</td><td className="px-5 py-3 text-right tabular-nums text-ink-muted">{formatARS(d.wa)}</td><td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">{formatARS(d.total)}</td></tr>))}</tbody></table></div>
                )}
              </Card>
              {!IS_DATABASE ? (
                <div className="space-y-3"><InsightCard tone="success" icon="TrendingUp" title="WhatsApp creció 22% mes a mes" detail="Ticket promedio más alto de todos los canales: $13.900." /><InsightCard tone="danger" icon="PieChart" title="PedidosYa bajó 3,4% y resta margen" detail="Las comisiones representan un 22% del ticket." /><InsightCard tone="info" icon="CalendarDays" title="Viernes y sábado concentran 39% de la semana" detail="Sumar turno extra de delivery los viernes podría aumentar 8% el total." /></div>
              ) : (
                <Card><CardContent className="pt-6"><EmptyState text="Los insights aparecerán cuando exista historial suficiente." /></CardContent></Card>
              )}
            </div>
          </>
        )}
      </div>
    </ErrorBoundaryCard>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">{text}</div>;
}
