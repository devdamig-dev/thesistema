import { Plus, Users } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightCard } from "@/components/common/insight-card";
import { employees, laborStats } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";

const ROLE_TONE = {
  Cocina: "warn",
  Caja: "info",
  Encargada: "brand",
  Atención: "ai",
  Delivery: "success",
} as const;

export default function EmpleadosPage() {
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Empleados"
        title="Tu equipo, ordenado."
        description="Turnos, horas, adelantos y costo laboral. La IA cruza esta info con las ventas para detectar oportunidades."
        actions={
          <Button size="sm" variant="primary">
            <Plus className="h-4 w-4" /> Agregar empleado
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Costo laboral mes" value={formatARS(laborStats.costoTotal, { compact: true })} delta={3.1} tone="brand" />
        <KpiCard label="Sobre ventas" value={formatPercent(laborStats.ratio, 0)} delta={1.5} tone="default" hint="Objetivo 25%" />
        <KpiCard label="Activos" value={String(laborStats.empleadosActivos)} />
        <KpiCard label="Adelantos pendientes" value={formatARS(laborStats.adelantosPendientes)} tone="danger" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InsightCard tone="warn" icon="PieChart" title="Costo laboral 27% de las ventas" detail="Dos puntos por encima del objetivo. Revisar turnos de bajo flujo." />
        <InsightCard tone="info" icon="CalendarDays" title="Martes a la noche: baja venta, alta carga" detail="Promedio $186k de costo laboral y $478k de venta los últimos 4 martes." />
        <InsightCard tone="danger" icon="Sparkles" title="Juan acumula 2 adelantos pendientes" detail="Suma $30.000. Vence el día de pago (05/06)." />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Equipo activo
          </CardTitle>
          <Badge tone="default">{employees.length} miembros</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Empleado</th>
                <th className="px-5 py-2.5 font-medium">Rol</th>
                <th className="px-5 py-2.5 font-medium">Turno</th>
                <th className="px-5 py-2.5 text-right font-medium">Horas mes</th>
                <th className="px-5 py-2.5 text-right font-medium">Adelantos</th>
                <th className="px-5 py-2.5 text-right font-medium">Faltas / Tarde</th>
                <th className="px-5 py-2.5 text-right font-medium">Costo mes</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.nombre} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-[11px] font-semibold text-brand-300">
                        {e.nombre.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <span className="font-medium text-ink">{e.nombre}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone={ROLE_TONE[e.rol as keyof typeof ROLE_TONE] ?? "default"}>{e.rol}</Badge>
                  </td>
                  <td className="px-5 py-3 text-ink-muted">{e.turno}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-ink">{e.horasMes}h</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    {e.adelantos > 0 ? (
                      <span className="text-warn-400">{formatARS(e.adelantos)}</span>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-ink-muted">
                    {e.faltas} / {e.tardes}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                    {formatARS(e.costoMes)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
