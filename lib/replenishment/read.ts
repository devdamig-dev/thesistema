import { hasPermission, type ModuleKey } from "../permissions";
import { localDate, localDateTimeToIso, shiftDate } from "../../app/ventas/reporting";
import { buildReplenishmentReport, validateReplenishmentInput } from "./domain";
import type { ReplenishmentActor, ReplenishmentData, ReplenishmentReport } from "./types";

type Db = { from: (table: string) => any; rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** Exact counts + stable IDs + revision guard; a short server page is not EOF. */
export async function readReplenishmentRows<T extends { id: string }>(factory: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>): Promise<T[]> {
  const rows: T[] = [], ids = new Set<string>(); let count: number | null = null;
  for (let offset = 0; offset < 100000;) {
    const result = await factory(offset, offset + 499);
    if (result.error || !Array.isArray(result.data) || !Number.isSafeInteger(result.count) || (result.count ?? -1) < 0) throw new Error("No se pudo leer el informe completo de reposición.");
    if (result.count! > 100000) throw new Error("Demasiados registros para una lectura completa. Acotá el período.");
    if (count !== null && count !== result.count) throw new Error("Los datos cambiaron durante la lectura. Volvé a consultar.");
    count = result.count!;
    for (const row of result.data) {
      if (typeof row.id !== "string" || ids.has(row.id)) throw new Error("La lectura de reposición es inconsistente. Volvé a consultar.");
      ids.add(row.id); rows.push(row);
    }
    if (rows.length > count) throw new Error("La lectura de reposición es inconsistente. Volvé a consultar.");
    if (rows.length === count) return rows;
    if (result.data.length === 0) throw new Error("La lectura de reposición quedó incompleta.");
    offset += result.data.length;
  }
  throw new Error("El informe supera el límite de lectura segura. Acotá el período.");
}
async function revision(db: Db, actor: ReplenishmentActor): Promise<string> {
  const result = await db.rpc("get_replenishment_revision", { p_business_id: actor.businessId, p_actor_id: actor.userId });
  if (result.error || typeof result.data !== "string" || !/^\d+$/.test(result.data)) throw new Error("No se pudo verificar la versión del informe de reposición.");
  return result.data;
}
async function liveScope(db: Db, actor: ReplenishmentActor, branchId: string) {
  if (!actor.businessId || !actor.userId || !hasPermission(actor.role, "stock.view") || !actor.enabledModules.includes("stock") || (actor.branchIds !== null && !actor.branchIds.includes(branchId))) throw new Error("No tenés acceso a reposición en esa sucursal.");
  const [profile, membership, branch, business, modules] = await Promise.all([
    db.from("profiles").select("id,active").eq("id", actor.userId).maybeSingle(),
    db.from("business_members").select("id,role").eq("business_id", actor.businessId).eq("user_id", actor.userId).maybeSingle(),
    db.from("branches").select("id,name").eq("business_id", actor.businessId).eq("id", branchId).maybeSingle(),
    db.from("businesses").select("id,timezone").eq("id", actor.businessId).maybeSingle(),
    readReplenishmentRows<any>((from, to) => db.from("business_modules").select("id,module_key", { count: "exact" }).eq("business_id", actor.businessId).eq("enabled", true).order("id").range(from, to)),
  ]);
  if ([profile, membership, branch, business].some((result) => result.error || !result.data) || profile.data.active !== true || membership.data.role !== actor.role || typeof business.data.timezone !== "string") throw new Error("No se pudo verificar tu acceso actual a reposición.");
  const enabled = modules.map((row) => row.module_key as ModuleKey).sort();
  if (!enabled.includes("stock")) throw new Error("El módulo Stock no está habilitado.");
  if (!["owner", "admin", "manager", "accountant"].includes(actor.role)) {
    const assigned = await db.from("branch_assignments").select("branch_id").eq("business_member_id", membership.data.id).eq("branch_id", branchId).maybeSingle();
    if (assigned.error || !assigned.data) throw new Error("No tenés acceso a esa sucursal.");
  }
  const canSales = hasPermission(actor.role, "sales.view") && hasPermission(actor.role, "products.view") && enabled.includes("sales") && enabled.includes("products") && actor.enabledModules.includes("sales") && actor.enabledModules.includes("products");
  const canPurchases = hasPermission(actor.role, "purchases.view") && enabled.includes("purchases") && actor.enabledModules.includes("purchases");
  return { branchName: String(branch.data.name), timezone: business.data.timezone as string, canSales, canPurchases, signature: JSON.stringify([membership.data.id, membership.data.role, branch.data, business.data, enabled]) };
}

/** Both transports call this function; service-role agent reads retain every
 * tenant, branch, role and enabled-module predicate explicitly. No dynamic SQL. */
export async function readReplenishment(db: Db, actor: ReplenishmentActor, value: unknown, now = new Date()): Promise<ReplenishmentReport> {
  const input = validateReplenishmentInput(value);
  const before = await revision(db, actor);
  const scope = await liveScope(db, actor, input.branchId);
  const today = localDate(now, scope.timezone);
  if (input.to > today) throw new Error("Elegí un período sin fechas futuras.");
  const start = localDateTimeToIso(`${input.from}T00:00`, scope.timezone);
  const end = input.to === today ? now.toISOString() : localDateTimeToIso(`${shiftDate(input.to, 1)}T00:00`, scope.timezone);
  const { businessId } = actor;
  const branchId = input.branchId;
  const read = (factory: () => any) => readReplenishmentRows<any>((from, to) => factory().order("id").range(from, to));
  const [ingredients, stock, movements, sales, saleLines, purchases, purchaseLines] = await Promise.all([
    read(() => db.from("ingredients").select("id,name,unit,active", { count: "exact" }).eq("business_id", businessId)),
    read(() => db.from("stock_items").select("id,ingredient_id,current,min,updated_at,ingredients!inner(business_id),branches!inner(business_id)", { count: "exact" }).eq("ingredients.business_id", businessId).eq("branches.business_id", businessId).eq("branch_id", branchId)),
    read(() => db.from("stock_movements").select("id,ingredient_id,qty,operation,reason,ref_type,base_unit,balance_before,balance_after,created_at,ingredients!inner(business_id),branches!inner(business_id)", { count: "exact" }).eq("ingredients.business_id", businessId).eq("branches.business_id", businessId).eq("branch_id", branchId).gte("created_at", start).lt("created_at", end)),
    scope.canSales ? read(() => db.from("sales").select("id,sale_kind", { count: "exact" }).eq("business_id", businessId).eq("branch_id", branchId).eq("status", "active").gte("occurred_at", start).lt("occurred_at", end)) : null,
    scope.canSales ? read(() => db.from("sale_items").select("id,sale_id,product_id,description,quantity,recipe_snapshot,sales!inner(business_id,branch_id,status,occurred_at)", { count: "exact" }).eq("business_id", businessId).eq("sales.business_id", businessId).eq("sales.branch_id", branchId).eq("sales.status", "active").gte("sales.occurred_at", start).lt("sales.occurred_at", end)) : null,
    scope.canPurchases ? read(() => db.from("purchases").select("id,purchased_at", { count: "exact" }).eq("business_id", businessId).eq("branch_id", branchId).eq("record_status", "active").gte("purchased_at", input.from).lte("purchased_at", input.to)) : null,
    scope.canPurchases ? read(() => db.from("purchase_items").select("id,purchase_id,ingredient_id,description,qty,unit,purchases!inner(business_id,branch_id,record_status,purchased_at)", { count: "exact" }).eq("purchases.business_id", businessId).eq("purchases.branch_id", branchId).eq("purchases.record_status", "active").gte("purchases.purchased_at", input.from).lte("purchases.purchased_at", input.to)) : null,
  ]);
  const [after, currentScope] = await Promise.all([revision(db, actor), liveScope(db, actor, branchId)]);
  if (before !== after || scope.signature !== currentScope.signature) throw new Error("Los datos o permisos cambiaron durante la lectura. Volvé a consultar.");
  const data: ReplenishmentData = { ingredients, stock, movements, sales, saleLines, purchases, purchaseLines };
  return buildReplenishmentReport(input, { branchName: scope.branchName, timezone: scope.timezone, readAt: now.toISOString(), today }, data);
}
