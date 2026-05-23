"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Event = "INSERT" | "UPDATE" | "DELETE" | "*";

/**
 * Hook que se subscribe a cambios de una tabla y dispara
 * `router.refresh()` cada vez que llega un evento.
 *
 * En demo mode (sin Supabase) el efecto es noop — el componente que
 * usa el hook funciona igual, sólo no recibe updates.
 */
export function useRealtimeRefresh(
  table: string,
  options: {
    enabled?: boolean;
    event?: Event;
    schema?: string;
    /** Throttle entre refreshes — evita flooding cuando llegan ráfagas. */
    throttleMs?: number;
  } = {},
) {
  const router = useRouter();
  const enabled = options.enabled ?? true;
  const event: Event = options.event ?? "*";
  const schema = options.schema ?? "public";
  const throttleMs = options.throttleMs ?? 800;

  useEffect(() => {
    if (!enabled) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    let lastRefresh = 0;
    let pending: ReturnType<typeof setTimeout> | null = null;

    const channel = supabase
      .channel(`realtime:${table}`)
      .on(
        "postgres_changes" as any,
        { event, schema, table },
        () => {
          const now = Date.now();
          const elapsed = now - lastRefresh;
          const fire = () => {
            lastRefresh = Date.now();
            router.refresh();
          };
          if (elapsed >= throttleMs) {
            fire();
          } else if (!pending) {
            pending = setTimeout(() => {
              pending = null;
              fire();
            }, throttleMs - elapsed);
          }
        },
      )
      .subscribe();

    return () => {
      if (pending) clearTimeout(pending);
      supabase.removeChannel(channel);
    };
  }, [enabled, event, schema, table, throttleMs, router]);
}
