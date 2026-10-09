"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission } from "@/lib/permissions";
import { withPermission } from "@/lib/permissions/server-action";
import { isSupplierId, isSupplierVersion, supplierError, supplierRpcFields, validateSupplierFields,
  type SupplierCreateInput, type SupplierUpdateInput, type SupplierMutationResult, type SupplierRow,
  type SupplierListData, type SupplierHistory } from "../../lib/suppliers/domain";

const columns = "id,name,tax_id,category,phone,email,payment_terms,notes,active,updated_at";
const reject = (error: string): SupplierMutationResult => ({ ok: false, persisted: false, status: "rejected", error });
function refreshSuppliers() {
  // Cache invalidation must never turn an acknowledged commit into a failure.
  try { revalidatePath("/compras"); revalidatePath("/compras/proveedores"); revalidatePath("/stock"); revalidatePath("/auditoria"); } catch { /* next request reads committed data */ }
}
async function mutate(rpc: string, args: Record<string, unknown>): Promise<SupplierMutationResult> {
  try {
    const db = await createSupabaseServerClient() as any;
    if (!db) return reject("No pudimos conectar con tus datos.");
    const result = await db.rpc(rpc, args);
    if (result.error) return supplierError(result.error);
    if (!result.data || result.data.id !== args.p_id || !isSupplierVersion(result.data.updated_at)) return supplierError(null);
    refreshSuppliers();
    return { ok: true, persisted: true, id: result.data.id, supplier: result.data as SupplierRow };
  } catch { return supplierError(null); }
}

export const createSupplierManualAction = withPermission<[SupplierCreateInput], SupplierMutationResult>("purchases.create", async (ctx, input) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId) return reject("Esta acción requiere una sesión y un negocio activo.");
  const error = validateSupplierFields(input);
  if (error) return reject(error);
  if (!isSupplierId(input.id)) return reject("El identificador del intento no es válido. Volvé a abrir el formulario.");
  return mutate("create_supplier_manual", { ...supplierRpcFields(input), p_id: input.id, p_business_id: ctx.businessId });
});
export const updateSupplierManualAction = withPermission<[SupplierUpdateInput], SupplierMutationResult>("purchases.create", async (ctx, input) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId) return reject("Esta acción requiere una sesión y un negocio activo.");
  const error = validateSupplierFields(input);
  if (error) return reject(error);
  if (!isSupplierId(input.id) || !isSupplierVersion(input.expectedUpdatedAt)) return reject("Recargá el proveedor antes de editarlo.");
  return mutate("update_supplier_manual", { ...supplierRpcFields(input), p_id: input.id, p_expected_updated_at: input.expectedUpdatedAt, p_business_id: ctx.businessId });
});
export const setSupplierActiveAction = withPermission<[{ id: string; expectedUpdatedAt: string; active: boolean }], SupplierMutationResult>("purchases.create", async (ctx, input) => {
  if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId) return reject("Esta acción requiere una sesión y un negocio activo.");
  if (!input || !isSupplierId(input.id) || !isSupplierVersion(input.expectedUpdatedAt) || typeof input.active !== "boolean") return reject("Recargá el proveedor antes de cambiar su estado.");
  return mutate("set_supplier_active_manual", { p_id: input.id, p_expected_updated_at: input.expectedUpdatedAt, p_active: input.active, p_business_id: ctx.businessId });
});

export async function getSuppliersPageDataAction(input: { query?: string; status?: "active" | "archived" | "all"; page?: number } = {}): Promise<{ ok: true; data: SupplierListData } | { ok: false; error: string }> {
  try {
    const ctx = await getCurrentUserContext();
    if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId || !hasPermission(ctx.role, "purchases.view")) return { ok: false, error: "No tenés acceso a los proveedores de este negocio." };
    if (!input || typeof input.query !== "undefined" && typeof input.query !== "string" || (input.query?.length ?? 0) > 200 || !["active", "archived", "all"].includes(input.status ?? "active") || !Number.isInteger(input.page ?? 0) || (input.page ?? 0) < 0 || (input.page ?? 0) > 100000) return { ok: false, error: "Revisá los filtros de búsqueda." };
    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, error: "No pudimos conectar con tus datos." };
    const page = input.page ?? 0; const pageSize = 30;
    let query = db.from("suppliers").select(columns, { count: "exact" }).eq("business_id", ctx.businessId);
    if ((input.status ?? "active") !== "all") query = query.eq("active", input.status !== "archived");
    if (input.query?.trim()) query = query.ilike("name", `%${input.query.trim().replace(/[\\%_]/g, "\\$&")}%`);
    const res = await query.order("name").order("id").range(page * pageSize, (page + 1) * pageSize - 1);
    if (res.error) return { ok: false, error: "No pudimos cargar los proveedores. Verificá que la actualización esté aplicada." };
    return { ok: true, data: { suppliers: res.data ?? [], count: res.count ?? 0, page, pageSize, canManage: hasPermission(ctx.role, "purchases.create"), draftScope: `${ctx.userId}:${ctx.businessId}` } };
  } catch { return { ok: false, error: "No pudimos cargar los proveedores." }; }
}

export async function getSupplierManualAction(id: string): Promise<{ ok: true; supplier: SupplierRow | null } | { ok: false; error: string }> {
  try {
    const ctx = await getCurrentUserContext();
    if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !hasPermission(ctx.role, "purchases.view") || !isSupplierId(id)) return { ok: false, error: "No tenés acceso al proveedor." };
    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, error: "No pudimos conectar con tus datos." };
    const res = await db.from("suppliers").select(columns).eq("id", id).eq("business_id", ctx.businessId).maybeSingle();
    if (res.error) return { ok: false, error: "No pudimos verificar el proveedor." };
    return { ok: true, supplier: res.data ?? null };
  } catch { return { ok: false, error: "No pudimos verificar el proveedor." }; }
}

export async function getSupplierHistoryAction(id: string): Promise<{ ok: true; purchases: SupplierHistory[] } | { ok: false; error: string }> {
  try {
    const ctx = await getCurrentUserContext();
    if (!isDatabaseMode() || !ctx.isAuthenticated || !ctx.businessId || !hasPermission(ctx.role, "purchases.view") || !isSupplierId(id)) return { ok: false, error: "No tenés acceso al historial." };
    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, error: "No pudimos conectar con tus datos." };
    const res = await db.from("purchases").select("id,purchased_at,total,branches(name)").eq("business_id", ctx.businessId).eq("supplier_id", id).order("purchased_at", { ascending: false }).order("id").limit(30);
    if (res.error) return { ok: false, error: "No pudimos cargar las compras del proveedor." };
    const rows = res.data ?? [];
    let items: any[] = [];
    if (rows.length) {
      const detail = await db.from("purchase_items").select("purchase_id,description,qty,unit,ingredients(name)").in("purchase_id", rows.map((row: any) => row.id)).order("created_at");
      if (detail.error) return { ok: false, error: "No pudimos cargar los insumos comprados." };
      items = detail.data ?? [];
    }
    const name = (relation: any) => (Array.isArray(relation) ? relation[0] : relation)?.name;
    return { ok: true, purchases: rows.map((row: any) => ({ id: row.id, purchasedAt: row.purchased_at, branch: name(row.branches) ?? "Sucursal no disponible", total: Number(row.total), items: items.filter((item) => item.purchase_id === row.id).map((item) => ({ description: item.description ?? name(item.ingredients) ?? "Compra", quantity: Number(item.qty), unit: item.unit, ingredient: name(item.ingredients) ?? null })) })) };
  } catch { return { ok: false, error: "No pudimos cargar el historial del proveedor." }; }
}
