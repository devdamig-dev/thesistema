"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { withPermission } from "@/lib/permissions/server-action";
import { logActivity } from "@/lib/data/activity";

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

export type ExpenseInput = {
  name: string;
  category: string;
  amount: number;
  dueDate: string | null;
  status: "pending" | "scheduled" | "paid";
};

type ExpenseMutationResult =
  | { ok: true; persisted: true; expenseId: string }
  | { ok: false; persisted: false; error: string };

export async function getExpensesPageDataAction(): Promise<
  { ok: true; data: ExpensesPageData } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "No pudimos conectar con tus datos." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const monthStart = `${today.slice(0, 7)}-01`;

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
      .gte("purchased_at", monthStart)
      .limit(5000),
    supabase
      .from("balance_snapshots")
      .select("gross_margin_pct")
      .eq("business_id", ctx.businessId)
      .order("period_month", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (expensesRes.error) return { ok: false, error: "No pudimos cargar los gastos." };
  if (purchasesRes.error) return { ok: false, error: "No pudimos cargar las compras del mes." };
  if (balanceRes.error) return { ok: false, error: "No pudimos cargar el último balance." };

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

function validateExpense(input: ExpenseInput): string | null {
  if (!input.name.trim()) return "Ingresá el concepto del gasto.";
  if (!input.category.trim()) return "Ingresá una categoría.";
  if (!Number.isFinite(Number(input.amount)) || Number(input.amount) <= 0) return "Ingresá un monto mayor a cero.";
  if (input.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate)) return "Ingresá una fecha de vencimiento válida.";
  if (!["pending", "scheduled", "paid"].includes(input.status)) return "Elegí un estado válido.";
  return null;
}

export const createExpenseAction = withPermission<[ExpenseInput], ExpenseMutationResult>(
  "expenses.create",
  async (ctx, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };

    const validation = validateExpense(input);
    if (validation) return { ok: false, persisted: false, error: validation };

    const db = createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus datos." };

    const res = await db
      .from("expenses")
      .insert({
        business_id: ctx.businessId,
        name: input.name.trim(),
        category: input.category.trim(),
        amount: Number(input.amount),
        due_date: input.dueDate || null,
        status: input.status,
      })
      .select("id")
      .maybeSingle();

    if (res.error || !res.data?.id) {
      return { ok: false, persisted: false, error: "No pudimos registrar el gasto." };
    }

    await logActivity({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorName: ctx.fullName,
      actorRole: ctx.role,
      action: "expense.created",
      targetType: "expenses",
      targetId: res.data.id,
      summary: `Gasto fijo registrado · ${input.name.trim()}`,
      data: {
        category: input.category.trim(),
        amount: Number(input.amount),
        due_date: input.dueDate || null,
        status: input.status,
      },
    });

    revalidatePath("/gastos");
    revalidatePath("/auditoria");
    return { ok: true, persisted: true, expenseId: res.data.id };
  },
);