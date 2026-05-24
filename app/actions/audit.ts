"use server";

import { getCurrentUserContext } from "@/lib/data/auth";
import {
  activityToCsv,
  listActivityWithFilters,
  type ActivityFilters,
} from "@/lib/data/activity";
import { assertPermission } from "@/lib/permissions/server-action";

export type ExportResult =
  | { ok: true; filename: string; csv: string; rows: number }
  | { ok: false; error: string };

/**
 * Devuelve el CSV de actividad como string para que el client lo
 * descargue. No usamos un endpoint REST porque queremos respetar
 * permisos via server action.
 */
export async function exportActivityCsvAction(
  filters: ActivityFilters = {},
): Promise<ExportResult> {
  const guard = await assertPermission("reports.export");
  if (guard) return { ok: false, error: guard.error };

  const ctx = await getCurrentUserContext();
  const rows = await listActivityWithFilters(ctx.businessId, {
    ...filters,
    limit: 5000,
  });
  const csv = activityToCsv(rows);
  const stamp = new Date().toISOString().slice(0, 10);
  return {
    ok: true,
    filename: `auditoria-${stamp}.csv`,
    csv,
    rows: rows.length,
  };
}
