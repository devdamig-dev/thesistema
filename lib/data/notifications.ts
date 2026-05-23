/**
 * Notificaciones internas.
 *
 * Generadas por server actions cuando hay algo que requiere atención:
 *   - inbox.needs_review
 *   - invoice.needs_review
 *   - debt.overdue
 *   - stock.critical
 *   - ai.recommendation.new
 *
 * En demo mode, devolvemos un set fijo plausible para que la UI tenga
 * algo que mostrar.
 *
 * Lectura: getRecentNotifications + unread count.
 * Escritura: createNotification (server side, usa admin client).
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";

export type NotificationTone = "info" | "success" | "warn" | "danger" | "ai";

export type Notification = {
  id: string;
  tone: NotificationTone;
  title: string;
  detail: string | null;
  href: string | null;
  source: string | null;
  read: boolean;
  createdAt: string;
};

/* ============================================================================
   READ
   ============================================================================ */

const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: "demo-1",
    tone: "ai",
    title: "3 movimientos esperan tu aprobación",
    detail: "El equipo cargó compras y un cierre por WhatsApp.",
    href: "/inbox",
    source: "inbox",
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
  {
    id: "demo-2",
    tone: "warn",
    title: "Factura de Edenor vencida",
    detail: "$142.000 con vencimiento 10/05.",
    href: "/deudas",
    source: "debts",
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: "demo-3",
    tone: "danger",
    title: "Stock crítico · Queso cheddar",
    detail: "Quedan 8kg. Cobertura estimada 2 días.",
    href: "/stock",
    source: "stock",
    read: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "demo-4",
    tone: "success",
    title: "Factura aprobada · La Serenísima",
    detail: "Cheddar 10kg + IVA discriminado. Lista para el contador.",
    href: "/facturas",
    source: "invoices",
    read: true,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
];

export async function getRecentNotifications(limit = 12): Promise<Notification[]> {
  if (!isDatabaseMode()) return DEMO_NOTIFICATIONS;
  const supabase = createSupabaseServerClient();
  if (!supabase) return DEMO_NOTIFICATIONS;
  const db = supabase as any;
  try {
    const res = await db
      .from("notifications")
      .select("id, tone, title, detail, href, source, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    const rows = (res.data as any[]) ?? [];
    if (rows.length === 0) return DEMO_NOTIFICATIONS;
    return rows.map((r) => ({
      id: r.id,
      tone: (r.tone ?? "info") as NotificationTone,
      title: r.title,
      detail: r.detail,
      href: r.href,
      source: r.source,
      read: !!r.read_at,
      createdAt: r.created_at,
    }));
  } catch {
    return DEMO_NOTIFICATIONS;
  }
}

export async function getUnreadCount(): Promise<number> {
  const list = await getRecentNotifications(50);
  return list.filter((n) => !n.read).length;
}

/* ============================================================================
   WRITE (server-only)
   ============================================================================ */

export type CreateNotificationInput = {
  businessId: string;
  recipientId?: string | null;
  tone?: NotificationTone;
  title: string;
  detail?: string;
  href?: string;
  source?: string;
};

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  if (!isDatabaseMode()) return;
  try {
    const db = createSupabaseAdminClient() as any;
    await db.from("notifications").insert({
      business_id: input.businessId,
      recipient_id: input.recipientId ?? null,
      tone: input.tone ?? "info",
      title: input.title,
      detail: input.detail ?? null,
      href: input.href ?? null,
      source: input.source ?? null,
    });
  } catch (error) {
    console.error("[notifications] create failed:", error);
  }
}
