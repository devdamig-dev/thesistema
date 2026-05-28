"use client";

import { useTransition } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Download, FileSpreadsheet, Loader2, Plus, Truck } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightCard } from "@/components/common/insight-card";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { exportPurchasesCsvAction } from "@/app/actions/exports";
import { triggerCsvDownload } from "@/lib/csv-download";
import { recentPurchases, topSuppliers } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ComprasPage() {
  const totalMes = topSuppliers.reduce((s, p) => s + p.totalMes, 0);
  const { toast } = useToast();
  const [exporting, startExport] = useTransition();

  function handleExport() {
    startExport(async () => {
      const res = await exportPurchasesCsvAction();
      if (res.ok) {
        triggerCsvDownload(res.filename, res.content);
        toast({
          tone: "success",
          title: "Exporte contable listo",
          description: `${res.rows} filas · ${res.filename}. Abrí con Excel y conciliá con IVA Compras.`,
        });
      } else {
        toast({ tone: "warn", title: "No pudimos exportar", description: res.error });
      }
    });
  }
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Compras y proveedores"
        title="Cada compra, su proveedor y su variación."
        description="Comparamos precios entre proveedores y alertamos cuando un insumo se sale del rango habitual."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              {exporting ? "Generando…" : "Exportar compras Excel"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toast(ToastPresets.comingSoon("Alta de proveedor"))}
            >
              <Truck className="h-4 w-4" /> Nuevo proveedor
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => toast(ToastPresets.comingSoon("Carga manual de compra"))}
            >
              <Plus className="h-4 w-4" /> Registrar compra
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Compras del mes" value={formatARS(totalMes, { compact: true })} delta={14.1} tone="brand" />
        <KpiCard label="Órdenes" value="20" delta={5} />
        <KpiCard label="Proveedores activos" value="9" />
        <KpiCard label="Insumo más caro" value="Carne premium" hint="$10.260/kg" />
      </div>

      {/* Insights alertas */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InsightCard tone="warn" icon="TrendingUp" title="Don José aumentó 14% el kilo de carne" detail="De $9.000 a $10.260 en la última compra del 16/05." />
        <InsightCard tone="info" icon="Sparkles" title="Frigorífico Sur cotiza $9.450/kg" detail="Ahorro estimado de $16.200 por compra de 20kg." />
        <InsightCard tone="success" icon="Target" title="Verdulería Centro bajó 2%" detail="Lechuga y tomate vienen estables hace 3 semanas." />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Últimas compras */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Últimas compras</CardTitle>
            <Badge tone="ai">Detectadas por IA</Badge>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Fecha</th>
                  <th className="px-5 py-2.5 font-medium">Proveedor</th>
                  <th className="px-5 py-2.5 font-medium">Insumo</th>
                  <th className="px-5 py-2.5 text-right font-medium">Cant.</th>
                  <th className="px-5 py-2.5 text-right font-medium">Var.</th>
                  <th className="px-5 py-2.5 text-right font-medium">Monto</th>
                </tr>
              </thead>
              <tbody>
                {recentPurchases.map((p, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                    <td className="px-5 py-3 text-ink-muted">{p.fecha}</td>
                    <td className="px-5 py-3 text-ink">{p.proveedor}</td>
                    <td className="px-5 py-3 text-ink-muted">{p.insumo}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{p.cantidad}</td>
                    <td className="px-5 py-3 text-right">
                      {p.variacion === 0 ? (
                        <span className="text-xs text-ink-subtle">—</span>
                      ) : (
                        <span
                          className={cn(
                            "inline-flex items-center gap-0.5 text-xs font-medium tabular-nums",
                            p.variacion > 5
                              ? "text-danger-400"
                              : p.variacion > 0
                                ? "text-warn-400"
                                : "text-success-400",
                          )}
                        >
                          {p.variacion > 0 ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : (
                            <ArrowDownRight className="h-3 w-3" />
                          )}
                          {formatPercent(Math.abs(p.variacion))}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                      {formatARS(p.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Ranking proveedores */}
        <Card>
          <CardHeader>
            <CardTitle>Ranking de proveedores</CardTitle>
            <p className="text-xs text-ink-muted">Mes en curso</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {topSuppliers.map((s) => (
              <div key={s.nombre} className="rounded-xl border border-line bg-bg-subtle/60 p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{s.nombre}</div>
                    <div className="text-[11px] text-ink-subtle">
                      {s.rubro} · {s.ordenes} órdenes
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold tabular-nums text-ink">
                      {formatARS(s.totalMes, { compact: true })}
                    </div>
                    <div
                      className={cn(
                        "text-[11px] tabular-nums",
                        s.tendencia > 5
                          ? "text-danger-400"
                          : s.tendencia > 0
                            ? "text-warn-400"
                            : "text-success-400",
                      )}
                    >
                      {s.tendencia > 0 ? "+" : ""}
                      {formatPercent(s.tendencia)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-elevated">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                    style={{ width: `${(s.totalMes / topSuppliers[0].totalMes) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Comparativo */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warn-400" />
              Comparativa de precios — Carne premium
            </CardTitle>
            <p className="text-xs text-ink-muted">3 proveedores cotizando este insumo</p>
          </div>
          <Badge tone="warn">Ahorro detectado</Badge>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            { prov: "Don José", precio: 10_260, tag: "Actual", tone: "danger" as const },
            { prov: "Frigorífico Sur", precio: 9_450, tag: "Recomendado", tone: "success" as const },
            { prov: "Cárnicos Norte", precio: 9_900, tag: "Cotizado", tone: "info" as const },
          ].map((p) => (
            <div key={p.prov} className="rounded-2xl border border-line bg-bg-subtle/40 p-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-ink">{p.prov}</div>
                <Badge tone={p.tone}>{p.tag}</Badge>
              </div>
              <div className="mt-3 text-2xl font-semibold tracking-tight text-ink tabular-nums">
                {formatARS(p.precio)}
              </div>
              <div className="text-xs text-ink-subtle">por kilo</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
