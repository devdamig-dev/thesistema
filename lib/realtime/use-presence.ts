"use client";

import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export type PresenceUser = {
  id: string;
  name: string;
  joinedAt: number;
};

/**
 * Hook de presencia básica usando Supabase Realtime channels.
 *
 * Devuelve la lista de usuarios actualmente conectados al `room`.
 * En demo mode (sin client) devuelve [].
 */
export function usePresence(
  room: string,
  me: { id: string; name: string } | null,
): PresenceUser[] {
  const [users, setUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    if (!me) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase.channel(`presence:${room}`, {
      config: { presence: { key: me.id } },
    });

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const flat: PresenceUser[] = Object.values(state)
          .flat()
          .map((entry: any) => ({
            id: entry.id ?? "anon",
            name: entry.name ?? "Anónimo",
            joinedAt: entry.joinedAt ?? Date.now(),
          }));
        // dedup por id
        const dedup = new Map<string, PresenceUser>();
        flat.forEach((u) => {
          const existing = dedup.get(u.id);
          if (!existing || u.joinedAt < existing.joinedAt) {
            dedup.set(u.id, u);
          }
        });
        setUsers([...dedup.values()]);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({
            id: me.id,
            name: me.name,
            joinedAt: Date.now(),
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room, me?.id, me?.name]);

  return users;
}
