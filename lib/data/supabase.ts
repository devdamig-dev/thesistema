/**
 * Adaptador Supabase.
 *
 * Cada función:
 *   1. Si no hay client (modo demo o env mal configurado) → delega al demo.
 *   2. Hace la query a Supabase con cliente server-side.
 *   3. En database mode, una query vacía devuelve un estado vacío real.
 *      Los datos demo sólo se usan cuando no existe un cliente Supabase.
 *   4. Mapea las filas a la estructura que la UI ya consume.
 *
 * En Sprint 1 cubrimos las entidades ya seedeadas:
 *   - business, products, employees, customers, suppliers, expenses,
 *     recommendations.
 *
 * Inbox, facturas, cierres, marketing, ventas, stock siguen 100% del
 * demo hasta que las migremos en sprints siguientes.
 */

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { localDate } from "@/app/ventas/reporting";
import { getSalesPageDataAction } from "@/app/actions/sales-page";
import type { Database } from "@/lib/supabase/types";
import * as demo from "./demo";
import { applyBranchFilter, getEffectiveBranchIds } from "./branch-filter";
import { getCurrentUserContext } from "./auth";
import {
  mapBusiness,
  mapCustomer,
  mapDailyClosure,
  mapDebt,
  mapEmployee,
  mapExpense,
  mapInboxItem,
  mapInvoice,
  mapProduct,
  mapRecommendation,
  mapStockItem,
  mapSupplier,
} from "./mappers";

type Tables = Database["public"]["Tables"];

const EMPTY_DASHBOARD_KPIS = { ventasHoy: 0, ventasHoyDelta: 0, ventasMes: 0, ventasMesDelta: 0, margenEstimado: 0, margenDelta: 0, costosMes: 0, costosDelta: 0 };
const EMPTY_TODAY_SNAPSHOT = { ventasHoy: 0, tickets: 0, ticketProm: 0, movimientosPendientes: 0, margenHoy: 0, costoHoyPct: 0 };
const EMPTY_SPARKLINES = { ventasHoy: [], ventasMes: [], margen: [], costos: [] };
const EMPTY_BALANCE = { ventasMes: 0, comprasMes: 0, gastosMes: 0, sueldosMes: 0, retirosMes: 0, deudasPendientes: 0, pagosDeudaMes: 0, stockValorizado: 0, cajaEstimada: 0, margenBrutoPct: 0, resultadoOperativo: 0, resultadoNeto: 0 };
const EMPTY_GROWTH_SUMMARY = { clientesActivos: 0, clientesNuevos: 0, tasaRetorno: 0, ticketPromedio: 0 };

// ---------- BUSINESS ----------
export const business = {
  async getCurrent() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.business.getCurrent();

    // 1) Primer business del usuario (RLS filtra a los suyos).
    const memberRes = await supabase
      .from("business_members")
      .select("business_id")
      .limit(1)
      .maybeSingle();
    const member = memberRes.data as Pick<Tables["business_members"]["Row"], "business_id"> | null;
    if (memberRes.error || !member) return null;

    // 2) Detalles del business.
    const bizRes = await supabase
      .from("businesses")
      .select("name, organization_id")
      .eq("id", member.business_id)
      .maybeSingle();
    const biz = bizRes.data as Pick<Tables["businesses"]["Row"], "name" | "organization_id"> | null;
    if (bizRes.error || !biz) return null;

    // 3) Organization (para plan).
    const orgRes = await supabase
      .from("organizations")
      .select("name, plan")
      .eq("id", biz.organization_id)
      .maybeSingle();
    const org = orgRes.data as Pick<Tables["organizations"]["Row"], "name" | "plan"> | null;

    // 4) Sucursal principal.
    const branchRes = await supabase
      .from("branches")
      .select("address")
      .eq("business_id", member.business_id)
      .eq("is_main", true)
      .limit(1)
      .maybeSingle();
    const branch = branchRes.data as Pick<Tables["branches"]["Row"], "address"> | null;

    // 5) Profile del usuario actual.
    const profileRes = await supabase
      .from("profiles")
      .select("full_name")
      .limit(1)
      .maybeSingle();
    const profile = profileRes.data as Pick<Tables["profiles"]["Row"], "full_name"> | null;

    if (!org) return null;

    return mapBusiness(
      { name: org.name, plan: org.plan },
      { name: biz.name },
      branch,
      profile?.full_name ?? "—",
    );
  },
};

// ---------- DASHBOARD (todavía 100% mock) ----------
export const dashboard = {
  async getKpis() { return EMPTY_DASHBOARD_KPIS; },
  async getTodaySnapshot() { return EMPTY_TODAY_SNAPSHOT; },
  async getKpiSparklines() { return EMPTY_SPARKLINES; },
  async getInsights() { return []; },
  async getAttentionItems() { return []; },
  async getOperationalIntelligence() { return []; },
  async getSalesByDay() { return []; },
  async getExpensesByCategory() { return []; },
  async getRecentActivity() { return []; },
};

// ---------- INBOX (Sprint 2 · real) ----------
export const inbox = {
  async list() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.inbox.list();
    const db = supabase as any;

    const ctx = await getCurrentUserContext();
    const branchIds = await getEffectiveBranchIds(db, ctx);

    // 1) Mensajes ordenados por más recientes
    let msgQuery = db
      .from("whatsapp_messages")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(50);
    // Para employees con sucursal asignada, filtramos por branch_id
    // (incluyendo NULL para mensajes "del business" sin sucursal específica)
    // Si no hay restricción, no filtra.
    if (branchIds !== null) {
      // Si hay restricción, mostramos sólo los mensajes con branch en la
      // lista o NULL (mensajes del business).
      const ids = branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"];
      msgQuery = msgQuery.or(
        `branch_id.in.(${ids.join(",")}),branch_id.is.null`,
      );
    }
    const msgRes = await msgQuery;
    const messages = (msgRes.data as Tables["whatsapp_messages"]["Row"][] | null) ?? [];
    if (msgRes.error || messages.length === 0) return [];

    // 2) Extracciones asociadas (un join client-side simple)
    const messageIds = messages.map((m) => m.id);
    const extRes = await db
      .from("ai_extractions")
      .select("*")
      .in("message_id", messageIds);
    const extractions =
      (extRes.data as Tables["ai_extractions"]["Row"][] | null) ?? [];
    const byMessage = new Map(extractions.map((e) => [e.message_id, e]));

    return messages.map((m) => mapInboxItem(m, byMessage.get(m.id) ?? null));
  },
  async getConversation(messageId: string) {
    // Por ahora las conversaciones bidireccionales viven en mock-data.
    // Cuando integremos respuestas reales del copiloto en Sprint 3,
    // las leemos de una nueva tabla `whatsapp_conversation_turns`.
    return await createSupabaseServerClient() ? [] : demo.inbox.getConversation(messageId);
  },
};

// ---------- FACTURAS · DB con branch filtering ----------
export const invoices = {
  async list() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.invoices.list();
    const db = supabase as any;
    const ctx = await getCurrentUserContext();
    const branchIds = await getEffectiveBranchIds(db, ctx);

    let query = db
      .from("invoices")
      .select("*")
      .order("invoice_date", { ascending: false })
      .limit(50);
    if (branchIds !== null) {
      // Aceptamos null branch_id (factura del business sin sucursal específica)
      const ids = branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"];
      query = query.or(`branch_id.in.(${ids.join(",")}),branch_id.is.null`);
    }
    const res = await query;
    const rows = (res.data as Tables["invoices"]["Row"][] | null) ?? [];
    if (res.error || rows.length === 0) return [];

    // Joinear suppliers para nombre legible
    const supplierIds = [...new Set(rows.map((r) => r.supplier_id).filter(Boolean))] as string[];
    let suppliers: Map<string, string> = new Map();
    if (supplierIds.length > 0) {
      const sRes = await db.from("suppliers").select("id, name").in("id", supplierIds);
      const list = (sRes.data as { id: string; name: string }[] | null) ?? [];
      suppliers = new Map(list.map((s) => [s.id, s.name]));
    }

    return rows.map((r) => mapInvoice(r, r.supplier_id ? suppliers.get(r.supplier_id) : null));
  },
};

// ---------- CIERRES · DB con branch filtering ----------
export const closures = {
  async list() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.closures.list();
    const db = supabase as any;
    const ctx = await getCurrentUserContext();
    const branchIds = await getEffectiveBranchIds(db, ctx);

    let query = db
      .from("daily_closures")
      .select("*")
      .order("closure_date", { ascending: false })
      .limit(50);
    if (branchIds !== null) {
      const ids = branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"];
      query = query.or(`branch_id.in.(${ids.join(",")}),branch_id.is.null`);
    }
    const res = await query;
    const rows = (res.data as Tables["daily_closures"]["Row"][] | null) ?? [];
    if (res.error || rows.length === 0) return [];
    return rows.map(mapDailyClosure);
  },
};

// ---------- PRODUCTOS ----------
export const products = {
  async list() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.products.list();
    const res = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("category")
      .order("name");
    const rows = res.data as Tables["products"]["Row"][] | null;
    if (res.error || !rows?.length) return [];
    return rows.map(mapProduct);
  },
  async getRecipe(name: string) { return await createSupabaseServerClient() ? [] : demo.products.getRecipe(name); },
  async getCostHistory(name: string) { return await createSupabaseServerClient() ? undefined : demo.products.getCostHistory(name); },
  async getRecommendations(name: string) { return await createSupabaseServerClient() ? [] : demo.products.getRecommendations(name); },
  async getCostingAlerts() { return await createSupabaseServerClient() ? [] : demo.products.getCostingAlerts(); },
  async getIngredientCostHistory() { return await createSupabaseServerClient() ? [] : demo.products.getIngredientCostHistory(); },
};

// ---------- VENTAS · DB con branch filtering ----------
async function loadSalesReport() {
  const result = await getSalesPageDataAction("last_30_days");
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
export const sales = {
  async byChannel() { return (await loadSalesReport()).salesByChannel; },
  async daily() { return (await loadSalesReport()).dailySalesTable; },
  async byDay() { return (await loadSalesReport()).salesByDay; },
};

// ---------- COMPRAS ----------
export const purchases = {
  async list() {
    return await createSupabaseServerClient() ? [] : demo.purchases.list();
  },
  async topSuppliers() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.purchases.topSuppliers();
    const res = await supabase.from("suppliers").select("*").order("name");
    const rows = res.data as Tables["suppliers"]["Row"][] | null;
    if (res.error || !rows?.length) return [];
    return rows.map(mapSupplier);
  },
};

// ---------- GASTOS ----------
export const expenses = {
  async fixed() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.expenses.fixed();
    const res = await supabase
      .from("expenses")
      .select("*")
      .order("amount", { ascending: false });
    const rows = res.data as Tables["expenses"]["Row"][] | null;
    if (res.error || !rows?.length) return [];
    return rows.map(mapExpense);
  },
  async breakEven() {
    if (!await createSupabaseServerClient()) return demo.expenses.breakEven();
    return { costosFijos: 0, margenContribucion: 0, puntoEquilibrio: 0, ventaActual: 0 };
  },
};

// ---------- STOCK · DB con branch filtering ----------
export const stock = {
  async list() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.stock.list();
    const db = supabase as any;
    const ctx = await getCurrentUserContext();
    const branchIds = await getEffectiveBranchIds(db, ctx);

    let query = db.from("stock_items").select("*");
    if (branchIds !== null) {
      const ids = branchIds.length ? branchIds : ["00000000-0000-0000-0000-000000000000"];
      query = query.in("branch_id", ids);
    }
    const res = await query;
    const rows = (res.data as Tables["stock_items"]["Row"][] | null) ?? [];
    if (res.error || rows.length === 0) return [];

    // Joinear ingredients para nombre y unidad
    const ingIds = [...new Set(rows.map((r) => r.ingredient_id))];
    const ingRes = await db
      .from("ingredients")
      .select("id, name, unit")
      .in("id", ingIds);
    const ingredients = new Map<string, { name: string; unit: string }>(
      ((ingRes.data as { id: string; name: string; unit: string }[] | null) ?? []).map(
        (i) => [i.id, { name: i.name, unit: i.unit }],
      ),
    );

    return rows
      .map((r) => {
        const ing = ingredients.get(r.ingredient_id);
        if (!ing) return null;
        return mapStockItem(r, ing.name, ing.unit);
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  },
};

// ---------- EMPLEADOS ----------
export const employees = {
  async list() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.employees.list();
    const res = await supabase
      .from("employees")
      .select("*")
      .eq("active", true)
      .order("full_name");
    const rows = res.data as Tables["employees"]["Row"][] | null;
    if (res.error || !rows?.length) return [];
    return rows.map(mapEmployee);
  },
  async laborStats() { return await createSupabaseServerClient() ? [] : demo.employees.laborStats(); },
  async weeklyShifts() { return await createSupabaseServerClient() ? [] : demo.employees.weeklyShifts(); },
  async alerts() { return await createSupabaseServerClient() ? [] : demo.employees.alerts(); },
  async laborByDay() { return await createSupabaseServerClient() ? [] : demo.employees.laborByDay(); },
};

// ---------- CLIENTES ----------
export const customers = {
  async list() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.customers.list();
    const res = await supabase
      .from("customers")
      .select("*")
      .order("total_spend", { ascending: false });
    const rows = res.data as Tables["customers"]["Row"][] | null;
    if (res.error || !rows?.length) return [];
    return rows.map(mapCustomer);
  },
};

// ---------- MARKETING (sprint próximo: tabla campaigns ya existe) ----------
export const marketing = {
  async summary() { return await createSupabaseServerClient() ? EMPTY_GROWTH_SUMMARY : demo.marketing.summary(); },
  async insights() { return await createSupabaseServerClient() ? [] : demo.marketing.insights(); },
  async campaigns() { return await createSupabaseServerClient() ? [] : demo.marketing.campaigns(); },
  async audiences() { return await createSupabaseServerClient() ? [] : demo.marketing.audiences(); },
  async bestHours() { return await createSupabaseServerClient() ? [] : demo.marketing.bestHours(); },
  async copies() { return await createSupabaseServerClient() ? [] : demo.marketing.copies(); },
};

// ---------- DEUDAS (Sprint 3 · real con fallback) ----------
export const debts = {
  async list() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.debts.list();
    const db = supabase as any;
    const dRes = await db
      .from("debts")
      .select("*")
      .order("status")
      .order("due_date", { ascending: true, nullsFirst: false });
    const rows = dRes.data as Tables["debts"]["Row"][] | null;
    if (dRes.error || !rows?.length) return [];

    const payRes = await db
      .from("debt_payments")
      .select("*")
      .in(
        "debt_id",
        rows.map((d) => d.id),
      )
      .order("paid_at", { ascending: false });
    const payments =
      (payRes.data as Tables["debt_payments"]["Row"][] | null) ?? [];
    const byDebt = new Map<string, Tables["debt_payments"]["Row"][]>();
    payments.forEach((p) => {
      const arr = byDebt.get(p.debt_id) ?? [];
      arr.push(p);
      byDebt.set(p.debt_id, arr);
    });
    return rows.map((d) => mapDebt(d, byDebt.get(d.id) ?? []));
  },
  async kpis() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.debts.kpis();
    const db = supabase as any;
    const res = await db
      .from("debts")
      .select("pending_amount, status, due_date, creditor")
      .neq("status", "settled");
    const rows = res.data as
      | Pick<Tables["debts"]["Row"], "pending_amount" | "status" | "due_date" | "creditor">[]
      | null;
    if (res.error || !rows?.length) return { totalDeuda: 0, vencidas: 0, proximoVencimiento: "—", impactoMensual: 0 };
    const total = rows.reduce((s, r) => s + Number(r.pending_amount), 0);
    const overdue = rows
      .filter((r) => r.status === "overdue")
      .reduce((s, r) => s + Number(r.pending_amount), 0);
    const next = rows
      .filter((r) => r.due_date)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1))[0];
    return {
      totalDeuda: total,
      vencidas: overdue,
      proximoVencimiento: next
        ? `${new Date(next.due_date!).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" })} · ${next.creditor}`
        : "—",
      impactoMensual: Math.round(total / 6), // proxy simple: 6 cuotas
    };
  },
};

// ---------- BALANCES (Sprint 3 · sigue demo, snapshots opcionales) ----------
export const balances = {
  async snapshot() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.balances.snapshot();
    const db = supabase as any;
    const ctx=await getCurrentUserContext();
    if (!ctx.isAuthenticated || !ctx.businessId) throw new Error("balance_scope_unavailable");
    const business=await db.from("businesses").select("timezone").eq("id",ctx.businessId).maybeSingle();
    if (business.error || !business.data?.timezone) throw new Error("balance_timezone_unavailable");
    const isoMonth = `${localDate(new Date(),business.data.timezone).slice(0,7)}-01`;
    const res = await db
      .from("balance_snapshots")
      .select("*")
      .eq("business_id",ctx.businessId)
      .eq("period_month", isoMonth)
      .maybeSingle();
    const row = res.data as Tables["balance_snapshots"]["Row"] | null;
    if (res.error) throw new Error("balance_read_failed");
    if (row?.sales_data_stale) throw new Error("balance_sales_snapshot_stale");
    if (!row) return EMPTY_BALANCE;
    return {
      ventasMes: Number(row.sales_total),
      comprasMes: Number(row.purchases_total),
      gastosMes: Number(row.expenses_total),
      sueldosMes: Number(row.payroll_total),
      retirosMes: Number(row.withdrawals_total),
      deudasPendientes: Number(row.debts_pending),
      pagosDeudaMes: Number(row.debt_payments_total),
      stockValorizado: Number(row.stock_valued),
      cajaEstimada: Number(row.cash_estimated),
      margenBrutoPct: row.gross_margin_pct != null ? Number(row.gross_margin_pct) : 0,
      resultadoOperativo: row.operating_result != null ? Number(row.operating_result) : 0,
      resultadoNeto: row.net_result != null ? Number(row.net_result) : 0,
    };
  },
  async monthly() { return await createSupabaseServerClient() ? [] : demo.balances.monthly(); },
  async recommendations() { return await createSupabaseServerClient() ? [] : demo.balances.recommendations(); },
};

// ---------- REPORTES — recomendaciones IA reales si hay seed ----------
export const reports = {
  async insights() { return await createSupabaseServerClient() ? [] : demo.reports.insights(); },
  async suggestions() { return await createSupabaseServerClient() ? [] : demo.reports.suggestions(); },
  async weeklyDecisions() {
    const supabase = await createSupabaseServerClient();
    if (!supabase) return demo.reports.weeklyDecisions();
    const res = await supabase
      .from("ai_recommendations")
      .select("*")
      .eq("status", "open")
      .order("priority")
      .order("estimated_impact", { ascending: false });
    const rows = res.data as Tables["ai_recommendations"]["Row"][] | null;
    if (res.error || !rows?.length) return [];
    return rows.map(mapRecommendation);
  },
};
