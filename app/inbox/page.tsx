"use client";

import { useMemo, useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Filter,
  Image as ImageIcon,
  Inbox,
  MessageSquareText,
  Mic,
  Phone,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InboxItem, InboxStatus, inboxItems } from "@/lib/mock-data";
import { formatARS, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const CHANNEL_ICON = {
  texto: MessageSquareText,
  audio: Mic,
  foto: ImageIcon,
} as const;

const FILTERS: { key: "todos" | InboxStatus; label: string }[] = [
  { key: "todos", label: "Todos" },
  { key: "pendiente", label: "Pendientes" },
  { key: "revision", label: "Revisión" },
  { key: "aprobado", label: "Aprobados" },
];

export default function InboxPage() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("todos");
  const [selectedId, setSelectedId] = useState<string>(inboxItems[0].id);
  const [statusOverrides, setStatusOverrides] = useState<Record<string, InboxStatus>>({});

  const items = useMemo(
    () =>
      inboxItems.map((m) => ({
        ...m,
        status: statusOverrides[m.id] ?? m.status,
      })),
    [statusOverrides],
  );

  const filtered = useMemo(
    () => (filter === "todos" ? items : items.filter((m) => m.status === filter)),
    [filter, items],
  );

  const selected = items.find((m) => m.id === selectedId) ?? items[0];

  const counts = {
    pendiente: items.filter((m) => m.status === "pendiente").length,
    revision: items.filter((m) => m.status === "revision").length,
    aprobado: items.filter((m) => m.status === "aprobado").length,
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Inbox IA · WhatsApp"
        title="Cada mensaje, un registro contable."
        description="La IA escucha tu WhatsApp, entiende el contexto del negocio y crea movimientos listos para aprobar. Vos sólo confirmás."
        actions={
          <>
            <Button size="sm" variant="ghost">
              <Phone className="h-4 w-4" />
              +54 9 11 5556-7700
            </Button>
            <Button size="sm" variant="ai">
              <Sparkles className="h-4 w-4" />
              Entrenar a la IA
            </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPill label="Pendientes" value={counts.pendiente} tone="brand" />
        <StatPill label="En revisión" value={counts.revision} tone="warn" />
        <StatPill label="Aprobados hoy" value={counts.aprobado} tone="success" />
        <StatPill label="Tasa de acierto IA" value="96%" tone="ai" />
      </div>

      {/* Inbox + Detail layout */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[420px_1fr]">
        {/* List */}
        <Card className="overflow-hidden">
          <div className="border-b border-line p-3">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-2">
              <Search className="h-4 w-4 text-ink-subtle" />
              <input
                placeholder="Buscar en mensajes…"
                className="flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
              />
              <Filter className="h-4 w-4 text-ink-subtle" />
            </div>
            <div className="mt-3 flex gap-1 overflow-x-auto">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    filter === f.key
                      ? "border-brand-500/30 bg-brand-500/10 text-brand-300"
                      : "border-line bg-bg-subtle text-ink-muted hover:text-ink",
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <ul className="max-h-[640px] divide-y divide-line overflow-y-auto scrollbar-thin">
            {filtered.length === 0 && (
              <li className="grid place-items-center gap-2 px-6 py-16 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full border border-line bg-bg-subtle text-ink-muted">
                  <Inbox className="h-4 w-4" />
                </div>
                <p className="text-sm text-ink">Sin mensajes en esta vista</p>
                <p className="text-xs text-ink-muted">
                  Probá con otro filtro o esperá nuevos registros.
                </p>
              </li>
            )}
            {filtered.map((m) => {
              const ChannelIcon = CHANNEL_ICON[m.channel];
              const active = m.id === selectedId;
              return (
                <li key={m.id}>
                  <button
                    onClick={() => setSelectedId(m.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                      active
                        ? "bg-bg-elevated"
                        : "hover:bg-bg-subtle",
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 h-10 w-0.5 -translate-y-0.5 rounded-full bg-brand-500" />
                    )}
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-xs font-semibold text-brand-300">
                      {initials(m.sender)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-ink">
                          {m.sender}
                        </p>
                        <span className="ml-auto text-[11px] text-ink-subtle">
                          {relativeTime(m.receivedAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-xs text-ink-muted">
                        {m.preview}
                      </p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-md border border-line bg-bg-subtle px-1.5 py-0.5 text-[10px] text-ink-muted">
                          <ChannelIcon className="h-3 w-3" />
                          {m.channel}
                        </span>
                        <StatusBadge status={m.status} />
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Detail */}
        <Card className="overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <MessageDetail
                item={selected}
                onApprove={() =>
                  setStatusOverrides((s) => ({ ...s, [selected.id]: "aprobado" }))
                }
                onReview={() =>
                  setStatusOverrides((s) => ({ ...s, [selected.id]: "revision" }))
                }
              />
            </motion.div>
          </AnimatePresence>
        </Card>
      </div>
    </div>
  );
}

function MessageDetail({
  item,
  onApprove,
  onReview,
}: {
  item: InboxItem;
  onApprove: () => void;
  onReview: () => void;
}) {
  const ChannelIcon = CHANNEL_ICON[item.channel];
  const isApproved = item.status === "aprobado";

  return (
    <div className="flex h-full flex-col">
      <CardHeader>
        <div className="flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-sm font-semibold text-brand-300">
            {initials(item.sender)}
          </div>
          <div>
            <CardTitle>{item.sender}</CardTitle>
            <p className="mt-0.5 text-xs text-ink-muted">
              {item.role} · {relativeTime(item.receivedAt)} ·{" "}
              <span className="inline-flex items-center gap-1">
                <ChannelIcon className="h-3 w-3" /> {item.channel}
              </span>
            </p>
          </div>
        </div>
        <StatusBadge status={item.status} large />
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* Mensaje original */}
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Mensaje original
          </div>
          <div className="rounded-2xl rounded-tl-sm border border-line bg-success-500/[0.04] p-3.5">
            <div className="mb-1 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-success-400">
              <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
              WhatsApp Business
            </div>
            <p className="text-sm leading-relaxed text-ink">{item.raw}</p>
          </div>
        </div>

        {/* IA extracción */}
        <div className="rounded-2xl border border-ai-400/30 bg-ai-500/[0.05] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="grid h-7 w-7 place-items-center rounded-lg border border-ai-400/30 bg-ai-500/15 text-ai-400">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="leading-tight">
                <div className="text-sm font-medium text-ink">La IA entendió</div>
                <div className="text-[11px] text-ink-muted">
                  Confianza{" "}
                  <span className="font-medium text-ai-400">
                    {Math.round(item.extracted.confidence * 100)}%
                  </span>
                  {item.extracted.missing && item.extracted.missing.length > 0 && (
                    <> · Falta confirmar: {item.extracted.missing.join(", ")}</>
                  )}
                </div>
              </div>
            </div>
            <Badge tone="ai">Borrador automático</Badge>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <FieldRow label="Tipo" value={item.extracted.tipo} />
            {item.extracted.monto !== undefined && (
              <FieldRow
                label="Monto"
                value={formatARS(item.extracted.monto)}
                highlight
              />
            )}
            {item.extracted.proveedor && (
              <FieldRow label="Proveedor" value={item.extracted.proveedor} />
            )}
            {item.extracted.empleado && (
              <FieldRow label="Empleado" value={item.extracted.empleado} />
            )}
            {item.extracted.insumo && (
              <FieldRow label="Insumo" value={item.extracted.insumo} />
            )}
            {item.extracted.cantidad && (
              <FieldRow label="Cantidad" value={item.extracted.cantidad} />
            )}
            {item.extracted.medioPago && (
              <FieldRow label="Medio de pago" value={item.extracted.medioPago} />
            )}
            {item.extracted.canal && (
              <FieldRow label="Canal" value={item.extracted.canal} />
            )}
            <FieldRow label="Categoría" value={item.extracted.categoria ?? "—"} />
            <FieldRow label="Fecha" value={item.extracted.fecha} />
          </div>

          {item.extracted.missing && item.extracted.missing.length > 0 && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border border-warn-500/30 bg-warn-500/10 px-3 py-2 text-xs text-warn-400">
              <CircleHelp className="h-3.5 w-3.5" />
              Falta info para registrar: {item.extracted.missing.join(", ")}
            </div>
          )}
        </div>

        {/* Acciones */}
        <div className="flex flex-col gap-2 border-t border-line pt-4 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-ink-muted">
            Al aprobar, el movimiento queda registrado y disponible en los reportes.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="md" onClick={onReview}>
              <CircleHelp className="h-4 w-4" />
              Pedir dato faltante
            </Button>
            <Button variant="ghost" size="md">
              <XCircle className="h-4 w-4" />
              Descartar
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={onApprove}
              disabled={isApproved}
            >
              {isApproved ? (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  Aprobado
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Aprobar registro
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </div>
  );
}

function FieldRow({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1.5 last:border-b-0">
      <span className="text-xs text-ink-subtle">{label}</span>
      <span
        className={cn(
          "text-right text-sm tabular-nums",
          highlight ? "font-semibold text-brand-300" : "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number | string;
  tone?: "brand" | "warn" | "success" | "ai" | "default";
}) {
  const toneClass = {
    brand: "text-brand-300",
    warn: "text-warn-400",
    success: "text-success-400",
    ai: "text-ai-400",
    default: "text-ink",
  }[tone];
  return (
    <div className="card flex items-center justify-between p-4">
      <div>
        <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
          {label}
        </div>
        <div className={cn("mt-1 text-xl font-semibold tabular-nums", toneClass)}>
          {value}
        </div>
      </div>
      <ChevronRight className="h-4 w-4 text-ink-subtle" />
    </div>
  );
}

function StatusBadge({
  status,
  large,
}: {
  status: InboxStatus;
  large?: boolean;
}) {
  if (status === "aprobado")
    return (
      <Badge tone="success" className={large ? "text-xs" : undefined}>
        <CheckCircle2 className="h-3 w-3" />
        Aprobado
      </Badge>
    );
  if (status === "revision")
    return (
      <Badge tone="warn" className={large ? "text-xs" : undefined}>
        <CircleHelp className="h-3 w-3" />
        Revisión
      </Badge>
    );
  return (
    <Badge tone="brand" className={large ? "text-xs" : undefined}>
      <Sparkles className="h-3 w-3" />
      Listo para aprobar
    </Badge>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}
