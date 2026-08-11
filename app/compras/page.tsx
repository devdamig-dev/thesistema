"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { ArrowDownRight, ArrowUpRight, FileSpreadsheet, Loader2, Plus, Truck } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightCard } from "@/components/common/insight-card";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { exportPurchasesCsvAction } from "@/app/actions/exports";
import { getPurchasesPageDataAction, type PurchasesPageData } from "@/app/actions/purchases-page";
import { triggerCsvDownload } from "@/lib/csv-download";
import { recentPurchases as demoRecentPurchases, topSuppliers as demoTopSuppliers } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";

export default function ComprasPage() {
  const { toast } = useToast();
  const [exporting, startExport] = useTransition();
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseData, setDatabaseData] = useState<PurchasesPageData | null>(null);

  useEffect(() => {
    if (!IS_DATABASE) return;
    let cancelled = false;
    setLoading(true);
    void getPurchasesPageDataAction()
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
        if (!cancelled) setLoadError("No pudimos cargar las compras reales.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const recentPurchases = IS_DATABASE ? databaseData?.recentPurchases ?? [] : demoRecentPurchases;
  const topSuppliers = IS_DATABASE ? databaseData?.topSuppliers ?? [] : demoTopSuppliers;
  const supplierCount = IS_DATABASE ? databaseData?.supplierCount ?? 0 : topSuppliers.length;
  const totalMes = useMemo(() => topSuppliers.reduce((s, p) => s + p.totalMes, 0), [topSuppliers]);

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
        description={IS_DATABASE
          ? "Los indicadores se calculan con compras y proveedores persistidos en Supabase."
          : "Comparamos precios entre proveedores y alertamos cuando un insumo se sale del rango habitual."}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {exporting ? "Generando…" : "Exportar compras Excel"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => toast(ToastPresets.comingSoon("Alta de proveedor"))}>
              <Truck className="h-4 w-4" /> Nuevo proveedor
            </Button>
            <Button size="sm" variant="primary" onClick={() => toast(ToastPresets.comingSoon("Carga manual de compra"))}>
              <Plus className="h-4 w-4" /> Registrar compra
            </Button>
          </>
        }
      />

      {IS_DATABASE && loadError && (
        <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
          <div className="text-sm font-semibold text-ink">No pudimos leer el estado real de Compras</div>
          <p className="mt-1 text-xs text-ink-muted">{loadError} No mostramos ceros para evitar confundir una falla de lectura con un negocio vacío.</p>
        </div>
      )}

      {IS_DATABASE && loading ? (
        <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando compras reales…
        </div>
      ) : loadError ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Compras del mes" value={formatARS(totalMes, { compact: true })} delta={IS_DATABASE ? undefined : 14.1} tone="brand" />
            <KpiCard label="Órdenes" value={String(recentPurchases.length)} delta={IS_DATABASE ? undefined : 5} />
            <KpiCard label="Proveedores activos" value={String(supplierCount)} />
            <KpiCard label="Insumo más caro" value={IS_DATABASE ? "—" : "Carne premium"} hint={IS_DATABASE ? "Se habilita con historial comparable" : "$10.260/kg"} />
          </div>

          {!IS_DATABASE && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <InsightCard tone="warn" icon="TrendingUp" title="Don José aumentó 14% el kilo de carne" detail="De $9.000 a $10.260 en la última compra del 16/05." />
              <InsightCard tone="info" icon="Sparkles" title="Frigorífico Sur cotiza $9.450/kg" detail="Ahorro estimado de $16.200 por compra de 20kg." />
              <InsightCard tone="success" icon="Target" title="Verdulería Centro bajó 2%" detail="Lechuga y tomate vienen estables hace 3 semanas." />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Últimas compras</CardTitle>
                {!IS_DATABASE && <Badge tone="ai">Detectadas por IA</Badge>}
              </CardHeader>
              {recentPurchases.length === 0 ? (
                <CardContent>
                  <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                    Todavía no hay compras registradas.
                  </div>
                </CardContent>
              ) : (
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
                        <tr key={`${p.fecha}-${p.proveedor}-${i}`} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                          <td className="px-5 py-3 text-ink-muted">{p.fecha}</td>
                          <td className="px-5 py-3 text-ink">{p.proveedor}</td>
                          <td className="px-5 py-3 text-ink-muted">{p.insumo}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{p.cantidad}</td>
                          <td className="px-5 py-3 text-right">
                            {p.variacion === 0 ? <span className="text-xs text-ink-subtle">—</span> : (
                              <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", p.variacion > 5 ? "text-danger-400" : p.variacion > 0 ? "text-warn-400" : "text-success-400")}>
                                {p.variacion > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {formatPercent(Math.abs(p.variacion))}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">{formatARS(p.monto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Ranking de proveedores</CardTitle>
                  <p className="text-xs text-ink-muted">Mes en curso</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {topSuppliers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                    Sin proveedores con movimientos todavía.
                  </div>
                ) : topSuppliers.map((s) => (
                  <div key={s.nombre} className="rounded-xl border border-line bg-bg-subtle/60 p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{s.nombre}</div>
                        <div className="text-[11px] text-ink-subtle">{s.rubro} · {s.ordenes} órdenes</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums text-ink">{formatARS(s.totalMes, { compact: true })}</div>
                        {!IS_DATABASE && <div className={cn("text-[11px] tabular-nums", s.tendencia > 5 ? "text-danger-400" : s.tendencia > 0 ? "text-warn-400" : "text-success-400")}>{s.tendencia > 0 ? "+" : ""}{formatPercent(s.tendencia)}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
