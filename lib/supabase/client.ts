/**
 * Supabase browser client.
 *
 * Devuelve `null` cuando la app corre en modo demo o cuando faltan
 * variables — los callers deben manejar ese caso degradándose a mock.
 */

import { createBrowserClient } from "@supabase/ssr";
import { env, isDatabaseMode } from "@/lib/env";
import type { Database } from "./types";

export function createSupabaseBrowserClient() {
  if (!isDatabaseMode()) return null;
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey);
}

export type SupabaseBrowserClient = NonNullable<
  ReturnType<typeof createSupabaseBrowserClient>
>;
