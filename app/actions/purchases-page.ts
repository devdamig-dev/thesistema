"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";

export type PurchasesPageRow = {
  fecha: string;
  proveedor: string;
  insumo: string;
  cantidad: string;
  variacion: number;
  monto: number;
};

export type SupplierSummaryRow = {
  nombre: string;
  rubro: string;
  ordenes: number;
  totalMes: number;
  tendencia: number;
};

export type PurchasesPageData = {
  recentPurchases: PurchasesPageRow[];
  topSuppliers: SupplierSummaryRow[];
  supplierCount: number;
  orderCount: number;
  totalMonth: number;
};

export async function getPurchasesPageDataAction(): Promise<
  { ok: true; data: PurchasesPageData } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "Supabase no está disponible." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  const monthStart = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).slice(0, 7) + "-01";

  const [recentRes, monthRes, suppliersRes] = await Promise.all([
    supabase
      .from("purchases")
      .select("id, supplier_id, purchased_at, total")
      .eq("business_id", ctx.businessId)
      .order("purchased_at", { ascending: false })
      .limit(50),
    supabase
      .from("purchases")
      .select("id, supplier_id, purchased_at, total")
      .eq("business_id", ctx.businessId)
      .gte("purchased_at", monthStart)
      .order("purchased_at", { ascending: false }),
    supabase
      .from("suppliers")
      .select("id, name, category")
      .eq("business_id", ctx.businessId)
      .order("name"),
  ]);

  if (recentRes.error) {
    return { ok: false, error: `No se pudieron leer las compras recientes (${recentRes.error.code ?? "query_error"}).` };
  }
  if (monthRes.error) {
    return { ok: false, error: `No se pudieron leer las compras del mes (${monthRes.error.code ?? "query_error"}).` };
  }
  if (suppliersRes.error) {
    return { ok: false, error: `No se pudieron leer los proveedores (${suppliersRes.error.code ?? "query_error"}).` };
  }

  type PurchaseDbRow = {
    id: string;
    supplier_id: string | null;
    purchased_at: string;
    total: number | string | null;
  };

  const purchases = (recentRes.data ?? []) as PurchaseDbRow[];
  const monthPurchases = (monthRes.data ?? []) as PurchaseDbRow[];
  const suppliers = (suppliersRes.data ?? []) as Array<{
    id: string;
    name: string;
    category: string | null;
  }>;

  const supplierMap = new Map(suppliers.map((s) => [s.id, s]));
  const purchaseIds = purchases.map((p) => p.id);

  let items: Array<{
    purchase_id: string;
    description: string | null;
    qty: number | string | null;
    unit: string | null;
  }> = [];

  if (purchaseIds.length > 0) {
    const itemsRes = await supabase
      .from("purchase_items")
      .select("purchase_id, description, qty, unit")
      .in("purchase_id", purchaseIds)
      .order("created_at", { ascending: true });

    if (itemsRes.error) {
      return { ok: false, error: `No se pudieron leer los ítems de compras (${itemsRes.error.code ?? "query_error"}).` };
    }
    items = itemsRes.data ?? [];
  }

  const firstItemByPurchase = new Map<string, (typeof items)[number]>();
  for (const item of items) {
    if (!firstItemByPurchase.has(item.purchase_id)) firstItemByPurchase.set(item.purchase_id, item);
  }

  const recentPurchases: PurchasesPageRow[] = purchases.map((purchase) => {
    const supplier = purchase.supplier_id ? supplierMap.get(purchase.supplier_id) : undefined;
    const item = firstItemByPurchase.get(purchase.id);
    const qty = Number(item?.qty ?? 0);
    return {
      fecha: new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(`${purchase.purchased_at}T12:00:00-03:00`)),
      proveedor: supplier?.name ?? "Sin proveedor",
      insumo: item?.description ?? "Compra",
      cantidad: item ? `${qty || 0}${item.unit ? ` ${item.unit}` : ""}` : "—",
      variacion: 0,
      monto: Number(purchase.total ?? 0),
    };
  });

  const supplierAgg = new Map<string, SupplierSummaryRow>();
  for (const purchase of monthPurchases) {
    const supplier = purchase.supplier_id ? supplierMap.get(purchase.supplier_id) : undefined;
    const key = purchase.supplier_id ?? "unknown";
    const current = supplierAgg.get(key) ?? {
      nombre: supplier?.name ?? "Sin proveedor",
      rubro: supplier?.category ?? "Sin categoría",
      ordenes: 0,
      totalMes: 0,
      tendencia: 0,
    };
    current.ordenes += 1;
    current.totalMes += Number(purchase.total ?? 0);
    supplierAgg.set(key, current);
  }

  const topSuppliers = [...supplierAgg.values()]
    .sort((a, b) => b.totalMes - a.totalMes)
    .slice(0, 8);

  return {
    ok: true,
    data: {
      recentPurchases,
      topSuppliers,
      supplierCount: suppliers.length,
      orderCount: monthPurchases.length,
      totalMonth: monthPurchases.reduce((sum, purchase) => sum + Number(purchase.total ?? 0), 0),
    },
  };
}
