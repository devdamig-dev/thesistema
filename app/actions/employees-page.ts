"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";

export type EmployeePageRow = {
  id: string;
  fullName: string;
  role: string;
  shift: string | null;
  monthlyHours: number;
  monthlyCost: number;
  pendingAdvance: number;
  absences: number;
  lateArrivals: number;
  active: boolean;
};

export type EmployeesPageData = {
  employees: EmployeePageRow[];
  activeCount: number;
  totalMonthlyCost: number;
  pendingAdvances: number;
  totalAbsences: number;
  totalLateArrivals: number;
};

export async function getEmployeesPageDataAction(): Promise<
  { ok: true; data: EmployeesPageData } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "Supabase no está disponible." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  const res = await supabase
    .from("employees")
    .select("id,full_name,role,shift,monthly_hours,monthly_cost,pending_advance,absences,late_arrivals,active")
    .eq("business_id", ctx.businessId)
    .order("active", { ascending: false })
    .order("full_name", { ascending: true })
    .limit(1000);

  if (res.error) {
    return { ok: false, error: `No se pudieron leer los empleados (${res.error.code ?? "query_error"}).` };
  }

  const employees: EmployeePageRow[] = ((res.data ?? []) as Array<{
    id: string;
    full_name: string;
    role: string | null;
    shift: string | null;
    monthly_hours: number | string | null;
    monthly_cost: number | string | null;
    pending_advance: number | string | null;
    absences: number | null;
    late_arrivals: number | null;
    active: boolean | null;
  }>).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    role: row.role ?? "Sin rol",
    shift: row.shift,
    monthlyHours: Number(row.monthly_hours ?? 0),
    monthlyCost: Number(row.monthly_cost ?? 0),
    pendingAdvance: Number(row.pending_advance ?? 0),
    absences: Number(row.absences ?? 0),
    lateArrivals: Number(row.late_arrivals ?? 0),
    active: Boolean(row.active),
  }));

  return {
    ok: true,
    data: {
      employees,
      activeCount: employees.filter((row) => row.active).length,
      totalMonthlyCost: employees.filter((row) => row.active).reduce((sum, row) => sum + row.monthlyCost, 0),
      pendingAdvances: employees.reduce((sum, row) => sum + row.pendingAdvance, 0),
      totalAbsences: employees.reduce((sum, row) => sum + row.absences, 0),
      totalLateArrivals: employees.reduce((sum, row) => sum + row.lateArrivals, 0),
    },
  };
}
