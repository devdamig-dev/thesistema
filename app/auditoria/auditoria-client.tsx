"use client";

import { useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileText,
  HandCoins,
  Inbox,
  Megaphone,
  Search,
  ShieldOff,
  Sparkles,
  UserPlus,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SegmentedTabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { exportActivityCsvAction } from "@/app/actions/audit";
import type { ActivityRow } from "@/lib/data/activity";
import { cn } from "@/lib/utils";

const ACTION_GROUPS = [
  { key: "all", label: "Todas" },
  { key: "inbox", label: "Inbox" },
  { key: "invoice", label: "Facturas" },
  { key: "debt", label: "Deudas" },
  { key: "team", label: "Equipo" },
  { key: "permission", label: "Permisos" },
] as const;

type GroupKey = (typeof ACTION_GROUPS)[number]["key"];

const ICONS: Record<string, any> = {
  invoice: FileText,
  inbox: Inbox,
  debt: HandCoins,
  team: UserPlus,
  permission: ShieldOff,
  marketing: Megaphone,
  approved: CheckCircle2,
  ai: Sparkles,
  default: Sparkles,
};

function iconFor(action: string) {
  const prefix = action.split(".")[0];
  return ICONS[prefix] ?? ICONS.default;
}

function relative(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "hace instantes";
  if (diff < 3600) return `hace ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)} h`;
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AuditoriaClient({
  initialRows,
}: {
  initialRows: ActivityRow[];
}) {
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [group, setGroup] = useState<GroupKey>("all");
  const [search, setSearch] = useState("");
  const [actor, setActor] = useState("");

  const rows = initialRows;

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: rows.length };
    rows.forEach((r) => {
      const prefix = r.action.split(".")[0];
      map[prefix] = (map[prefix] ?? 0) + 1;
    });
    return map;
  }, [rows]);

  const filtered = rows.filter((r) => {
    if (group !== "all" && !r.action.startsWith(group)) return false;
    if (actor) {
      const a = (r.actor_name ?? "").toLowerCase();
      if (!a.includes(actor.toLowerCase())) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const hit =
        r.summary.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        (r.target_type ?? "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  });

  function handleExport() {
    startTransition(async () => {
      const result = await exportActivityCsvAction({
        action: group === "all" ? undefined : group,
        actorName: actor || undefined,
        q: search || undefined,
      });
      if (!result.ok) {
        toast({ tone: "warn", title: "No se pudo exportar", description: result.error });
        return;
      }
      // Trigger download
      const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        tone: "success",
        title: "Exportación lista",
        description: `${result.rows} eventos · ${result.filename}`,
      });
    });
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Sistema · Auditoría"
        title="Todo lo que pasó en el negocio."
        description="Quién hizo qué, cuándo y a qué módulo afectó. Útil para el contador y para auditar permisos."
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={handleExport}
            disabled={pending}
          >
            <Download className="h-4 w-4" />
            {pending ? "Generando…" : "Exportar CSV"}
          </Button>
        }
      />

      {/* Stat strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Eventos" value={rows.length} />
        <Stat label="Aprobaciones inbox" value={counts.inbox ?? 0} tone="brand" />
        <Stat label="Facturas" value={counts.invoice ?? 0} tone="ai" />
        <Stat
          label="Accesos denegados"
          value={counts.permission ?? 0}
          tone="danger"
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
              placeholder="Buscar acción, resumen, módulo…"
              className="w-64 bg-transparent text-xs placeholder:text-ink-subtle focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-1.5">
            <input
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder="Filtrar por usuario…"
              className="w-48 bg-transparent text-xs placeholder:text-ink-subtle focus:outline-none"
            />
          </div>
          <SegmentedTabs
            value={group}
            onChange={setGroup}
            options={ACTION_GROUPS.map((g) => ({
              value: g.key,
              label: g.label,
              count: g.key === "all" ? counts.all : counts[g.key],
            }))}
          />
        </div>
      </div>

      {/* Lista */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            {filtered.length} {filtered.length === 1 ? "evento" : "eventos"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-10 text-center">
              <div className="mx-auto grid h-10 w-10 place-items-center rounded-full border border-line bg-bg-subtle text-ink-muted">
                <Sparkles className="h-4 w-4" />
              </div>
              <p className="mt-3 text-sm text-ink">Sin eventos en esta vista</p>
              <p className="text-xs text-ink-muted">Probá con otro filtro.</p>
            </div>
          ) : (
            filtered.map((row) => {
              const Icon = iconFor(row.action);
              const isDenied = row.action === "permission.denied";
              return (
                <div
                  key={row.id}
                  className={cn(
                    "group flex items-start gap-3 rounded-xl border p-3 transition-colors hover:bg-bg-subtle",
                    isDenied
                      ? "border-danger-500/25 bg-danger-500/[0.04]"
                      : "border-line bg-bg-subtle/40",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border bg-bg-subtle/60",
                      isDenied
                        ? "border-danger-500/30 text-danger-400"
                        : "border-line text-ink-muted",
                    )}
                  >
                    {isDenied ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : (
                      <Icon className="h-4 w-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-ink">
                        {row.actor_name ?? "Sistema"}
                      </span>
                      {row.actor_role && (
                        <Badge tone="default">{row.actor_role}</Badge>
                      )}
                      {row.target_type && (
                        <Badge tone="default">{row.target_type}</Badge>
                      )}
                      {isDenied && <Badge tone="danger">Denegado</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-ink-muted leading-relaxed">
                      {row.summary}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-subtle">
                      <span>{relative(row.created_at)}</span>
                      <span>·</span>
                      <code className="rounded bg-bg-elevated px-1 py-0.5 text-[10px] text-ink-muted">
                        {row.action}
                      </code>
                    </div>
                  </div>
                </div>
              );
            })
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
      <div className={cn("mt-1 text-2xl font-semibold tabular-nums", color)}>
        {value}
      </div>
    </div>
  );
}
