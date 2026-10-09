"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission } from "@/lib/permissions";
import { withPermission } from "@/lib/permissions/server-action";
import { employeeError, employeeRpcFields, isEmployeeId, isEmployeeVersion, isEmployeeDatabaseRow, mapEmployeeRow, validateEmployeeFields,
  type EmployeeCreateInput, type EmployeeUpdateInput, type EmployeeMutationResult, type EmployeeFilters,
  type EmployeeRow, type EmployeesPageData } from "../../lib/employees/domain";
export type { EmployeesPageData } from "../../lib/employees/domain";
export type EmployeePageRow = EmployeeRow;

const columns = "id,full_name,role,shift,branch_id,monthly_hours,monthly_cost,pending_advance,absences,late_arrivals,active,updated_at";
const reject = (error: string): EmployeeMutationResult => ({ ok: false, persisted: false, status: "rejected", error });
async function mutate(rpc: string, args: Record<string, unknown>): Promise<EmployeeMutationResult> {
  try {
    const db = await createSupabaseServerClient() as any;
    if (!db) return reject("No pudimos conectar con tus datos.");
    const result = await db.rpc(rpc, args);
    if (result.error) return employeeError(result.error);
    if (!isEmployeeDatabaseRow(result.data) || result.data.id !== args.p_id) return employeeError(null);
    // A cache failure must not hide a committed, acknowledged write.
    try { revalidatePath("/empleados"); revalidatePath("/auditoria"); revalidatePath("/balances"); } catch { /* next read gets persisted rows */ }
    return { ok: true, persisted: true, id: result.data.id, employee: mapEmployeeRow(result.data) };
  } catch { return employeeError(null); }
}
export const createEmployeeManualAction = withPermission<[EmployeeCreateInput], EmployeeMutationResult>("employees.manage", async (ctx, input) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId) return reject("Esta acción requiere una sesión y un negocio activo.");
  const error = validateEmployeeFields(input);
  if (error) return reject(error);
  if (!isEmployeeId(input.id)) return reject("El identificador del intento no es válido. Volvé a abrir el formulario.");
  return mutate("create_employee_manual", { ...employeeRpcFields(input), p_id: input.id, p_business_id: ctx.businessId });
});
export const updateEmployeeManualAction = withPermission<[EmployeeUpdateInput], EmployeeMutationResult>("employees.manage", async (ctx, input) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId) return reject("Esta acción requiere una sesión y un negocio activo.");
  const error = validateEmployeeFields(input);
  if (error) return reject(error);
  if (!isEmployeeId(input.id) || !isEmployeeVersion(input.expectedUpdatedAt)) return reject("Recargá el empleado antes de editarlo.");
  return mutate("update_employee_manual", { ...employeeRpcFields(input), p_id: input.id, p_expected_updated_at: input.expectedUpdatedAt, p_business_id: ctx.businessId });
});
export const setEmployeeActiveAction = withPermission<[{ id: string; expectedUpdatedAt: string; active: boolean }], EmployeeMutationResult>("employees.manage", async (ctx, input) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId) return reject("Esta acción requiere una sesión y un negocio activo.");
  if (!input || !isEmployeeId(input.id) || !isEmployeeVersion(input.expectedUpdatedAt) || typeof input.active !== "boolean") return reject("Recargá el empleado antes de cambiar su estado.");
  return mutate("set_employee_active_manual", { p_id: input.id, p_expected_updated_at: input.expectedUpdatedAt, p_active: input.active, p_business_id: ctx.businessId });
});
export async function getEmployeesPageDataAction(input: EmployeeFilters = {}): Promise<{ ok: true; data: EmployeesPageData } | { ok: false; error: string }> {
  try {
    const ctx = await getCurrentUserContext();
    if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId || !hasPermission(ctx.role, "employees.view")) return { ok: false, error: "No tenés acceso al equipo de este negocio." };
    if (!input || (input.query !== undefined && typeof input.query !== "string") || (input.query?.length ?? 0) > 200 || !["active", "archived", "all"].includes(input.status ?? "active") || (input.branchId && !isEmployeeId(input.branchId)) || !Number.isInteger(input.page ?? 0) || (input.page ?? 0) < 0 || (input.page ?? 0) > 100000) return { ok: false, error: "Revisá los filtros de búsqueda." };
    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, error: "No pudimos conectar con tus datos." };
    const profile = await db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle();
    if (profile.error || !profile.data?.active) return { ok: false, error: "Tu perfil no está activo." };
    const page = input.page ?? 0; const pageSize = 30;
    let query = db.from("employees").select(columns).eq("business_id", ctx.businessId);
    const active = (input.status ?? "active") === "all" ? null : input.status !== "archived";
    if (active !== null) query = query.eq("active", active);
    if (input.branchId) query = query.eq("branch_id", input.branchId);
    if (input.query?.trim()) query = query.ilike("full_name", `%${input.query.trim().replace(/[\\%_]/g, "\\$&")}%`);
    const [rows, summary, branches] = await Promise.all([
      query.order("full_name").order("id").range(page * pageSize, (page + 1) * pageSize - 1),
      db.rpc("employee_manual_summary", { p_business_id: ctx.businessId, p_search: input.query?.trim() ?? "", p_active: active, p_branch_id: input.branchId || null }),
      db.from("branches").select("id,name").eq("business_id", ctx.businessId).order("name"),
    ]);
    if (rows.error || summary.error || branches.error || !summary.data || !(rows.data ?? []).every(isEmployeeDatabaseRow)) return { ok: false, error: "No pudimos cargar el equipo. Verificá que la actualización esté aplicada." };
    return { ok: true, data: { employees: (rows.data ?? []).map(mapEmployeeRow), branches: branches.data ?? [],
      canManage: hasPermission(ctx.role, "employees.manage"), draftScope: `${ctx.userId}:${ctx.businessId}`,
      count: Number(summary.data.count), page, pageSize, activeCount: Number(summary.data.activeCount),
      totalMonthlyCost: Number(summary.data.totalMonthlyCost), pendingAdvances: Number(summary.data.pendingAdvances),
      totalAbsences: Number(summary.data.totalAbsences), totalLateArrivals: Number(summary.data.totalLateArrivals) } };
  } catch { return { ok: false, error: "No pudimos cargar el equipo." }; }
}
export async function getEmployeeManualAction(id: string): Promise<{ ok: true; employee: EmployeeRow | null } | { ok: false; error: string }> {
  try {
    const ctx = await getCurrentUserContext();
    if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId || !hasPermission(ctx.role, "employees.view") || !isEmployeeId(id)) return { ok: false, error: "No tenés acceso al empleado." };
    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, error: "No pudimos conectar con tus datos." };
    const profile = await db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle();
    if (profile.error || !profile.data?.active) return { ok: false, error: "Tu perfil no está activo. No pudimos verificar el resultado." };
    const result = await db.from("employees").select(columns).eq("business_id", ctx.businessId).eq("id", id).maybeSingle();
    if (result.error || result.data && !isEmployeeDatabaseRow(result.data)) return { ok: false, error: "No pudimos verificar el empleado." };
    return { ok: true, employee: result.data ? mapEmployeeRow(result.data) : null };
  } catch { return { ok: false, error: "No pudimos verificar el empleado." }; }
}
