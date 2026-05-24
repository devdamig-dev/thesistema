/**
 * Checks "on demand" para disparar notificaciones que dependen de
 * un cron (vencimientos, stock crítico, ingredientes sin movimiento).
 *
 * Idempotentes — dedup por business_id + title + source dentro de las
 * últimas 24 horas, para no spamear.
 *
 * Pueden invocarse desde:
 *   - una edge function programada cada N minutos.
 *   - un endpoint `/api/cron/...` protegido por token.
 *   - manualmente desde la UI ("Re-chequear ahora").
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { createNotification, type NotificationPriority } from "@/lib/data/notifications";

type CheckSummary = { created: number; skipped: number };

const DEDUP_WINDOW_HOURS = 24;

async function notificationAlreadyExists(
  db: any,
  businessId: string,
  title: string,
  source: string,
): Promise<boolean> {
  const since = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3600_000).toISOString();
  const res = await db
    .from("notifications")
    .select("id")
    .eq("business_id", businessId)
    .eq("title", title)
    .eq("source", source)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  return !!res.data;
}

/* ============================================================================
   Deudas próximas a vencer + vencidas
   ============================================================================ */

export async function checkDebtsForBusiness(businessId: string): Promise<CheckSummary> {
  if (!isDatabaseMode()) return { created: 0, skipped: 0 };
  const db = createSupabaseAdminClient() as any;
  let created = 0;
  let skipped = 0;

  const todayISO = new Date().toISOString().slice(0, 10);
  const in3DaysISO = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);

  // 1) Deudas vencidas — pending > 0 y due_date < hoy
  const overdueRes = await db
    .from("debts")
    .select("id, creditor, pending_amount, due_date")
    .eq("business_id", businessId)
    .neq("status", "settled")
    .lt("due_date", todayISO);
  const overdue = (overdueRes.data as any[]) ?? [];

  for (const d of overdue) {
    const title = `Deuda vencida · ${d.creditor}`;
    if (await notificationAlreadyExists(db, businessId, title, "debts")) {
      skipped++;
      continue;
    }
    await createNotification({
      businessId,
      tone: "danger",
      priority: "high",
      category: "debt",
      title,
      detail: `Saldo pendiente $${Number(d.pending_amount).toLocaleString("es-AR")} · vencía ${d.due_date}`,
      href: "/deudas",
      source: "debts",
    });
    // Marcar status overdue si todavía no
    await db.from("debts").update({ status: "overdue" }).eq("id", d.id);
    created++;
  }

  // 2) Deudas que vencen en los próximos 3 días
  const soonRes = await db
    .from("debts")
    .select("id, creditor, pending_amount, due_date")
    .eq("business_id", businessId)
    .neq("status", "settled")
    .gte("due_date", todayISO)
    .lte("due_date", in3DaysISO);
  const soon = (soonRes.data as any[]) ?? [];

  for (const d of soon) {
    const title = `Vencimiento próximo · ${d.creditor}`;
    if (await notificationAlreadyExists(db, businessId, title, "debts")) {
      skipped++;
      continue;
    }
    await createNotification({
      businessId,
      tone: "warn",
      priority: "medium",
      category: "debt",
      title,
      detail: `$${Number(d.pending_amount).toLocaleString("es-AR")} vence el ${d.due_date}.`,
      href: "/deudas",
      source: "debts",
    });
    created++;
  }

  return { created, skipped };
}

/* ============================================================================
   Extracciones IA pendientes hace > 4h
   ============================================================================ */

export async function checkPendingExtractionsForBusiness(
  businessId: string,
): Promise<CheckSummary> {
  if (!isDatabaseMode()) return { created: 0, skipped: 0 };
  const db = createSupabaseAdminClient() as any;
  let created = 0;
  let skipped = 0;

  const fourHoursAgo = new Date(Date.now() - 4 * 3600_000).toISOString();
  const res = await db
    .from("ai_extractions")
    .select("id, type, summary, created_at, status", { count: "exact" })
    .eq("business_id", businessId)
    .in("status", ["pending", "needs_review"])
    .lt("created_at", fourHoursAgo);
  const rows = (res.data as any[]) ?? [];
  if (rows.length === 0) return { created, skipped };

  const title = `${rows.length} movimientos IA esperan aprobación`;
  if (await notificationAlreadyExists(db, businessId, title, "inbox")) {
    skipped++;
    return { created, skipped };
  }

  const priority: NotificationPriority = rows.length >= 5 ? "high" : "medium";
  await createNotification({
    businessId,
    tone: priority === "high" ? "warn" : "ai",
    priority,
    category: "ai",
    title,
    detail: `Los movimientos más antiguos llevan más de 4 horas sin revisar.`,
    href: "/inbox",
    source: "inbox",
  });
  created++;
  return { created, skipped };
}

/* ============================================================================
   Productos con margen crítico (< 35%)
   ============================================================================ */

export async function checkCriticalMarginForBusiness(
  businessId: string,
): Promise<CheckSummary> {
  if (!isDatabaseMode()) return { created: 0, skipped: 0 };
  const db = createSupabaseAdminClient() as any;
  let created = 0;
  let skipped = 0;

  const res = await db
    .from("products")
    .select("id, name, price, cost")
    .eq("business_id", businessId)
    .eq("active", true);
  const products = (res.data as any[]) ?? [];

  const critical = products.filter((p) => {
    const price = Number(p.price);
    const cost = Number(p.cost);
    if (price <= 0) return false;
    const margin = ((price - cost) / price) * 100;
    return margin < 35;
  });

  if (critical.length === 0) return { created, skipped };

  const title = `${critical.length} producto${critical.length > 1 ? "s" : ""} con margen crítico`;
  if (await notificationAlreadyExists(db, businessId, title, "ai")) {
    skipped++;
    return { created, skipped };
  }

  await createNotification({
    businessId,
    tone: "warn",
    priority: "high",
    category: "ai",
    title,
    detail: `Margen por debajo de 35% en: ${critical.slice(0, 3).map((p) => p.name).join(", ")}${critical.length > 3 ? "…" : ""}.`,
    href: "/productos",
    source: "ai",
  });
  created++;
  return { created, skipped };
}

/* ============================================================================
   Stock crítico + bajo (complemento del trigger SQL)
   ============================================================================ */

export async function checkStockForBusiness(businessId: string): Promise<CheckSummary> {
  if (!isDatabaseMode()) return { created: 0, skipped: 0 };
  const db = createSupabaseAdminClient() as any;
  let created = 0;
  let skipped = 0;

  // Stock items del business actual via join con branches
  const branchesRes = await db
    .from("branches")
    .select("id")
    .eq("business_id", businessId);
  const branchIds = ((branchesRes.data as { id: string }[]) ?? []).map((b) => b.id);
  if (branchIds.length === 0) return { created, skipped };

  const stockRes = await db
    .from("stock_items")
    .select("ingredient_id, current, min")
    .in("branch_id", branchIds)
    .lt("current", "min");
  const lowStock = (stockRes.data as any[]) ?? [];

  if (lowStock.length === 0) return { created, skipped };

  const ingIds = [...new Set(lowStock.map((s) => s.ingredient_id))];
  const ingRes = await db.from("ingredients").select("id, name").in("id", ingIds);
  const byId = new Map(
    ((ingRes.data as { id: string; name: string }[]) ?? []).map((i) => [i.id, i.name]),
  );

  for (const s of lowStock) {
    const name = byId.get(s.ingredient_id) ?? "Insumo";
    const ratio = s.min > 0 ? Number(s.current) / Number(s.min) : 1;
    const priority: NotificationPriority = ratio < 0.5 ? "high" : "medium";
    const tone = priority === "high" ? "danger" : "warn";
    const title = priority === "high"
      ? `Stock crítico · ${name}`
      : `Stock bajo · ${name}`;
    if (await notificationAlreadyExists(db, businessId, title, "stock")) {
      skipped++;
      continue;
    }
    await createNotification({
      businessId,
      tone,
      priority,
      category: "stock",
      title,
      detail: `Quedan ${s.current}. Mínimo: ${s.min}.`,
      href: "/stock",
      source: "stock",
    });
    created++;
  }

  return { created, skipped };
}
