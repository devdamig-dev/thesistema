import type { ReactNode } from "react";
import { UserSquare2 } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { customers } from "@/lib/data";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatARS } from "@/lib/format";

export default async function ClientesLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return children;

  const items = await customers.list();
  const frequent = items.filter((customer) => customer.estado === "frecuente").length;
  const inactive = items.filter((customer) => customer.estado === "inactivo").length;
  const avgTicket = items.length
    ? Math.round(items.reduce((sum, customer) => sum + Number(customer.ticket ?? 0), 0) / items.length)
    : 0;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Clientes"
        title="Clientes reales del negocio."
        description="En database mode sólo mostramos clientes y métricas registradas. Los insights y campañas se habilitan cuando exista historial suficiente."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Clientes registrados" value={String(items.length)} tone="brand" />
        <KpiCard label="Frecuentes" value={String(frequent)} tone="success" />
        <KpiCard label="Inactivos" value={String(inactive)} tone="warn" />
        <KpiCard label="Ticket promedio" value={formatARS(avgTicket)} hint={items.length ? "Promedio registrado" : "Sin datos todavía"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserSquare2 className="h-4 w-4" /> Clientes
          </CardTitle>
          <Badge tone="default">{items.length} registrados</Badge>
        </CardHeader>
        {items.length === 0 ? (
          <CardContent>
            <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">
              Todavía no hay clientes registrados. No mostramos clientes de ejemplo en un negocio real.
            </div>
          </CardContent>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Cliente</th>
                  <th className="px-5 py-2.5 font-medium">Canal</th>
                  <th className="px-5 py-2.5 text-right font-medium">Visitas</th>
                  <th className="px-5 py-2.5 font-medium">Última compra</th>
                  <th className="px-5 py-2.5 text-right font-medium">Ticket prom.</th>
                  <th className="px-5 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((customer) => (
                  <tr key={`${customer.nombre}-${customer.canal}`} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                    <td className="px-5 py-3 font-medium text-ink">{customer.nombre}</td>
                    <td className="px-5 py-3 text-ink-muted">{customer.canal}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink">{customer.visitas}</td>
                    <td className="px-5 py-3 text-ink-muted">{customer.ultima}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink">{formatARS(customer.ticket)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={customer.estado === "frecuente" ? "success" : customer.estado === "inactivo" ? "warn" : "default"}>
                        {customer.estado}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
