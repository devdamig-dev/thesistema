"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { extractTextFromInvoice } from "@/lib/ocr";
import { extractInvoiceFromText } from "@/lib/ai/invoice-extract";
import {
  matchAllItems,
  type IngredientCandidate,
} from "@/lib/ingredients/matching";
import { recalcRecipesForIngredient } from "@/lib/recipes/recalc";
import { logActivity } from "@/lib/data/activity";
import { createNotification } from "@/lib/data/notifications";

/* ============================================================================
   tipos comunes
   ============================================================================ */

type ActionResult<T = unknown> =
  | ({ ok: true; persisted: boolean } & T)
  | { ok: false; persisted: boolean; error: string };

function refresh() {
  revalidatePath("/facturas");
  revalidatePath("/compras");
  revalidatePath("/stock");
  revalidatePath("/productos");
  revalidatePath("/reportes");
}

async function resolveBusiness(db: any): Promise<{ business_id: string; org_id: string } | null> {
  const memberRes = await db
    .from("business_members")
    .select("business_id")
    .limit(1)
    .maybeSingle();
  const member = memberRes.data as { business_id: string } | null;
  if (!member) return null;
  const bizRes = await db
    .from("businesses")
    .select("organization_id")
    .eq("id", member.business_id)
    .maybeSingle();
  const biz = bizRes.data as { organization_id: string } | null;
  return biz ? { business_id: member.business_id, org_id: biz.organization_id } : null;
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

/* ============================================================================
   uploadInvoiceAction
   ============================================================================ */

export async function uploadInvoiceAction(
  formData: FormData,
): Promise<ActionResult<{ invoice_id?: string; summary?: any }>> {
  const file = formData.get("file") as File | null;
  if (!file) return { ok: false, persisted: false, error: "no_file" };

  // Modo demo: corremos el pipeline sin persistir y devolvemos preview.
  if (!isDatabaseMode()) {
    const text = await runOcrInMemory(file);
    const extraction = await extractInvoiceFromText(text);
    return {
      ok: true,
      persisted: false,
      summary: {
        ocr_text: text,
        extraction,
      },
    };
  }

  let adminDb: any;
  try {
    adminDb = createSupabaseAdminClient() as any;
  } catch (error: any) {
    return { ok: false, persisted: false, error: error?.message ?? "admin_client_failed" };
  }

  const ctx = await resolveBusiness(adminDb);
  if (!ctx) return { ok: false, persisted: false, error: "no_business" };

  // 1) Subir a Storage
  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase();
  const fileId = randomUUID();
  const storagePath = `${ctx.org_id}/${ctx.business_id}/${fileId}.${ext}`;
  const bytes = new Uint8Array(await file.arrayBuffer());

  const uploadRes = await adminDb.storage
    .from("invoices")
    .upload(storagePath, bytes, {
      contentType: file.type,
      upsert: false,
    });
  if (uploadRes.error) {
    return { ok: false, persisted: false, error: uploadRes.error.message };
  }

  // 2) Crear invoice (status uploaded) con placeholders
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
    return {
      ok: false,
      persisted: false,
      error: invoiceInsert.error?.message ?? "invoice_insert_failed",
    };
  }
  const invoiceId = invoice.id;

  await logStage(adminDb, invoiceId, "upload", true, {
    storagePath,
    bytes: bytes.byteLength,
  });

  // 3) Marcar processing
  await adminDb
    .from("invoices")
    .update({
      status: "processing",
      processing_started_at: new Date().toISOString(),
    })
    .eq("id", invoiceId);

  // 4) OCR
  let ocrText = "";
  try {
    // Firma una URL para que el provider real pueda bajar el archivo.
    const signed = await adminDb.storage
      .from("invoices")
      .createSignedUrl(storagePath, 60 * 5);
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
      .update({
        ocr_text: ocrText,
        ocr_provider: ocrResult.provider,
      })
      .eq("id", invoiceId);
    if (!ocrText) {
      await adminDb
        .from("invoices")
        .update({ status: "failed", processing_error: ocrResult.error ?? "empty_ocr" })
        .eq("id", invoiceId);
      return {
        ok: false,
        persisted: true,
        error: ocrResult.error ?? "empty_ocr",
      };
    }
  } catch (error: any) {
    await logStage(adminDb, invoiceId, "ocr", false, undefined, error?.message);
    await adminDb
      .from("invoices")
      .update({ status: "failed", processing_error: error?.message })
      .eq("id", invoiceId);
    return { ok: false, persisted: true, error: error?.message ?? "ocr_failed" };
  }

  // 5) Extracción IA del texto OCR
  const extraction = await extractInvoiceFromText(ocrText);
  await logStage(adminDb, invoiceId, "ai", extraction.source !== "failed", {
    source: extraction.source,
    items: extraction.items.length,
    confidence: extraction.confidence,
  }, extraction.error);

  // 6) Resolver supplier si vino con CUIT/nombre
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
        .insert({
          business_id: ctx.business_id,
          name: extraction.supplier,
          tax_id: extraction.tax_id,
        })
        .select("id")
        .maybeSingle();
      supplierId = (created.data as { id: string } | null)?.id ?? null;
    }
  }

  // 7) Update invoice con datos extraídos
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
    .eq("id", invoiceId);

  // 8) Insertar invoice_items + matching
  const ingredientsRes = await adminDb
    .from("ingredients")
    .select("id, name")
    .eq("business_id", ctx.business_id);
  const ingredients =
    ((ingredientsRes.data as { id: string; name: string }[] | null) ?? []) as IngredientCandidate[];

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

/* ============================================================================
   helper · OCR en memoria para demo mode
   ============================================================================ */

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

/* ============================================================================
   approveInvoiceAction
   ============================================================================ */

export async function approveInvoiceAction(
  invoiceId: string,
): Promise<ActionResult<{ purchase_id?: string; recalc?: any[] }>> {
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const db = createSupabaseAdminClient() as any;

  const invoiceRes = await db
    .from("invoices")
    .select("*")
    .eq("id", invoiceId)
    .maybeSingle();
  const invoice = invoiceRes.data as any;
  if (!invoice) return { ok: false, persisted: false, error: "invoice_not_found" };
  if (invoice.status === "approved" || invoice.status === "sent_to_accountant") {
    return { ok: true, persisted: true };
  }

  const itemsRes = await db
    .from("invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId);
  const items = (itemsRes.data as any[]) ?? [];

  // 1) Crear purchase
  const purchaseInsert = await db
    .from("purchases")
    .insert({
      business_id: invoice.business_id,
      supplier_id: invoice.supplier_id,
      purchased_at: invoice.invoice_date,
      total: invoice.total,
      payment_method: invoice.payment_method,
      invoice_id: invoice.id,
    })
    .select("id")
    .maybeSingle();
  const purchase = purchaseInsert.data as { id: string } | null;
  if (!purchase) {
    return { ok: false, persisted: false, error: "purchase_insert_failed" };
  }

  // 2) Crear purchase_items + stock_movements + recalc
  const recalcSummaries: any[] = [];
  const ingredientsToRecalc = new Set<string>();

  for (const item of items) {
    const ingredientId = item.matched_ingredient_id ?? item.suggested_ingredient_id;
    if (ingredientId) ingredientsToRecalc.add(ingredientId);

    await db.from("purchase_items").insert({
      purchase_id: purchase.id,
      ingredient_id: ingredientId,
      description: item.description,
      qty: Number(item.qty_numeric ?? item.qty ?? 0),
      unit: item.unit ?? "u",
      unit_price: Number(item.unit_price ?? 0),
      total: Number(item.total ?? 0),
    });

    // Stock movement — sólo si tenemos ingredient + sucursal principal
    if (ingredientId) {
      const branchRes = await db
        .from("branches")
        .select("id")
        .eq("business_id", invoice.business_id)
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

  // 3) Recalcular avg_unit_cost de cada ingrediente afectado
  //    via RPC, después recalcular productos.
  for (const ingredientId of ingredientsToRecalc) {
    try {
      await db.rpc("recalc_ingredient_cost", { p_ingredient_id: ingredientId });
    } catch {
      // RPC opcional: si la migración 0006 no se aplicó, igual seguimos.
    }
    const summary = await recalcRecipesForIngredient(db, invoice.business_id, ingredientId);
    recalcSummaries.push(summary);
  }
  await logStage(db, invoiceId, "recalc", true, {
    ingredients: ingredientsToRecalc.size,
    products_affected: recalcSummaries.reduce((s, r) => s + r.productsAffected, 0),
    recommendations: recalcSummaries.reduce((s, r) => s + r.recommendationsCreated, 0),
  });

  // 4) Marcar invoice como approved
  await db
    .from("invoices")
    .update({ status: "approved" })
    .eq("id", invoiceId);

  await logStage(db, invoiceId, "approval", true, { purchase_id: purchase.id });

  // Activity feed + notification
  const totalRecommendations = recalcSummaries.reduce(
    (s, r) => s + (r.recommendationsCreated ?? 0),
    0,
  );
  await logActivity({
    businessId: invoice.business_id,
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
    businessId: invoice.business_id,
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

/* ============================================================================
   rejectInvoiceAction
   ============================================================================ */

export async function rejectInvoiceAction(invoiceId: string): Promise<ActionResult> {
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const db = createSupabaseAdminClient() as any;
  const res = await db
    .from("invoices")
    .update({ status: "rejected" })
    .eq("id", invoiceId);
  if (res.error) return { ok: false, persisted: false, error: res.error.message };
  refresh();
  return { ok: true, persisted: true };
}

/* ============================================================================
   updateInvoiceItemAction
   ============================================================================ */

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
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const db = createSupabaseAdminClient() as any;

  const update: Record<string, unknown> = { ...patch };
  if (patch.qty != null) update.qty_numeric = patch.qty;
  if (patch.matched_ingredient_id !== undefined) {
    update.match_status = patch.matched_ingredient_id ? "manual" : "unmatched";
  }

  const res = await db.from("invoice_items").update(update).eq("id", itemId);
  if (res.error) return { ok: false, persisted: false, error: res.error.message };
  refresh();
  return { ok: true, persisted: true };
}
