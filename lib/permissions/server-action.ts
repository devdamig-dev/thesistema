/**
 * Wrapper genérico para server actions con chequeo de permisos.
 *
 * Uso:
 *   export const approveInvoiceAction = withPermission(
 *     "invoices.approve",
 *     async (ctx, invoiceId: string) => { ... }
 *   );
 *
 * El wrapper:
 *   1. Resuelve el contexto del usuario actual (rol, business).
 *   2. Chequea que tenga el permiso pedido.
 *   3. Si falta sesión o business, devuelve un error controlado.
 *   4. Ejecuta la action pasando el contexto como primer argumento.
 *
 * En demo mode el contexto resuelve a `owner` (todos los permisos)
 * para que la app siga funcionando sin Supabase. Las actions que se
 * pasen al wrapper deben aceptar `ctx` como primer argumento.
 */

import { getCurrentUserContext, type UserContext } from "@/lib/data/auth";
import { hasPermission, type Permission } from "./index";

export type PermissionError =
  | { ok: false; persisted: false; error: "no_session" | "no_business" | "forbidden"; message: string };

export type PermissionResult<T> = T | PermissionError;

/**
 * Envuelve una server action chequeando un permiso. La function recibe
 * el contexto como primer argumento y los argumentos originales después.
 */
export function withPermission<Args extends unknown[], R>(
  permission: Permission,
  fn: (ctx: UserContext, ...args: Args) => Promise<R>,
): (...args: Args) => Promise<PermissionResult<R>> {
  return async (...args: Args) => {
    const ctx = await getCurrentUserContext();

    // En demo mode, ctx.role siempre será "owner" (todos los permisos).
    if (!hasPermission(ctx.role, permission)) {
      return {
        ok: false,
        persisted: false,
        error: "forbidden",
        message: `Tu rol (${ctx.role}) no puede ejecutar "${permission}".`,
      } satisfies PermissionError;
    }

    // En database mode chequeamos también que haya business.
    if (ctx.isAuthenticated && !ctx.businessId) {
      return {
        ok: false,
        persisted: false,
        error: "no_business",
        message: "No tenés un negocio asignado.",
      } satisfies PermissionError;
    }

    return fn(ctx, ...args);
  };
}

/**
 * Variante minimal: sólo chequea permiso, no inyecta ctx.
 * Útil cuando la action ya tiene su propia lógica de resolver business.
 */
export function requirePermission<Args extends unknown[], R>(
  permission: Permission,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<PermissionResult<R>> {
  return async (...args: Args) => {
    const ctx = await getCurrentUserContext();
    if (!hasPermission(ctx.role, permission)) {
      return {
        ok: false,
        persisted: false,
        error: "forbidden",
        message: `Tu rol (${ctx.role}) no puede ejecutar "${permission}".`,
      } satisfies PermissionError;
    }
    return fn(...args);
  };
}

/**
 * Helper inline para mantener el shape existente de los Result types
 * de las actions. Devuelve `null` si el usuario tiene el permiso, o
 * un objeto compatible con `{ ok: false, persisted: false, error: ... }`
 * para retornar tal cual.
 *
 *   const guard = await assertPermission("invoices.approve");
 *   if (guard) return guard;
 *   // ... resto de la action
 */
export async function assertPermission(
  permission: Permission,
): Promise<{ ok: false; persisted: false; error: string } | null> {
  const ctx = await getCurrentUserContext();
  if (hasPermission(ctx.role, permission)) return null;
  return {
    ok: false,
    persisted: false,
    error: `forbidden:${permission}`,
  };
}
