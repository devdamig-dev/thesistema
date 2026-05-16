import { AlertTriangle, ChefHat, Plus, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { products } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function ProductosPage() {
  const total = products.length;
  const margenBajo = products.filter((p) => p.estado === "margen-bajo").length;
  const margenPromedio =
    products.reduce((s, p) => s + (p.precio - p.costo) / p.precio, 0) / total * 100;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Productos y recetas"
        title="Menú con márgenes en tiempo real."
        description="Cada producto está vinculado a sus insumos. Si cambia el costo de un ingrediente, recalculamos el margen y avisamos."
        actions={
          <>
            <Button size="sm" variant="ghost">
              <Sparkles className="h-4 w-4" /> Sugerir precios
            </Button>
            <Button size="sm" variant="primary">
              <Plus className="h-4 w-4" /> Nuevo producto
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Productos activos" value={String(total)} tone="brand" />
        <KpiCard label="Margen promedio" value={formatPercent(margenPromedio)} delta={-1.4} />
        <KpiCard label="Con margen bajo" value={String(margenBajo)} tone="danger" />
        <KpiCard label="Estrella del mes" value="Clásica" hint="38% de las ventas" />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {products.map((p) => {
          const margen = ((p.precio - p.costo) / p.precio) * 100;
          const bajo = p.estado === "margen-bajo";
          return (
            <Card key={p.nombre} className="overflow-hidden">
              <div className="relative h-28 overflow-hidden bg-gradient-to-br from-brand-500/20 via-brand-700/10 to-ai-500/10">
                <div className="grid-bg absolute inset-0 opacity-40" />
                <div className="absolute right-3 top-3 flex gap-1.5">
                  <Badge tone="default">{p.categoria}</Badge>
                  {bajo && (
                    <Badge tone="danger">
                      <AlertTriangle className="h-3 w-3" /> Margen bajo
                    </Badge>
                  )}
                </div>
                <div className="absolute bottom-3 left-4 grid h-12 w-12 place-items-center rounded-xl border border-line bg-bg-elevated/80 backdrop-blur">
                  <ChefHat className="h-5 w-5 text-brand-400" />
                </div>
              </div>
              <CardContent className="space-y-3 pt-4">
                <div>
                  <h3 className="text-base font-semibold text-ink">{p.nombre}</h3>
                  <p className="text-xs text-ink-muted">
                    {p.ingredientes.length} ingredientes
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-bg-subtle/60 p-2.5">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Precio</div>
                    <div className="text-sm font-semibold text-ink tabular-nums">
                      {formatARS(p.precio)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Costo</div>
                    <div className="text-sm font-medium text-ink-muted tabular-nums">
                      {formatARS(p.costo)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Margen</div>
                    <div
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        bajo ? "text-danger-400" : margen > 60 ? "text-success-400" : "text-ink",
                      )}
                    >
                      {formatPercent(margen, 0)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {p.ingredientes.slice(0, 4).map((i) => (
                    <span key={i} className="chip">{i}</span>
                  ))}
                  {p.ingredientes.length > 4 && (
                    <span className="chip">+{p.ingredientes.length - 4}</span>
                  )}
                </div>
                {bajo && (
                  <div className="flex items-start gap-2 rounded-lg border border-ai-400/30 bg-ai-500/10 p-2.5 text-xs text-ai-400">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Recomendación IA: subir precio a {formatARS(p.precio + 600)} mantendría margen sobre 55%.
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
