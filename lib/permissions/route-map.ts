/**
 * Mapeo pathname → ModuleKey para el middleware guard.
 *
 * Si el usuario no puede ver el módulo según su rol, el middleware
 * redirige a / con ?denied=<module>.
 *
 * Mantener sincronizado con el sidebar.
 */

import type { ModuleKey } from "./types";

const PREFIX_TO_MODULE: { prefix: string; module: ModuleKey }[] = [
  { prefix: "/inbox", module: "inbox_ai" },
  { prefix: "/reportes", module: "reports_ai" },
  { prefix: "/marketing", module: "marketing_ai" },
  { prefix: "/facturas", module: "invoices_ocr" },
  { prefix: "/cierres", module: "daily_closures" },
  { prefix: "/ventas", module: "sales" },
  { prefix: "/compras", module: "purchases" },
  { prefix: "/gastos", module: "fixed_expenses" },
  { prefix: "/deudas", module: "debts" },
  { prefix: "/stock", module: "stock" },
  { prefix: "/productos", module: "products" },
  { prefix: "/balances", module: "balances" },
  { prefix: "/empleados", module: "employees" },
  { prefix: "/clientes", module: "customers" },
];

/** Rutas que están siempre permitidas (no pasan por el guard). */
export const PUBLIC_PATHS = [
  "/",
  "/login",
  "/ayuda",
  "/notificaciones",
  "/logout",
  "/sin-permisos",
];
export const SETTINGS_PREFIX = "/ajustes";

/** Devuelve el `ModuleKey` requerido para acceder a una ruta, o null. */
export function moduleForPath(pathname: string): ModuleKey | null {
  for (const entry of PREFIX_TO_MODULE) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix + "/")) {
      return entry.module;
    }
  }
  return null;
}

/** ¿Esta ruta es ajustes? */
export function isSettingsPath(pathname: string): boolean {
  return pathname === SETTINGS_PREFIX || pathname.startsWith(SETTINGS_PREFIX + "/");
}

/** ¿Esta ruta es pública (no requiere guard de módulo)? */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p);
}
