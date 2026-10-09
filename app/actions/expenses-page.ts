"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { canSeeModule, hasPermission } from "@/lib/permissions";
import { mutateExpense } from "@/lib/expenses/service";
import { readExpenseRevision, readExpenseRows } from "@/lib/expenses/read";
import { EXPENSE_UUID } from "@/lib/expenses/validation";
import type { ChangeExpenseStateInput, ExpenseMutation, ExpenseResult, SaveExpenseInput } from "@/lib/expenses/types";
export type ExpenseInput = SaveExpenseInput;
export type ExpenseRow = {
  id: string; nombre: string; categoria: string; monto: number; amount: string; vencimiento: string | null;
  estado: string; sucursal: string; branchId: string; version: number; recordStatus: "active" | "voided";
  source: string | null; voidReason: string | null;
};
export type ExpenseBranch = { id: string; name: string };
export type ExpensesPageData = {
  expenses: ExpenseRow[]; totalFixed: number; totalVariable: number; grossMarginPct: number | null;
  branches: ExpenseBranch[]; businessId: string; userId: string; canManage: boolean;
};

async function context(permission: "expenses.view" | "expenses.create") {
  if (!isDatabaseMode()) throw new Error("Esta acción requiere un negocio activo.");
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId || !ctx.userId || !hasPermission(ctx.role, permission) || !canSeeModule(ctx.role, "fixed_expenses", ctx.enabledModules)) throw new Error("La sesión no está habilitada para consultar o gestionar gastos.");
  const db = await createSupabaseServerClient() as any;
  if (!db) throw new Error("No pudimos conectar con tus datos.");
  const profile = await db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle();
  if (profile.error || profile.data?.active !== true) throw new Error("Tu perfil no está activo.");
  return { db, ctx, businessId: ctx.businessId, userId: ctx.userId };
}

export async function getExpensesPageDataAction(): Promise<{ ok: true; data: ExpensesPageData } | { ok: false; error: string }> {
  try {
    const { db, ctx, businessId, userId } = await context("expenses.view");
    const before = await readExpenseRevision(db, businessId);
    const business = await db.from("businesses").select("timezone").eq("id", businessId).maybeSingle();
    if (business.error || !business.data?.timezone) throw new Error("No pudimos leer la zona horaria del negocio.");
    const today = new Date().toLocaleDateString("en-CA", { timeZone: business.data.timezone });
    const monthStart = `${today.slice(0, 7)}-01`;
    const scope = (query: any) => ctx.assignedBranchIds === null ? query : query.in("branch_id", ctx.assignedBranchIds.length ? ctx.assignedBranchIds : ["00000000-0000-0000-0000-000000000000"]);
    let branchesQuery = db.from("branches").select("id,name").eq("business_id", businessId).order("is_main", { ascending: false }).order("created_at");
    if (ctx.assignedBranchIds !== null) branchesQuery = branchesQuery.in("id", ctx.assignedBranchIds.length ? ctx.assignedBranchIds : ["00000000-0000-0000-0000-000000000000"]);
    const [rows, purchases, balance, branches] = await Promise.all([
      readExpenseRows<any>((from, to) => scope(db.from("expenses").select("id,name,category,amount::text,due_date,status,branch_id,version,record_status,source,void_reason,branches(name)", { count: "exact" }).eq("business_id", businessId).order("id").range(from, to))),
      readExpenseRows<{ total: string | number | null }>((from, to) => scope(db.from("purchases").select("id,total", { count: "exact" }).eq("business_id", businessId).eq("record_status", "active").gte("purchased_at", monthStart).order("id").range(from, to))),
      ctx.assignedBranchIds === null ? db.from("balance_snapshots").select("gross_margin_pct,sales_data_stale,expenses_data_stale,purchases_data_stale,payroll_data_stale").eq("business_id", businessId).order("period_month", { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null, error: null }),
      branchesQuery,
    ]);
    if (balance.error || branches.error) throw new Error("No pudimos cargar el balance o las sucursales.");
    if (await readExpenseRevision(db, businessId) !== before) throw new Error("Los gastos cambiaron durante la lectura. Volvé a cargar.");
    const expenses: ExpenseRow[] = rows.map((row) => ({ id: row.id, nombre: row.name, categoria: row.category, monto: Number(row.amount), amount: String(row.amount), vencimiento: row.due_date, estado: row.status, sucursal: row.branches?.name ?? "Sucursal", branchId: row.branch_id, version: row.version, recordStatus: row.record_status, source: row.source, voidReason: row.void_reason }));
    const totalFixed = expenses.filter((row) => row.recordStatus === "active").reduce((sum, row) => sum + row.monto, 0);
    const totalVariable = purchases.reduce((sum, row) => sum + Number(row.total ?? 0), 0);
    const grossMarginPct = balance.data?.sales_data_stale || balance.data?.expenses_data_stale || balance.data?.purchases_data_stale || balance.data?.payroll_data_stale || balance.data?.gross_margin_pct == null ? null : Number(balance.data.gross_margin_pct);
    return { ok: true, data: { expenses, totalFixed, totalVariable, grossMarginPct, branches: branches.data ?? [], businessId, userId, canManage: hasPermission(ctx.role, "expenses.create") } };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No pudimos cargar los gastos." }; }
}

async function mutation(operation: "save" | "void" | "restore", input: unknown): Promise<ExpenseResult> {
  let current: Awaited<ReturnType<typeof context>>;
  try { current = await context("expenses.create"); }
  catch (error) { return { ok: false, persisted: false, error: error instanceof Error ? error.message : "No pudimos validar la sesión." }; }
  const result = await mutateExpense(current.db, { businessId: current.businessId, userId: current.userId, source: "manual" }, operation, input);
  if (result.ok) {
    // Cache invalidation cannot turn a committed receipt into a failure.
    for (const path of ["/gastos", "/auditoria", "/balances", "/dashboard"]) { try { revalidatePath(path); } catch { /* Refresh recovers current DB state. */ } }
  }
  return result;
}
export async function createExpenseAction(input: SaveExpenseInput): Promise<ExpenseResult> {
  if (input?.id !== null || input?.expectedVersion !== null) return { ok: false, persisted: false, error: "El alta no puede editar un gasto existente." };
  return mutation("save", input);
}
export async function saveExpenseAction(input: SaveExpenseInput): Promise<ExpenseResult> { return mutation("save", input); }
export async function voidExpenseAction(input: ChangeExpenseStateInput): Promise<ExpenseResult> { return mutation("void", input); }
export async function restoreExpenseAction(input: ChangeExpenseStateInput): Promise<ExpenseResult> { return mutation("restore", input); }
export async function getExpenseHistoryAction(id: string): Promise<{ ok: true; history: ExpenseMutation[] } | { ok: false; error: string }> {
  try {
    if (typeof id !== "string" || !EXPENSE_UUID.test(id)) throw new Error("Referencia de gasto inválida.");
    const { db, businessId } = await context("expenses.view");
    const history = await readExpenseRows<ExpenseMutation>((from, to) => db.from("expense_mutations").select("request_id,source,operation,actor_role,created_at,before_snapshot,after_snapshot,payload", { count: "exact" }).eq("business_id", businessId).eq("expense_id", id).order("created_at", { ascending: false }).order("request_id").range(from, to));
    return { ok: true, history };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No pudimos leer el historial." }; }
}
