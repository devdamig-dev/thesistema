"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Loader2, Plus, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightCard } from "@/components/common/insight-card";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { stockItems as demoStockItems } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { getStockPageDataAction, type StockPageData } from "@/app/actions/stock-page";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";

function stateFor(stock: number, minimo: number): "ok" | "alerta" | "critico" {
  if (minimo <= 0) return "ok";
  if (stock <= minimo) return "critico";
  if (stock <= minimo * 1.5) return "alerta";
  return "ok";
}

const STATE_STYLES = {
  ok: { tone: "success" as const, label: "Stock OK" },
  alerta: { tone: "warn" as const, label: "Atención" },
  critico: { tone: "danger" as const, label: "Crítico" },
};

function formatLastUpdated(value: string | null) {
  if (!value) return "Sin movimientos";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
}

export default function StockPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseData, setDatabaseData] = useState<StockPageData | null>(null);

  useEffect(() => {
    if (!IS_DATABASE) return;
    let cancelled = false;
    setLoading(true);
    void getStockPageDataAction()
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
        if (!cancelled) setLoadError("No pudimos cargar el stock real.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (IS_DATABASE) {
      return (databaseData?.items ?? []).map((row) => ({
        id: row.id,
        insumo: row.insumo,
        stock: row.stock,
        minimo: row.minimo,
        unidad: row.unidad,
        dias: null as number | null,
        estado: stateFor(row.stock, row.minimo),
      }));
    }
    return demoStockItems.map((row, index) => ({ ...row, id: `demo-${index}` }));
  }, [databaseData]);

  const criticos = IS_DATABASE
    ? databaseData?.criticalCount ?? 0
    : rows.filter((row) => row.estado === "critico").length;
  const alertas = IS_DATABASE
    ? databaseData?.alertCount ?? 0
    : rows.filter((row) => row.estado === "alerta").length;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Stock e insumos"
        title="Lo que tenés y lo que se está acabando."
        description={IS_DATABASE
          ? "Estado persistido por sucursal. La cobertura y las sugerencias aparecerán cuando exista historial suficiente de consumo."
          : "La IA actualiza tu stock con cada foto, audio o texto que mandás. Calcula cobertura en días y avisa cuándo reponer."}
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={IS_DATABASE}
              onClick={() =>
                toast({
                  tone: "ai",
                  title: "Reposición sugerida",
                  description: "Generamos un borrador de orden con pan brioche, cheddar y bacon.",
                })
              }
            >
              <Sparkles className="h-4 w-4" /> Sugerir reposición
            </Button>
            <Button size="sm" variant="primary" onClick={() => toast(ToastPresets.comingSoon("Movimiento manual de stock"))}>
              <Plus className="h-4 w-4" /> Movimiento manual
            </Button>
          </>
        }
      />

      {IS_DATABASE && loadError && (
        <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
          <div className="text-sm font-semibold text-ink">No pudimos leer el stock real</div>
          <p className="mt-1 text-xs text-ink-muted">{loadError} No mostramos datos demo ni indicadores inventados.</p>
        </div>
      )}

      {IS_DATABASE && loading ? (
        <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando stock real…
        </div>
      ) : loadError ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Insumos críticos" value={String(criticos)} tone="danger" hint="En o por debajo del mínimo" />
            <KpiCard label="En alerta" value={String(alertas)} tone="default" />
            <KpiCard label="Cobertura promedio" value={IS_DATABASE ? "—" : "4 días"} delta={IS_DATABASE ? undefined : -1.2} hint={IS_DATABASE ? "Requiere historial de consumo" : undefined} />
            <KpiCard label="Última actualización" value={IS_DATABASE ? formatLastUpdated(databaseData?.lastUpdatedAt ?? null) : "hace 9 min"} hint={IS_DATABASE ? "Último cambio persistido" : "Foto enviada por Lucía"} />
          </div>

          {!IS_DATABASE && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <InsightCard tone="danger" icon="TrendingUp" title="Pan brioche se queda en menos de 24 horas" detail="Sugerimos pedir 200 unidades a La Espiga antes de las 14hs." />
              <InsightCard tone="warn" icon="Sparkles" title="Cheddar bajo: 8kg quedan" detail="Cobertura estimada de 2 días al ritmo actual de venta." />
              <InsightCard tone="success" icon="Target" title="Papas y aceite con buena cobertura" detail="9 y 6 días respectivamente. No requieren acción." />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Boxes className="h-4 w-4" /> Estado actual de insumos</CardTitle>
              <Badge tone={criticos > 0 ? "warn" : "default"}><AlertTriangle className="h-3 w-3" /> {criticos} críticos</Badge>
            </CardHeader>
            {rows.length === 0 ? (
              <CardContent>
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                  Todavía no hay stock registrado para las sucursales accesibles.
                </div>
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Insumo</th>
                      <th className="px-5 py-2.5 font-medium">Stock actual</th>
                      <th className="px-5 py-2.5 font-medium">Mínimo</th>
                      <th className="px-5 py-2.5 font-medium">Cobertura</th>
                      <th className="px-5 py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const ratio = row.minimo > 0 ? Math.min(100, (row.stock / row.minimo) * 80) : 100;
                      const cfg = STATE_STYLES[row.estado as keyof typeof STATE_STYLES];
                      return (
                        <tr key={row.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                          <td className="px-5 py-3 font-medium text-ink">{row.insumo}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <span className="w-20 text-sm tabular-nums text-ink">{row.stock} {row.unidad}</span>
                              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-bg-subtle">
                                <div className={cn("h-full rounded-full", row.estado === "critico" ? "bg-danger-500" : row.estado === "alerta" ? "bg-warn-500" : "bg-success-500")} style={{ width: `${ratio}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 tabular-nums text-ink-muted">{row.minimo} {row.unidad}</td>
                          <td className="px-5 py-3 tabular-nums text-ink-muted">{row.dias == null ? "—" : `${row.dias} días`}</td>
                          <td className="px-5 py-3"><Badge tone={cfg.tone}>{cfg.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
