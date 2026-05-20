/**
 * Supabase admin client.
 *
 * Sólo para scripts server-only que necesitan saltarse RLS:
 *   - tsx scripts/seed.ts
 *   - tareas de mantenimiento
 *   - cron / edge functions
 *
 * NUNCA importarlo desde React Components ni rutas públicas.
 */

import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";
import type { Database } from "./types";

export function createSupabaseAdminClient() {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error(
      "[supabase.admin] Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY. " +
        "Verificá tu .env.local antes de correr scripts admin.",
    );
  }
  return createClient<Database>(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type SupabaseAdminClient = ReturnType<typeof createSupabaseAdminClient>;
