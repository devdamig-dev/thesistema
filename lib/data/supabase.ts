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
  mapEmployee,
  mapExpense,
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

// ---------- INBOX (sprint próximo) ----------
export const inbox = demo.inbox;

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
