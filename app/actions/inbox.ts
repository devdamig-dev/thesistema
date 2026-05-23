"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import type {
  ExtractedAdvance,
  ExtractedDailyClosure,
  ExtractedExpense,
  ExtractedPurchase,
  ExtractedSale,
  ExtractedStockUpdate,
  MovementType,
} from "@/lib/ai/types";

/* ============================================================================
   Tipos comunes
   ============================================================================ */

type ActionResult =
  | { ok: true; persisted: boolean; target_entity?: string | null; target_record_id?: string | null }
  | { ok: false; persisted: false; error: string };

type ExtractionRow = {
  id: string;
  message_id: string;
  business_id: string | null;
  type: string;
  fields: any;
  missing: string[];
  confidence: number;
  status: string;
  summary: string | null;
  target_entity: string | null;
};

/* ============================================================================
   Helpers
   ============================================================================ */

async function loadExtraction(extractionId: string): Promise<{
  supabase: any;
  extraction: ExtractionRow | null;
}> {
  const supabase = createSupabaseServerClient();
  if (!supabase) return { supabase: null, extraction: null };
  const db = supabase as any;
  const res = await db
    .from("ai_extractions")
    .select("*")
    .eq("id", extractionId)
    .maybeSingle();
  return { supabase: db, extraction: (res.data as ExtractionRow) ?? null };
}

async function resolveBusinessId(db: any): Promise<string | null> {
  const res = await db
    .from("business_members")
    .select("business_id")
    .limit(1)
    .maybeSingle();
  return (res.data as { business_id: string } | null)?.business_id ?? null;
}

async function resolveBranchId(db: any, businessId: string): Promise<string | null> {
  const res = await db
    .from("branches")
    .select("id")
    .eq("business_id", businessId)
    .eq("is_main", true)
    .limit(1)
    .maybeSingle();
  return (res.data as { id: string } | null)?.id ?? null;
}

function refreshPaths() {
  revalidatePath("/inbox");
  revalidatePath("/");
}

/* ============================================================================
   Creators por tipo — devuelven el id del registro creado
   ============================================================================ */

async function createPurchase(
  db: any,
  businessId: string,
  fields: ExtractedPurchase,
): Promise<string | null> {
  // 1) Resolver o crear supplier
  let supplierId: string | null = null;
  if (fields.supplier) {
    const sup = await db
      .from("suppliers")
      .select("id")
      .eq("business_id", businessId)
      .ilike("name", fields.supplier)
      .limit(1)
      .maybeSingle();
    supplierId = (sup.data as { id: string } | null)?.id ?? null;
    if (!supplierId) {
      const created = await db
        .from("suppliers")
        .insert({ business_id: businessId, name: fields.supplier })
        .select("id")
        .maybeSingle();
      supplierId = (created.data as { id: string } | null)?.id ?? null;
    }
  }

  // 2) Insertar purchase
  const purchase = await db
    .from("purchases")
    .insert({
      business_id: businessId,
      supplier_id: supplierId,
      purchased_at: new Date().toISOString().slice(0, 10),
      total: fields.total_amount ?? 0,
      payment_method: fields.payment_method ?? "Pendiente",
    })
    .select("id")
    .maybeSingle();
  const purchaseId = (purchase.data as { id: string } | null)?.id ?? null;
  if (!purchaseId) return null;

  // 3) Insertar purchase_item (si tenemos datos suficientes)
  if (fields.item && fields.quantity) {
    const unitPrice = fields.unit_price
      ?? (fields.total_amount && fields.quantity ? fields.total_amount / fields.quantity : 0);
    await db.from("purchase_items").insert({
      purchase_id: purchaseId,
      description: fields.item,
      qty: fields.quantity,
      unit: fields.unit ?? "u",
      unit_price: unitPrice,
      total: fields.total_amount ?? unitPrice * fields.quantity,
    });
  }

  return purchaseId;
}

async function createSale(
  db: any,
  businessId: string,
  branchId: string | null,
  fields: ExtractedSale,
): Promise<string | null> {
  // Si vienen múltiples canales, creamos un sale por canal.
  const channels = fields.channels?.length
    ? fields.channels
    : fields.total_amount
      ? [{ channel: "salon", amount: fields.total_amount }]
      : [];
  if (channels.length === 0) return null;

  const inserts = channels.map((c) => ({
    business_id: businessId,
    branch_id: branchId,
    channel: normalizeSalesChannel(c.channel),
    amount: c.amount,
    occurred_at: new Date().toISOString(),
  }));
  const res = await db.from("sales").insert(inserts).select("id");
  const rows = res.data as { id: string }[] | null;
  return rows?.[0]?.id ?? null;
}

function normalizeSalesChannel(channel: string): string {
  const c = channel.toLowerCase().replace(/\s+/g, "_");
  const allowed = ["salon", "delivery", "whatsapp", "pedidos_ya", "rappi", "mp_qr"];
  return allowed.includes(c) ? c : "salon";
}

async function createExpense(
  db: any,
  businessId: string,
  fields: ExtractedExpense,
): Promise<string | null> {
  const res = await db
    .from("expenses")
    .insert({
      business_id: businessId,
      name: fields.concept ?? "Gasto sin nombre",
      category: fields.category ?? "Otros",
      amount: fields.amount ?? 0,
      status: "paid",
    })
    .select("id")
    .maybeSingle();
  return (res.data as { id: string } | null)?.id ?? null;
}

async function createStockMovement(
  db: any,
  branchId: string | null,
  fields: ExtractedStockUpdate,
): Promise<string | null> {
  if (!branchId || !fields.ingredient || fields.qty == null) return null;
  // Buscar ingrediente por nombre
  const ing = await db
    .from("ingredients")
    .select("id")
    .ilike("name", `%${fields.ingredient}%`)
    .limit(1)
    .maybeSingle();
  const ingredientId = (ing.data as { id: string } | null)?.id;
  if (!ingredientId) return null;

  const res = await db
    .from("stock_movements")
    .insert({
      ingredient_id: ingredientId,
      branch_id: branchId,
      reason: fields.reason ?? "manual_adjust",
      qty: fields.qty,
    })
    .select("id")
    .maybeSingle();
  return (res.data as { id: string } | null)?.id ?? null;
}

async function createAdvance(
  db: any,
  businessId: string,
  fields: ExtractedAdvance,
): Promise<string | null> {
  if (!fields.employee_name || fields.amount == null) return null;
  // Buscar empleado por nombre
  const emp = await db
    .from("employees")
    .select("id")
    .eq("business_id", businessId)
    .ilike("full_name", `%${fields.employee_name}%`)
    .limit(1)
    .maybeSingle();
  const employeeId = (emp.data as { id: string } | null)?.id;
  if (!employeeId) return null;

  const res = await db
    .from("advance_payments")
    .insert({
      employee_id: employeeId,
      amount: fields.amount,
      paid_at: new Date().toISOString().slice(0, 10),
      status: "pending",
    })
    .select("id")
    .maybeSingle();
  return (res.data as { id: string } | null)?.id ?? null;
}

async function createDailyClosure(
  db: any,
  businessId: string,
  branchId: string | null,
  fields: ExtractedDailyClosure,
): Promise<string | null> {
  const gross = fields.total ?? (fields.cash ?? 0) + (fields.card ?? 0) + (fields.qr ?? 0);
  const expensesSum = (fields.expenses ?? []).reduce((s, e) => s + (e.amount ?? 0), 0);
  const withdrawal = fields.withdrawal ?? 0;
  const net = gross - expensesSum - withdrawal;

  const incomes = [
    fields.cash ? { method: "Efectivo", amount: fields.cash } : null,
    fields.card ? { method: "Tarjeta", amount: fields.card } : null,
    fields.qr ? { method: "QR", amount: fields.qr } : null,
  ].filter(Boolean);

  const parsed = {
    incomes,
    expenses: fields.expenses ?? [],
    withdrawals: withdrawal ? [{ name: "Retiro", amount: withdrawal }] : [],
    change: fields.change ?? 0,
    products: fields.products ?? [],
    grossTotal: gross,
    netTotal: net,
  };

  const res = await db
    .from("daily_closures")
    .insert({
      business_id: businessId,
      branch_id: branchId,
      closure_date: parseClosureDate(fields.date) ?? new Date().toISOString().slice(0, 10),
      raw_text: fields.business_unit ?? "",
      parsed,
      gross_total: gross,
      net_total: net,
      status: "approved",
    })
    .select("id")
    .maybeSingle();
  return (res.data as { id: string } | null)?.id ?? null;
}

function parseClosureDate(input?: string): string | null {
  if (!input) return null;
  // "16/05" o "16/05/2026" → ISO
  const m = input.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const day = m[1].padStart(2, "0");
  const month = m[2].padStart(2, "0");
  const yearRaw = m[3] ?? String(new Date().getFullYear());
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month}-${day}`;
}

/* ============================================================================
   Server actions públicas
   ============================================================================ */

/**
 * Aprueba una extracción y crea el registro real en la tabla destino
 * según el tipo. Si falta info crítica, marca como needs_review.
 */
export async function approveExtractionAction(extractionId: string): Promise<ActionResult> {
  if (!isDatabaseMode()) {
    refreshPaths();
    return { ok: true, persisted: false };
  }

  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db) return { ok: true, persisted: false };
  if (!extraction) {
    return { ok: false, persisted: false, error: "extraction_not_found" };
  }
  if (extraction.status === "approved") {
    return { ok: true, persisted: true, target_entity: extraction.target_entity };
  }

  const businessId =
    extraction.business_id ?? (await resolveBusinessId(db));
  if (!businessId) {
    return { ok: false, persisted: false, error: "no_business" };
  }
  const branchId = await resolveBranchId(db, businessId);

  let targetRecordId: string | null = null;

  switch (extraction.type as MovementType) {
    case "purchase":
      targetRecordId = await createPurchase(db, businessId, extraction.fields as ExtractedPurchase);
      break;
    case "sale":
      targetRecordId = await createSale(db, businessId, branchId, extraction.fields as ExtractedSale);
      break;
    case "expense":
      targetRecordId = await createExpense(db, businessId, extraction.fields as ExtractedExpense);
      break;
    case "stock_update":
      targetRecordId = await createStockMovement(db, branchId, extraction.fields as ExtractedStockUpdate);
      break;
    case "employee_advance":
      targetRecordId = await createAdvance(db, businessId, extraction.fields as ExtractedAdvance);
      break;
    case "daily_closure":
      targetRecordId = await createDailyClosure(db, businessId, branchId, extraction.fields as ExtractedDailyClosure);
      break;
    case "supplier_price_change":
    case "unknown":
    default:
      // No hay creator definido. Aprobamos sin insertar.
      break;
  }

  // Si esperábamos crear algo y no se pudo (datos faltantes), mark
  // needs_review para que el operador edite y reintente.
  if (extraction.target_entity && !targetRecordId) {
    await db
      .from("ai_extractions")
      .update({ status: "needs_review" })
      .eq("id", extractionId);
    refreshPaths();
    return {
      ok: false,
      persisted: false,
      error: "missing_fields_for_creation",
    };
  }

  await db
    .from("ai_extractions")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      target_record_id: targetRecordId,
    })
    .eq("id", extractionId);

  refreshPaths();
  return {
    ok: true,
    persisted: true,
    target_entity: extraction.target_entity,
    target_record_id: targetRecordId,
  };
}

export async function rejectExtractionAction(extractionId: string): Promise<ActionResult> {
  if (!isDatabaseMode()) {
    refreshPaths();
    return { ok: true, persisted: false };
  }
  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db || !extraction) {
    return { ok: false, persisted: false, error: "extraction_not_found" };
  }
  await db
    .from("ai_extractions")
    .update({ status: "rejected" })
    .eq("id", extractionId);
  refreshPaths();
  return { ok: true, persisted: true };
}

export async function requestMoreInfoAction(extractionId: string): Promise<ActionResult> {
  if (!isDatabaseMode()) {
    refreshPaths();
    return { ok: true, persisted: false };
  }
  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db || !extraction) {
    return { ok: false, persisted: false, error: "extraction_not_found" };
  }
  await db
    .from("ai_extractions")
    .update({ status: "needs_review" })
    .eq("id", extractionId);
  refreshPaths();
  return { ok: true, persisted: true };
}

/**
 * Actualiza campos de la extracción antes de aprobar. Útil cuando el
 * operador corrige algo que la IA detectó mal.
 */
export async function updateExtractionFieldsAction(
  extractionId: string,
  fields: Record<string, unknown>,
): Promise<ActionResult> {
  if (!isDatabaseMode()) {
    refreshPaths();
    return { ok: true, persisted: false };
  }
  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db || !extraction) {
    return { ok: false, persisted: false, error: "extraction_not_found" };
  }
  const merged = { ...(extraction.fields as Record<string, unknown>), ...fields };
  await db
    .from("ai_extractions")
    .update({ fields: merged })
    .eq("id", extractionId);
  refreshPaths();
  return { ok: true, persisted: true };
}
