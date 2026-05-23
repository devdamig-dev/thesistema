"use client";

import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Command,
  Info,
  MessageSquareText,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState, useTransition, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/actions/notifications";
import type { Notification } from "@/lib/data/notifications";
import { cn } from "@/lib/utils";

export function Topbar({
  onOpenNav,
  notifications,
  unreadCount,
}: {
  onOpenNav: () => void;
  notifications: Notification[];
  unreadCount: number;
}) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl md:px-6">
      <button
        onClick={onOpenNav}
        className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-bg-subtle text-ink-muted hover:text-ink md:hidden"
        aria-label="Abrir menú"
      >
        <span className="block h-0.5 w-4 bg-current shadow-[0_4px_0_currentColor,0_-4px_0_currentColor]" />
      </button>

      <div className="hidden flex-1 md:flex md:max-w-md">
        <div className="group flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 text-sm text-ink-muted transition-colors hover:border-line-strong">
          <Search className="h-4 w-4" />
          <input
            placeholder="Buscar movimientos, proveedores, productos…"
            className="flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
          />
          <kbd className="hidden items-center gap-1 rounded border border-line bg-bg-elevated px-1.5 py-0.5 text-[10px] text-ink-subtle md:inline-flex">
            <Command className="h-3 w-3" /> K
          </kbd>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <AskAIPill />
        <NotificationsBell notifications={notifications} unreadCount={unreadCount} />
        <button className="hidden h-9 items-center gap-2 rounded-lg border border-success-500/30 bg-success-500/10 px-2.5 text-xs font-medium text-success-400 md:inline-flex">
          <MessageSquareText className="h-3.5 w-3.5" />
          WhatsApp conectado
          <span className="ml-1 h-1.5 w-1.5 rounded-full bg-success-500 animate-pulseDot" />
        </button>
      </div>
    </header>
  );
}

function AskAIPill() {
  const [value, setValue] = useState("");
  return (
    <div className="hidden h-9 items-center gap-2 rounded-lg border border-ai-400/30 bg-ai-500/10 px-2.5 text-sm text-ai-400 md:inline-flex">
      <Sparkles className="h-3.5 w-3.5" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Preguntale a la IA…"
        className="w-44 bg-transparent text-xs placeholder:text-ai-400/70 focus:outline-none"
      />
    </div>
  );
}

/* ============================================================================
   NOTIFICATIONS BELL + DROPDOWN
   ============================================================================ */

const TONE_ICON: Record<Notification["tone"], ReactNode> = {
  info: <Info className="h-3.5 w-3.5 text-ai-400" />,
  ai: <Sparkles className="h-3.5 w-3.5 text-ai-400" />,
  success: <CheckCircle2 className="h-3.5 w-3.5 text-success-400" />,
  warn: <AlertTriangle className="h-3.5 w-3.5 text-warn-400" />,
  danger: <AlertTriangle className="h-3.5 w-3.5 text-danger-400" />,
};

const TONE_RING: Record<Notification["tone"], string> = {
  info: "border-ai-400/20",
  ai: "border-ai-400/20",
  success: "border-success-500/20",
  warn: "border-warn-500/20",
  danger: "border-danger-500/20",
};

function NotificationsBell({
  notifications,
  unreadCount,
}: {
  notifications: Notification[];
  unreadCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleMarkRead(id: string) {
    startTransition(async () => {
      await markNotificationReadAction(id);
    });
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative grid h-9 w-9 place-items-center rounded-lg border border-line bg-bg-subtle text-ink-muted hover:text-ink"
        aria-label={`Notificaciones${unreadCount ? ` (${unreadCount} sin leer)` : ""}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-[1rem] place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white shadow-soft">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            {/* backdrop para cerrar al click fuera */}
            <button
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.18 }}
              className="absolute right-0 top-11 z-50 w-[360px] overflow-hidden rounded-xl border border-line bg-bg-elevated shadow-soft"
            >
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-ink">Notificaciones</div>
                  <div className="text-[11px] text-ink-subtle">
                    {unreadCount > 0
                      ? `${unreadCount} sin leer`
                      : "Estás al día"}
                  </div>
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    disabled={pending}
                    className="text-[11px] font-medium text-brand-300 hover:text-brand-200 disabled:opacity-50"
                  >
                    Marcar todas
                  </button>
                )}
              </div>

              <ul className="max-h-[420px] overflow-y-auto scrollbar-thin">
                {notifications.length === 0 && (
                  <li className="grid place-items-center gap-2 px-6 py-12 text-center">
                    <div className="grid h-10 w-10 place-items-center rounded-full border border-line bg-bg-subtle text-ink-muted">
                      <Bell className="h-4 w-4" />
                    </div>
                    <p className="text-sm text-ink">Sin notificaciones</p>
                    <p className="text-[11px] text-ink-muted">
                      Te avisamos cuando algo necesite tu atención.
                    </p>
                  </li>
                )}
                {notifications.map((n) => (
                  <li key={n.id} className="border-b border-line/60 last:border-0">
                    <div className="flex items-start gap-3 px-4 py-3">
                      <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg border bg-bg-subtle/60", TONE_RING[n.tone])}>
                        {TONE_ICON[n.tone]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <p className={cn("flex-1 text-sm leading-snug", n.read ? "text-ink-muted" : "text-ink font-medium")}>
                            {n.title}
                          </p>
                          {!n.read && <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                        </div>
                        {n.detail && (
                          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-muted">
                            {n.detail}
                          </p>
                        )}
                        <div className="mt-2 flex items-center gap-2 text-[10px] text-ink-subtle">
                          <span>{relativeShort(n.createdAt)}</span>
                          {n.href && (
                            <Link
                              href={n.href}
                              onClick={() => {
                                if (!n.read) handleMarkRead(n.id);
                                setOpen(false);
                              }}
                              className="text-brand-300 hover:text-brand-200"
                            >
                              Ver →
                            </Link>
                          )}
                          {!n.read && (
                            <button
                              onClick={() => handleMarkRead(n.id)}
                              className="ml-auto inline-flex items-center gap-1 text-[10px] text-ink-muted hover:text-ink"
                            >
                              <Check className="h-3 w-3" /> Marcar leída
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function relativeShort(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}
