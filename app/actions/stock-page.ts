"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { withPermission } from "@/lib/permissions/server-action";
import { hasPermission } from "@/lib/permissions";
import { readCatalogRows } from "@/lib/catalog/pagination";
import { convertQuantity, normalizeUnit } from "@/lib/recipes/quantities";

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
  canAdjust: boolean;
};

export type ManualStockOperation = "in" | "out" | "waste" | "set";

export type ManualStockInput = {
  ingredientId: string;
  branchId: string;
  operation: ManualStockOperation;
  quantity: number;
  reason: string;
  unit?: string | null;
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
  canAdjust: false,
};

export async function getStockPageDataAction(): Promise<
  { ok: true; data: StockPageData } | { ok: false; error: string }
> {
  if (!isDatabaseMode()) return { ok: false, error: "Esta consulta requiere un negocio activo." };
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId) return { ok: false, error: "No se pudo resolver tu sesión y negocio activo." };
  if (!hasPermission(ctx.role, "stock.view")) return { ok: false, error: "No tenés permiso para consultar el stock." };
  const supabase = await createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "No pudimos conectar con tus datos." };
  if (!await activeProfile(supabase, ctx.userId)) return { ok: false, error: "Tu perfil no está activo o no se pudo verificar." };
  const canAdjust = hasPermission(ctx.role, "stock.adjust");

  let branchesQuery = supabase
    .from("branches")
    .select("id,name")
    .eq("business_id", ctx.businessId)
    .order("is_main", { ascending: false })
    .order("name", { ascending: true });

  if (ctx.assignedBranchIds) {
    if (ctx.assignedBranchIds.length === 0) {
      return { ok: true, data: { ...EMPTY_DATA, canAdjust } };
    }
    branchesQuery = branchesQuery.in("id", ctx.assignedBranchIds);
  }

  const [branchesRes, ingredientsRes] = await Promise.all([
    readCatalogRows(branchesQuery.order("id")),
    readCatalogRows(supabase
      .from("ingredients")
      .select("id,name,unit")
      .eq("business_id", ctx.businessId)
      .order("name", { ascending: true })
      .order("id")),
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
    return { ok: true, data: { ...EMPTY_DATA, branches, ingredients, canAdjust } };
  }

  const stockRes = await readCatalogRows(supabase
    .from("stock_items")
    .select("id,ingredient_id,branch_id,current,min,updated_at,ingredients!inner(business_id)")
    .eq("ingredients.business_id", ctx.businessId)
    .in("branch_id", branchIds)
    .order("updated_at", { ascending: false })
    .order("id"));

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

  return { ok: true, data: { items, branches, ingredients, criticalCount, alertCount, lastUpdatedAt, canAdjust } };
}

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const dbNumber = (value: unknown): number | null => (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number.isFinite(Number(value)) ? Number(value) : null;

async function activeProfile(db: any, userId: string): Promise<boolean> {
  const profile = await db.from("profiles").select("active").eq("id", userId).maybeSingle();
  return !profile.error && profile.data?.active === true;
}

export type StockMovementRow = {
  id: string;
  createdAt: string;
  ingredientId: string;
  ingredientName: string;
  branchId: string;
  branchName: string;
  delta: number | null;
  reason: string;
  operation: string | null;
  reasonNote: string | null;
  source: string | null;
  actorName: string | null;
  actorRole: string | null;
  inputQuantity: number | null;
  inputUnit: string | null;
  baseUnit: string | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
  legacy: boolean;
};

export type StockHistoryInput = { page: number; branchId?: string; ingredientId?: string };
export type StockHistoryData = { items: StockMovementRow[]; total: number; page: number; pageSize: number };

export async function getStockMovementHistoryAction(input: StockHistoryInput): Promise<
  { ok: true; data: StockHistoryData } | { ok: false; error: string }
> {
  if (!record(input) || Object.keys(input).some((key) => !["page", "branchId", "ingredientId"].includes(key)) ||
      !Number.isSafeInteger(input.page) || input.page < 1 || !Number.isSafeInteger(input.page * 25) ||
      (input.branchId !== undefined && input.branchId !== "" && !uuid(input.branchId)) ||
      (input.ingredientId !== undefined && input.ingredientId !== "" && !uuid(input.ingredientId))) {
    return { ok: false, error: "Los filtros del historial no son válidos." };
  }
  if (!isDatabaseMode()) return { ok: false, error: "El historial real requiere un negocio activo." };
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId || !hasPermission(ctx.role, "stock.view")) {
    return { ok: false, error: "No tenés acceso al historial de stock." };
  }
  const db = await createSupabaseServerClient() as any;
  if (!db) return { ok: false, error: "No pudimos conectar con el historial." };
  if (!await activeProfile(db, ctx.userId)) return { ok: false, error: "Tu perfil no está activo o no se pudo verificar." };
  const pageSize = 25;
  if (ctx.assignedBranchIds && input.branchId && !ctx.assignedBranchIds.includes(input.branchId)) {
    return { ok: false, error: "No tenés acceso a esa sucursal." };
  }
  if (ctx.assignedBranchIds?.length === 0) {
    return { ok: true, data: { items: [], total: 0, page: input.page, pageSize } };
  }

  // Tenant isolation through both parents also includes historical rows whose
  // new business_id is null. Their missing audit metadata is never backfilled.
  let query = db.from("stock_movements").select(
    "id,created_at,ingredient_id,branch_id,qty,reason,operation,reason_note,source,actor_name,actor_role,input_quantity,input_unit,base_unit,balance_before,balance_after,branches!inner(name,business_id),ingredients!inner(name,business_id)",
    { count: "exact" },
  ).eq("branches.business_id", ctx.businessId).eq("ingredients.business_id", ctx.businessId);
  if (ctx.assignedBranchIds) query = query.in("branch_id", ctx.assignedBranchIds);
  if (input.branchId) query = query.eq("branch_id", input.branchId);
  if (input.ingredientId) query = query.eq("ingredient_id", input.ingredientId);
  const start = (input.page - 1) * pageSize;
  const result = await query.order("created_at", { ascending: false }).order("id", { ascending: false }).range(start, start + pageSize - 1);
  if (result.error || !Array.isArray(result.data) || typeof result.count !== "number") {
    return { ok: false, error: "No pudimos cargar el historial de movimientos. Intentá nuevamente." };
  }
  const items: StockMovementRow[] = result.data.map((row: any) => ({
    id: row.id, createdAt: row.created_at,
    ingredientId: row.ingredient_id, ingredientName: row.ingredients?.name ?? "Insumo sin nombre",
    branchId: row.branch_id, branchName: row.branches?.name ?? "Sucursal sin nombre",
    delta: dbNumber(row.qty), reason: row.reason,
    operation: row.operation ?? null, reasonNote: row.reason_note ?? null,
    source: row.source ?? null, actorName: row.actor_name ?? null, actorRole: row.actor_role ?? null,
    inputQuantity: dbNumber(row.input_quantity), inputUnit: row.input_unit ?? null, baseUnit: row.base_unit ?? null,
    balanceBefore: dbNumber(row.balance_before), balanceAfter: dbNumber(row.balance_after),
    legacy: row.source == null && row.operation == null && row.balance_before == null && row.balance_after == null,
  }));
  return { ok: true, data: { items, total: result.count, page: input.page, pageSize } };
}

function manualStockError(message?: string | null): string {
  if (!message) return "No pudimos registrar el movimiento.";
  if (message.includes("insufficient_stock")) return "La salida o merma supera el stock disponible.";
  if (message.includes("reason")) return "Ingresá el motivo del movimiento (hasta 1000 caracteres).";
  if (message.includes("unit")) return "La unidad no es compatible con la unidad base del insumo.";
  if (message.includes("precision")) return "La cantidad convertida admite hasta 6 decimales y debe ser menor a un billón de unidades base.";
  if (message.includes("quantity") || message.includes("overflow")) return "Ingresá una cantidad válida.";
  if (message.includes("invalid_stock_operation")) return "Elegí un tipo de movimiento válido.";
  if (message.includes("forbidden") || message.includes("inactive")) return "No tenés permiso para modificar ese stock o tu perfil está inactivo.";
  if (message.includes("not_found")) return "No encontramos el insumo o la sucursal seleccionada.";
  return "No pudimos registrar el movimiento. Revisá los datos e intentá nuevamente.";
}

export const adjustStockManualAction = withPermission<[ManualStockInput], ManualStockResult>(
  "stock.adjust",
  async (ctx, input) => {
    if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.userId || !ctx.businessId) {
      return { ok: false, persisted: false, error: "Esta acción requiere una sesión y un negocio activos." };
    }
    if (!record(input) || Object.keys(input).some((key) => !["ingredientId", "branchId", "operation", "quantity", "reason", "unit"].includes(key)) || !uuid(input.ingredientId) || !uuid(input.branchId)) {
      return { ok: false, persisted: false, error: "Completá el insumo y la sucursal con datos válidos." };
    }
    if (!["in", "out", "waste", "set"].includes(input.operation)) {
      return { ok: false, persisted: false, error: "Elegí un tipo de movimiento válido." };
    }
    const quantity = input.quantity;
    if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity < 0 || (input.operation !== "set" && quantity <= 0)) {
      return { ok: false, persisted: false, error: "Ingresá una cantidad válida." };
    }
    if (typeof input.reason !== "string" || !input.reason.trim() || input.reason.trim().length > 1000) {
      return { ok: false, persisted: false, error: "Ingresá el motivo del movimiento (hasta 1000 caracteres)." };
    }
    if (input.unit != null && (typeof input.unit !== "string" || !input.unit.trim() || input.unit.length > 50)) {
      return { ok: false, persisted: false, error: "Elegí una unidad válida." };
    }
    if (ctx.assignedBranchIds && !ctx.assignedBranchIds.includes(input.branchId)) {
      return { ok: false, persisted: false, error: "No tenés acceso a esa sucursal." };
    }
    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus datos." };
    if (!await activeProfile(db, ctx.userId)) return { ok: false, persisted: false, error: "Tu perfil no está activo o no se pudo verificar." };
    const [branchRes, ingredientRes] = await Promise.all([
      db.from("branches").select("id,name,business_id").eq("id", input.branchId).eq("business_id", ctx.businessId).maybeSingle(),
      db.from("ingredients").select("id,name,unit,business_id").eq("id", input.ingredientId).eq("business_id", ctx.businessId).maybeSingle(),
    ]);
    if (branchRes.error || !branchRes.data) return { ok: false, persisted: false, error: "No encontramos la sucursal seleccionada." };
    if (ingredientRes.error || !ingredientRes.data) return { ok: false, persisted: false, error: "No encontramos el insumo seleccionado." };
    const baseUnit = ingredientRes.data.unit;
    const unit = input.unit?.trim() ?? baseUnit;
    try {
      if (!normalizeUnit(baseUnit)) return { ok: false, persisted: false, error: "La unidad base del insumo no está soportada. Revisá su unidad en Insumos antes de registrar movimientos." };
      convertQuantity(quantity === 0 ? 1 : quantity, unit, baseUnit);
    } catch {
      return { ok: false, persisted: false, error: "La cantidad o unidad no es compatible con la unidad base del insumo." };
    }
    const rpc = await db.rpc("adjust_stock_manual", {
      p_ingredient_id: input.ingredientId,
      p_branch_id: input.branchId,
      p_operation: input.operation,
      p_quantity: quantity,
      p_reason: input.reason.trim(),
      p_unit: input.unit?.trim() ?? null,
    });
    if (rpc.error) {
      // Supabase can return transport failures as an error object after commit.
      // Only a concrete database rejection is safe to present as not persisted.
      const databaseRejection = /^[0-9A-Z]{5}$/.test(rpc.error.code ?? "") ||
        /insufficient_stock|invalid_stock_|stock_reason_required|incompatible_stock_units|stock_quantity_precision|stock_.*forbidden|stock_actor_inactive/.test(rpc.error.message ?? "");
      if (!databaseRejection) throw new Error("stock_result_unconfirmed");
      return { ok: false, persisted: false, error: manualStockError(rpc.error.message) };
    }
    const result = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
    const newCurrent = dbNumber(result?.new_current);
    const delta = dbNumber(result?.delta);
    // An unexpected RPC response is uncertain, never a fabricated zero balance.
    if (newCurrent === null || delta === null || !result?.stock_item_id) throw new Error("stock_result_unconfirmed");
    // Audit belongs to the same database transaction as the stock movement.
    // Revalidation must not turn an already persisted operation into a failure.
    try { revalidatePath("/stock"); revalidatePath("/auditoria"); } catch { /* Client reloads both stock and history. */ }
    return { ok: true, persisted: true, newCurrent, delta };
  },
);
