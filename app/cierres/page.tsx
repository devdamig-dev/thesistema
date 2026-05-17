"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleHelp,
  ClipboardList,
  CreditCard,
  Hash,
  MapPin,
  MessageSquareText,
  ScrollText,
  Send,
  Sparkles,
  Wallet,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Closure, closures } from "@/lib/mock-data";
import { formatARS, formatNumber, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function CierresPage() {
  const [selectedId, setSelectedId] = useState(closures[0].id);
  const [overrides, setOverrides] = useState<Record<string, "aprobado">>({});
  const items = closures.map((c) => ({
    ...c,
    status: overrides[c.id] ?? c.status,
  }));
  const selected = items.find((c) => c.id === selectedId) ?? items[0];

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Cierres operativos · IA"
        title="El cierre del día llega por WhatsApp. La IA lo arma."
        description="Tu equipo manda el resumen en texto libre. Detectamos ingresos por medio de pago, gastos, retiros, productos vendidos y alertamos inconsistencias."
        actions={
          <Button size="sm" variant="ai">
            <Sparkles className="h-4 w-4" />
            Plantilla automática
          </Button>
        }
      />

      <BeforeAfterBanner />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
        {/* Lista */}
        <Card className="overflow-hidden">
          <div className="border-b border-line p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-ink">Cierres recibidos</div>
              <Badge tone="default">{items.length}</Badge>
            </div>
          </div>
          <ul className="divide-y divide-line">
            {items.map((c) => {
              const active = c.id === selectedId;
              return (
                <li key={c.id} className="relative">
                  <button
                    onClick={() => setSelectedId(c.id)}
                    className={cn(
                      "w-full px-4 py-3 text-left transition-colors",
                      active ? "bg-bg-elevated" : "hover:bg-bg-subtle/60",
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-10 w-0.5 -translate-y-1/2 rounded-r bg-brand-500" />
                    )}
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-bg-subtle text-ink-muted">
                        <ScrollText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-semibold text-ink">{c.punto}</div>
                          <span className="text-[10px] text-ink-subtle">
                            {relativeTime(c.recibida)}
                          </span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-ink-muted">
                          {c.fecha} · {c.sender}
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-sm font-semibold text-gradient-brand tabular-nums">
                            {formatARS(c.parsed.total, { compact: true })}
                          </span>
                          <span className="text-[10px] text-ink-subtle">bruto</span>
                          {c.status === "aprobado" ? (
                            <Badge tone="success" className="ml-auto">
                              <CheckCircle2 className="h-3 w-3" /> Aprobado
                            </Badge>
                          ) : c.inconsistencias.length > 0 ? (
                            <Badge tone="warn" className="ml-auto">
                              <AlertTriangle className="h-3 w-3" /> {c.inconsistencias.length}
                            </Badge>
                          ) : (
                            <Badge tone="brand" className="ml-auto">
                              <Sparkles className="h-3 w-3" /> Listo
                            </Badge>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Detalle */}
        <Card className="overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
            >
              <ClosureDetail
                closure={selected}
                onApprove={() =>
                  setOverrides((s) => ({ ...s, [selected.id]: "aprobado" }))
                }
              />
            </motion.div>
          </AnimatePresence>
        </Card>
      </div>
    </div>
  );
}

function BeforeAfterBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ai-400/20 bg-gradient-to-r from-ai-500/[0.06] via-bg-elevated/40 to-success-500/[0.04]">
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[auto_1fr_auto_1fr] md:items-center md:gap-6 md:p-5">
        <Badge tone="ai">
          <Sparkles className="h-3 w-3" /> Cómo funciona
        </Badge>
        <div>
          <div className="eyebrow text-danger-400/90">Antes</div>
          <p className="text-sm text-ink">
            Cierres a mano en planilla. Se traspapelan, se olvidan, no cuadran.
          </p>
        </div>
        <div className="hidden text-ai-400 md:block">→</div>
        <div>
          <div className="eyebrow text-success-400/90">Ahora</div>
          <p className="text-sm text-ink">
            El equipo escribe el resumen como siempre. La IA lo clasifica y detecta lo que no cuadra.
          </p>
        </div>
      </div>
    </div>
  );
}

function ClosureDetail({
  closure: c,
  onApprove,
}: {
  closure: Closure & { status: "pendiente" | "aprobado" };
  onApprove: () => void;
}) {
  const isApproved = c.status === "aprobado";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-ink-muted">
            <MapPin className="h-3.5 w-3.5" />
            {c.punto} · {c.fecha}
          </div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums">
            {formatARS(c.parsed.total)}{" "}
            <span className="text-sm font-normal text-ink-muted">bruto del día</span>
          </div>
          <div className="mt-1 text-xs text-ink-muted">
            Neto después de gastos y retiros:{" "}
            <span className="font-semibold text-success-400 tabular-nums">
              {formatARS(c.parsed.neto)}
            </span>
          </div>
        </div>
        {isApproved ? (
          <Badge tone="success">
            <CheckCircle2 className="h-3 w-3" /> Aprobado e imputado
          </Badge>
        ) : (
          <Badge tone="brand">
            <Sparkles className="h-3 w-3" /> Borrador automático
          </Badge>
        )}
      </div>

      {/* 2 columnas: mensaje vs parsed */}
      <div className="grid grid-cols-1 gap-0 md:grid-cols-2">
        {/* Mensaje original */}
        <div className="border-b border-line p-5 md:border-b-0 md:border-r">
          <div className="mb-2 flex items-center gap-2 text-xs">
            <MessageSquareText className="h-3.5 w-3.5 text-success-400" />
            <span className="eyebrow text-success-400/90">Mensaje original</span>
          </div>
          <div className="rounded-2xl rounded-tl-sm border border-success-500/20 bg-success-500/[0.04] p-4">
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-success-400">
              <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
              WhatsApp Business · {c.sender}
            </div>
            <pre className="whitespace-pre-wrap text-sm leading-relaxed text-ink font-sans">
              {c.raw}
            </pre>
            <div className="mt-2 text-[10px] text-ink-subtle">
              {relativeTime(c.recibida)}
            </div>
          </div>
        </div>

        {/* Parsed */}
        <div className="space-y-4 p-5">
          <div className="mb-1 flex items-center gap-2 text-xs">
            <Sparkles className="h-3.5 w-3.5 text-ai-400" />
            <span className="eyebrow text-ai-400/90">Cómo lo estructura la IA</span>
          </div>

          {/* Ingresos */}
          <Block icon={CreditCard} title="Ingresos por medio de pago">
            <ul className="space-y-1.5">
              {c.parsed.ingresos.map((i) => {
                const pct = (i.monto / c.parsed.total) * 100;
                return (
                  <li key={i.medio}>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-ink">{i.medio}</span>
                      <span className="tabular-nums text-ink">{formatARS(i.monto)}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-subtle">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
              <li className="mt-2 flex items-center justify-between border-t border-line/60 pt-2 text-sm">
                <span className="text-ink-muted">Total bruto</span>
                <span className="font-semibold tabular-nums text-brand-300">
                  {formatARS(c.parsed.total)}
                </span>
              </li>
            </ul>
          </Block>

          {/* Gastos y retiros lado a lado */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Block icon={ArrowDownRight} title="Gastos">
              {c.parsed.gastos.length === 0 ? (
                <Empty>Sin gastos en el día</Empty>
              ) : (
                <ul className="space-y-1 text-sm">
                  {c.parsed.gastos.map((g) => (
                    <li key={g.concepto} className="flex items-center justify-between">
                      <span className="text-ink">{g.concepto}</span>
                      <span className="tabular-nums text-danger-400">-{formatARS(g.monto)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
            <Block icon={Wallet} title="Retiros">
              {c.parsed.retiros.length === 0 ? (
                <Empty>Sin retiros</Empty>
              ) : (
                <ul className="space-y-1 text-sm">
                  {c.parsed.retiros.map((r) => (
                    <li key={r.concepto} className="flex items-center justify-between">
                      <span className="text-ink">{r.concepto}</span>
                      <span className="tabular-nums text-warn-400">-{formatARS(r.monto)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Block>
          </div>

          {/* Productos */}
          {c.parsed.productos.length > 0 && (
            <Block icon={Hash} title="Productos vendidos">
              <ul className="space-y-1 text-sm">
                {c.parsed.productos.map((p) => (
                  <li key={p.nombre} className="flex items-center justify-between">
                    <span className="text-ink">{p.nombre}</span>
                    <span className="tabular-nums text-ink">{formatNumber(p.cantidad)}</span>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
      </div>

      {/* Inconsistencias */}
      {c.inconsistencias.length > 0 && (
        <div className="border-t border-line px-5 py-4">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warn-400" />
            <h3 className="text-sm font-semibold text-ink">La IA detectó algo raro</h3>
            <Badge tone="warn">{c.inconsistencias.length}</Badge>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {c.inconsistencias.map((i, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-2 rounded-xl border p-3 text-xs",
                  i.tone === "danger" && "border-danger-500/30 bg-danger-500/[0.07] text-danger-400",
                  i.tone === "warn" && "border-warn-500/30 bg-warn-500/[0.07] text-warn-400",
                  i.tone === "info" && "border-ai-400/30 bg-ai-500/[0.07] text-ai-400",
                )}
              >
                <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="text-ink">{i.msg}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Acciones */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg-subtle/40 p-4">
        <p className="text-[11px] text-ink-subtle">
          Al aprobar, el cierre se imputa a ventas, gastos y caja del día.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="md">
            <CircleHelp className="h-4 w-4" /> Pedir aclaración
          </Button>
          <Button variant="ghost" size="md">
            Editar valores
          </Button>
          <Button variant="primary" size="md" onClick={onApprove} disabled={isApproved}>
            {isApproved ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                Aprobado
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Aprobar cierre
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Block({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-quiet p-3.5">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-subtle">
        <Icon className="h-3 w-3" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-ink-subtle">{children}</div>;
}
