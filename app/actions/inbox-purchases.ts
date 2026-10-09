"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission, canSeeModule } from "@/lib/permissions";
import { parseInboxPurchaseApproval, parsePurchaseExpectedFields, PURCHASE_UUID, type InboxPurchaseReview } from "@/lib/purchases/inbox";
import { purchaseCommitResult, type PurchaseCommitResult } from "@/lib/purchases/service";
import { readExpenseRows } from "@/lib/expenses/read";
async function session() {
  if (!isDatabaseMode()) throw new Error("Esta revisión requiere un negocio activo.");
  const ctx = await getCurrentUserContext(); const db = await createSupabaseServerClient() as any;
  if (!db || !ctx.isAuthenticated || !ctx.businessId || !ctx.userId || !hasPermission(ctx.role, "inbox.approve") || !canSeeModule(ctx.role, "inbox_ai", ctx.enabledModules)) throw new Error("No tenés permiso para revisar este registro.");
  const profile = await db.from("profiles").select("active").eq("id", ctx.userId).maybeSingle();
  if (profile.error || profile.data?.active !== true) throw new Error("No pudimos verificar el usuario activo.");
  return { db, ctx, businessId: ctx.businessId, userId: ctx.userId };
}
export async function getInboxPurchaseReviewAction(extractionId: string): Promise<{ ok: true; review: InboxPurchaseReview } | { ok: false; error: string }> {
  try {
    if (typeof extractionId !== "string" || !PURCHASE_UUID.test(extractionId)) throw new Error("Extracción inválida.");
    const { db, ctx, businessId, userId } = await session();
    const result = await db.from("ai_extractions").select("id,business_id,branch_id,message_id,type,fields,status").eq("id", extractionId).maybeSingle();
    if (result.error || !result.data) throw new Error("Extracción no disponible."); const e = result.data;
    if (e.type !== "purchase") return { ok: false, error: "unsupported_purchase_extraction" };
    if (!hasPermission(ctx.role, "purchases.create") || !canSeeModule(ctx.role, "purchases", ctx.enabledModules)) throw new Error("No tenés permiso para registrar compras.");
    if (!["pending", "needs_review", "failed", "approved"].includes(e.status)) throw new Error("La extracción ya está cerrada. Revisá la compra guardada antes de crear otra.");
    const message = await db.from("whatsapp_messages").select("business_id,branch_id").eq("id", e.message_id).maybeSingle();
    if (message.error || message.data?.business_id !== businessId || e.business_id && e.business_id !== businessId) throw new Error("No pudimos verificar el contexto de la compra.");
    const branchId = e.branch_id ?? message.data.branch_id ?? null;
    if (e.branch_id && message.data.branch_id && e.branch_id !== message.data.branch_id || branchId && ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(branchId)) throw new Error("Sucursal no autorizada.");
    const [branches, suppliers, ingredients] = await Promise.all([
      readExpenseRows<{ id: string; name: string }>((from, to) => { let q = db.from("branches").select("id,name", { count: "exact" }).eq("business_id", businessId).order("id").range(from, to); if (ctx.assignedBranchIds !== null) q = q.in("id", ctx.assignedBranchIds.length ? ctx.assignedBranchIds : ["00000000-0000-0000-0000-000000000000"]); return q; }),
      readExpenseRows<{ id: string; name: string }>((from, to) => db.from("suppliers").select("id,name", { count: "exact" }).eq("business_id", businessId).eq("active", true).order("id").range(from, to)),
      readExpenseRows<{ id: string; name: string; unit: string }>((from, to) => db.from("ingredients").select("id,name,unit", { count: "exact" }).eq("business_id", businessId).eq("active", true).order("id").range(from, to)),
    ]);
    if (branchId && !branches.some(b => b.id === branchId)) throw new Error("La sucursal de origen no está disponible.");
    const fields = parsePurchaseExpectedFields(e.fields);
    const text = (value: unknown) => typeof value === "string" || typeof value === "number" && Number.isFinite(value) ? String(value) : "";
    const matches = suppliers.filter(s => s.name.trim().toLocaleLowerCase("es-AR") === text(fields.supplier).trim().toLocaleLowerCase("es-AR"));
    return { ok: true, review: { alreadyApproved: e.status === "approved", extractionId, businessId, userId, branchId, branches, suppliers, ingredients, expectedFields: fields, supplierId: matches.length === 1 ? matches[0].id : "", purchasedAt: text(fields.purchased_at ?? fields.date), paymentMethod: text(fields.payment_method), amount: text(fields.total_amount), items: [{ ingredientId: null, description: text(fields.item), qty: text(fields.quantity), unit: text(fields.unit), unitPrice: text(fields.unit_price) }] } };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "No pudimos cargar la revisión." }; }
}
export async function approveInboxPurchaseAction(input: unknown): Promise<PurchaseCommitResult> {
  let parsed; let current: Awaited<ReturnType<typeof session>>;
  try { parsed = parseInboxPurchaseApproval(input); current = await session(); if (parsed.businessId !== current.businessId || parsed.userId !== current.userId || !hasPermission(current.ctx.role, "purchases.create") || !canSeeModule(current.ctx.role, "purchases", current.ctx.enabledModules) || (current.ctx.assignedBranchIds !== null && !current.ctx.assignedBranchIds.includes(parsed.review.branchId))) throw new Error("Cambió la sesión o el negocio. Revisá el intento antes de continuar."); }
  catch (error) { return { ok: false, persisted: false, error: error instanceof Error ? error.message : "Datos inválidos." }; }
  let result: PurchaseCommitResult;
  try { result = purchaseCommitResult(await current.db.rpc("commit_purchase_atomic", { p_business_id: current.businessId, p_input: { expectedFields: parsed.expectedFields, review: parsed.review }, p_extraction_id: parsed.extractionId, p_pending_id: null }), { source: "inbox", kind: parsed.review.kind }); }
  catch { result = { ok: false, persisted: "unknown", error: "Se interrumpió la conexión. La compra podría estar guardada; reintentá exactamente esta revisión." }; }
  if (result.ok) for (const path of ["/inbox", "/compras", "/stock", "/gastos", "/balances", "/auditoria"]) { try { revalidatePath(path); } catch { /* Already committed. */ } }
  return result;
}
