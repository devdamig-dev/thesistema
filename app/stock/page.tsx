"use client";

import { AlertTriangle, Boxes, Plus, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightCard } from "@/components/common/insight-card";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { stockItems } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const STATE_STYLES = {
  ok: { tone: "success" as const, label: "Stock OK" },
  alerta: { tone: "warn" as const, label: "Atención" },
  critico: { tone: "danger" as const, label: "Crítico" },
};

export default function StockPage() {
  const criticos = stockItems.filter((s) => s.estado === "critico").length;
  const { toast } = useToast();
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Stock e insumos"
        title="Lo que tenés y lo que se está acabando."
        description="La IA actualiza tu stock con cada foto, audio o texto que mandás. Calcula cobertura en días y avisa cuándo reponer."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
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
            <Button
              size="sm"
              variant="primary"
              onClick={() => toast(ToastPresets.comingSoon("Movimiento manual de stock"))}
            >
              <Plus className="h-4 w-4" /> Movimiento manual
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Insumos críticos" value={String(criticos)} tone="danger" hint="Por debajo del mínimo" />
        <KpiCard label="En alerta" value="2" tone="default" />
        <KpiCard label="Cobertura promedio" value="4 días" delta={-1.2} />
        <KpiCard label="Última actualización" value="hace 9 min" hint="Foto enviada por Lucía" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InsightCard tone="danger" icon="TrendingUp" title="Pan brioche se queda en menos de 24 horas" detail="Sugerimos pedir 200 unidades a La Espiga antes de las 14hs." />
        <InsightCard tone="warn" icon="Sparkles" title="Cheddar bajo: 8kg quedan" detail="Cobertura estimada de 2 días al ritmo actual de venta." />
        <InsightCard tone="success" icon="Target" title="Papas y aceite con buena cobertura" detail="9 y 6 días respectivamente. No requieren acción." />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="h-4 w-4" />
            Estado actual de insumos
          </CardTitle>
          <Badge tone="warn">
            <AlertTriangle className="h-3 w-3" /> {criticos} críticos
          </Badge>
        </CardHeader>
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
              {stockItems.map((s) => {
                const ratio = Math.min(100, (s.stock / s.minimo) * 80);
                const cfg = STATE_STYLES[s.estado as keyof typeof STATE_STYLES];
                return (
                  <tr key={s.insumo} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                    <td className="px-5 py-3 font-medium text-ink">{s.insumo}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="w-16 text-sm tabular-nums text-ink">
                          {s.stock} {s.unidad}
                        </span>
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-bg-subtle">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              s.estado === "critico"
                                ? "bg-danger-500"
                                : s.estado === "alerta"
                                  ? "bg-warn-500"
                                  : "bg-success-500",
                            )}
                            style={{ width: `${ratio}%` }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-muted">
                      {s.minimo} {s.unidad}
                    </td>
                    <td className="px-5 py-3 tabular-nums text-ink-muted">{s.dias} días</td>
                    <td className="px-5 py-3">
                      <Badge tone={cfg.tone}>{cfg.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
