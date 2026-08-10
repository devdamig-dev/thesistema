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
  const meId = me?.id ?? null;
  const meName = me?.name ?? null;

  useEffect(() => {
    if (!meId || !meName) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) return;

    const channel = supabase.channel(`presence:${room}`, {
      config: { presence: { key: meId } },
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
            id: meId,
            name: meName,
            joinedAt: Date.now(),
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [room, meId, meName]);

  return users;
}
