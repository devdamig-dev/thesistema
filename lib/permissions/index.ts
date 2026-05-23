/**
 * Helpers de permisos.
 *
 * Diseñados para usarse tanto en server actions (chequeo + throw) como
 * en componentes (filtrado pasivo).
 *
 * En demo mode el rol default es "owner" para que todos los flujos
 * sean visibles y la app funcione idéntica a antes.
 */

import { modulesFor, permissionsFor } from "./matrix";
import { ROLE_LABELS, type ModuleKey, type Permission, type Role } from "./types";

export const DEMO_ROLE: Role = "owner";

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  const effective = role ?? DEMO_ROLE;
  return permissionsFor(effective).includes(permission);
}

export function canSeeModule(
  role: Role | null | undefined,
  module: ModuleKey,
  enabledModules?: ModuleKey[] | null,
): boolean {
  const effective = role ?? DEMO_ROLE;
  const allowedByRole = modulesFor(effective).includes(module);
  if (!allowedByRole) return false;
  // Si el negocio definió módulos activos, intersectamos.
  if (enabledModules && enabledModules.length > 0) {
    return enabledModules.includes(module);
  }
  return true;
}

export function getRoleLabel(role: Role | null | undefined): string {
  if (!role) return ROLE_LABELS[DEMO_ROLE];
  return ROLE_LABELS[role] ?? role;
}

export type { ModuleKey, Permission, Role } from "./types";
export { PRIMARY_ROLES, ROLE_LABELS } from "./types";
export { modulesFor, permissionsFor } from "./matrix";
