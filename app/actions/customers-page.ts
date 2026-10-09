"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { canSeeModule, hasPermission } from "@/lib/permissions";
import type { CustomerRow } from "@/lib/customers/validation";

export type CustomersPageData = { customers: CustomerRow[]; canManage: boolean; truncated: boolean };
export type CustomersPageResult = { ok: true; data: CustomersPageData } | { ok: false; error: string };
export async function getCustomersPageDataAction(): Promise<CustomersPageResult> {
  if (!isDatabaseMode()) return { ok: false, error: "Los clientes reales sólo están disponibles en database mode." };
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId) return { ok: false, error: "No se pudo resolver la sesión y el negocio activo." };
  if (!hasPermission(ctx.role, "customers.view") || !canSeeModule(ctx.role, "customers", ctx.enabledModules)) return { ok: false, error: "No tenés permiso para ver clientes." };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, error: "Supabase no está disponible." };
  type Row = { id: string; name: string; phone: string | null; email: string | null; channel: string | null; notes: string | null; active: boolean; updated_at: string };
  const rows: Row[] = [];
  let totalCount = 0;
  // PostgREST's server row limit may be 1000. Small explicit ranges avoid silently
  // treating a capped response as the complete directory; count signals our UI cap.
  for (let offset = 0; offset < 2000;) {
    const res = await supabase.from("customers")
      .select("id,name,phone,email,channel,notes,active,updated_at", { count: "exact" })
      .eq("business_id", ctx.businessId).order("name").order("id").range(offset, Math.min(offset + 499, 1999));
    if (res.error) return { ok: false, error: `No se pudieron leer los clientes (${res.error.code ?? "query_error"}). Verificá que esté aplicada la migración de Clientes.` };
    const batch = (res.data ?? []) as Row[];
    rows.push(...batch);
    totalCount = res.count ?? Math.max(totalCount, rows.length + (batch.length === 500 ? 1 : 0));
    offset += batch.length;
    if (batch.length === 0 || (res.count !== null && offset >= totalCount) || (res.count === null && batch.length < 500)) break;
  }
  return { ok: true, data: {
    customers: rows.slice(0, 2000).map(({ updated_at, ...row }) => ({ ...row, updatedAt: updated_at })),
    canManage: hasPermission(ctx.role, "customers.manage"), truncated: totalCount > rows.length,
  } };
}
