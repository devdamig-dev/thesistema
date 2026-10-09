"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission, canSeeModule } from "@/lib/permissions";
import { mutateClosure, UUID, type ClosuresDatabase, type ClosureResult, type ClosureWorkspace, type ClosureHistory } from "@/lib/closures/domain";
async function context() {
  if (!isDatabaseMode()) throw new Error("Los cierres reales requieren database mode.");
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId || !hasPermission(ctx.role, "closures.view") || !canSeeModule(ctx.role, "daily_closures", ctx.enabledModules)) throw new Error("No hay una sesión autorizada para consultar cierres.");
  const db = await createSupabaseServerClient() as any; if (!db) throw new Error("No se pudo conectar con los cierres.");
  const profile = await db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle();
  if (profile.error || !profile.data?.active) throw new Error("La sesión no tiene un perfil activo.");
  return { db, ctx: { ...ctx, userId: ctx.userId, businessId: ctx.businessId } };
}
async function revision(db: any, businessId: string): Promise<string> {
  const result = await db.rpc("get_closures_revision", { p_business_id: businessId });
  if (result.error || typeof result.data !== "string" || !/^\d+$/.test(result.data)) throw new Error("No se pudo verificar la lectura completa de cierres.");
  return result.data;
}
async function all(query: any): Promise<any[]> {
  const rows: any[] = []; let total: number | null = null;
  for (let offset = 0; ; offset += 500) {
    const result = await query.range(offset, offset + 499);
    if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count) || total !== null && total !== result.count) throw new Error("No pudimos leer todos los registros. Actualizá los cierres.");
    total = result.count; rows.push(...result.data);
    if (rows.length === total) return rows;
    if (!result.data.length || rows.length > total!) throw new Error("La lectura de cierres quedó incompleta.");
  }
}
export async function getClosuresWorkspaceAction(): Promise<{ ok: true; data: ClosureWorkspace } | { ok: false; error: string }> {
  try {
    const { db, ctx } = await context();
    const scope = (q: any, key: string) => ctx.assignedBranchIds === null ? q : q.in(key, ctx.assignedBranchIds.length ? ctx.assignedBranchIds : ["00000000-0000-0000-0000-000000000000"]);
    const before = await revision(db, ctx.businessId);
    const [business, branches, closures] = await Promise.all([
      db.from("businesses").select("timezone").eq("id", ctx.businessId).maybeSingle(),
      all(scope(db.from("branches").select("id,name", { count: "exact" }).eq("business_id", ctx.businessId).order("name").order("id"), "id")),
      all(scope(db.from("daily_closures").select("id,business_id,branch_id,closure_date,raw_text,parsed,inconsistencies,gross_total::text,net_total::text,status,source,manual_note,version,created_at,archived_at,archive_reason", { count: "exact" }).eq("business_id", ctx.businessId).order("closure_date", { ascending: false }).order("id"), "branch_id")),
    ]);
    if (before !== await revision(db, ctx.businessId)) throw new Error("Los cierres cambiaron durante la lectura. Volvé a actualizar.");
    if (business.error || !business.data?.timezone) throw new Error("No se pudo verificar la zona horaria del negocio.");
    new Intl.DateTimeFormat("es-AR", { timeZone: business.data.timezone }).format(new Date());
    return { ok: true, data: { businessId: ctx.businessId, userId: ctx.userId, timezone: business.data.timezone, branches, closures, canManage: hasPermission(ctx.role, "closures.approve") } };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No pudimos cargar los cierres." }; }
}
async function write(kind: "save" | "archive", input: unknown): Promise<ClosureResult> {
  let ready; try { ready = await context(); } catch (error) { return { ok: false, persisted: false, error: error instanceof Error ? error.message : "No se pudo verificar la sesión." }; }
  const { db, ctx } = ready; if (!hasPermission(ctx.role, "closures.approve")) return { ok: false, persisted: false, error: "No tenés permiso para gestionar cierres." };
  const result = await mutateClosure(db as ClosuresDatabase, ctx, kind, input);
  if (result.ok) { try { for (const path of ["/cierres", "/auditoria", "/"]) revalidatePath(path); } catch { /* The transaction is already confirmed. */ } }
  return result;
}
export async function saveClosureAction(input: unknown): Promise<ClosureResult> { return write("save", input); }
export async function archiveClosureAction(input: unknown): Promise<ClosureResult> { return write("archive", input); }
export async function getClosureHistoryAction(id: string): Promise<{ ok: true; history: ClosureHistory[] } | { ok: false; error: string }> {
  try { if (!UUID.test(id)) throw new Error("Cierre inválido."); const { db, ctx } = await context(); const result = await db.from("daily_closures").select("id").eq("business_id", ctx.businessId).eq("id", id).maybeSingle(); if (result.error || !result.data) throw new Error("Cierre no disponible.");
    return { ok: true, history: await all(db.from("closure_mutations").select("request_id,operation,actor_role,created_at,reason,before_snapshot,after_snapshot,result", { count: "exact" }).eq("business_id", ctx.businessId).eq("closure_id", id).order("created_at").order("request_id")) };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No se pudo leer el historial." }; }
}
