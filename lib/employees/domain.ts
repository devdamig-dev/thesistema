export type EmployeeFields = {
  fullName: string; role: string; shift: string; branchId: string;
  monthlyHours: string; monthlyCost: string; pendingAdvance: string; absences: string; lateArrivals: string;
};
export type EmployeeRow = {
  id: string; fullName: string; role: string; shift: string | null; branchId: string | null;
  monthlyHours: number; monthlyCost: number; pendingAdvance: number; absences: number; lateArrivals: number;
  active: boolean; updatedAt: string;
};
export type EmployeeCreateInput = EmployeeFields & { id: string };
export type EmployeeUpdateInput = EmployeeCreateInput & { expectedUpdatedAt: string };
export type EmployeeMutationResult =
  | { ok: true; persisted: true; id: string; employee: EmployeeRow }
  | { ok: false; persisted: false | null; error: string; status: "rejected" | "conflict" | "uncertain" };
export type EmployeeFilters = { query?: string; status?: "active" | "archived" | "all"; branchId?: string; page?: number };
export type EmployeesPageData = {
  employees: EmployeeRow[]; branches: { id: string; name: string }[]; canManage: boolean; draftScope: string;
  count: number; page: number; pageSize: number; activeCount: number; totalMonthlyCost: number;
  pendingAdvances: number; totalAbsences: number; totalLateArrivals: number;
};
export const employeeTextLimits = { fullName: 200, role: 120, shift: 120 };
export const employeeNumericFields = {
  monthlyHours: { label: "Horas del mes", max: 744, integer: false },
  monthlyCost: { label: "Costo del mes (ARS)", max: 9999999999.99, integer: false },
  pendingAdvance: { label: "Adelantos pendientes (ARS)", max: 9999999999.99, integer: false },
  absences: { label: "Faltas", max: 31, integer: true },
  lateArrivals: { label: "Llegadas tarde", max: 31, integer: true },
};
export const isEmployeeId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isEmployeeVersion = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
export function validateEmployeeFields(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Ingresá los datos del empleado.";
  const value = input as Record<string, unknown>;
  for (const [key, max] of Object.entries(employeeTextLimits)) {
    const text = value[key];
    if (typeof text !== "string" || text.trim().length > max || /[\x00-\x1f\x7f]/.test(text)) return "Revisá el nombre, rol y turno.";
    if (key !== "shift" && !text.trim()) return "Completá el nombre y el rol del empleado.";
  }
  if (!isEmployeeId(value.branchId)) return "Elegí una sucursal del negocio.";
  for (const [key, config] of Object.entries(employeeNumericFields)) {
    const number = value[key];
    if (typeof number !== "string" || !(config.integer ? /^\d+$/ : /^\d+(?:\.\d{1,2})?$/).test(number) || !Number.isFinite(Number(number)) || Number(number) > config.max) return `Revisá ${config.label.toLowerCase()}: usá un valor entre 0 y ${config.max}${config.integer ? " sin decimales" : " con hasta 2 decimales"}.`;
  }
  return null;
}
export function employeeRpcFields(input: EmployeeFields) {
  return { p_full_name: input.fullName.trim(), p_role: input.role.trim(), p_shift: input.shift.trim() || null,
    p_branch_id: input.branchId, p_monthly_hours: Number(input.monthlyHours), p_monthly_cost: Number(input.monthlyCost),
    p_pending_advance: Number(input.pendingAdvance), p_absences: Number(input.absences), p_late_arrivals: Number(input.lateArrivals) };
}
export function employeeToFields(row: EmployeeRow): EmployeeFields {
  return { fullName: row.fullName, role: row.role, shift: row.shift ?? "", branchId: row.branchId ?? "",
    monthlyHours: String(row.monthlyHours), monthlyCost: String(row.monthlyCost), pendingAdvance: String(row.pendingAdvance), absences: String(row.absences), lateArrivals: String(row.lateArrivals) };
}
export function isEmployeeDatabaseRow(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return isEmployeeId(row.id) && isEmployeeVersion(row.updated_at) && typeof row.full_name === "string" && typeof row.role === "string"
    && (row.shift === null || typeof row.shift === "string") && (row.branch_id === null || isEmployeeId(row.branch_id)) && typeof row.active === "boolean"
    && ["monthly_hours", "monthly_cost", "pending_advance", "absences", "late_arrivals"].every((key) => (typeof row[key] === "number" || typeof row[key] === "string" && row[key] !== "") && Number.isFinite(Number(row[key])));
}
export function mapEmployeeRow(row: Record<string, any>): EmployeeRow {
  return { id: row.id, fullName: row.full_name, role: row.role, shift: row.shift, branchId: row.branch_id,
    monthlyHours: Number(row.monthly_hours), monthlyCost: Number(row.monthly_cost), pendingAdvance: Number(row.pending_advance),
    absences: Number(row.absences), lateArrivals: Number(row.late_arrivals), active: row.active, updatedAt: row.updated_at };
}
export function employeeError(error: { code?: string; message?: string } | null): EmployeeMutationResult {
  if (error?.message?.includes("employee_stale_version")) return { ok: false, persisted: false, status: "conflict", error: "Otra persona cambió este empleado. Recargá sus datos antes de guardar." };
  if (error?.message?.includes("employee_request_conflict")) return { ok: false, persisted: false, status: "conflict", error: "Este intento ya corresponde a un empleado guardado. Verificá el resultado antes de continuar." };
  if (["42501", "P0002", "23514", "22023", "22P02", "22007", "22003"].includes(error?.code ?? "")) return { ok: false, persisted: false, status: "rejected", error: error?.code === "42501" ? "Tu usuario no tiene permiso para modificar este empleado." : "No se guardaron cambios. Revisá los datos y la sucursal del empleado." };
  return { ok: false, persisted: null, status: "uncertain", error: "No pudimos confirmar el resultado. Verificá lo guardado antes de continuar." };
}
