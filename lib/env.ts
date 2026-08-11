/**
 * Demo branch configuration.
 *
 * Esta rama existe exclusivamente para el deployment público de demostración.
 * Nunca conecta Supabase ni datos reales aunque Vercel tenga variables de
 * database configuradas a nivel proyecto.
 */

export type AppMode = "demo" | "database";

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPA_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const env = {
  appMode: "demo" as AppMode,
  supabaseUrl: SUPA_URL,
  supabaseAnonKey: SUPA_ANON,
  supabaseServiceRoleKey: SUPA_SERVICE,
};

export function isDemoMode() {
  return true;
}

export function isDatabaseMode() {
  return false;
}
