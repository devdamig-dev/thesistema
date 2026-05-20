/**
 * Supabase server client (Server Components, Route Handlers, Server Actions).
 *
 * Devuelve `null` cuando la app corre en modo demo o cuando faltan
 * variables — los callers deben manejar ese caso.
 *
 * Importante: en server components, las cookies de Next son read-only.
 * El SSR helper de Supabase llama `set()` cuando renueva el token, así
 * que envolvemos la API en try/catch para no romper renders RSC.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env, isDatabaseMode } from "@/lib/env";
import type { Database } from "./types";

export function createSupabaseServerClient() {
  if (!isDatabaseMode()) return null;
  const store = cookies();
  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      get(name: string) {
        return store.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          store.set({ name, value, ...options });
        } catch {
          // Server Components no permiten escribir cookies — el middleware
          // se encarga de refrescar la sesión.
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          store.set({ name, value: "", ...options });
        } catch {
          /* idem */
        }
      },
    },
  });
}

export type SupabaseServerClient = NonNullable<
  ReturnType<typeof createSupabaseServerClient>
>;
