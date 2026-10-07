import type { ReactNode } from "react";
import { isDatabaseMode } from "@/lib/env";
import { invoices } from "@/lib/data";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { DatabaseInvoicesView, type DatabaseInvoiceRow } from "./database-view";

async function loadAccessibleBranches() {
  const ctx = await getCurrentUserContext();
  const db = await createSupabaseServerClient() as any;
  if (!db || !ctx.businessId) return [];
  if (ctx.assignedBranchIds !== null && ctx.assignedBranchIds.length === 0) return [];

  let query = db
    .from("branches")
    .select("id,name,is_main")
    .eq("business_id", ctx.businessId)
    .order("is_main", { ascending: false })
    .order("name", { ascending: true });
  if (ctx.assignedBranchIds !== null) {
    query = query.in("id", ctx.assignedBranchIds);
  }

  const result = await query;
  if (result.error) {
    console.error("[invoices] accessible branch query failed", result.error);
    return [];
  }
  return ((result.data ?? []) as Array<{ id: string; name: string; is_main: boolean }>).map(
    (branch) => ({ id: branch.id, name: branch.name, isMain: branch.is_main }),
  );
}

export default async function FacturasLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return <>{children}</>;

  const [rows, branches] = await Promise.all([invoices.list(), loadAccessibleBranches()]);
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

  return <DatabaseInvoicesView rows={serialized} branches={branches} />;
}
