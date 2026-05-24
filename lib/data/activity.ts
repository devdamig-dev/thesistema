/**
 * Activity logging.
 *
 * Las server actions llaman a `logActivity(...)` después de cada
 * operación significativa (aprobar inbox/factura, registrar deuda,
 * subir factura, cambiar rubro, etc).
 *
 * En demo mode no hace nada. En database mode persiste en
 * `activity_logs` con RLS por business.
 *
 * Read-side: `listRecentActivity(businessId)` para la UI.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";

export type LogActivityInput = {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  action: string;            // ej "invoice.approved", "debt.payment.registered"
  targetType?: string;       // tabla de destino
  targetId?: string;
  summary: string;           // línea legible para el feed
  data?: Record<string, unknown>;
};

export async function logActivity(input: LogActivityInput): Promise<void> {
  if (!isDatabaseMode()) return;
  try {
    const db = createSupabaseAdminClient() as any;
    await db.from("activity_logs").insert({
      business_id: input.businessId,
      actor_id: input.actorId ?? null,
      actor_name: input.actorName ?? null,
      actor_role: input.actorRole ?? null,
      action: input.action,
      target_type: input.targetType ?? null,
      target_id: input.targetId ?? null,
      summary: input.summary,
      data: input.data ?? {},
    });
  } catch (error) {
    // No queremos romper la action por un fallo en el log.
    console.error("[activity] log failed:", error);
  }
}

export type ActivityRow = {
  id: string;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  summary: string;
  target_type: string | null;
  created_at: string;
};

export async function listRecentActivity(
  businessId: string,
  limit = 20,
): Promise<ActivityRow[]> {
  if (!isDatabaseMode()) return [];
  try {
    const db = createSupabaseAdminClient() as any;
    const res = await db
      .from("activity_logs")
      .select("id, actor_name, actor_role, action, summary, target_type, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (res.data as ActivityRow[]) ?? [];
  } catch {
    return [];
  }
}

export type ActivityFilters = {
  actorName?: string;
  action?: string;     // prefix match: "invoice." matches "invoice.approved"
  targetType?: string;
  from?: string;       // ISO date
  to?: string;         // ISO date
  q?: string;          // texto libre en summary
  limit?: number;
};

const DEMO_ACTIVITY: ActivityRow[] = [
  {
    id: "demo-a-1",
    actor_name: "Mateo Iglesias",
    actor_role: "owner",
    action: "inbox.purchase.approved",
    summary: "Compra 20kg carne · Don José · $180.000 aprobada desde Inbox",
    target_type: "purchases",
    created_at: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
  },
  {
    id: "demo-a-2",
    actor_name: "Lucía Romero",
    actor_role: "manager",
    action: "invoice.approved",
    summary: "Factura B-0002-00009912 aprobada · 1 ítem · purchase creada",
    target_type: "invoices",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: "demo-a-3",
    actor_name: "Mateo Iglesias",
    actor_role: "owner",
    action: "debt.payment.registered",
    summary: "Pago parcial · Panadería La Espiga · $80.000",
    target_type: "debt_payments",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
  {
    id: "demo-a-4",
    actor_name: "Sistema",
    actor_role: "system",
    action: "permission.denied",
    summary: "Acceso denegado a /marketing para rol accountant",
    target_type: "permission",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
  },
  {
    id: "demo-a-5",
    actor_name: "Mateo Iglesias",
    actor_role: "owner",
    action: "team.invited",
    summary: "Invitación enviada a florencia@labirra.com como marketing",
    target_type: "user_invitations",
    created_at: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
  },
];

export async function listActivityWithFilters(
  businessId: string | null,
  filters: ActivityFilters = {},
): Promise<ActivityRow[]> {
  const limit = filters.limit ?? 200;

  // Demo fallback: filtramos en memoria
  const filterDemo = () => {
    return DEMO_ACTIVITY.filter((r) => {
      if (filters.action && !r.action.startsWith(filters.action)) return false;
      if (filters.targetType && r.target_type !== filters.targetType) return false;
      if (filters.actorName) {
        const a = (r.actor_name ?? "").toLowerCase();
        if (!a.includes(filters.actorName.toLowerCase())) return false;
      }
      if (filters.q) {
        const q = filters.q.toLowerCase();
        const matches =
          r.summary.toLowerCase().includes(q) || r.action.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (filters.from && new Date(r.created_at) < new Date(filters.from)) return false;
      if (filters.to && new Date(r.created_at) > new Date(filters.to)) return false;
      return true;
    });
  };

  if (!isDatabaseMode() || !businessId) return filterDemo().slice(0, limit);

  try {
    const db = createSupabaseAdminClient() as any;
    let query = db
      .from("activity_logs")
      .select("id, actor_name, actor_role, action, summary, target_type, created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (filters.action) {
      query = query.like("action", `${filters.action}%`);
    }
    if (filters.targetType) {
      query = query.eq("target_type", filters.targetType);
    }
    if (filters.actorName) {
      query = query.ilike("actor_name", `%${filters.actorName}%`);
    }
    if (filters.q) {
      query = query.ilike("summary", `%${filters.q}%`);
    }
    if (filters.from) query = query.gte("created_at", filters.from);
    if (filters.to) query = query.lte("created_at", filters.to);

    const res = await query;
    const rows = (res.data as ActivityRow[]) ?? [];
    if (rows.length === 0) return filterDemo().slice(0, limit);
    return rows;
  } catch {
    return filterDemo().slice(0, limit);
  }
}

/**
 * Loguea un intento de acceso denegado por permisos.
 * El actor puede ser null si no hay sesión.
 */
export async function logPermissionDenied(input: {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  module: string;
  pathname: string;
}): Promise<void> {
  await logActivity({
    businessId: input.businessId,
    actorId: input.actorId ?? null,
    actorName: input.actorName ?? null,
    actorRole: input.actorRole ?? null,
    action: "permission.denied",
    targetType: "permission",
    summary: `Acceso denegado a ${input.pathname} (módulo ${input.module}) para rol ${input.actorRole ?? "anónimo"}`,
    data: { module: input.module, pathname: input.pathname },
  });
}

export function activityToCsv(rows: ActivityRow[]): string {
  const header = ["fecha", "actor", "rol", "accion", "modulo", "resumen"];
  const lines = [header.join(",")];
  for (const r of rows) {
    const fields = [
      r.created_at,
      r.actor_name ?? "",
      r.actor_role ?? "",
      r.action,
      r.target_type ?? "",
      r.summary,
    ].map(csvEscape);
    lines.push(fields.join(","));
  }
  return lines.join("\n");
}

function csvEscape(s: string): string {
  if (s == null) return "";
  const needsQuotes = /[",\n]/.test(s);
  if (!needsQuotes) return s;
  return `"${s.replace(/"/g, '""')}"`;
}
