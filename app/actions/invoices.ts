"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { extractTextFromInvoice } from "@/lib/ocr";
import { extractInvoiceFromText } from "@/lib/ai/invoice-extract";
import { matchAllItems, type IngredientCandidate } from "@/lib/ingredients/matching";
import { recalcRecipesForIngredient } from "@/lib/recipes/recalc";
import { logActivity } from "@/lib/data/activity";
import { createNotification } from "@/lib/data/notifications";
import { getCurrentUserContext } from "@/lib/data/auth";
import { assertPermission } from "@/lib/permissions/server-action";

type ActionResult<T = unknown> =
  | ({ ok: true; persisted: boolean } & T)
  | { ok: false; persisted: boolean; error: string };

type BusinessContext = { business_id: string; org_id: string };

function refresh() {
  revalidatePath("/facturas");
  revalidatePath("/compras");
  revalidatePath("/stock");
  revalidatePath("/productos");
  revalidatePath("/reportes");
}

/**
 * Resolve the active business from the authenticated user, never from an
 * unrestricted admin query. The admin client is used only after this tenant
 * boundary has been established.
 */
async function resolveBusiness(db: any): Promise<BusinessContext | null> {
  const userCtx = await getCurrentUserContext();
  if (!userCtx.isAuthenticated || !userCtx.businessId) return null;

  const bizRes = await db
    .from("businesses")
    .select("organization_id")
    .eq("id", userCtx.businessId)
    .maybeSingle();
  const biz = bizRes.data as { organization_id: string } | null;
  return biz ? { business_id: userCtx.businessId, org_id: biz.organization_id } : null;
}

async function logStage(
  db: any,
  invoiceId: string,
  stage: string,
  ok: boolean,
  data?: unknown,
  message?: string,
  durationMs?: number,
) {
  await db.from("invoice_processing_logs").insert({
    invoice_id: invoiceId,
    stage,
    ok,
    message,
    data,
    duration_ms: durationMs,
  });
}

export async function uploadInvoiceAction(
  formData: FormData,
): Promise<ActionResult<{ invoice_id?: string; summary?: any }>> {
  const guard = await assertPermission("invoices.upload");
  if (guard) return guard;

  const file = formData.get("file") as File | null;
  if (!file) return { ok: false, persisted: false, error: "no_file" };

  if (!isDatabaseMode()) {
    const text = await runOcrInMemory(file);
    const extraction = await extractInvoiceFromText(text);
    return { ok: true, persisted: false, summary: { ocr_text: text, extraction } };
  }

  let adminDb: any;
  try {
    adminDb = createSupabaseAdminClient() as any;
  } catch (error: any) {
    return { ok: false, persisted: false, error: error?.message ?? "admin_client_failed" };
  }

  const ctx = await resolveBusiness(adminDb);
  if (!ctx) return { ok: false, persisted: false, error: "no_business" };

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const fileId = randomUUID();
  const storagePath = `${ctx.org_id}/${ctx.business_id}/${fileId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const uploadRes = await adminDb.storage.from("invoices").upload(storagePath, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadRes.error) return { ok: false, persisted: false, error: uploadRes.error.message };

  const invoiceInsert = await adminDb
    .from("invoices")
    .insert({
      business_id: ctx.business_id,
      number: `TEMP-${fileId.slice(0, 8)}`,
      type: "B",
      invoice_date: new Date().toISOString().slice(0, 10),
      subtotal: 0,
      tax: 0,
      total: 0,
      status: "uploaded",
      confidence: 0,
      source: ext === "pdf" ? "pdf" : "foto",
      storage_path: storagePath,
      storage_bucket: "invoices",
      file_mime: file.type,
      file_size: bytes.byteLength,
      sender: file.name,
    })
    .select("id")
    .maybeSingle();
  const invoice = invoiceInsert.data as { id: string } | null;
  if (!invoice) {
    return { ok: false, persisted: false, error: invoiceInsert.error?.message ?? "invoice_insert_failed" };
  }
  const invoiceId = invoice.id;

  await logStage(adminDb, invoiceId, "upload", true, { storagePath, bytes: bytes.byteLength });
  await adminDb
    .from("invoices")
    .update({ status: "processing", processing_started_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id);

  let ocrText = "";
  try {
    const signed = await adminDb.storage.from("invoices").createSignedUrl(storagePath, 60 * 5);
    const ocrResult = await extractTextFromInvoice({
      storagePath,
      mime: file.type,
      filename: file.name,
      signedUrl: (signed.data as any)?.signedUrl,
      bytes,
    });
    ocrText = ocrResult.text;
    await logStage(
      adminDb,
      invoiceId,
      "ocr",
      !ocrResult.error,
      { provider: ocrResult.provider, confidence: ocrResult.confidence },
      ocrResult.error,
      ocrResult.durationMs,
    );
    await adminDb
      .from("invoices")
      .update({ ocr_text: ocrText, ocr_provider: ocrResult.provider })
      .eq("id", invoiceId)
      .eq("business_id", ctx.business_id);
    if (!ocrText) {
      await adminDb
        .from("invoices")
        .update({ status: "failed", processing_error: ocrResult.error ?? "empty_ocr" })
        .eq("id", invoiceId)
        .eq("business_id", ctx.business_id);
      return { ok: false, persisted: true, error: ocrResult.error ?? "empty_ocr" };
    }
  } catch (error: any) {
    await logStage(adminDb, invoiceId, "ocr", false, undefined, error?.message);
    await adminDb
      .from("invoices")
      .update({ status: "failed", processing_error: error?.message })
      .eq("id", invoiceId)
      .eq("business_id", ctx.business_id);
    return { ok: false, persisted: true, error: error?.message ?? "ocr_failed" };
  }

  const extraction = await extractInvoiceFromText(ocrText);
  await logStage(
    adminDb,
    invoiceId,
    "ai",
    extraction.source !== "failed",
    { source: extraction.source, items: extraction.items.length, confidence: extraction.confidence },
    extraction.error,
  );

  let supplierId: string | null = null;
  if (extraction.supplier) {
    const sup = await adminDb
      .from("suppliers")
      .select("id")
      .eq("business_id", ctx.business_id)
      .ilike("name", extraction.supplier)
      .limit(1)
      .maybeSingle();
    supplierId = (sup.data as { id: string } | null)?.id ?? null;
    if (!supplierId) {
      const created = await adminDb
        .from("suppliers")
        .insert({ business_id: ctx.business_id, name: extraction.supplier, tax_id: extraction.tax_id })
        .select("id")
        .maybeSingle();
      supplierId = (created.data as { id: string } | null)?.id ?? null;
    }
  }

  await adminDb
    .from("invoices")
    .update({
      supplier_id: supplierId,
      number: extraction.invoice_number ?? `TEMP-${fileId.slice(0, 8)}`,
      type: extraction.invoice_type ?? "B",
      tax_id: extraction.tax_id ?? null,
      invoice_date: extraction.invoice_date ?? new Date().toISOString().slice(0, 10),
      payment_method: extraction.payment_method ?? "Pendiente",
      subtotal: extraction.subtotal ?? 0,
      tax: extraction.tax ?? 0,
      total: extraction.total ?? 0,
      confidence: extraction.confidence,
      ai_provider: extraction.source,
      status: extraction.confidence >= 0.7 ? "extracted" : "needs_review",
      processing_completed_at: new Date().toISOString(),
    })
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id);

  const ingredientsRes = await adminDb
    .from("ingredients")
    .select("id, name")
    .eq("business_id", ctx.business_id);
  const ingredients = ((ingredientsRes.data as { id: string; name: string }[] | null) ?? []) as IngredientCandidate[];
  const matched = matchAllItems(extraction.items, ingredients);

  for (const item of matched) {
    await adminDb.from("invoice_items").insert({
      invoice_id: invoiceId,
      description: item.description,
      qty: String(item.qty),
      qty_numeric: item.qty,
      unit: item.unit,
      unit_price: item.unit_price,
      total: item.total,
      match_status: item.match.status,
      match_score: item.match.score,
      suggested_ingredient_id: item.match.suggestedId ?? null,
      matched_ingredient_id: item.match.status === "matched" ? item.match.suggestedId ?? null : null,
    });
  }
  await logStage(adminDb, invoiceId, "matching", true, {
    items: matched.length,
    matched: matched.filter((m) => m.match.status === "matched").length,
    ambiguous: matched.filter((m) => m.match.status === "ambiguous").length,
    unmatched: matched.filter((m) => m.match.status === "unmatched").length,
  });

  refresh();
  return {
    ok: true,
    persisted: true,
    invoice_id: invoiceId,
    summary: { extraction, matched: matched.length, ingredients: ingredients.length },
  };
}

async function runOcrInMemory(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ocrResult = await extractTextFromInvoice({
    storagePath: `demo/${file.name}`,
    mime: file.type,
    filename: file.name,
    bytes,
  });
  return ocrResult.text;
}

export async function approveInvoiceAction(
  invoiceId: string,
): Promise<ActionResult<{ purchase_id?: string; recalc?: any[] }>> {
  const guard = await assertPermission("invoices.approve");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }

  const db = createSupabaseAdminClient() as any;
  const ctx = await resolveBusiness(db);
  if (!ctx) return { ok: false, persisted: false, error: "no_business" };

  const invoiceRes = await db
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id)
    .maybeSingle();
  const invoice = invoiceRes.data as any;
  if (!invoice) return { ok: false, persisted: false, error: "invoice_not_found" };
  if (invoice.status === "approved" || invoice.status === "sent_to_accountant") {
    return { ok: true, persisted: true };
  }

  const itemsRes = await db.from("invoice_items").select("*").eq("invoice_id", invoiceId);
  const items = (itemsRes.data as any[]) ?? [];

  const purchaseInsert = await db
    .from("purchases")
    .insert({
      business_id: ctx.business_id,
      supplier_id: invoice.supplier_id,
      purchased_at: invoice.invoice_date,
      total: invoice.total,
      payment_method: invoice.payment_method,
      invoice_id: invoice.id,
    })
    .select("id")
    .maybeSingle();
  const purchase = purchaseInsert.data as { id: string } | null;
  if (!purchase) return { ok: false, persisted: false, error: "purchase_insert_failed" };

  const recalcSummaries: any[] = [];
  const ingredientsToRecalc = new Set<string>();

  for (const item of items) {
    const ingredientId = item.matched_ingredient_id ?? item.suggested_ingredient_id;
    if (ingredientId) {
      const ownedIngredient = await db
        .from("ingredients")
        .select("id")
        .eq("id", ingredientId)
        .eq("business_id", ctx.business_id)
        .maybeSingle();
      if (!ownedIngredient.data) continue;
      ingredientsToRecalc.add(ingredientId);
    }

    await db.from("purchase_items").insert({
      purchase_id: purchase.id,
      ingredient_id: ingredientId || null,
      description: item.description,
      qty: Number(item.qty_numeric ?? item.qty ?? 0),
      unit: item.unit ?? "u",
      unit_price: Number(item.unit_price ?? 0),
      total: Number(item.total ?? 0),
    });

    if (ingredientId) {
      const branchRes = await db
        .from("branches")
        .select("id")
        .eq("business_id", ctx.business_id)
        .eq("is_main", true)
        .limit(1)
        .maybeSingle();
      const branch = branchRes.data as { id: string } | null;
      if (branch) {
        await db.from("stock_movements").insert({
          ingredient_id: ingredientId,
          branch_id: branch.id,
          reason: "purchase",
          qty: Number(item.qty_numeric ?? item.qty ?? 0),
          ref_type: "purchase",
          ref_id: purchase.id,
        });
      }
    }
  }

  for (const ingredientId of ingredientsToRecalc) {
    try {
      await db.rpc("recalc_ingredient_cost", { p_ingredient_id: ingredientId });
    } catch {}
    const summary = await recalcRecipesForIngredient(db, ctx.business_id, ingredientId);
    recalcSummaries.push(summary);
  }

  await logStage(db, invoiceId, "recalc", true, {
    ingredients: ingredientsToRecalc.size,
    products_affected: recalcSummaries.reduce((s, r) => s + r.productsAffected, 0),
    recommendations: recalcSummaries.reduce((s, r) => s + r.recommendationsCreated, 0),
  });

  await db
    .from("invoices")
    .update({ status: "approved" })
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id);
  await logStage(db, invoiceId, "approval", true, { purchase_id: purchase.id });

  const totalRecommendations = recalcSummaries.reduce((s, r) => s + (r.recommendationsCreated ?? 0), 0);
  await logActivity({
    businessId: ctx.business_id,
    action: "invoice.approved",
    targetType: "invoices",
    targetId: invoiceId,
    summary: `Factura ${invoice.number} aprobada · ${items.length} ítems · purchase creada.`,
    data: {
      invoice_id: invoiceId,
      purchase_id: purchase.id,
      ingredients_affected: ingredientsToRecalc.size,
      recommendations_created: totalRecommendations,
    },
  });
  await createNotification({
    businessId: ctx.business_id,
    tone: totalRecommendations > 0 ? "warn" : "success",
    title: totalRecommendations > 0
      ? `${totalRecommendations} alerta(s) de margen tras aprobar factura`
      : "Factura aprobada e imputada",
    detail: `${invoice.number} · ${items.length} ítems · stock actualizado.`,
    href: "/facturas",
    source: "invoices",
  });

  refresh();
  return { ok: true, persisted: true, purchase_id: purchase.id, recalc: recalcSummaries };
}

export async function rejectInvoiceAction(invoiceId: string): Promise<ActionResult> {
  const guard = await assertPermission("invoices.approve");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }

  const db = createSupabaseAdminClient() as any;
  const ctx = await resolveBusiness(db);
  if (!ctx) return { ok: false, persisted: false, error: "no_business" };

  const res = await db
    .from("invoices")
    .update({ status: "rejected" })
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id)
    .select("id")
    .maybeSingle();
  if (res.error) return { ok: false, persisted: false, error: res.error.message };
  if (!res.data) return { ok: false, persisted: false, error: "invoice_not_found" };
  refresh();
  return { ok: true, persisted: true };
}

export async function getInvoiceAttachmentUrlAction(
  invoiceId: string,
): Promise<
  | { ok: true; persisted: boolean; url: string; mime?: string; demo?: boolean }
  | { ok: false; persisted: boolean; error: string }
> {
  const guard = await assertPermission("invoices.view");
  if (guard) return guard;

  if (!isDatabaseMode()) {
    return { ok: true, persisted: false, demo: true, url: "about:blank" };
  }

  let db: any;
  try {
    db = createSupabaseAdminClient();
  } catch (error: any) {
    return { ok: false, persisted: false, error: error?.message ?? "admin_failed" };
  }

  const ctx = await resolveBusiness(db);
  if (!ctx) return { ok: false, persisted: false, error: "no_business" };

  const res = await db
    .from("invoices")
    .select("storage_path, storage_bucket, file_mime")
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id)
    .maybeSingle();
  const row = res.data as
    | { storage_path: string | null; storage_bucket: string | null; file_mime: string | null }
    | null;
  if (!row || !row.storage_path) return { ok: false, persisted: true, error: "no_attachment" };

  const bucket = row.storage_bucket ?? "invoices";
  const signed = await db.storage.from(bucket).createSignedUrl(row.storage_path, 60 * 10);
  const url = (signed.data as any)?.signedUrl as string | undefined;
  if (!url) return { ok: false, persisted: true, error: signed.error?.message ?? "signed_url_failed" };
  return { ok: true, persisted: true, url, mime: row.file_mime ?? undefined };
}

export async function updateInvoiceItemAction(
  itemId: string,
  patch: {
    description?: string;
    qty?: number;
    unit?: string;
    unit_price?: number;
    total?: number;
    matched_ingredient_id?: string | null;
  },
): Promise<ActionResult> {
  const guard = await assertPermission("invoices.approve");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }

  const db = createSupabaseAdminClient() as any;
  const ctx = await resolveBusiness(db);
  if (!ctx) return { ok: false, persisted: false, error: "no_business" };

  const itemRes = await db.from("invoice_items").select("invoice_id").eq("id", itemId).maybeSingle();
  const item = itemRes.data as { invoice_id: string } | null;
  if (!item) return { ok: false, persisted: false, error: "item_not_found" };

  const ownedInvoice = await db
    .from("invoices")
    .select("id")
    .eq("id", item.invoice_id)
    .eq("business_id", ctx.business_id)
    .maybeSingle();
  if (!ownedInvoice.data) return { ok: false, persisted: false, error: "item_not_found" };

  if (patch.matched_ingredient_id) {
    const ingredient = await db
      .from("ingredients")
      .select("id")
      .eq("id", patch.matched_ingredient_id)
      .eq("business_id", ctx.business_id)
      .maybeSingle();
    if (!ingredient.data) return { ok: false, persisted: false, error: "ingredient_not_found" };
  }

  const update: Record<string, unknown> = { ...patch };
  if (patch.qty != null) update.qty_numeric = patch.qty;
  if (patch.matched_ingredient_id !== undefined) {
    update.match_status = patch.matched_ingredient_id ? "manual" : "unmatched";
  }

  const res = await db.from("invoice_items").update(update).eq("id", itemId).eq("invoice_id", item.invoice_id);
  if (res.error) return { ok: false, persisted: false, error: res.error.message };
  refresh();
  return { ok: true, persisted: true };
}
