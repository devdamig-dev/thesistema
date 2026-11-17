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
  // /login owns the explicit PKCE exchange; recovery is exchanged server-side.
  // Automatic URL detection would consume the one-use code before /login does.
  return createBrowserClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { detectSessionInUrl: false },
  });
}

export type SupabaseBrowserClient = NonNullable<
  ReturnType<typeof createSupabaseBrowserClient>
>;
