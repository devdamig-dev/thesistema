"use client";

import { usePresence } from "@/lib/realtime/use-presence";

const COLORS = [
  "from-brand-400 to-brand-600",
  "from-ai-400 to-ai-600",
  "from-success-400 to-success-600",
  "from-warn-400 to-warn-500",
];

function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initials(name: string): string {
  return name
    .split(" ")
    .slice(0, 2)
    .map((n) => n[0] ?? "")
    .join("")
    .toUpperCase();
}

/**
 * Indicador visual de presencia (avatars apilados + contador) para
 * mostrar quién más está viendo la misma página.
 *
 * En demo mode no hay subscription y el componente renderiza vacío.
 */
export function PresenceIndicator({
  room,
  me,
}: {
  room: string;
  me: { id: string; name: string } | null;
}) {
  const users = usePresence(room, me);
  if (!users.length) return null;

  const visible = users.slice(0, 4);
  const extra = users.length - visible.length;

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border border-success-500/30 bg-success-500/[0.06] px-2 py-1 text-[11px] text-success-400"
      title={users.map((u) => u.name).join(" · ")}
    >
      <span className="flex -space-x-2">
        {visible.map((u) => (
          <span
            key={u.id}
            className={`relative inline-grid h-5 w-5 place-items-center rounded-full bg-gradient-to-br ${colorFor(u.id)} text-[8px] font-bold text-white ring-1 ring-bg-elevated`}
          >
            {initials(u.name)}
          </span>
        ))}
        {extra > 0 && (
          <span className="grid h-5 w-5 place-items-center rounded-full border border-line bg-bg-elevated text-[8px] font-bold text-ink ring-1 ring-bg-elevated">
            +{extra}
          </span>
        )}
      </span>
      <span>
        {users.length === 1
          ? `${users[0].name} está acá`
          : `${users.length} personas viendo esto`}
      </span>
    </div>
  );
}
