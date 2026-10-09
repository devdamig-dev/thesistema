"use server";
import { withSalesRevision } from "../../lib/sales/read";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { applyAdminBranchScope } from "@/lib/data/branch-scope";
import { canSeeModule } from "@/lib/permissions";
import { assertPermission } from "@/lib/permissions/server-action";
import { periodRange, readAllSales, summarizeSales, type ReportSale, type SalesPeriod } from "@/app/ventas/reporting";
export type { SalesPeriod } from "@/app/ventas/reporting";
export type SalesPageData = ReturnType<typeof summarizeSales>;
export async function getSalesPageDataAction(period: SalesPeriod = "current_month", branchId: string | null = null): Promise<{ ok: true; data: SalesPageData } | { ok: false; error: string }> {
  try {
    const guard = await assertPermission("sales.view"); if (guard) return { ok: false, error: guard.error };
    const db = await createSupabaseServerClient() as any; const ctx = await getCurrentUserContext();
    if (!db || !ctx.isAuthenticated || !ctx.userId || !ctx.businessId || !canSeeModule(ctx.role, "sales", ctx.enabledModules)) return { ok: false, error: "No se pudo resolver el negocio activo." };
    if (!["current_month", "previous_month", "last_30_days"].includes(period)) return { ok: false, error: "Período inválido." };
    if (branchId && (!/^[0-9a-f-]{36}$/i.test(branchId) || (ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(branchId)))) return { ok: false, error: "Sucursal no disponible para esta sesión." };
    const [business, profile] = await Promise.all([db.from("businesses").select("timezone").eq("id", ctx.businessId).maybeSingle(), db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle()]);
    if (profile.error || profile.data?.active !== true) return { ok: false, error: "La sesión no está habilitada para consultar ventas." };
    if (business.error || typeof business.data?.timezone !== "string") return { ok: false, error: "No pudimos leer la zona horaria del negocio." };
    const range = periodRange(period, business.data.timezone);
    const rows = await withSalesRevision(db,ctx.businessId,()=>readAllSales<ReportSale>((from, to) => {
      let query = db.from("sales").select("id, occurred_at, channel, amount, status, sale_kind", { count: "exact" }).eq("business_id", ctx.businessId).eq("status", "active").gte("occurred_at", range.start).lt("occurred_at", range.end).order("occurred_at").order("id").range(from, to);
      query = applyAdminBranchScope(query, ctx.assignedBranchIds);
      if (branchId) query = query.eq("branch_id", branchId);
      return query;
    }));
    return { ok: true, data: summarizeSales(rows, business.data.timezone) };
  } catch { return { ok: false, error: "No pudimos cargar el informe completo de ventas. Reintentá o elegí otro período." }; }
}
