"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";

export type ClosurePageRow = {
  id: string;
  branchName: string;
  closureDate: string;
  rawText: string;
  parsed: Record<string, unknown>;
  inconsistencies: unknown[];
  status: string;
  grossTotal: number;
  netTotal: number;
  createdAt: string;
};

export async function getClosuresPageDataAction(): Promise<
  { ok: true; data: ClosurePageRow[] } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "Supabase no está disponible." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  let query = supabase
    .from("daily_closures")
    .select("id,branch_id,closure_date,raw_text,parsed,inconsistencies,status,gross_total,net_total,created_at")
    .eq("business_id", ctx.businessId)
    .order("closure_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  if (ctx.assignedBranchIds) {
    if (ctx.assignedBranchIds.length === 0) return { ok: true, data: [] };
    query = query.in("branch_id", ctx.assignedBranchIds);
  }

  const closuresRes = await query;
  if (closuresRes.error) {
    return { ok: false, error: `No se pudieron leer los cierres (${closuresRes.error.code ?? "query_error"}).` };
  }

  const closureRows = (closuresRes.data ?? []) as Array<{
    id: string;
    branch_id: string | null;
    closure_date: string;
    raw_text: string | null;
    parsed: Record<string, unknown> | null;
    inconsistencies: unknown[] | null;
    status: string;
    gross_total: number | string | null;
    net_total: number | string | null;
    created_at: string;
  }>;

  const branchIds = [...new Set(closureRows.map((row) => row.branch_id).filter(Boolean))] as string[];
  const branchMap = new Map<string, string>();

  if (branchIds.length > 0) {
    const branchesRes = await supabase
      .from("branches")
      .select("id,name")
      .eq("business_id", ctx.businessId)
      .in("id", branchIds);

    if (branchesRes.error) {
      return { ok: false, error: `No se pudieron leer las sucursales (${branchesRes.error.code ?? "query_error"}).` };
    }

    for (const row of (branchesRes.data ?? []) as Array<{ id: string; name: string }>) {
      branchMap.set(row.id, row.name);
    }
  }

  return {
    ok: true,
    data: closureRows.map((row) => ({
      id: row.id,
      branchName: row.branch_id ? branchMap.get(row.branch_id) ?? "Sucursal" : "Negocio",
      closureDate: row.closure_date,
      rawText: row.raw_text ?? "",
      parsed: row.parsed ?? {},
      inconsistencies: Array.isArray(row.inconsistencies) ? row.inconsistencies : [],
      status: row.status,
      grossTotal: Number(row.gross_total ?? 0),
      netTotal: Number(row.net_total ?? 0),
      createdAt: row.created_at,
    })),
  };
}
