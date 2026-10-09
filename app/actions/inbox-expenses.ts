"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission, canSeeModule } from "@/lib/permissions";
import { parseInboxExpenseApproval, type InboxExpenseReview } from "@/lib/expenses/inbox";
import { expenseRpcResult } from "@/lib/expenses/service";
import { readExpenseRows } from "@/lib/expenses/read";
import { EXPENSE_UUID } from "@/lib/expenses/validation";
import type { ExpenseResult } from "@/lib/expenses/types";

async function session() {
  if (!isDatabaseMode()) throw new Error("Esta revisión requiere un negocio activo.");
  const ctx = await getCurrentUserContext(); const db = await createSupabaseServerClient() as any;
  if (!db || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId || !hasPermission(ctx.role, "inbox.approve") || !canSeeModule(ctx.role, "inbox_ai", ctx.enabledModules)) throw new Error("No tenés permiso para revisar este registro.");
  return { db, ctx, businessId: ctx.businessId, userId: ctx.userId };
}
export async function getInboxExpenseReviewAction(extractionId: string): Promise<{ ok: true; review: InboxExpenseReview } | { ok: false; error: string }> {
  try {
    if (typeof extractionId !== "string" || !EXPENSE_UUID.test(extractionId)) throw new Error("Extracción inválida.");
    const { db, ctx, businessId, userId } = await session();
    const result = await db.from("ai_extractions").select("id,business_id,branch_id,message_id,type,fields,status").eq("id", extractionId).maybeSingle();
    if (result.error || !result.data) throw new Error("Extracción no disponible.");
    const e = result.data;
    if (e.type !== "expense") return { ok: false, error: "unsupported_expense_extraction" };
    if (!hasPermission(ctx.role, "expenses.create") || !canSeeModule(ctx.role, "fixed_expenses", ctx.enabledModules)) throw new Error("No tenés permiso para registrar gastos.");
    if (!["pending", "needs_review", "failed"].includes(e.status)) throw new Error("La extracción ya está cerrada. Revisá el registro en Gastos antes de crear otro.");
    const [message, profile] = await Promise.all([db.from("whatsapp_messages").select("business_id,branch_id").eq("id", e.message_id).maybeSingle(), db.from("profiles").select("active").eq("id", userId).maybeSingle()]);
    if (message.error || message.data?.business_id !== businessId || e.business_id && e.business_id !== businessId || profile.error || profile.data?.active !== true) throw new Error("No pudimos verificar el contexto del gasto.");
    const branchId = e.branch_id ?? message.data.branch_id ?? null;
    if (e.branch_id && message.data.branch_id && e.branch_id !== message.data.branch_id || branchId && ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(branchId)) throw new Error("Sucursal no autorizada.");
    const branches = await readExpenseRows<{ id: string; name: string }>((from, to) => {
      let query = db.from("branches").select("id,name", { count: "exact" }).eq("business_id", businessId).order("id").range(from, to);
      if (ctx.assignedBranchIds !== null) query = query.in("id", ctx.assignedBranchIds.length ? ctx.assignedBranchIds : ["00000000-0000-0000-0000-000000000000"]);
      return query;
    });
    const suppliers = await readExpenseRows<{ id: string; name: string; active: boolean }>((from, to) => db.from("suppliers").select("id,name,active", { count: "exact" }).eq("business_id", businessId).eq("active", true).order("id").range(from, to));
    if (branchId && !branches.some((branch) => branch.id === branchId)) throw new Error("La sucursal de origen no está disponible.");
    const fields = e.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("La extracción necesita una revisión válida.");
    return { ok: true, review: { extractionId, businessId, userId, branchId, branches, suppliers, expectedFields: fields, name: typeof fields.concept === "string" ? fields.concept : "", category: typeof fields.category === "string" ? fields.category : "", amount: typeof fields.amount === "number" && Number.isFinite(fields.amount) || typeof fields.amount === "string" ? String(fields.amount) : "", dueDate: typeof fields.due_date === "string" ? fields.due_date : null } };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No pudimos leer la revisión." }; }
}
export async function approveInboxExpenseAction(input: unknown): Promise<ExpenseResult> {
  let parsed; let current: Awaited<ReturnType<typeof session>>;
  try {
    parsed = parseInboxExpenseApproval(input); current = await session();
    if (parsed.businessId !== current.businessId || parsed.userId !== current.userId || !hasPermission(current.ctx.role, "expenses.create") || !canSeeModule(current.ctx.role, "fixed_expenses", current.ctx.enabledModules)) throw new Error("Cambió la sesión, el negocio o los permisos. Revisá el intento antes de continuar.");
  } catch (error) { return { ok: false, persisted: false, error: error instanceof Error ? error.message : "Datos inválidos." }; }
  let result: ExpenseResult;
  try { result = expenseRpcResult(await current.db.rpc("approve_expense_extraction_atomic", { p_business_id: current.businessId, p_actor_id: current.userId, p_extraction_id: parsed.extractionId, p_expected_fields: parsed.expectedFields, p_review: parsed.review })); }
  catch { result = { ok: false, persisted: "unknown", error: "La conexión se interrumpió. El gasto podría estar aprobado. Reintentá esta misma revisión para comprobarlo." }; }
  if (result.ok) { for (const path of ["/inbox", "/gastos", "/", "/auditoria", "/balances"]) { try { revalidatePath(path); } catch { /* The transaction already committed. */ } } }
  return result;
}
