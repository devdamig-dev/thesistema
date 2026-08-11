/**
 * Helpers para aplicar branch-level filtering a queries de Supabase.
 *
 * Patrón de uso:
 *
 *   const ctx = await getCurrentUserContext();
 *   const branchIds = await getEffectiveBranchIds(db, ctx);
 *   const query = db.from("sales").select("*");
 *   const filtered = applyBranchFilter(query, "branch_id", branchIds);
 *
 * Resolución de `branchIds`:
 *   - null  → sin restricción (rol manager/admin/owner) → no filtra.
 *   - []    → sin sucursales asignadas (employee nuevo) → no devuelve nada.
 *   - [...] → sólo esas sucursales.
 */

import type { UserContext } from "@/lib/data/auth";

/**
 * Devuelve los branch_ids efectivos del usuario.
 * Si el rol está sin restricción, devuelve null.
 * Si está restringido y no tiene asignaciones explícitas, devuelve []
 * y falla cerrado: nunca se concede acceso implícito a la sucursal principal.
 */
export async function getEffectiveBranchIds(
  _db: any,
  ctx: UserContext,
): Promise<string[] | null> {
  if (ctx.assignedBranchIds === null) return null;
  return ctx.assignedBranchIds;
}

/**
 * Aplica el filtro `column IN (...)` a una query Supabase si hay
 * restricción. Si no hay restricción devuelve la query intacta.
 */
export function applyBranchFilter(query: any, column: string, branchIds: string[] | null) {
  if (branchIds === null) return query;
  if (branchIds.length === 0) {
    // Forzar resultado vacío.
    return query.in(column, ["00000000-0000-0000-0000-000000000000"]);
  }
  return query.in(column, branchIds);
}
