"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { extractTextFromInvoice } from "@/lib/ocr";
import { extractInvoiceFromText } from "@/lib/ai/invoice-extract";
import { matchAllItems, type IngredientCandidate } from "@/lib/ingredients/matching";
import { recalcRecipesForIngredient } from "@/lib/recipes/recalc";
import { getCurrentUserContext } from "@/lib/data/auth";
import { applyAdminBranchScope } from "@/lib/data/branch-scope";
import { assertPermission } from "@/lib/permissions/server-action";

type ActionResult<T = unknown> =
  | ({ ok: true; persisted: boolean } & T)
  | { ok: false; persisted: boolean; error: string };

type BusinessContext = {
  business_id: string;
  org_id: string;
  actor_id: string;
  assigned_branch_ids: string[] | null;
};

const BRANCH_REQUIRED_ERROR = "Elegí una sucursal habilitada para cargar la factura.";
const BRANCH_FORBIDDEN_ERROR = "No tenés acceso a la sucursal seleccionada.";
const BRANCH_LOOKUP_ERROR = "No pudimos validar la sucursal. Intentá nuevamente.";

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
  return biz
    ? {
        business_id: userCtx.businessId,
        org_id: biz.organization_id,
        actor_id: userCtx.userId!,
        assigned_branch_ids: userCtx.assignedBranchIds,
      }
    : null;
}

function scopeInvoiceQuery(query: any, ctx: BusinessContext) {
  return applyAdminBranchScope(query, ctx.assigned_branch_ids);
}

async function resolveUploadBranch(
  db: any,
  ctx: BusinessContext,
  requestedBranchId: FormDataEntryValue | null,
): Promise<{ ok: true; branchId: string } | { ok: false; error: string }> {
  if (typeof requestedBranchId !== "string" || !requestedBranchId.trim()) {
    return { ok: false, error: BRANCH_REQUIRED_ERROR };
  }
  const branchId = requestedBranchId.trim();

  if (
    ctx.assigned_branch_ids !== null
    && !ctx.assigned_branch_ids.includes(branchId)
  ) {
    return { ok: false, error: BRANCH_FORBIDDEN_ERROR };
  }

  const branch = await db
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("business_id", ctx.business_id)
    .maybeSingle();
  if (branch.error) {
    console.error("[invoices] branch lookup failed", branch.error);
    return { ok: false, error: BRANCH_LOOKUP_ERROR };
  }
  if (!branch.data) return { ok: false, error: BRANCH_FORBIDDEN_ERROR };

  return { ok: true, branchId };
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

async function markInvoiceFailed(
  db: any,
  invoiceId: string,
  businessId: string,
  error: string,
): Promise<boolean> {
  const update = await db
    .from("invoices")
    .update({ status: "failed", processing_error: error })
    .eq("id", invoiceId)
    .eq("business_id", businessId)
    .select("id")
    .maybeSingle();
  if (update.error || !update.data) {
    console.error("[invoices] could not persist failed state", update.error ?? "invoice_not_found");
    return false;
  }
  await logStage(db, invoiceId, "error", false, undefined, error);
  return true;
}

async function removeUploadedObject(db: any, storagePath: string) {
  const cleanup = await db.storage.from("invoices").remove([storagePath]);
  if (cleanup.error) {
    console.error("[invoices] could not remove orphaned upload", cleanup.error);
  }
}

async function finalizationWasCommitted(db: any, invoiceId: string): Promise<boolean> {
  const log = await db
    .from("invoice_processing_logs")
    .select("id, data")
    .eq("invoice_id", invoiceId)
    .eq("stage", "matching")
    .eq("ok", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return !log.error && Boolean((log.data as { data?: { atomic?: boolean } } | null)?.data?.atomic);
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
  const branch = await resolveUploadBranch(adminDb, ctx, formData.get("branch_id"));
  if (!branch.ok) return { ok: false, persisted: false, error: branch.error };

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
      branch_id: branch.branchId,
      created_by: ctx.actor_id,
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
    await removeUploadedObject(adminDb, storagePath);
    return { ok: false, persisted: false, error: invoiceInsert.error?.message ?? "invoice_insert_failed" };
  }
  const invoiceId = invoice.id;

  await logStage(adminDb, invoiceId, "upload", true, {
    storagePath,
    bytes: bytes.byteLength,
    branch_id: branch.branchId,
  });
  const processingUpdate = await adminDb
    .from("invoices")
    .update({ status: "processing", processing_started_at: new Date().toISOString() })
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id)
    .select("id")
    .maybeSingle();
  if (processingUpdate.error || !processingUpdate.data) {
    const error = processingUpdate.error?.message ?? "processing_state_failed";
    await markInvoiceFailed(adminDb, invoiceId, ctx.business_id, error);
    return { ok: false, persisted: true, error };
  }

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
    const ocrUpdate = await adminDb
      .from("invoices")
      .update({ ocr_text: ocrText, ocr_provider: ocrResult.provider })
      .eq("id", invoiceId)
      .eq("business_id", ctx.business_id)
      .select("id")
      .maybeSingle();
    if (ocrUpdate.error || !ocrUpdate.data) {
      const error = ocrUpdate.error?.message ?? "ocr_persistence_failed";
      await markInvoiceFailed(adminDb, invoiceId, ctx.business_id, error);
      return { ok: false, persisted: true, error };
    }
    if (ocrResult.error || !ocrText) {
      const error = ocrResult.error ?? "empty_ocr";
      await markInvoiceFailed(adminDb, invoiceId, ctx.business_id, error);
      return { ok: false, persisted: true, error };
    }
  } catch (error: any) {
    const message = error?.message ?? "ocr_failed";
    await markInvoiceFailed(adminDb, invoiceId, ctx.business_id, message);
    return { ok: false, persisted: true, error: message };
  }

  const extraction = await extractInvoiceFromText(ocrText);
  if (extraction.source === "failed") {
    const error = extraction.error ?? "invoice_extraction_failed";
    await markInvoiceFailed(adminDb, invoiceId, ctx.business_id, error);
    return { ok: false, persisted: true, error };
  }

  const ingredientsRes = await adminDb
    .from("ingredients")
    .select("id, name")
    .eq("business_id", ctx.business_id);
  if (ingredientsRes.error) {
    const error = ingredientsRes.error.message ?? "ingredients_query_failed";
    await markInvoiceFailed(adminDb, invoiceId, ctx.business_id, error);
    return { ok: false, persisted: true, error };
  }
  const ingredients = ((ingredientsRes.data as { id: string; name: string }[] | null) ?? []) as IngredientCandidate[];
  const matched = matchAllItems(extraction.items, ingredients);

  const finalization = await adminDb.rpc("finalize_invoice_extraction_atomic", {
    p_invoice_id: invoiceId,
    p_business_id: ctx.business_id,
    p_actor_id: ctx.actor_id,
    p_invoice_data: {
      supplier: extraction.supplier ?? null,
      tax_id: extraction.tax_id ?? null,
      invoice_type: extraction.invoice_type ?? "B",
      invoice_number: extraction.invoice_number ?? `TEMP-${fileId.slice(0, 8)}`,
      invoice_date: extraction.invoice_date ?? new Date().toISOString().slice(0, 10),
      due_date: extraction.due_date ?? null,
      payment_method: extraction.payment_method ?? "Pendiente",
      subtotal: extraction.subtotal ?? 0,
      tax: extraction.tax ?? 0,
      total: extraction.total ?? 0,
      confidence: extraction.confidence,
      source: extraction.source,
    },
    p_items: matched.map((item) => ({
      description: item.description,
      qty: item.qty,
      unit: item.unit,
      unit_price: item.unit_price,
      total: item.total,
      match_status: item.match.status,
      match_score: item.match.score,
      suggested_ingredient_id: item.match.suggestedId ?? null,
      matched_ingredient_id: item.match.status === "matched" ? item.match.suggestedId ?? null : null,
    })),
  });
  const finalized = finalization.data as {
    ok?: boolean;
    error?: string;
    already_finalized?: boolean;
    item_count?: number;
  } | null;
  if (finalization.error || !finalized?.ok) {
    // PostgREST can lose the response after PostgreSQL committed. Confirm the
    // atomic matching log before changing a successfully finalized invoice to failed.
    if (!(await finalizationWasCommitted(adminDb, invoiceId))) {
      const error = finalized?.error ?? finalization.error?.message ?? "invoice_finalization_failed";
      await markInvoiceFailed(adminDb, invoiceId, ctx.business_id, error);
      return { ok: false, persisted: true, error };
    }
  }

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

  const approvalRes = await db.rpc("approve_invoice_atomic", {
    p_invoice_id: invoiceId,
    p_business_id: ctx.business_id,
    p_actor_id: ctx.actor_id,
  });
  if (approvalRes.error) {
    console.error("[invoices] atomic approval failed", approvalRes.error);
    return { ok: false, persisted: false, error: "approval_failed" };
  }

  const approval = approvalRes.data as {
    ok: boolean;
    error?: string;
    already_approved?: boolean;
    purchase_id?: string;
    invoice_number?: string;
    item_count?: number;
    ingredient_ids?: string[];
  } | null;
  if (!approval?.ok || !approval.purchase_id) {
    return {
      ok: false,
      persisted: false,
      error: approval?.error ?? "approval_failed",
    };
  }

  if (approval.already_approved) {
    refresh();
    return { ok: true, persisted: true, purchase_id: approval.purchase_id, recalc: [] };
  }

  const recalcSummaries: any[] = [];
  const ingredientIds = approval.ingredient_ids ?? [];
  for (const ingredientId of ingredientIds) {
    try {
      const summary = await recalcRecipesForIngredient(db, ctx.business_id, ingredientId);
      recalcSummaries.push(summary);
    } catch (error) {
      console.error("[invoices] post-approval recipe recalculation failed", error);
    }
  }

  await logStage(db, invoiceId, "recalc", recalcSummaries.length === ingredientIds.length, {
    ingredients: ingredientIds.length,
    products_affected: recalcSummaries.reduce((s, r) => s + r.productsAffected, 0),
    recommendations: recalcSummaries.reduce((s, r) => s + r.recommendationsCreated, 0),
  });

  refresh();
  return { ok: true, persisted: true, purchase_id: approval.purchase_id, recalc: recalcSummaries };
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

  let rejectQuery = db
    .from("invoices")
    .update({ status: "rejected" })
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id);
  rejectQuery = scopeInvoiceQuery(rejectQuery, ctx);
  const res = await rejectQuery.select("id").maybeSingle();
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

  let invoiceQuery = db
    .from("invoices")
    .select("storage_path, storage_bucket, file_mime")
    .eq("id", invoiceId)
    .eq("business_id", ctx.business_id);
  invoiceQuery = scopeInvoiceQuery(invoiceQuery, ctx);
  const res = await invoiceQuery.maybeSingle();
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
