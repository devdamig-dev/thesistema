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
import { sendHighPriorityAlert } from "@/lib/email/alert";

export type {
  Notification,
  NotificationTone,
  NotificationPriority,
  NotificationCategory,
} from "./notifications-types";
export {
  PRIORITY_LABELS,
  CATEGORY_LABELS,
} from "./notifications-types";

import type {
  Notification,
  NotificationCategory,
  NotificationPriority,
  NotificationTone,
} from "./notifications-types";

/* ============================================================================
   READ
   ============================================================================ */

const DEMO_NOTIFICATIONS: Notification[] = [
  {
    id: "demo-1",
    tone: "ai",
    priority: "high",
    category: "ai",
    title: "3 movimientos esperan tu aprobación",
    detail: "El equipo cargó compras y un cierre por WhatsApp.",
    href: "/inbox",
    source: "inbox",
    read: false,
    archived: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
  },
  {
    id: "demo-2",
    tone: "warn",
    priority: "high",
    category: "debt",
    title: "Factura de Edenor vencida",
    detail: "$142.000 con vencimiento 10/05.",
    href: "/deudas",
    source: "debts",
    read: false,
    archived: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(),
  },
  {
    id: "demo-3",
    tone: "danger",
    priority: "high",
    category: "stock",
    title: "Stock crítico · Queso cheddar",
    detail: "Quedan 8kg. Cobertura estimada 2 días.",
    href: "/stock",
    source: "stock",
    read: false,
    archived: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
  },
  {
    id: "demo-4",
    tone: "success",
    priority: "low",
    category: "invoice",
    title: "Factura aprobada · La Serenísima",
    detail: "Cheddar 10kg + IVA discriminado. Lista para el contador.",
    href: "/facturas",
    source: "invoices",
    read: true,
    archived: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
  },
  {
    id: "demo-5",
    tone: "ai",
    priority: "medium",
    category: "ai",
    title: "Nueva recomendación · margen bajo en Bacon Lover",
    detail: "Subir precio $600 mantiene margen sobre 52%.",
    href: "/reportes",
    source: "ai",
    read: false,
    archived: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
  },
  {
    id: "demo-6",
    tone: "info",
    priority: "info",
    category: "marketing",
    title: "Campaña enviada · Reactivación 21 días",
    detail: "42 clientes recibieron el código VOLVE15.",
    href: "/marketing",
    source: "marketing",
    read: true,
    archived: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 30).toISOString(),
  },
  {
    id: "demo-7",
    tone: "warn",
    priority: "medium",
    category: "employee",
    title: "Adelanto pendiente · Juan Pérez",
    detail: "$30.000 pendientes de descuento.",
    href: "/empleados",
    source: "employees",
    read: true,
    archived: false,
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 40).toISOString(),
  },
];

function mapRow(r: any): Notification {
  return {
    id: r.id,
    tone: (r.tone ?? "info") as NotificationTone,
    priority: (r.priority ?? "medium") as NotificationPriority,
    category: (r.category ?? "system") as NotificationCategory,
    title: r.title,
    detail: r.detail,
    href: r.href,
    source: r.source,
    read: !!r.read_at,
    archived: !!r.archived_at,
    createdAt: r.created_at,
  };
}

export type NotificationFilters = {
  category?: NotificationCategory | "all";
  priority?: NotificationPriority | "all";
  unreadOnly?: boolean;
  includeArchived?: boolean;
  search?: string;
};

export async function getRecentNotifications(limit = 12): Promise<Notification[]> {
  if (!isDatabaseMode()) {
    return DEMO_NOTIFICATIONS.filter((n) => !n.archived).slice(0, limit);
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return DEMO_NOTIFICATIONS.filter((n) => !n.archived).slice(0, limit);
  const db = supabase as any;
  try {
    const res = await db
      .from("notifications")
      .select(
        "id, tone, priority, category, title, detail, href, source, read_at, archived_at, created_at",
      )
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    const rows = (res.data as any[]) ?? [];
    if (rows.length === 0) return DEMO_NOTIFICATIONS.filter((n) => !n.archived).slice(0, limit);
    return rows.map(mapRow);
  } catch {
    return DEMO_NOTIFICATIONS.filter((n) => !n.archived).slice(0, limit);
  }
}

export async function listNotifications(
  filters: NotificationFilters = {},
  limit = 100,
): Promise<Notification[]> {
  const fallback = DEMO_NOTIFICATIONS.filter((n) => {
    if (filters.includeArchived ? false : n.archived) return false;
    if (filters.unreadOnly && n.read) return false;
    if (filters.category && filters.category !== "all" && n.category !== filters.category)
      return false;
    if (filters.priority && filters.priority !== "all" && n.priority !== filters.priority)
      return false;
    if (filters.search) {
      const s = filters.search.toLowerCase();
      const matches =
        n.title.toLowerCase().includes(s) || (n.detail ?? "").toLowerCase().includes(s);
      if (!matches) return false;
    }
    return true;
  });

  if (!isDatabaseMode()) return fallback.slice(0, limit);
  const supabase = createSupabaseServerClient();
  if (!supabase) return fallback.slice(0, limit);
  const db = supabase as any;
  try {
    let query = db
      .from("notifications")
      .select(
        "id, tone, priority, category, title, detail, href, source, read_at, archived_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!filters.includeArchived) query = query.is("archived_at", null);
    if (filters.unreadOnly) query = query.is("read_at", null);
    if (filters.category && filters.category !== "all") {
      query = query.eq("category", filters.category);
    }
    if (filters.priority && filters.priority !== "all") {
      query = query.eq("priority", filters.priority);
    }
    if (filters.search) {
      query = query.ilike("title", `%${filters.search}%`);
    }
    const res = await query;
    const rows = (res.data as any[]) ?? [];
    if (rows.length === 0) return fallback.slice(0, limit);
    return rows.map(mapRow);
  } catch {
    return fallback.slice(0, limit);
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
  priority?: NotificationPriority;
  category?: NotificationCategory;
  title: string;
  detail?: string;
  href?: string;
  source?: string;
};

/** Mapeo razonable desde tone → priority cuando no se pasa explícito. */
function priorityFromTone(tone?: NotificationTone): NotificationPriority {
  if (tone === "danger" || tone === "warn") return "high";
  if (tone === "success") return "low";
  if (tone === "ai") return "medium";
  return "info";
}

export async function createNotification(input: CreateNotificationInput): Promise<void> {
  if (!isDatabaseMode()) return;
  try {
    const db = createSupabaseAdminClient() as any;
    await db.from("notifications").insert({
      business_id: input.businessId,
      recipient_id: input.recipientId ?? null,
      tone: input.tone ?? "info",
      priority: input.priority ?? priorityFromTone(input.tone),
      category: input.category ?? "system",
      title: input.title,
      detail: input.detail ?? null,
      href: input.href ?? null,
      source: input.source ?? null,
    });
    // Si priority es alta y hay RESEND_API_KEY, disparar email inmediato.
    const effectivePriority = input.priority ?? priorityFromTone(input.tone);
    if (effectivePriority === "high" && process.env.RESEND_API_KEY) {
      try {
        // Resolver owner email del business para mandar alerta
        const ownerRes = await db
          .from("business_members")
          .select("user_id")
          .eq("business_id", input.businessId)
          .eq("role", "owner")
          .limit(1)
          .maybeSingle();
        const ownerId = (ownerRes.data as { user_id: string } | null)?.user_id;
        if (ownerId) {
          const profileRes = await db
            .from("profiles")
            .select("email")
            .eq("id", ownerId)
            .maybeSingle();
          const email = (profileRes.data as { email: string | null } | null)?.email;
          const bizRes = await db
            .from("businesses")
            .select("name")
            .eq("id", input.businessId)
            .maybeSingle();
          const bizName = (bizRes.data as { name: string } | null)?.name ?? "Tu negocio";
          if (email) {
            await sendHighPriorityAlert({
              to: email,
              businessName: bizName,
              title: input.title,
              detail: input.detail,
              href: input.href,
            });
          }
        }
      } catch (emailErr) {
        console.error("[notifications] email alert failed:", emailErr);
      }
    }
  } catch (error) {
    console.error("[notifications] create failed:", error);
  }
}
