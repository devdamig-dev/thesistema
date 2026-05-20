/**
 * Validación liviana de variables de entorno.
 *
 * Tres modos:
 *   - "demo"     → no requiere Supabase. La app sigue funcionando con
 *                  los datos de lib/mock-data.ts.
 *   - "database" → requiere SUPABASE_URL y ANON_KEY. Si faltan, se
 *                  degrada a demo y lo logea en consola.
 *
 * No hacemos `throw` para no romper la demo si alguien levanta el repo
 * sin .env.local.
 */

export type AppMode = "demo" | "database";

const RAW_MODE = (process.env.NEXT_PUBLIC_APP_MODE ?? "demo").toLowerCase();
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

function resolveMode(): AppMode {
  if (RAW_MODE !== "database") return "demo";
  if (!SUPA_URL || !SUPA_ANON) {
    if (typeof window === "undefined") {
      // Sólo en server, evitamos spamear el cliente.
      console.warn(
        "[env] NEXT_PUBLIC_APP_MODE=database pero faltan variables de Supabase. " +
          "Degradando a modo demo para no romper la app.",
      );
    }
    return "demo";
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
