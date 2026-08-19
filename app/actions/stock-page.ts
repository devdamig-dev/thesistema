"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { withPermission } from "@/lib/permissions/server-action";
import { logActivity } from "@/lib/data/activity";

export type StockPageRow = {
  id: string;
  ingredientId: string;
  branchId: string;
  branchName: string;
  insumo: string;
  unidad: string;
  stock: number;
  minimo: number;
  updatedAt: string | null;
};

export type StockOption = {
  id: string;
  name: string;
  unit?: string;
};

export type StockPageData = {
  items: StockPageRow[];
  branches: StockOption[];
  ingredients: StockOption[];
  criticalCount: number;
  alertCount: number;
  lastUpdatedAt: string | null;
};

export type ManualStockOperation = "in" | "out" | "set";

export type ManualStockInput = {
  ingredientId: string;
  branchId: string;
  operation: ManualStockOperation;
  quantity: number;
};

export type ManualStockResult =
  | { ok: true; persisted: true; newCurrent: number; delta: number }
  | { ok: false; persisted: false; error: string };

const EMPTY_DATA: StockPageData = {
  items: [],
  branches: [],
  ingredients: [],
  criticalCount: 0,
  alertCount: 0,
  lastUpdatedAt: null,
};

export async function getStockPageDataAction(): Promise<
  { ok: true; data: StockPageData } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "No pudimos conectar con tus datos." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  let branchesQuery = supabase
    .from("branches")
    .select("id,name")
    .eq("business_id", ctx.businessId)
    .order("is_main", { ascending: false })
    .order("name", { ascending: true });

  if (ctx.assignedBranchIds) {
    if (ctx.assignedBranchIds.length === 0) {
      return { ok: true, data: EMPTY_DATA };
    }
    branchesQuery = branchesQuery.in("id", ctx.assignedBranchIds);
  }

  const [branchesRes, ingredientsRes] = await Promise.all([
    branchesQuery,
    supabase
      .from("ingredients")
      .select("id,name,unit")
      .eq("business_id", ctx.businessId)
      .order("name", { ascending: true })
      .limit(5000),
  ]);

  if (branchesRes.error) {
    return { ok: false, error: "No se pudieron cargar las sucursales." };
  }
  if (ingredientsRes.error) {
    return { ok: false, error: "No se pudieron cargar los insumos." };
  }

  const branches = ((branchesRes.data ?? []) as Array<{ id: string; name: string }>).map((row) => ({
    id: row.id,
    name: row.name,
  }));
  const branchIds = branches.map((row) => row.id);
  const ingredients = ((ingredientsRes.data ?? []) as Array<{ id: string; name: string; unit: string }>).map((row) => ({
    id: row.id,
    name: row.name,
    unit: row.unit,
  }));

  if (branchIds.length === 0) {
    return { ok: true, data: { ...EMPTY_DATA, branches, ingredients } };
  }

  const stockRes = await supabase
    .from("stock_items")
    .select("id,ingredient_id,branch_id,current,min,updated_at")
    .in("branch_id", branchIds)
    .order("updated_at", { ascending: false })
    .limit(5000);

  if (stockRes.error) {
    return { ok: false, error: "No se pudo cargar el stock." };
  }

  const stockRows = (stockRes.data ?? []) as Array<{
    id: string;
    ingredient_id: string;
    branch_id: string;
    current: number | string | null;
    min: number | string | null;
    updated_at: string | null;
  }>;

  const ingredientMap = new Map(ingredients.map((row) => [row.id, row]));
  const branchMap = new Map(branches.map((row) => [row.id, row.name]));

  const items: StockPageRow[] = stockRows.map((row) => {
    const ingredient = ingredientMap.get(row.ingredient_id);
    return {
      id: row.id,
      ingredientId: row.ingredient_id,
      branchId: row.branch_id,
      branchName: branchMap.get(row.branch_id) ?? "Sucursal",
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

  return { ok: true, data: { items, branches, ingredients, criticalCount, alertCount, lastUpdatedAt } };
}

function manualStockError(message?: string | null): string {
  if (!message) return "No pudimos registrar el movimiento.";
  if (message.includes("insufficient_stock")) return "La salida supera el stock disponible.";
  if (message.includes("invalid_stock_quantity")) return "Ingresá una cantidad válida.";
  if (message.includes("invalid_stock_operation")) return "Elegí un tipo de movimiento válido.";
  if (message.includes("forbidden")) return "No tenés permiso para modificar ese stock.";
  if (message.includes("not_found")) return "No encontramos el insumo o la sucursal seleccionada.";
  return "No pudimos registrar el movimiento. Revisá los datos e intentá nuevamente.";
}

export const adjustStockManualAction = withPermission<[ManualStockInput], ManualStockResult>(
  "stock.adjust",
  async (ctx, input) => {
    if (!isDatabaseMode()) {
      return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    }
    if (!ctx.businessId || !input.ingredientId || !input.branchId) {
      return { ok: false, persisted: false, error: "Completá el insumo y la sucursal." };
    }
    if (!["in", "out", "set"].includes(input.operation)) {
      return { ok: false, persisted: false, error: "Elegí un tipo de movimiento válido." };
    }

    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity < 0 || (input.operation !== "set" && quantity <= 0)) {
      return { ok: false, persisted: false, error: "Ingresá una cantidad válida." };
    }
    if (ctx.assignedBranchIds && !ctx.assignedBranchIds.includes(input.branchId)) {
      return { ok: false, persisted: false, error: "No tenés acceso a esa sucursal." };
    }

    const db = createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus datos." };

    const [branchRes, ingredientRes] = await Promise.all([
      db.from("branches").select("id,name,business_id").eq("id", input.branchId).eq("business_id", ctx.businessId).maybeSingle(),
      db.from("ingredients").select("id,name,unit,business_id").eq("id", input.ingredientId).eq("business_id", ctx.businessId).maybeSingle(),
    ]);

    if (branchRes.error || !branchRes.data) {
      return { ok: false, persisted: false, error: "No encontramos la sucursal seleccionada." };
    }
    if (ingredientRes.error || !ingredientRes.data) {
      return { ok: false, persisted: false, error: "No encontramos el insumo seleccionado." };
    }

    const rpc = await db.rpc("adjust_stock_manual", {
      p_ingredient_id: input.ingredientId,
      p_branch_id: input.branchId,
      p_operation: input.operation,
      p_quantity: quantity,
    });

    if (rpc.error) {
      return { ok: false, persisted: false, error: manualStockError(rpc.error.message) };
    }

    const result = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    const newCurrent = Number(result?.new_current ?? 0);
    const delta = Number(result?.delta ?? 0);
    const operationLabel = input.operation === "in" ? "Entrada" : input.operation === "out" ? "Salida" : "Ajuste";

    await logActivity({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorName: ctx.fullName,
      actorRole: ctx.role,
      action: "stock.manual_adjusted",
      targetType: "stock_items",
      targetId: result?.stock_item_id ?? undefined,
      summary: `${operationLabel} manual · ${ingredientRes.data.name} · ${branchRes.data.name} · ${Math.abs(delta)} ${ingredientRes.data.unit}`,
      data: {
        ingredient_id: input.ingredientId,
        branch_id: input.branchId,
        operation: input.operation,
        requested_quantity: quantity,
        delta,
        new_current: newCurrent,
      },
    });

    revalidatePath("/stock");
    revalidatePath("/auditoria");
    return { ok: true, persisted: true, newCurrent, delta };
  },
);
