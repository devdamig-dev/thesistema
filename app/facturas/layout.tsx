import type { ReactNode } from "react";
import { isDatabaseMode } from "@/lib/env";
import { invoices } from "@/lib/data";
import { DatabaseInvoicesView, type DatabaseInvoiceRow } from "./database-view";

export default async function FacturasLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return <>{children}</>;

  const rows = await invoices.list();
  const serialized: DatabaseInvoiceRow[] = rows.map((invoice) => ({
    id: invoice.id,
    proveedor: invoice.proveedor,
    tipo: invoice.tipo,
    numero: invoice.numero,
    fecha: invoice.fecha,
    total: Number(invoice.total ?? 0),
    iva: Number(invoice.iva ?? 0),
    status: invoice.status,
    confidence: Number(invoice.confidence ?? 0),
  }));

  return <DatabaseInvoicesView rows={serialized} />;
}
