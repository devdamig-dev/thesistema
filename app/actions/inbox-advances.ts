"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission, canSeeModule } from "@/lib/permissions";
import { advanceRpcResult, parseAdvanceApproval, type AdvanceResult, type AdvanceReview } from "@/lib/advances/inbox";
import { EXPENSE_UUID } from "@/lib/expenses/validation";
import { readExpenseRows } from "@/lib/expenses/read";
import { isEmployeeVersion } from "@/lib/employees/domain";

async function session() {
  if (!isDatabaseMode()) throw new Error("Esta revisión requiere un negocio activo.");
  const ctx = await getCurrentUserContext(); const db = await createSupabaseServerClient() as any;
  if (!db || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId || !hasPermission(ctx.role, "inbox.approve") || !canSeeModule(ctx.role, "inbox_ai", ctx.enabledModules)) throw new Error("No tenés permiso para revisar este registro.");
  return { db, ctx, businessId: ctx.businessId, userId: ctx.userId };
}
function canAdvance(ctx: Awaited<ReturnType<typeof getCurrentUserContext>>) {
  return hasPermission(ctx.role, "advances.create") && canSeeModule(ctx.role, "employees", ctx.enabledModules);
}
export async function getInboxAdvanceReviewAction(extractionId: string): Promise<{ ok: true; review: AdvanceReview } | { ok: false; error: string }> {
  try {
    if (typeof extractionId !== "string" || !EXPENSE_UUID.test(extractionId)) throw new Error("Extracción inválida.");
    const { db, ctx, businessId, userId } = await session();
    const result = await db.from("ai_extractions").select("id,business_id,branch_id,message_id,type,fields,status,target_record_id").eq("id", extractionId).maybeSingle();
    if (result.error || !result.data) throw new Error("Extracción no disponible.");
    const e = result.data;
    if (e.type !== "employee_advance") return { ok: false, error: "unsupported_advance_extraction" };
    if (!canAdvance(ctx)) throw new Error("No tenés permiso para registrar adelantos.");
    if (!["pending", "needs_review", "failed", "approved"].includes(e.status)) throw new Error("La extracción está cerrada. Revisá la auditoría.");
    const [message, profile] = await Promise.all([db.from("whatsapp_messages").select("business_id,branch_id").eq("id", e.message_id).maybeSingle(), db.from("profiles").select("active").eq("id", userId).maybeSingle()]);
    if (message.error || message.data?.business_id !== businessId || e.business_id && e.business_id !== businessId || profile.error || profile.data?.active !== true) throw new Error("No pudimos verificar el contexto del adelanto.");
    const branchId = e.branch_id ?? message.data.branch_id ?? null;
    if (e.branch_id && message.data.branch_id && e.branch_id !== message.data.branch_id || branchId && ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(branchId)) throw new Error("Sucursal no autorizada.");
    const branches = await readExpenseRows<{ id: string; name: string }>((from, to) => {
      let query = db.from("branches").select("id,name", { count: "exact" }).eq("business_id", businessId).order("id").range(from, to);
      if (branchId) query = query.eq("id", branchId);
      if (ctx.assignedBranchIds !== null) query = query.in("id", ctx.assignedBranchIds.length ? ctx.assignedBranchIds : ["00000000-0000-0000-0000-000000000000"]);
      return query;
    });
    if (branchId && !branches.some((branch) => branch.id === branchId)) throw new Error("La sucursal de origen no está disponible.");
    const employees = branches.length ? await readExpenseRows<{ id: string; full_name: string; role: string; branch_id: string; updated_at: string }>((from, to) => db.from("employees").select("id,full_name,role,branch_id,updated_at", { count: "exact" }).eq("business_id", businessId).eq("active", true).in("branch_id", branches.map(b => b.id)).order("id").range(from, to)) : [];
    if (employees.some(employee => !EXPENSE_UUID.test(employee.id) || !isEmployeeVersion(employee.updated_at) || !branches.some(b => b.id === employee.branch_id))) throw new Error("No pudimos verificar la lista de empleados.");
    const fields = e.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new Error("La extracción necesita una revisión válida.");
    return { ok: true, review: { extractionId, businessId, userId, branchId,
      employees: employees.map(employee => ({ id: employee.id, fullName: employee.full_name, role: employee.role, branchId: employee.branch_id, branchName: branches.find(b => b.id === employee.branch_id)!.name, updatedAt: employee.updated_at })),
      expectedFields: fields, detectedName: typeof fields.employee_name === "string" ? fields.employee_name : "",
      amount: typeof fields.amount === "string" || typeof fields.amount === "number" && Number.isFinite(fields.amount) ? String(fields.amount) : "",
      date: typeof fields.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fields.date) ? fields.date : "",
      closed: e.status === "approved", targetAdvanceId: typeof e.target_record_id === "string" ? e.target_record_id : null } };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No pudimos leer la revisión." }; }
}
export async function approveInboxAdvanceAction(input: unknown): Promise<AdvanceResult> {
  let parsed; let current: Awaited<ReturnType<typeof session>>;
  try {
    parsed = parseAdvanceApproval(input); current = await session();
    if (parsed.businessId !== current.businessId || parsed.userId !== current.userId || !canAdvance(current.ctx)) throw new Error("Cambió la sesión, el negocio o los permisos. Revisá el intento antes de continuar.");
  } catch (error) { return { ok: false, persisted: false, error: error instanceof Error ? error.message : "Datos inválidos." }; }
  let result: AdvanceResult;
  try { result = advanceRpcResult(await current.db.rpc("approve_employee_advance_extraction_atomic", { p_business_id: current.businessId, p_actor_id: current.userId, p_extraction_id: parsed.extractionId, p_expected_fields: parsed.expectedFields, p_review: parsed.review })); }
  catch { result = { ok: false, persisted: "unknown", error: "La conexión se interrumpió. El adelanto podría estar aprobado. Reintentá esta misma revisión para comprobarlo." }; }
  if (result.ok) for (const path of ["/inbox", "/empleados", "/auditoria"]) { try { revalidatePath(path); } catch { /* Confirmed transaction survives cache errors. */ } }
  return result;
}
