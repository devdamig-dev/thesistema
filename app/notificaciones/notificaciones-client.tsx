"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  Archive,
  Bell,
  Check,
  CheckCheck,
  CheckCircle2,
  Filter,
  Info,
  Search,
  Sparkles,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SegmentedTabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  type Notification,
  type NotificationCategory,
  type NotificationPriority,
} from "@/lib/data/notifications-types";
import {
  archiveNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/actions/notifications";
import { cn } from "@/lib/utils";

type ReadFilter = "all" | "unread" | "read";

const TONE_ICON: Record<Notification["tone"], JSX.Element> = {
  info: <Info className="h-4 w-4 text-ai-400" />,
  ai: <Sparkles className="h-4 w-4 text-ai-400" />,
  success: <CheckCircle2 className="h-4 w-4 text-success-400" />,
  warn: <AlertTriangle className="h-4 w-4 text-warn-400" />,
  danger: <AlertTriangle className="h-4 w-4 text-danger-400" />,
};

const PRIORITY_TONE: Record<NotificationPriority, "danger" | "warn" | "info" | "default"> = {
  high: "danger",
  medium: "warn",
  low: "info",
  info: "default",
};

const PRIORITY_DOT: Record<NotificationPriority, string> = {
  high: "bg-danger-500",
  medium: "bg-warn-500",
  low: "bg-ai-500",
  info: "bg-ink-subtle",
};

export default function NotificacionesClient({ initial }: { initial: Notification[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [category, setCategory] = useState<NotificationCategory | "all">("all");
  const [priority, setPriority] = useState<NotificationPriority | "all">("all");
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [search, setSearch] = useState("");

  const items = initial;

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: items.length };
    items.forEach((n) => {
      map[n.category] = (map[n.category] ?? 0) + 1;
    });
    return map;
  }, [items]);

  const unread = items.filter((n) => !n.read).length;

  const filtered = items.filter((n) => {
    if (category !== "all" && n.category !== category) return false;
    if (priority !== "all" && n.priority !== priority) return false;
    if (readFilter === "unread" && n.read) return false;
    if (readFilter === "read" && !n.read) return false;
    if (search) {
      const s = search.toLowerCase();
      const matches =
        n.title.toLowerCase().includes(s) ||
        (n.detail ?? "").toLowerCase().includes(s);
      if (!matches) return false;
    }
    return true;
  });

  function handleMarkRead(id: string) {
    startTransition(async () => {
      await markNotificationReadAction(id);
      router.refresh();
    });
  }

  function handleArchive(id: string) {
    startTransition(async () => {
      await archiveNotificationAction(id);
      toast({ tone: "neutral", title: "Notificación archivada" });
      router.refresh();
    });
  }

  function handleMarkAll() {
    startTransition(async () => {
      await markAllNotificationsReadAction();
      toast({ tone: "success", title: "Todas marcadas como leídas" });
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Sistema · Notificaciones"
        title="Todo lo que necesita tu atención."
        description="Filtrá por módulo, prioridad y estado. La IA y el sistema generan alertas en tiempo real."
        actions={
          <>
            <Link href="/ajustes/equipo">
              <Button size="sm" variant="ghost">
                Preferencias
              </Button>
            </Link>
            <Button
              size="sm"
              variant="primary"
              onClick={handleMarkAll}
              disabled={pending || unread === 0}
            >
              <CheckCheck className="h-4 w-4" />
              Marcar todas
            </Button>
          </>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total" value={items.length} />
        <Stat label="Sin leer" value={unread} tone="brand" />
        <Stat
          label="Alta prioridad"
          value={items.filter((n) => n.priority === "high" && !n.read).length}
          tone="danger"
        />
        <Stat
          label="Hoy"
          value={
            items.filter(
              (n) => new Date(n.createdAt).toDateString() === new Date().toDateString(),
            ).length
          }
          tone="ai"
        />
      </div>

      {/* Filtros */}
      <div className="space-y-3 rounded-2xl border border-line bg-bg-elevated/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-ink-subtle" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar en notificaciones…"
              className="w-56 bg-transparent text-xs placeholder:text-ink-subtle focus:outline-none"
            />
            <Filter className="h-3.5 w-3.5 text-ink-subtle" />
          </div>
          <SegmentedTabs
            value={readFilter}
            onChange={setReadFilter}
            options={[
              { value: "all", label: "Todas", count: items.length },
              { value: "unread", label: "Sin leer", count: unread },
              { value: "read", label: "Leídas", count: items.length - unread },
            ]}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ink-subtle">Módulo</span>
          <Chip
            label="Todos"
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {(Object.keys(CATEGORY_LABELS) as NotificationCategory[]).map((c) => (
            <Chip
              key={c}
              label={`${CATEGORY_LABELS[c]} ${counts[c] ? `(${counts[c]})` : ""}`}
              active={category === c}
              onClick={() => setCategory(c)}
            />
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ink-subtle">
            Prioridad
          </span>
          <Chip
            label="Todas"
            active={priority === "all"}
            onClick={() => setPriority("all")}
          />
          {(Object.keys(PRIORITY_LABELS) as NotificationPriority[]).map((p) => (
            <Chip
              key={p}
              label={PRIORITY_LABELS[p]}
              active={priority === p}
              onClick={() => setPriority(p)}
            />
          ))}
        </div>
      </div>

      {/* Lista */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            {filtered.length}{" "}
            {filtered.length === 1 ? "notificación" : "notificaciones"}
          </CardTitle>
          {pending && <span className="text-[10px] text-ink-subtle">actualizando…</span>}
        </CardHeader>
        <CardContent className="space-y-2">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-10 text-center">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-line bg-bg-subtle text-ink-muted">
                <Bell className="h-4 w-4" />
              </div>
              <p className="mt-3 text-sm text-ink">Sin notificaciones en esta vista</p>
              <p className="text-xs text-ink-muted">
                Probá con otro filtro o esperá nuevos eventos.
              </p>
            </div>
          ) : (
            filtered.map((n) => (
              <div
                key={n.id}
                className={cn(
                  "group relative flex items-start gap-3 rounded-xl border p-3 transition-colors",
                  n.read
                    ? "border-line bg-bg-subtle/40"
                    : "border-line bg-bg-elevated/60 hover:bg-bg-elevated",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-3 h-[calc(100%-1.5rem)] w-0.5 rounded-r",
                    PRIORITY_DOT[n.priority],
                  )}
                />
                <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-bg-subtle/60">
                  {TONE_ICON[n.tone]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p
                      className={cn(
                        "text-sm leading-snug",
                        n.read ? "text-ink-muted" : "font-semibold text-ink",
                      )}
                    >
                      {n.title}
                    </p>
                    <Badge tone={PRIORITY_TONE[n.priority]}>
                      {PRIORITY_LABELS[n.priority]}
                    </Badge>
                    <Badge tone="default">{CATEGORY_LABELS[n.category]}</Badge>
                    {!n.read && (
                      <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
                    )}
                  </div>
                  {n.detail && (
                    <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                      {n.detail}
                    </p>
                  )}
                  <div className="mt-2 flex items-center gap-3 text-[11px] text-ink-subtle">
                    <span>{relativeShort(n.createdAt)}</span>
                    {n.href && (
                      <Link
                        href={n.href}
                        onClick={() => !n.read && handleMarkRead(n.id)}
                        className="text-brand-300 hover:text-brand-200"
                      >
                        Ir al registro →
                      </Link>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {!n.read && (
                    <button
                      onClick={() => handleMarkRead(n.id)}
                      disabled={pending}
                      title="Marcar leída"
                      className="grid h-7 w-7 place-items-center rounded-md border border-line bg-bg-subtle text-ink-muted hover:text-ink"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleArchive(n.id)}
                    disabled={pending}
                    title="Archivar"
                    className="grid h-7 w-7 place-items-center rounded-md border border-line bg-bg-subtle text-ink-muted hover:text-ink"
                  >
                    <Archive className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "brand" | "danger" | "ai";
}) {
  const color = {
    default: "text-ink",
    brand: "text-brand-300",
    danger: "text-danger-400",
    ai: "text-ai-400",
  }[tone];
  return (
    <div className="card-quiet p-3.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", color)}>{value}</div>
    </div>
  );
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-brand-500/30 bg-brand-500/10 text-brand-300"
          : "border-line bg-bg-subtle text-ink-muted hover:text-ink",
      )}
    >
      {label}
    </button>
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
