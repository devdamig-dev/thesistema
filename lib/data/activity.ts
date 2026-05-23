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
