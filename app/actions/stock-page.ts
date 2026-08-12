"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";

export type StockPageRow = {
  id: string;
  insumo: string;
  unidad: string;
  stock: number;
  minimo: number;
  updatedAt: string | null;
};

export type StockPageData = {
  items: StockPageRow[];
  criticalCount: number;
  alertCount: number;
  lastUpdatedAt: string | null;
};

export async function getStockPageDataAction(): Promise<
  { ok: true; data: StockPageData } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "Supabase no está disponible." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  let branchesQuery = supabase
    .from("branches")
    .select("id")
    .eq("business_id", ctx.businessId);

  if (ctx.assignedBranchIds) {
    if (ctx.assignedBranchIds.length === 0) {
      return { ok: true, data: { items: [], criticalCount: 0, alertCount: 0, lastUpdatedAt: null } };
    }
    branchesQuery = branchesQuery.in("id", ctx.assignedBranchIds);
  }

  const branchesRes = await branchesQuery;
  if (branchesRes.error) {
    return { ok: false, error: `No se pudieron leer las sucursales (${branchesRes.error.code ?? "query_error"}).` };
  }

  const branchIds = ((branchesRes.data ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (branchIds.length === 0) {
    return { ok: true, data: { items: [], criticalCount: 0, alertCount: 0, lastUpdatedAt: null } };
  }

  const stockRes = await supabase
    .from("stock_items")
    .select("id,ingredient_id,current,min,updated_at")
    .in("branch_id", branchIds)
    .order("updated_at", { ascending: false })
    .limit(5000);

  if (stockRes.error) {
    return { ok: false, error: `No se pudo leer el stock (${stockRes.error.code ?? "query_error"}).` };
  }

  const stockRows = (stockRes.data ?? []) as Array<{
    id: string;
    ingredient_id: string;
    current: number | string | null;
    min: number | string | null;
    updated_at: string | null;
  }>;

  const ingredientIds = [...new Set(stockRows.map((row) => row.ingredient_id).filter(Boolean))];
  const ingredientMap = new Map<string, { name: string; unit: string }>();

  if (ingredientIds.length > 0) {
    const ingredientsRes = await supabase
      .from("ingredients")
      .select("id,name,unit")
      .eq("business_id", ctx.businessId)
      .in("id", ingredientIds);

    if (ingredientsRes.error) {
      return { ok: false, error: `No se pudieron leer los insumos (${ingredientsRes.error.code ?? "query_error"}).` };
    }

    for (const row of (ingredientsRes.data ?? []) as Array<{ id: string; name: string; unit: string }>) {
      ingredientMap.set(row.id, { name: row.name, unit: row.unit });
    }
  }

  const items: StockPageRow[] = stockRows.map((row) => {
    const ingredient = ingredientMap.get(row.ingredient_id);
    return {
      id: row.id,
      insumo: ingredient?.name ?? "Insumo sin nombre",
      unidad: ingredient?.unit ?? "u",
      stock: Number(row.current ?? 0),
      minimo: Number(row.min ?? 0),
      updatedAt: row.updated_at,
    };
  });

  const criticalCount = items.filter((row) => row.minimo > 0 && row.stock <= row.minimo).length;
  const alertCount = items.filter((row) => row.minimo > 0 && row.stock > row.minimo && row.stock <= row.minimo * 1.5).length;
  const lastUpdatedAt = items.reduce<string | null>((latest, row) => {
    if (!row.updatedAt) return latest;
    if (!latest || row.updatedAt > latest) return row.updatedAt;
    return latest;
  }, null);

  return { ok: true, data: { items, criticalCount, alertCount, lastUpdatedAt } };
}
