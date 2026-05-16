import { MessageSquareText, Plus, Send, UserSquare2 } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightCard } from "@/components/common/insight-card";
import { customers } from "@/lib/mock-data";
import { formatARS } from "@/lib/format";

export default function ClientesPage() {
  const frecuentes = customers.filter((c) => c.estado === "frecuente").length;
  const inactivos = customers.filter((c) => c.estado === "inactivo").length;
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Clientes"
        title="Quiénes vuelven y quiénes dejaron de volver."
        description="La IA arma campañas por WhatsApp y detecta oportunidades de reactivación con clientes inactivos."
        actions={
          <Button size="sm" variant="primary">
            <Plus className="h-4 w-4" /> Cargar cliente
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Clientes activos" value="148" delta={11.4} tone="brand" />
        <KpiCard label="Frecuentes" value={String(frecuentes)} tone="success" />
        <KpiCard label="Inactivos > 30 días" value={String(inactivos)} tone="warn" />
        <KpiCard label="Ticket promedio" value={formatARS(13_500)} delta={2.4} />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InsightCard tone="success" icon="Sparkles" title="Sofía vuelve cada 11 días" detail="Última visita ayer. Sugerimos enviarle el combo nuevo." />
        <InsightCard tone="warn" icon="CalendarDays" title="Edificio Av. Córdoba 4500 hace 2 días sin pedir" detail="Promediaba 3 pedidos por semana. Buen momento para reactivar." />
        <InsightCard tone="info" icon="Target" title="5 clientes inactivos > 30 días" detail="Campaña sugerida: 'Te extrañamos · 10% off por WhatsApp'." />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserSquare2 className="h-4 w-4" />
            Clientes
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="ai">
              <Send className="h-4 w-4" /> Campaña WhatsApp
            </Button>
          </div>
        </CardHeader>
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
              {customers.map((c) => (
                <tr key={c.nombre} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-ai-500/20 to-brand-500/20 text-[11px] font-semibold text-ai-400">
                        {c.nombre.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                      </div>
                      <span className="font-medium text-ink">{c.nombre}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                      <MessageSquareText className="h-3 w-3" />
                      {c.canal}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums text-ink">{c.visitas}</td>
                  <td className="px-5 py-3 text-ink-muted">{c.ultima}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-ink">{formatARS(c.ticket)}</td>
                  <td className="px-5 py-3">
                    <Badge tone={c.estado === "frecuente" ? "success" : "warn"}>
                      {c.estado}
                    </Badge>
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
