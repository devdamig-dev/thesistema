"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/data/auth";
import { executeInboxDebt, prepareInboxDebt, type InboxDebtPreview } from "@/lib/whatsapp-agent/inbox-debts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { logActivity } from "@/lib/data/activity";
import { createNotification } from "@/lib/data/notifications";
import { assertPermission } from "@/lib/permissions/server-action";

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
  branch_id: string | null;
};

/* ============================================================================
   Helpers
   ============================================================================ */

async function loadExtraction(extractionId: string): Promise<{
  supabase: any;
  extraction: ExtractionRow | null;
}> {
  const supabase = await createSupabaseServerClient();
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
  revalidatePath("/deudas");
  revalidatePath("/balances");
  revalidatePath("/stock");
  revalidatePath("/ventas");
  revalidatePath("/auditoria");
}

/* ============================================================================
   Creators por tipo — devuelven el id del registro creado
   ============================================================================ */


/* ============================================================================
   Server actions públicas
   ============================================================================ */

/**
 * Aprueba una extracción y crea el registro real en la tabla destino
 * según el tipo. Si falta info crítica, marca como needs_review.
 */
export async function approveExtractionAction(extractionId: string, debtReviewDigest?: string): Promise<ActionResult> {
  const guard = await assertPermission("inbox.approve");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refreshPaths();
    return { ok: true, persisted: false };
  }

  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db) return { ok: false, persisted: false, error: "database_unavailable" };
  if (!extraction) {
    return { ok: false, persisted: false, error: "extraction_not_found" };
  }
  // Stock owns approval and its source record in the same database transaction.
  // No legacy business/branch/name fallback and no second history/audit write.
  if (extraction.type === "stock_update") {
    const stockGuard = await assertPermission("stock.adjust");
    if (stockGuard) return stockGuard;
    const ctx = await getCurrentUserContext();
    if (!ctx.isAuthenticated || !ctx.businessId) return { ok: false, persisted: false, error: "no_business" };
    if (extraction.business_id && extraction.business_id !== ctx.businessId) return { ok: false, persisted: false, error: "stock_extraction_not_found" };
    const result = await db.rpc("approve_stock_extraction_atomic", {
      p_extraction_id: extractionId,
      p_business_id: ctx.businessId,
    });
    try { refreshPaths(); } catch { /* Confirmed persistence survives a cache-refresh failure. */ }
    if (result.error) return { ok: false, persisted: false, error: "No se confirmó la aprobación de stock. Revisá el historial antes de reintentar." };
    if (!result.data?.ok) return { ok: false, persisted: false,
      error: result.data?.needs_review ? "missing_fields_for_creation" : result.data?.error ?? "stock_approval_failed" };
    if (!result.data.target_record_id) return { ok: false, persisted: false, error: "stock_approval_result_unconfirmed" };
    return { ok: true, persisted: true, target_entity: "stock_movements", target_record_id: result.data.target_record_id };
  }
  if (extraction.type === "employee_advance") return { ok: false, persisted: false, error: "advance_review_required" };
  if (extraction.type === "daily_closure") return { ok: false, persisted: false, error: "closure_review_required" };
  if (extraction.type === "purchase") return { ok: false, persisted: false, error: "purchase_review_required" };
  if (extraction.type === "expense") return { ok: false, persisted: false, error: "expense_review_required" };
  if (extraction.type === "sale") return { ok: false, persisted: false, error: "sale_review_required" };
  if (extraction.status === "approved" && !["debt_created", "debt_payment"].includes(extraction.type)) {
    return { ok: true, persisted: true, target_entity: extraction.target_entity };
  }

  if (extraction.type === "debt_created" || extraction.type === "debt_payment") {
    const ctx = await getCurrentUserContext();
    try {
      const result = await executeInboxDebt(db, ctx, extraction, debtReviewDigest);
      const target = extraction.type === "debt_created" ? "debts" : "debt_payments";
      const targetId = extraction.type === "debt_created" ? result.debtId : result.paymentId;
      // The Inbox wrapper commits financial ledger, approval actor and status in one transaction.
      try {
        await logActivity({ businessId: ctx.businessId!, action: `inbox.${extraction.type}.approved`, targetType: target, targetId, summary: "Operación de deuda revisada y aprobada desde Inbox.", data: { extractionId, debtId: result.debtId } });
        refreshPaths();
      } catch { /* The financial transaction already committed and is audited by its RPC. */ }
      return { ok: true, persisted: true, target_entity: target, target_record_id: targetId };
    } catch (error) {
      await db.from("ai_extractions").update({ status: "needs_review" }).eq("id", extraction.id).in("status", ["pending", "needs_review", "failed"]);
      const code = error instanceof Error ? error.message : "missing_fields_for_creation";
      return { ok: false, persisted: false, error: code };
    }
  }

  const businessId =
    extraction.business_id ?? (await resolveBusinessId(db));
  if (!businessId) {
    return { ok: false, persisted: false, error: "no_business" };
  }
  const branchId = extraction.branch_id ?? await resolveBranchId(db, businessId);
  if (!branchId) return { ok: false, persisted: false, error: "no_branch" };

  // All record-producing types use their reviewed atomic paths above.
  const targetRecordId: string | null = null;

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

  if (businessId) {
    await logActivity({
      businessId,
      action: `inbox.${extraction.type}.approved`,
      targetType: extraction.target_entity ?? undefined,
      targetId: targetRecordId ?? undefined,
      summary: `${extraction.summary ?? extraction.type} · aprobado desde Inbox.`,
      data: { extractionId, type: extraction.type },
    });
    await createNotification({
      businessId,
      tone: "success",
      title: "Movimiento aprobado",
      detail: extraction.summary ?? `Aprobado: ${extraction.type}`,
      href: "/inbox",
      source: "inbox",
    });
  }

  refreshPaths();
  return {
    ok: true,
    persisted: true,
    target_entity: extraction.target_entity,
    target_record_id: targetRecordId,
  };
}

export async function rejectExtractionAction(extractionId: string): Promise<ActionResult> {
  const guard = await assertPermission("inbox.approve");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refreshPaths();
    return { ok: true, persisted: false };
  }
  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db || !extraction) {
    return { ok: false, persisted: false, error: "extraction_not_found" };
  }
  const changed = await db
    .from("ai_extractions")
    .update({ status: "rejected" })
    .eq("id", extractionId)
    .eq("status", extraction.status)
    .eq("fields", JSON.stringify(extraction.fields))
    .in("status", ["pending", "needs_review", "failed"])
    .select("id").maybeSingle();
  if (changed.error || !changed.data) return { ok: false, persisted: false, error: "extraction_changed_or_closed" };
  refreshPaths();
  return { ok: true, persisted: true };
}

export async function requestMoreInfoAction(extractionId: string): Promise<ActionResult> {
  const guard = await assertPermission("inbox.approve");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refreshPaths();
    return { ok: true, persisted: false };
  }
  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db || !extraction) {
    return { ok: false, persisted: false, error: "extraction_not_found" };
  }
  const changed = await db
    .from("ai_extractions")
    .update({ status: "needs_review" })
    .eq("id", extractionId)
    .eq("status", extraction.status)
    .eq("fields", JSON.stringify(extraction.fields))
    .in("status", ["pending", "needs_review", "failed"])
    .select("id").maybeSingle();
  if (changed.error || !changed.data) return { ok: false, persisted: false, error: "extraction_changed_or_closed" };
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
  const guard = await assertPermission("inbox.approve");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refreshPaths();
    return { ok: true, persisted: false };
  }
  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db || !extraction) {
    return { ok: false, persisted: false, error: "extraction_not_found" };
  }
  const typedDebtReplacement = extraction.type === "debt_created" && Object.hasOwn(fields, "planRequest") || extraction.type === "debt_payment" && Object.hasOwn(fields, "paymentRequest");
  const merged = typedDebtReplacement ? fields : { ...(extraction.fields as Record<string, unknown>), ...fields };
  const changed = await db
    .from("ai_extractions")
    .update({ fields: merged })
    .eq("id", extractionId)
    .eq("status", extraction.status)
    .eq("fields", JSON.stringify(extraction.fields))
    .in("status", ["pending", "needs_review", "failed"])
    .select("id").maybeSingle();
  if (changed.error || !changed.data) return { ok: false, persisted: false, error: "extraction_changed_or_closed" };
  refreshPaths();
  return { ok: true, persisted: true };
}

/** Read-only preview. The returned digest binds approval to actor, tenant and complete unchanged payload. */
export async function previewInboxDebtAction(extractionId: string): Promise<{ ok: true; preview: InboxDebtPreview } | { ok: false; error: string }> {
  const guard = await assertPermission("inbox.approve");
  if (guard) return { ok: false, error: guard.error };
  if (!isDatabaseMode()) return { ok: false, error: "database_required" };
  const { supabase: db, extraction } = await loadExtraction(extractionId);
  if (!db || !extraction) return { ok: false, error: "extraction_not_found" };
  try { const prepared = await prepareInboxDebt(db, await getCurrentUserContext(), extraction); return { ok: true, preview: prepared.preview }; }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "missing_fields_for_creation" }; }
}
