import type { ReactNode } from "react";
import { Target } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { expenses } from "@/lib/data";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatARS } from "@/lib/format";

const STATUS_TONE = {
  pagado: "success",
  programado: "info",
  pendiente: "warn",
  variable: "default",
  automático: "ai",
} as const;

type BadgeTone = "success" | "info" | "warn" | "default" | "ai";

function expenseTone(status: string): BadgeTone {
  return STATUS_TONE[status as keyof typeof STATUS_TONE] ?? "default";
}

export default async function GastosLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return children;

  const fixedExpenses = await expenses.fixed();
  const totalFijos = fixedExpenses.reduce((sum, expense) => sum + Number(expense.monto ?? 0), 0);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Gastos fijos"
        title="Costos reales del negocio."
        description="En database mode sólo mostramos gastos registrados. Las proyecciones se habilitan cuando exista historial suficiente."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Costos fijos"
          value={formatARS(totalFijos, { compact: true })}
          tone="brand"
          hint="Suma de gastos registrados"
        />
        <KpiCard
          label="Ítems registrados"
          value={String(fixedExpenses.length)}
          hint="Datos reales del negocio"
        />
        <KpiCard
          label="Punto de equilibrio"
          value="—"
          icon={<Target />}
          hint="Pendiente de margen real suficiente"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Detalle de gastos fijos</CardTitle>
          <Badge tone="default">{fixedExpenses.length} ítems</Badge>
        </CardHeader>
        {fixedExpenses.length === 0 ? (
          <CardContent>
            <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">
              Todavía no hay gastos fijos registrados.
            </div>
          </CardContent>
        ) : (
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
                {fixedExpenses.map((expense) => (
                  <tr key={`${expense.nombre}-${expense.vencimiento}`} className="border-b border-line/60 last:border-0">
                    <td className="px-5 py-3 font-medium text-ink">{expense.nombre}</td>
                    <td className="px-5 py-3 text-ink-muted">{expense.vencimiento}</td>
                    <td className="px-5 py-3">
                      <Badge tone={expenseTone(expense.estado)}>{expense.estado}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                      {formatARS(expense.monto)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-bg-elevated/60">
                  <td colSpan={3} className="px-5 py-3 text-right text-xs uppercase tracking-wider text-ink-subtle">
                    Total mensual
                  </td>
                  <td className="px-5 py-3 text-right text-base font-semibold tabular-nums text-brand-300">
                    {formatARS(totalFijos)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <CardContent className="p-6 text-sm text-ink-muted">
          La simulación de punto de equilibrio y el seguimiento de días por encima del objetivo quedan ocultos hasta contar con ventas,
          margen y costos reales suficientes. No usamos el historial demostrativo en un negocio real.
        </CardContent>
      </Card>
    </div>
  );
}
