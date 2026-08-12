"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";

export type ExpenseRow = {
  id: string;
  nombre: string;
  categoria: string;
  monto: number;
  vencimiento: string | null;
  estado: string;
};

export type ExpensesPageData = {
  expenses: ExpenseRow[];
  totalFixed: number;
  totalVariable: number;
  grossMarginPct: number | null;
};

export async function getExpensesPageDataAction(): Promise<
  { ok: true; data: ExpensesPageData } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "Supabase no está disponible." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const monthStart = `${today.slice(0, 7)}-01T00:00:00-03:00`;

  const [expensesRes, purchasesRes, balanceRes] = await Promise.all([
    supabase
      .from("expenses")
      .select("id,name,category,amount,due_date,status")
      .eq("business_id", ctx.businessId)
      .order("due_date", { ascending: true, nullsFirst: false })
      .limit(1000),
    supabase
      .from("purchases")
      .select("total")
      .eq("business_id", ctx.businessId)
      .gte("occurred_at", monthStart)
      .limit(5000),
    supabase
      .from("balance_snapshots")
      .select("gross_margin_pct")
      .eq("business_id", ctx.businessId)
      .order("period_month", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (expensesRes.error) {
    return { ok: false, error: `No se pudieron leer los gastos (${expensesRes.error.code ?? "query_error"}).` };
  }
  if (purchasesRes.error) {
    return { ok: false, error: `No se pudieron leer las compras del mes (${purchasesRes.error.code ?? "query_error"}).` };
  }
  if (balanceRes.error) {
    return { ok: false, error: `No se pudo leer el último balance (${balanceRes.error.code ?? "query_error"}).` };
  }

  const expenses = ((expensesRes.data ?? []) as Array<{
    id: string;
    name: string;
    category: string;
    amount: number | string;
    due_date: string | null;
    status: string;
  }>).map((row) => ({
    id: row.id,
    nombre: row.name,
    categoria: row.category,
    monto: Number(row.amount ?? 0),
    vencimiento: row.due_date,
    estado: row.status,
  }));

  const totalFixed = expenses.reduce((sum, row) => sum + row.monto, 0);
  const totalVariable = ((purchasesRes.data ?? []) as Array<{ total: number | string | null }>).reduce(
    (sum, row) => sum + Number(row.total ?? 0),
    0,
  );
  const balance = balanceRes.data as { gross_margin_pct: number | string | null } | null;
  const grossMarginPct = balance?.gross_margin_pct == null ? null : Number(balance.gross_margin_pct);

  return { ok: true, data: { expenses, totalFixed, totalVariable, grossMarginPct } };
}
