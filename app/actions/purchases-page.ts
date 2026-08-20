"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { withPermission } from "@/lib/permissions/server-action";
import { logActivity } from "@/lib/data/activity";

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

export type SupplierOption = {
  id: string;
  name: string;
  category: string | null;
};

export type PurchasesPageData = {
  recentPurchases: PurchasesPageRow[];
  topSuppliers: SupplierSummaryRow[];
  suppliers: SupplierOption[];
  supplierCount: number;
  orderCount: number;
  totalMonth: number;
};

export type SupplierInput = {
  name: string;
  taxId?: string;
  category?: string;
  phone?: string;
  email?: string;
};

export type PurchaseInput = {
  supplierId: string;
  purchasedAt: string;
  paymentMethod: string;
  description: string;
  qty: number;
  unit: string;
  unitPrice: number;
};

type MutationResult =
  | { ok: true; persisted: true; id: string }
  | { ok: false; persisted: false; error: string };

export async function getPurchasesPageDataAction(): Promise<
  { ok: true; data: PurchasesPageData } | { ok: false; error: string }
> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "No pudimos conectar con tus datos." };

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

  if (recentRes.error) return { ok: false, error: "No pudimos cargar las compras recientes." };
  if (monthRes.error) return { ok: false, error: "No pudimos cargar las compras del mes." };
  if (suppliersRes.error) return { ok: false, error: "No pudimos cargar los proveedores." };

  type PurchaseDbRow = {
    id: string;
    supplier_id: string | null;
    purchased_at: string;
    total: number | string | null;
  };

  const purchases = (recentRes.data ?? []) as PurchaseDbRow[];
  const monthPurchases = (monthRes.data ?? []) as PurchaseDbRow[];
  const suppliers = (suppliersRes.data ?? []) as SupplierOption[];
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

    if (itemsRes.error) return { ok: false, error: "No pudimos cargar el detalle de las compras." };
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
      fecha: new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(new Date(`${purchase.purchased_at}T12:00:00-03:00`)),
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
      suppliers,
      supplierCount: suppliers.length,
      orderCount: monthPurchases.length,
      totalMonth: monthPurchases.reduce((sum, purchase) => sum + Number(purchase.total ?? 0), 0),
    },
  };
}

function validateSupplier(input: SupplierInput): string | null {
  if (!input.name.trim()) return "Ingresá el nombre del proveedor.";
  if (input.email?.trim() && !/^\S+@\S+\.\S+$/.test(input.email.trim())) return "Ingresá un email válido.";
  return null;
}

export const createSupplierAction = withPermission<[SupplierInput], MutationResult>(
  "purchases.create",
  async (ctx, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };

    const validation = validateSupplier(input);
    if (validation) return { ok: false, persisted: false, error: validation };

    const db = createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus datos." };

    const res = await db
      .from("suppliers")
      .insert({
        business_id: ctx.businessId,
        name: input.name.trim(),
        tax_id: input.taxId?.trim() || null,
        category: input.category?.trim() || null,
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
      })
      .select("id")
      .maybeSingle();

    if (res.error || !res.data?.id) return { ok: false, persisted: false, error: "No pudimos registrar el proveedor." };

    await logActivity({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorName: ctx.fullName,
      actorRole: ctx.role,
      action: "supplier.created",
      targetType: "suppliers",
      targetId: res.data.id,
      summary: `Proveedor registrado · ${input.name.trim()}`,
      data: { category: input.category?.trim() || null },
    });

    revalidatePath("/compras");
    revalidatePath("/auditoria");
    return { ok: true, persisted: true, id: res.data.id };
  },
);

function validatePurchase(input: PurchaseInput): string | null {
  if (!input.supplierId) return "Elegí un proveedor.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchasedAt)) return "Ingresá una fecha válida.";
  if (!input.paymentMethod.trim()) return "Elegí un medio de pago.";
  if (!input.description.trim()) return "Ingresá el insumo o concepto comprado.";
  if (!Number.isFinite(Number(input.qty)) || Number(input.qty) <= 0) return "Ingresá una cantidad mayor a cero.";
  if (!input.unit.trim()) return "Ingresá la unidad.";
  if (!Number.isFinite(Number(input.unitPrice)) || Number(input.unitPrice) < 0) return "Ingresá un precio unitario válido.";
  return null;
}

export const createPurchaseAction = withPermission<[PurchaseInput], MutationResult>(
  "purchases.create",
  async (ctx, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };

    const validation = validatePurchase(input);
    if (validation) return { ok: false, persisted: false, error: validation };

    const db = createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus datos." };

    const supplierRes = await db
      .from("suppliers")
      .select("id,name")
      .eq("id", input.supplierId)
      .eq("business_id", ctx.businessId)
      .maybeSingle();
    if (supplierRes.error || !supplierRes.data?.id) return { ok: false, persisted: false, error: "El proveedor seleccionado no está disponible." };

    const qty = Number(input.qty);
    const unitPrice = Number(input.unitPrice);
    const total = Math.round(qty * unitPrice * 100) / 100;

    const purchaseRes = await db
      .from("purchases")
      .insert({
        business_id: ctx.businessId,
        supplier_id: input.supplierId,
        purchased_at: input.purchasedAt,
        total,
        payment_method: input.paymentMethod.trim(),
        created_by: ctx.userId,
      })
      .select("id")
      .maybeSingle();

    if (purchaseRes.error || !purchaseRes.data?.id) return { ok: false, persisted: false, error: "No pudimos registrar la compra." };

    const purchaseId = purchaseRes.data.id as string;
    const itemRes = await db.from("purchase_items").insert({
      purchase_id: purchaseId,
      ingredient_id: null,
      description: input.description.trim(),
      qty,
      unit: input.unit.trim(),
      unit_price: unitPrice,
      total,
    });

    if (itemRes.error) {
      await db.from("purchases").delete().eq("id", purchaseId).eq("business_id", ctx.businessId);
      return { ok: false, persisted: false, error: "No pudimos guardar el detalle de la compra." };
    }

    await logActivity({
      businessId: ctx.businessId,
      actorId: ctx.userId,
      actorName: ctx.fullName,
      actorRole: ctx.role,
      action: "purchase.created",
      targetType: "purchases",
      targetId: purchaseId,
      summary: `Compra registrada · ${supplierRes.data.name}`,
      data: {
        supplier_id: input.supplierId,
        purchased_at: input.purchasedAt,
        payment_method: input.paymentMethod.trim(),
        description: input.description.trim(),
        qty,
        unit: input.unit.trim(),
        unit_price: unitPrice,
        total,
      },
    });

    revalidatePath("/compras");
    revalidatePath("/gastos");
    revalidatePath("/balances");
    revalidatePath("/auditoria");
    return { ok: true, persisted: true, id: purchaseId };
  },
);