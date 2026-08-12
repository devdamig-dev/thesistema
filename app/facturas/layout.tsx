import type { ReactNode } from "react";
import { isDatabaseMode } from "@/lib/env";
import { invoices } from "@/lib/data";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatARS } from "@/lib/format";

export default async function FacturasLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return <>{children}</>;

  const rows = await invoices.list();

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Facturas · Datos reales"
        title="Facturas del negocio"
        description="En producción se muestran únicamente facturas persistidas en Supabase. No usamos comprobantes de demostración."
      />

      {rows.length === 0 ? (
        <Card>
          <CardHeader><CardTitle>Sin facturas registradas</CardTitle></CardHeader>
          <CardContent className="text-sm text-ink-muted">
            Todavía no hay comprobantes reales para este negocio. La carga OCR y las acciones de aprobación se mostrarán acá cuando exista un registro persistido.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((invoice) => (
            <Card key={invoice.id}>
              <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="font-medium text-ink">{invoice.proveedor}</div>
                  <div className="mt-1 text-xs text-ink-muted">Factura {invoice.tipo} · {invoice.numero} · {invoice.fecha}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge tone={invoice.status === "aprobado" ? "success" : "neutral"}>{invoice.status}</Badge>
                  <div className="font-semibold tabular-nums text-ink">{formatARS(invoice.total)}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
