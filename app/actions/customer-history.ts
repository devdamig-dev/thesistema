"use server";

import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { canSeeModule, hasPermission } from "@/lib/permissions";
import { getSalesWorkspaceAction } from "@/app/actions/sales";

export type CustomerSaleHistoryRow = {
  id: string; occurredAt: string; amount: string; branch: string;
  source: string | null; status: string; description: string;
};
export type CustomerSalesHistoryResult =
  | { ok: true; customerName: string; timezone: string; rows: CustomerSaleHistoryRow[] }
  | { ok: false; error: string };

/** Reuses the complete, revision-checked, branch-scoped sales read contract. */
export async function getCustomerSalesHistoryAction(id: string): Promise<CustomerSalesHistoryResult> {
  try {
    if (!isDatabaseMode() || typeof id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return { ok: false, error: "Referencia de cliente inválida." };
    const ctx = await getCurrentUserContext();
    if (!ctx.isAuthenticated || !ctx.businessId || !ctx.userId
      || !hasPermission(ctx.role, "customers.view") || !canSeeModule(ctx.role, "customers", ctx.enabledModules)
      || !hasPermission(ctx.role, "sales.view") || !canSeeModule(ctx.role, "sales", ctx.enabledModules)) return { ok: false, error: "No tenés permiso para consultar el historial de ventas de clientes." };
    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, error: "No pudimos conectar con los datos reales." };
    const customer = await db.from("customers").select("id,name").eq("business_id", ctx.businessId).eq("id", id).maybeSingle();
    if (customer.error || !customer.data || customer.data.id !== id || typeof customer.data.name !== "string") return { ok: false, error: "El cliente no está disponible en este negocio." };
    const sales = await getSalesWorkspaceAction();
    if (!sales.ok) return sales;
    if (sales.data.businessId !== ctx.businessId || sales.data.userId !== ctx.userId) return { ok: false, error: "La sesión cambió durante la consulta. Volvé a abrir el historial." };
    return { ok: true, customerName: customer.data.name, timezone: sales.data.timezone,
      rows: sales.data.sales.filter(row => row.customer_id === id).map(row => ({
        id: row.id, occurredAt: row.occurred_at, amount: String(row.amount),
        branch: sales.data.branches.find(branch => branch.id === row.branch_id)?.name ?? "Sucursal no informada",
        source: row.source, status: row.status,
        description: row.items.length ? row.items.map(item => `${item.quantity} × ${item.description}`).join(" · ") : "Registro sin detalle vinculado",
      })) };
  } catch { return { ok: false, error: "No pudimos consultar el historial completo del cliente." }; }
}
