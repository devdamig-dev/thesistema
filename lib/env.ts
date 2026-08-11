/**
 * Validación liviana de variables de entorno.
 *
 * Dos modos:
 *   - "demo"     → no requiere Supabase. La app funciona con los datos de
 *                  lib/mock-data.ts.
 *   - "database" → requiere SUPABASE_URL y ANON_KEY. Si faltan, falla
 *                  explícitamente en vez de degradar silenciosamente a demo.
 *
 * La demo sigue siendo el default cuando NEXT_PUBLIC_APP_MODE no pide database.
 * Pero una configuración que declara database nunca debe mostrar datos mock por
 * accidente: eso oculta fallas de infraestructura y genera estados engañosos.
 */

export type AppMode = "demo" | "database";

const RAW_MODE = (process.env.NEXT_PUBLIC_APP_MODE ?? "demo").toLowerCase();
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function resolveMode(): AppMode {
  if (RAW_MODE !== "database") return "demo";

  const missing: string[] = [];
  if (!SUPA_URL) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!SUPA_ANON) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length > 0) {
    throw new Error(
      `[env] NEXT_PUBLIC_APP_MODE=database requiere ${missing.join(", ")}. ` +
        "Se rechaza el fallback a demo para evitar datos mock en database mode.",
    );
  }

  return "database";
}

export const env = {
  appMode: resolveMode(),
  supabaseUrl: SUPA_URL,
  supabaseAnonKey: SUPA_ANON,
  /** Sólo disponible en server. Vacío en el cliente. */
  supabaseServiceRoleKey: SUPA_SERVICE,
};

export function isDemoMode() {
  return env.appMode === "demo";
}

export function isDatabaseMode() {
  return env.appMode === "database";
}
