import { Calculator, Plus, Receipt } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { breakEven, fixedExpenses } from "@/lib/mock-data";
import { formatARS } from "@/lib/format";

const STATUS_TONE = {
  pagado: "success",
  programado: "info",
  pendiente: "warn",
  variable: "default",
  automático: "ai",
} as const;

export default function GastosPage() {
  const total = fixedExpenses.reduce((s, e) => s + e.monto, 0);
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Gastos fijos"
        title="Lo que cuesta abrir cada día."
        description="Costos estructurales del mes y cuánto tenés que facturar diariamente para cubrirlos."
        actions={
          <Button size="sm" variant="primary">
            <Plus className="h-4 w-4" /> Nuevo gasto fijo
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Total mensual" value={formatARS(total, { compact: true })} tone="brand" />
        <KpiCard label="Punto de equilibrio diario" value={formatARS(breakEven.diario)} icon={<Calculator />} tone="ai" hint="Promedio 30 días" />
        <KpiCard label="Días sobre objetivo" value="11/16" delta={6.2} tone="success" />
        <KpiCard label="Próximo vencimiento" value="05/06" hint="Sueldos · $2,48M" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detalle de gastos fijos</CardTitle>
          <Badge tone="default">{fixedExpenses.length} ítems</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Concepto</th>
                <th className="px-5 py-2.5 font-medium">Vencimiento</th>
                <th className="px-5 py-2.5 font-medium">Estado</th>
                <th className="px-5 py-2.5 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {fixedExpenses.map((e) => (
                <tr key={e.nombre} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-bg-subtle text-ink-muted">
                        <Receipt className="h-3.5 w-3.5" />
                      </div>
                      <span className="font-medium text-ink">{e.nombre}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-muted">{e.vencimiento}</td>
                  <td className="px-5 py-3">
                    <Badge tone={STATUS_TONE[e.estado as keyof typeof STATUS_TONE]}>
                      {e.estado}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                    {formatARS(e.monto)}
                  </td>
                </tr>
              ))}
              <tr className="bg-bg-elevated/60">
                <td colSpan={3} className="px-5 py-3 text-right text-xs uppercase tracking-wider text-ink-subtle">
                  Total mensual
                </td>
                <td className="px-5 py-3 text-right text-base font-semibold tabular-nums text-brand-300">
                  {formatARS(total)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="p-6 md:p-8">
            <Badge tone="ai" className="mb-3">
              <Calculator className="h-3 w-3" /> Punto de equilibrio
            </Badge>
            <h3 className="text-xl font-semibold tracking-tight text-ink">
              Necesitás facturar{" "}
              <span className="text-brand-300">{formatARS(breakEven.diario)}</span>{" "}
              por día para cubrir tus costos fijos de mayo.
            </h3>
            <p className="mt-2 text-sm text-ink-muted">
              Calculado sobre {formatARS(breakEven.mensual, { compact: true })} mensuales y 30 días de operación. Incluye sueldos, alquiler, servicios, comisiones y publicidad.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button variant="primary" size="sm">
                Ver proyección mensual
              </Button>
              <Button variant="ghost" size="sm">
                Ajustar supuestos
              </Button>
            </div>
          </div>
          <div className="relative grid-bg border-t border-line p-6 md:border-l md:border-t-0">
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-bold tracking-tight text-ink tabular-nums">
                11
              </span>
              <span className="text-ink-muted">de 16 días</span>
            </div>
            <p className="text-sm text-ink-muted">por encima del objetivo en mayo</p>
            <div className="mt-6 grid gap-1" style={{ gridTemplateColumns: "repeat(16, minmax(0,1fr))" }}>
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-8 rounded-sm ${
                    [1, 2, 4, 6, 9, 10, 12, 13, 14, 15, 16].includes(i + 1)
                      ? "bg-gradient-to-t from-brand-600 to-brand-400"
                      : "bg-bg-subtle"
                  }`}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-subtle">
              <span>1/05</span>
              <span>16/05</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
