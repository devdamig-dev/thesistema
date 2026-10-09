"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission } from "@/lib/permissions";
import { withPermission } from "@/lib/permissions/server-action";
import { createSupplierManualAction } from "./suppliers-page";
import type { SupplierCreateInput } from "../../lib/suppliers/domain";

export type PurchasesPageRow = {
  id: string; version: number; status: string; source: string | null;
  fecha: string;
  proveedor: string;
  insumo: string;
  cantidad: string;
  variacion: number;
  monto: number;
  sucursal: string;
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
  active: boolean;
};

export type BranchOption = { id: string; name: string };

export type PurchasesPageData = {
  supplierDraftScope: string;
  canManageSuppliers: boolean;
  recentPurchases: PurchasesPageRow[];
  topSuppliers: SupplierSummaryRow[];
  ingredients: Array<{ id: string; name: string; unit: string }>;
  suppliers: SupplierOption[];
  branches: BranchOption[];
  supplierCount: number;
  orderCount: number;
  totalMonth: number;
};

export type SupplierInput = SupplierCreateInput;

export type PurchaseInput = {
  requestId: string;
  replacesPurchaseId?: string;
  expectedVersion?: number;
  correctionReason?: string;
  ingredientId?: string | null;
  items?: Array<{ ingredientId: string | null; description: string; qty: number; unit: string; unitPrice: number }>;
  branchId: string;
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
  | { ok: false; persisted: false | null; error: string };

async function readCompletePurchaseRows(query:any) {
 const rows:any[]=[]; const ids=new Set<string>(); let expected:number|null=null;
 for(let offset=0;offset<10000;offset+=500){
  const result=await query.range(offset,offset+499);
  if(result.error||!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||result.count>10000||expected!==null&&result.count!==expected)return {data:null,error:{message:"incomplete_purchase_report"}};
  expected=result.count;
  for(const row of result.data){if(ids.has(row.id))return {data:null,error:{message:"changed_purchase_report"}};ids.add(row.id);rows.push(row);}
  if(rows.length===expected)return {data:rows,error:null};
  if(result.data.length<500)return {data:null,error:{message:"incomplete_purchase_report"}};
 }
 return {data:null,error:{message:"purchase_report_limit"}};
}

export async function getPurchasesPageDataAction(): Promise<
  { ok: true; data: PurchasesPageData } | { ok: false; error: string }
> {
  const supabase = await createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "No pudimos conectar con tus datos." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };
  const profile=await supabase.from("profiles").select("active").eq("id",ctx.userId).maybeSingle();
  if(profile.error||!profile.data?.active)return {ok:false,error:"El perfil no está activo."};

  const monthStart = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  }).slice(0, 7) + "-01";

  let branchesQuery = supabase
    .from("branches")
    .select("id, name")
    .eq("business_id", ctx.businessId)
    .order("is_main", { ascending: false })
    .order("created_at");
  if (ctx.assignedBranchIds !== null) {
    branchesQuery = ctx.assignedBranchIds.length > 0
      ? branchesQuery.in("id", ctx.assignedBranchIds)
      : branchesQuery.in("id", ["00000000-0000-0000-0000-000000000000"]);
  }

  const [recentRes, monthRes, suppliersRes, branchesRes, ingredientsRes] = await Promise.all([
    supabase
      .from("purchases")
      .select("id, branch_id, supplier_id, purchased_at, total, version,record_status,source,branches(name)")
      .eq("business_id", ctx.businessId)
      .order("purchased_at", { ascending: false })
      .limit(50),
    readCompletePurchaseRows(supabase
      .from("purchases")
      .select("id, branch_id, supplier_id, purchased_at, total, version,record_status,source,branches(name)",{count:"exact"})
      .eq("business_id", ctx.businessId)
      .eq("record_status", "active")
      .gte("purchased_at", monthStart)
      .order("purchased_at", { ascending: false }).order("id")),
    supabase
      .from("suppliers")
      .select("id, name, category, active")
      .eq("business_id", ctx.businessId)
      .order("name"),
    branchesQuery,
    supabase.from("ingredients").select("id,name,unit", { count: "exact" }).eq("business_id", ctx.businessId).eq("active", true).order("name").limit(1000),
  ]);

  if (ingredientsRes.error || (ingredientsRes.count ?? 0) > (ingredientsRes.data?.length ?? 0)) return { ok: false, error: "No pudimos cargar el catálogo completo de insumos." };
  if (recentRes.error) return { ok: false, error: "No pudimos cargar las compras recientes." };
  if (monthRes.error) return { ok: false, error: "No pudimos cargar las compras del mes." };
  if (suppliersRes.error) return { ok: false, error: "No pudimos cargar los proveedores." };
  if (branchesRes.error) return { ok: false, error: "No pudimos cargar las sucursales disponibles." };

  type PurchaseDbRow = {
    version: number; record_status: string; source: string | null;
    id: string;
    branch_id: string;
    supplier_id: string | null;
    purchased_at: string;
    total: number | string | null;
    branches: { name: string } | Array<{ name: string }> | null;
  };

  const purchases = (recentRes.data ?? []) as PurchaseDbRow[];
  const monthPurchases = (monthRes.data ?? []) as PurchaseDbRow[];
  const suppliers = (suppliersRes.data ?? []) as SupplierOption[];
  const branches = (branchesRes.data ?? []) as BranchOption[];
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
    const branch = Array.isArray(purchase.branches) ? purchase.branches[0] : purchase.branches;
    return {
      id: purchase.id, version: purchase.version, status: purchase.record_status, source: purchase.source,
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
      sucursal: branch?.name ?? "Sucursal no disponible",
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
      ingredients: ingredientsRes.data ?? [],
      recentPurchases,
      topSuppliers,
      supplierDraftScope: `${ctx.userId}:${ctx.businessId}`,
      canManageSuppliers: hasPermission(ctx.role, "purchases.create"),
      suppliers: suppliers.filter((supplier) => supplier.active),
      branches,
      supplierCount: suppliers.filter((supplier) => supplier.active).length,
      orderCount: monthPurchases.length,
      totalMonth: monthPurchases.reduce((sum, purchase) => sum + Number(purchase.total ?? 0), 0),
    },
  };
}

// Legacy action name; callers now supply a stable UUID for safe create reconciliation.
export async function createSupplierAction(input: SupplierInput) {
  return createSupplierManualAction(input);
}

function validatePurchase(input: PurchaseInput): string | null {
  if (!input.branchId) return "Elegí una sucursal.";
  if (!input.supplierId) return "Elegí un proveedor.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchasedAt)) return "Ingresá una fecha válida.";
  if (!input.paymentMethod.trim()) return "Elegí un medio de pago.";
  if (input.items && (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100)) return "Agregá entre 1 y 100 líneas.";
  for (const line of input.items ?? [input]) {
  if (!line.description.trim()) return "Ingresá el insumo o concepto comprado.";
  if (!Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0) return "Ingresá una cantidad mayor a cero.";
  if (!line.unit.trim()) return "Ingresá la unidad.";
  if (!Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0) return "Ingresá un precio unitario válido.";
  }
  return null;
}

export const createPurchaseAction = withPermission<[PurchaseInput], MutationResult>(
  "purchases.create",
  async (ctx, input) => {
    if (!isDatabaseMode()) return { ok: false, persisted: false, error: "Esta acción requiere un negocio activo." };
    if (!ctx.businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };

    const validation = validatePurchase(input);
    if (validation) return { ok: false, persisted: false, error: validation };

    const db = await createSupabaseServerClient() as any;
    if (!db) return { ok: false, persisted: false, error: "No pudimos conectar con tus datos." };

    const supplierRes = await db
      .from("suppliers")
      .select("id,name")
      .eq("id", input.supplierId)
      .eq("active", true)
      .eq("business_id", ctx.businessId)
      .maybeSingle();
    if (supplierRes.error || !supplierRes.data?.id) return { ok: false, persisted: false, error: "El proveedor seleccionado no está disponible." };

    if (ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(input.branchId)) {
      return { ok: false, persisted: false, error: "La sucursal seleccionada no está asignada a tu usuario." };
    }
    const branchRes = await db.from("branches").select("id,name")
      .eq("id", input.branchId).eq("business_id", ctx.businessId).maybeSingle();
    if (branchRes.error || !branchRes.data?.id) {
      return { ok: false, persisted: false, error: "La sucursal seleccionada no está disponible." };
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId ?? "")) {
      return { ok: false, persisted: false, error: "Falta la referencia del intento. Reabrí el formulario." };
    }
    let response;
    try {
      const payload = {
        requestId: input.requestId, branchId: input.branchId, supplierId: input.supplierId,
        purchasedAt: input.purchasedAt, paymentMethod: input.paymentMethod.trim(),
        ...(input.replacesPurchaseId ? {replacesPurchaseId:input.replacesPurchaseId,correctionReason:input.correctionReason?.trim()} : {}),
        items: (input.items ?? [input]).map(line => ({ ingredientId: line.ingredientId ?? null, description: line.description.trim(),
          qty: String(line.qty), unit: line.unit.trim(), unitPrice: String(line.unitPrice) })),
      };
      response = input.replacesPurchaseId ? await db.rpc("replace_purchase_manual_atomic", {p_business_id:ctx.businessId,p_original_id:input.replacesPurchaseId,p_expected_version:input.expectedVersion,p_reason:input.correctionReason?.trim(),p_input:payload})
        : await db.rpc("create_purchase_manual_atomic", {p_business_id:ctx.businessId,p_input:payload});
    } catch {
      return { ok: false, persisted: null, error: "No se confirmó el resultado. Conservá este intento y revisá Compras antes de volver a cargarlo." };
    }
    if (response.error || !response.data?.ok || !response.data?.id) {
      const rejected = typeof response.error?.code === "string" && /^(22|23|42|P0001)/.test(response.error.code);
      return { ok: false, persisted: rejected ? false : null, error: "No se confirmó la compra. Revisá datos y Compras; reutilizá el mismo intento para evitar duplicados." };
    }
    try {
      for (const path of ["/compras", "/gastos", "/balances", "/stock", "/auditoria"]) revalidatePath(path);
    } catch { /* The database transaction is already confirmed. */ }
    return { ok: true, persisted: true, id: response.data.id };
  },
);

export const voidPurchaseAction = withPermission<[{ id: string; expectedVersion: number; reason: string }], MutationResult>("purchases.create", async (ctx,input) => {
  if (!isDatabaseMode() || !ctx.businessId || !input.id || !Number.isSafeInteger(input.expectedVersion) || !input.reason.trim()) return {ok:false,persisted:false,error:"Revisá el registro y el motivo."};
  const db=await createSupabaseServerClient() as any;
  if(!db)return {ok:false,persisted:false,error:"No se pudo conectar."};
  try {
    const result=await db.rpc("void_purchase_manual_atomic",{p_business_id:ctx.businessId,p_id:input.id,p_expected_version:input.expectedVersion,p_reason:input.reason.trim()});
    if(result.error||!result.data?.ok)return {ok:false,persisted:null,error:"No se confirmó la anulación. Revisá si la compra cambió o si sus insumos ya se consumieron. Reintentá el mismo motivo para verificar."};
    try {for(const path of ["/compras","/stock","/gastos","/balances","/auditoria"])revalidatePath(path);}catch{}
    return {ok:true,persisted:true,id:result.data.id};
  }catch{return {ok:false,persisted:null,error:"Conexión interrumpida. Revisá el estado antes de crear otra operación."};}
});

export const getPurchaseCorrectionAction = withPermission<[string], {ok:true;input:PurchaseInput}|{ok:false;error:string}>("purchases.create",async(ctx,id)=>{
 const db=await createSupabaseServerClient() as any;
 if(!isDatabaseMode()||!db||!ctx.businessId)return {ok:false,error:"No se pudo conectar al negocio."};
 const result=await db.from("purchases").select("id,branch_id,supplier_id,purchased_at,payment_method,version,record_status,source").eq("id",id).eq("business_id",ctx.businessId).maybeSingle();
 const p=result.data;
 if(result.error||!p||p.source!=="manual"||p.record_status!=="active"||ctx.assignedBranchIds!==null&&!ctx.assignedBranchIds.includes(p.branch_id))return {ok:false,error:"La compra no está disponible para corregir."};
 const lines=await db.from("purchase_items").select("ingredient_id,description,qty,unit,unit_price",{count:"exact"}).eq("purchase_id",p.id).order("id").limit(100);
 if(lines.error||!lines.data?.length||lines.count!==lines.data.length)return {ok:false,error:"No se pudo leer el detalle completo."};
 const items=lines.data.map((l:any)=>({ingredientId:l.ingredient_id,description:l.description,qty:Number(l.qty),unit:l.unit,unitPrice:Number(l.unit_price)}));
 return {ok:true,input:{requestId:"",replacesPurchaseId:p.id,expectedVersion:p.version,correctionReason:"",branchId:p.branch_id,supplierId:p.supplier_id,purchasedAt:p.purchased_at,paymentMethod:p.payment_method,...items[0],items}};
});
