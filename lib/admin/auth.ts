/**
 * Gating del módulo interno `/admin/*`.
 *
 * No es para clientes — sólo para el equipo de GastroPilot que opera
 * los pilotos. Se habilita cuando:
 *
 *   1. `ENABLE_INTERNAL_ADMIN=true` está seteado en el entorno, **y**
 *   2. (database mode) el usuario logueado tiene rol owner/admin, **o**
 *   3. (database mode) el email del usuario está en
 *      `INTERNAL_ADMIN_EMAILS` (coma separada).
 *
 * En demo mode el rol siempre es owner, así que basta con el flag de
 * entorno — ideal para previews y QA.
 */

import { getCurrentUserContext } from "@/lib/data/auth";

const ENABLE_FLAG = (process.env.ENABLE_INTERNAL_ADMIN ?? "").toLowerCase() === "true";

function adminEmails(): string[] {
  const raw = process.env.INTERNAL_ADMIN_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True si el módulo /admin está habilitado por entorno. */
export function isInternalAdminEnabled(): boolean {
  return ENABLE_FLAG;
}

export type InternalAdminCheck =
  | { allowed: true; reason: "demo-flag" | "owner-flag" | "admin-flag" | "email-allowlist" }
  | { allowed: false; reason: "disabled" | "not-authenticated" | "wrong-role" | "not-allowlisted" };

/**
 * Resuelve si el caller puede acceder al módulo /admin. No hace
 * redirect — el page handler decide qué mostrar (notFound / redirect).
 */
export async function checkInternalAdmin(): Promise<InternalAdminCheck> {
  if (!ENABLE_FLAG) return { allowed: false, reason: "disabled" };
  const ctx = await getCurrentUserContext();

  // Demo mode: el contexto es siempre owner — con el flag alcanza.
  if (!ctx.isAuthenticated && ctx.role === "owner") {
    return { allowed: true, reason: "demo-flag" };
  }

  // Database mode: requiere sesión.
  if (!ctx.isAuthenticated) {
    return { allowed: false, reason: "not-authenticated" };
  }

  if (ctx.role === "owner") return { allowed: true, reason: "owner-flag" };
  if (ctx.role === "admin") return { allowed: true, reason: "admin-flag" };

  const allow = adminEmails();
  if (ctx.email && allow.includes(ctx.email.toLowerCase())) {
    return { allowed: true, reason: "email-allowlist" };
  }
  return { allowed: false, reason: "not-allowlisted" };
}
