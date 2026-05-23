/**
 * Adaptador Supabase.
 *
 * Cada función:
 *   1. Si no hay client (modo demo o env mal configurado) → delega al demo.
 *   2. Hace la query a Supabase con cliente server-side.
 *   3. Si la query falla o devuelve vacío → delega al demo como fallback.
 *      (Así la UI nunca queda en blanco en una demo recién seedeada o
 *       con tablas todavía vacías para algunos módulos.)
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
import type { Database } from "@/lib/supabase/types";
import * as demo from "./demo";
import {
  mapBusiness,
  mapCustomer,
  mapDebt,
  mapEmployee,
  mapExpense,
  mapInboxItem,
  mapProduct,
  mapRecommendation,
  mapSupplier,
} from "./mappers";

type Tables = Database["public"]["Tables"];

// ---------- BUSINESS ----------
export const business = {
  async getCurrent() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.business.getCurrent();

    // 1) Primer business del usuario (RLS filtra a los suyos).
    const memberRes = await supabase
      .from("business_members")
      .select("business_id")
      .limit(1)
      .maybeSingle();
    const member = memberRes.data as Pick<Tables["business_members"]["Row"], "business_id"> | null;
    if (memberRes.error || !member) return demo.business.getCurrent();

    // 2) Detalles del business.
    const bizRes = await supabase
      .from("businesses")
      .select("name, organization_id")
      .eq("id", member.business_id)
      .maybeSingle();
    const biz = bizRes.data as Pick<Tables["businesses"]["Row"], "name" | "organization_id"> | null;
    if (bizRes.error || !biz) return demo.business.getCurrent();

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

    if (!org) return demo.business.getCurrent();

    return mapBusiness(
      { name: org.name, plan: org.plan },
      { name: biz.name },
      branch,
      profile?.full_name ?? "—",
    );
  },
};

// ---------- DASHBOARD (todavía 100% mock) ----------
export const dashboard = demo.dashboard;

// ---------- INBOX (Sprint 2 · real) ----------
export const inbox = {
  async list() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.inbox.list();
    const db = supabase as any;

    // 1) Mensajes ordenados por más recientes
    const msgRes = await db
      .from("whatsapp_messages")
      .select("*")
      .order("received_at", { ascending: false })
      .limit(50);
    const messages = (msgRes.data as Tables["whatsapp_messages"]["Row"][] | null) ?? [];
    if (msgRes.error || messages.length === 0) return demo.inbox.list();

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
    return demo.inbox.getConversation(messageId);
  },
};

// ---------- FACTURAS (sprint próximo) ----------
export const invoices = demo.invoices;

// ---------- CIERRES (sprint próximo) ----------
export const closures = demo.closures;

// ---------- PRODUCTOS ----------
export const products = {
  async list() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.products.list();
    const res = await supabase
      .from("products")
      .select("*")
      .eq("active", true)
      .order("category")
      .order("name");
    const rows = res.data as Tables["products"]["Row"][] | null;
    if (res.error || !rows?.length) return demo.products.list();
    return rows.map(mapProduct);
  },
  getRecipe: demo.products.getRecipe,
  getCostHistory: demo.products.getCostHistory,
  getRecommendations: demo.products.getRecommendations,
  getCostingAlerts: demo.products.getCostingAlerts,
  getIngredientCostHistory: demo.products.getIngredientCostHistory,
};

// ---------- VENTAS (todavía mock; las agregaciones requieren sprint) ----------
export const sales = demo.sales;

// ---------- COMPRAS ----------
export const purchases = {
  async list() {
    return demo.purchases.list();
  },
  async topSuppliers() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.purchases.topSuppliers();
    const res = await supabase.from("suppliers").select("*").order("name");
    const rows = res.data as Tables["suppliers"]["Row"][] | null;
    if (res.error || !rows?.length) return demo.purchases.topSuppliers();
    return rows.map(mapSupplier);
  },
};

// ---------- GASTOS ----------
export const expenses = {
  async fixed() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.expenses.fixed();
    const res = await supabase
      .from("expenses")
      .select("*")
      .order("amount", { ascending: false });
    const rows = res.data as Tables["expenses"]["Row"][] | null;
    if (res.error || !rows?.length) return demo.expenses.fixed();
    return rows.map(mapExpense);
  },
  breakEven: demo.expenses.breakEven,
};

// ---------- STOCK ----------
export const stock = demo.stock;

// ---------- EMPLEADOS ----------
export const employees = {
  async list() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.employees.list();
    const res = await supabase
      .from("employees")
      .select("*")
      .eq("active", true)
      .order("full_name");
    const rows = res.data as Tables["employees"]["Row"][] | null;
    if (res.error || !rows?.length) return demo.employees.list();
    return rows.map(mapEmployee);
  },
  laborStats: demo.employees.laborStats,
  weeklyShifts: demo.employees.weeklyShifts,
  alerts: demo.employees.alerts,
  laborByDay: demo.employees.laborByDay,
};

// ---------- CLIENTES ----------
export const customers = {
  async list() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.customers.list();
    const res = await supabase
      .from("customers")
      .select("*")
      .order("total_spend", { ascending: false });
    const rows = res.data as Tables["customers"]["Row"][] | null;
    if (res.error || !rows?.length) return demo.customers.list();
    return rows.map(mapCustomer);
  },
};

// ---------- MARKETING (sprint próximo: tabla campaigns ya existe) ----------
export const marketing = demo.marketing;

// ---------- DEUDAS (Sprint 3 · real con fallback) ----------
export const debts = {
  async list() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.debts.list();
    const db = supabase as any;
    const dRes = await db
      .from("debts")
      .select("*")
      .order("status")
      .order("due_date", { ascending: true, nullsFirst: false });
    const rows = dRes.data as Tables["debts"]["Row"][] | null;
    if (dRes.error || !rows?.length) return demo.debts.list();

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
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.debts.kpis();
    const db = supabase as any;
    const res = await db
      .from("debts")
      .select("pending_amount, status, due_date, creditor")
      .neq("status", "settled");
    const rows = res.data as
      | Pick<Tables["debts"]["Row"], "pending_amount" | "status" | "due_date" | "creditor">[]
      | null;
    if (res.error || !rows?.length) return demo.debts.kpis();
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
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.balances.snapshot();
    const db = supabase as any;
    // Si hay snapshot del mes en curso, usarlo. Si no, fallback demo.
    const monthStart = new Date();
    monthStart.setDate(1);
    const isoMonth = monthStart.toISOString().slice(0, 10);
    const res = await db
      .from("balance_snapshots")
      .select("*")
      .eq("period_month", isoMonth)
      .maybeSingle();
    const row = res.data as Tables["balance_snapshots"]["Row"] | null;
    if (!row) return demo.balances.snapshot();
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
  monthly: demo.balances.monthly,
  recommendations: demo.balances.recommendations,
};

// ---------- REPORTES — recomendaciones IA reales si hay seed ----------
export const reports = {
  insights: demo.reports.insights,
  suggestions: demo.reports.suggestions,
  async weeklyDecisions() {
    const supabase = createSupabaseServerClient();
    if (!supabase) return demo.reports.weeklyDecisions();
    const res = await supabase
      .from("ai_recommendations")
      .select("*")
      .eq("status", "open")
      .order("priority")
      .order("estimated_impact", { ascending: false });
    const rows = res.data as Tables["ai_recommendations"]["Row"][] | null;
    if (res.error || !rows?.length) return demo.reports.weeklyDecisions();
    return rows.map(mapRecommendation);
  },
};
