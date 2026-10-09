"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Edit3,
  Filter,
  Image as ImageIcon,
  Inbox,
  MessageSquareText,
  Mic,
  Phone,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { SectionHeader } from "@/components/ui/section-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ConversationThread } from "@/components/common/conversation-thread";
import { PresenceIndicator } from "@/components/realtime/presence-indicator";
import { ToastPresets, useToast } from "@/components/ui/toast";
import {
  approveExtractionAction,
  previewInboxDebtAction,
  rejectExtractionAction,
  requestMoreInfoAction,
} from "@/app/actions/inbox";
import {
  InboxItem,
  InboxStatus,
  conversations,
} from "@/lib/mock-data";
import { formatARS, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getInboxAdvanceReviewAction } from "@/app/actions/inbox-advances";
import { InboxAdvanceReviewDialog } from "./advance-review";
import type { AdvanceReview } from "@/lib/advances/inbox";
import { getInboxClosureReviewAction } from "@/app/actions/inbox-closures";
import { InboxClosureReviewDialog } from "./closure-review";
import type { InboxClosureReview } from "@/lib/closures/inbox";
import { getInboxPurchaseReviewAction } from "@/app/actions/inbox-purchases";
import { InboxPurchaseReviewDialog } from "./purchase-review";
import type { InboxPurchaseReview } from "@/lib/purchases/inbox";
import { getInboxExpenseReviewAction } from "@/app/actions/inbox-expenses";
import { InboxExpenseReviewDialog } from "./expense-review";
import type { InboxExpenseReview } from "@/lib/expenses/inbox";
import { getInboxSaleReviewAction } from "@/app/actions/sales";
import { InboxSaleReviewDialog } from "./sale-review";
import type { InboxSaleReview } from "@/lib/sales/inbox";
import type { InboxDebtPreview } from "@/lib/whatsapp-agent/inbox-debts";

const CHANNEL_ICON = {
  texto: MessageSquareText,
  audio: Mic,
  foto: ImageIcon,
} as const;

type Filter = "todos" | InboxStatus;

export default function InboxClient({
  items: initialItems,
  presenceMe,
}: {
  items: InboxItem[];
  presenceMe?: { id: string; name: string };
}) {
  const router = useRouter();
  const [advanceReview, setAdvanceReview] = useState<AdvanceReview | null>(null);
  const [closureReview, setClosureReview] = useState<InboxClosureReview | null>(null);
  const [purchaseReview, setPurchaseReview] = useState<InboxPurchaseReview | null>(null);
  const [expenseReview, setExpenseReview] = useState<InboxExpenseReview | null>(null);
  const [saleReview,setSaleReview] = useState<InboxSaleReview|null>(null);
  const saleReviewLock=useRef(false);
  const [filter, setFilter] = useState<Filter>("todos");
  const [selectedId, setSelectedId] = useState<string>(initialItems[0]?.id ?? "");
  const [statusOverrides, setStatusOverrides] = useState<Record<string, InboxStatus>>({});
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();
  const [debtReview, setDebtReview] = useState<{ extractionId: string; preview: InboxDebtPreview } | null>(null);

  const items = useMemo(
    () =>
      initialItems.map((m) => ({
        ...m,
        status: statusOverrides[m.id] ?? m.status,
      })),
    [statusOverrides, initialItems],
  );

  const filtered = useMemo(
    () => (filter === "todos" ? items : items.filter((m) => m.status === filter)),
    [filter, items],
  );

  const selected = items.find((m) => m.id === selectedId) ?? items[0];
  const turns = conversations[selected.id] ?? [];

  const counts = {
    pendiente: items.filter((m) => m.status === "pendiente").length,
    revision: items.filter((m) => m.status === "revision").length,
    aprobado: items.filter((m) => m.status === "aprobado").length,
  };

  return (
    <>
    {advanceReview && <InboxAdvanceReviewDialog key={`${advanceReview.businessId}:${advanceReview.userId}:${advanceReview.extractionId}`} review={advanceReview} onClose={() => setAdvanceReview(null)} onSaved={() => { setAdvanceReview(null); toast({ tone: "success", title: "Adelanto registrado", description: "El adelanto, su aprobación y la auditoría quedaron guardados juntos. No se ejecutó un pago ni se cambió el saldo manual." }); router.refresh(); }} />}
    {closureReview && <InboxClosureReviewDialog key={`${closureReview.businessId}:${closureReview.userId}:${closureReview.extractionId}`} review={closureReview} onClose={() => setClosureReview(null)} onSaved={() => { setClosureReview(null); toast({ tone: "success", title: "Cierre guardado", description: "El resumen operativo y su aprobación quedaron registrados juntos, sin movimientos contables." }); router.refresh(); }} />}
    {purchaseReview && <InboxPurchaseReviewDialog key={`${purchaseReview.businessId}:${purchaseReview.userId}:${purchaseReview.extractionId}`} review={purchaseReview} onClose={() => setPurchaseReview(null)} onSaved={() => { setPurchaseReview(null); toast({ tone: "success", title: "Compra guardada", description: "La compra, su origen y la aprobación quedaron registrados juntos." }); router.refresh(); }} />}
    {expenseReview && <InboxExpenseReviewDialog key={`${expenseReview.businessId}:${expenseReview.userId}:${expenseReview.extractionId}`} review={expenseReview} onClose={() => setExpenseReview(null)} onSaved={() => { setExpenseReview(null); toast({ tone: "success", title: "Gasto guardado", description: "El gasto y su aprobación quedaron registrados juntos. No se ejecutó ningún pago." }); router.refresh(); }} />}
    {saleReview && <InboxSaleReviewDialog review={saleReview} onClose={()=>setSaleReview(null)} onSaved={()=>{setSaleReview(null);toast({tone:"success",title:"Resumen guardado",description:"Los ingresos se guardaron sin inventar tickets ni descontar stock."});router.refresh();}}/>}
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Inbox IA · WhatsApp"
        title="Cada mensaje, un registro contable."
        description="Tu equipo manda lo que pasa en el negocio por WhatsApp. La IA entiende, estructura y deja todo listo para que vos sólo confirmes."
        actions={
          <>
            {presenceMe && <PresenceIndicator room="inbox" me={presenceMe} />}
            <Link href="/ajustes/whatsapp">
              <Button size="sm" variant="ghost">
                <Phone className="h-4 w-4" />
                +54 9 11 5556-7700
              </Button>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                router.refresh();
                toast({ tone: "info", title: "Actualizando inbox…" });
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
            <Button
              size="sm"
              variant="ai"
              onClick={() => toast(ToastPresets.comingSoon("Entrenamiento de IA"))}
            >
              <Sparkles className="h-4 w-4" />
              Entrenar a la IA
            </Button>
          </>
        }
      />

      {/* Banner Antes / Ahora */}
      <BeforeAfterBanner />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatPill label="Pendientes" value={counts.pendiente} tone="brand" />
        <StatPill label="En revisión" value={counts.revision} tone="warn" />
        <StatPill label="Aprobados hoy" value={counts.aprobado} tone="success" />
        <StatPill label="Tasa de acierto IA" value="96%" tone="ai" />
      </div>

      {/* Inbox 3 columnas */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_1fr_400px]">
        {/* Columna 1: Lista */}
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
            <div className="mt-3">
              <SegmentedTabs
                options={[
                  { value: "todos", label: "Todos" },
                  { value: "pendiente", label: "Pendientes", count: counts.pendiente },
                  { value: "revision", label: "Revisión", count: counts.revision },
                  { value: "aprobado", label: "OK", count: counts.aprobado },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </div>
          </div>
          <ul className="max-h-[680px] divide-y divide-line overflow-y-auto scrollbar-thin">
            {filtered.length === 0 && (
              <li className="grid place-items-center gap-2 px-6 py-16 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full border border-line bg-bg-subtle text-ink-muted">
                  <Inbox className="h-4 w-4" />
                </div>
                <p className="text-sm text-ink">Sin mensajes en esta vista</p>
                <p className="text-xs text-ink-muted">
                  Probá otro filtro o esperá nuevos registros.
                </p>
              </li>
            )}
            {filtered.map((m) => {
              const ChannelIcon = CHANNEL_ICON[m.channel];
              const active = m.id === selectedId;
              return (
                <li key={m.id} className="relative">
                  <button
                    onClick={() => setSelectedId(m.id)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors",
                      active ? "bg-bg-elevated" : "hover:bg-bg-subtle/60",
                    )}
                  >
                    {active && (
                      <span className="absolute left-0 top-1/2 h-10 w-0.5 -translate-y-1/2 rounded-r bg-brand-500" />
                    )}
                    <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-xs font-semibold text-brand-300">
                      {initials(m.sender)}
                      {m.status === "pendiente" && (
                        <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg-elevated bg-brand-500" />
                      )}
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

        {/* Columna 2: Conversación */}
        <Card className="flex flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="flex h-full min-h-[560px] flex-col"
            >
              <div className="flex items-center justify-between border-b border-line px-5 py-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-xs font-semibold text-brand-300">
                    {initials(selected.sender)}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-ink">{selected.sender}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                      <span className="h-1.5 w-1.5 rounded-full bg-success-500" />
                      en línea · {selected.role} · WhatsApp
                    </div>
                  </div>
                </div>
                <StatusBadge status={selected.status} large />
              </div>

              <div className="flex-1 space-y-4 overflow-y-auto bg-[linear-gradient(180deg,rgba(132,204,22,0.02),transparent_40%)] p-5 scrollbar-thin">
                <DayDivider label="Hoy" />
                <ConversationThread turns={turns} sender={selected.sender} />
                <TypingIndicator />
              </div>

              <div className="border-t border-line bg-bg-subtle/40 p-3">
                <div className="flex items-center gap-2 rounded-xl border border-line bg-bg-elevated px-3 py-2">
                  <Sparkles className="h-4 w-4 text-ai-400" />
                  <input
                    placeholder="Respondé como copiloto…"
                    className="flex-1 bg-transparent text-sm placeholder:text-ink-subtle focus:outline-none"
                  />
                  <Button
                    variant="ai"
                    size="sm"
                    onClick={() =>
                      toast({
                        tone: "ai",
                        title: "Respuesta enviada",
                        description: "El copiloto la mandó por WhatsApp.",
                      })
                    }
                  >
                    <Send className="h-3.5 w-3.5" />
                    Enviar
                  </Button>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </Card>

        {/* Columna 3: Registro detectado */}
        <Card className="overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={selected.id}
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.25 }}
            >
              <ExtractedPanel
                item={selected}
                pending={pending}
                debtPreview={debtReview && debtReview.extractionId === selected.extractionId ? debtReview.preview : undefined}
                onCancelDebtPreview={() => setDebtReview(null)}
                onApprove={() => {
                  // Si tenemos extractionId, vamos al server. Si no
                  // (modo demo o item de mock), sólo actualizamos estado.
                  const extractionId = selected.extractionId;
                  if (!extractionId) {
                    setStatusOverrides((s) => ({ ...s, [selected.id]: "aprobado" }));
                    toast(ToastPresets.approved("Movimiento"));
                    return;
                  }
                  if (saleReviewLock.current) return;
                  saleReviewLock.current=true;
                  startTransition(async () => {
                    try {
                      const advance = await getInboxAdvanceReviewAction(extractionId);
                      if (advance.ok) { setAdvanceReview(advance.review); return; }
                      if (advance.error !== "unsupported_advance_extraction") { toast({ tone: "warn", title: "El adelanto requiere revisión", description: advance.error }); return; }
                      const sale = await getInboxSaleReviewAction(extractionId);
                      if (sale.ok) { setSaleReview(sale.review); return; }
                      if (sale.error !== "unsupported_sale_extraction") { toast({tone:"warn",title:"La venta requiere revisión",description:sale.error}); return; }
                      const purchase = await getInboxPurchaseReviewAction(extractionId);
                      if (purchase.ok) { setPurchaseReview(purchase.review); return; }
                      if (purchase.error !== "unsupported_purchase_extraction") { toast({ tone: "warn", title: "La compra requiere revisión", description: purchase.error }); return; }
                      const expense = await getInboxExpenseReviewAction(extractionId);
                      if (expense.ok) { setExpenseReview(expense.review); return; }
                      if (expense.error !== "unsupported_expense_extraction") { toast({ tone: "warn", title: "El gasto requiere revisión", description: expense.error }); return; }
                      const closure = await getInboxClosureReviewAction(extractionId);
                      if (closure.ok) { setClosureReview(closure.review); return; }
                      if (closure.error !== "unsupported_closure_extraction") { toast({ tone: "warn", title: "El cierre requiere revisión", description: closure.error }); return; }
                    } finally { saleReviewLock.current=false; }
                    const preview = debtReview?.extractionId === extractionId ? debtReview.preview : null;
                    if (!preview) {
                      const review = await previewInboxDebtAction(extractionId);
                      if (review.ok) {
                        setDebtReview({ extractionId, preview: review.preview });
                        return; // First click is read-only. The operator must review the complete schedule.
                      }
                      if (review.error !== "unsupported_debt_extraction") {
                        toast({ tone: "warn", title: "La deuda necesita revisión", description: "Faltan datos completos o permisos de Deudas. Revisá moneda, fechas, financiación y cuota/imputación. No se guardó ninguna obligación." });
                        await approveExtractionAction(extractionId); // Marks incomplete debt proposals needs_review, never writes a debt.
                        setStatusOverrides((s) => ({ ...s, [selected.id]: "revision" }));
                        return;
                      }
                    }
                    const result = await approveExtractionAction(extractionId, preview?.digest);
                    if (result.ok) {
                      setDebtReview(null);
                      setStatusOverrides((s) => ({ ...s, [selected.id]: "aprobado" }));
                      toast({
                        tone: "success",
                        title: "Registro aprobado",
                        description: result.persisted
                          ? `Creado en ${result.target_entity ?? "el sistema"}.`
                          : "Cambio local · activá database mode para persistir.",
                      });
                      router.refresh();
                    } else {
                      if (result.error !== "debt_response_unknown" && result.error !== "debt_saved_inbox_status_pending") setDebtReview(null);
                      toast({
                        tone: "warn",
                        title: "No pudimos aprobar",
                        description:
                          result.error === "missing_fields_for_creation" ? "Faltan datos críticos. Lo dejamos en revisión."
                            : result.error === "debt_review_required" ? "El detalle o la sesión cambiaron. Revisá el nuevo cronograma antes de confirmar."
                            : result.error === "stale_version" ? "El saldo cambió. Actualizá el detalle y revisá la imputación antes de confirmar."
                            : ["debt_response_unknown", "debt_saved_inbox_status_pending"].includes(result.error) ? "El resultado podría estar guardado. Conservamos el mismo intento: podés reintentar sin duplicar la operación o revisar Deudas."
                            : result.error,
                      });
                      setStatusOverrides((s) => ({ ...s, [selected.id]: "revision" }));
                    }
                  });
                }}
                onReview={() => {
                  const extractionId = selected.extractionId;
                  if (!extractionId) {
                    setStatusOverrides((s) => ({ ...s, [selected.id]: "revision" }));
                    toast(ToastPresets.needsDataRequested());
                    return;
                  }
                  startTransition(async () => {
                    const result = await requestMoreInfoAction(extractionId);
                    setStatusOverrides((s) => ({ ...s, [selected.id]: "revision" }));
                    toast(
                      result.ok
                        ? ToastPresets.needsDataRequested()
                        : { tone: "warn", title: "Error", description: result.error },
                    );
                    router.refresh();
                  });
                }}
                onDiscard={() => {
                  const extractionId = selected.extractionId;
                  if (!extractionId) {
                    toast(ToastPresets.dismissed("Movimiento"));
                    return;
                  }
                  startTransition(async () => {
                    const result = await rejectExtractionAction(extractionId);
                    toast(
                      result.ok
                        ? ToastPresets.dismissed("Movimiento")
                        : { tone: "warn", title: "Error", description: result.error },
                    );
                    router.refresh();
                  });
                }}
                onEdit={() => toast(ToastPresets.comingSoon("Editor de campos"))}
              />
            </motion.div>
          </AnimatePresence>
        </Card>
      </div>
    </div>
    </>
  );
}

function BeforeAfterBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ai-400/20 bg-gradient-to-r from-ai-500/[0.06] via-bg-elevated/40 to-success-500/[0.04]">
      <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-[auto_1fr_auto_1fr] md:items-center md:gap-6 md:p-5">
        <Badge tone="ai">
          <Sparkles className="h-3 w-3" /> Diferencial
        </Badge>
        <div>
          <div className="eyebrow text-danger-400/90">Antes</div>
          <p className="text-sm text-ink">
            Mensajes perdidos en WhatsApp, planillas que nadie completa, decisiones a fin de mes.
          </p>
        </div>
        <div className="hidden text-ai-400 md:block">→</div>
        <div>
          <div className="eyebrow text-success-400/90">Ahora</div>
          <p className="text-sm text-ink">
            Administración ordenada en tiempo real. Cada mensaje se convierte en un dato útil.
          </p>
        </div>
      </div>
    </div>
  );
}

function DayDivider({ label }: { label: string }) {
  return (
    <div className="my-2 flex items-center gap-3">
      <div className="h-px flex-1 bg-line" />
      <span className="rounded-full border border-line bg-bg-subtle px-2.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-subtle">
        {label}
      </span>
      <div className="h-px flex-1 bg-line" />
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 pl-9 text-[11px] text-ai-400">
      <span className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-ai-400" style={{ animationDelay: "0ms" }} />
        <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-ai-400" style={{ animationDelay: "150ms" }} />
        <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-ai-400" style={{ animationDelay: "300ms" }} />
      </span>
      Copiloto está escuchando…
    </div>
  );
}

function ExtractedPanel({
  item,
  onApprove,
  onReview,
  onDiscard,
  onEdit,
  pending,
  debtPreview,
  onCancelDebtPreview,
}: {
  item: InboxItem;
  debtPreview?: InboxDebtPreview;
  onCancelDebtPreview: () => void;
  onApprove: () => void;
  onReview: () => void;
  onDiscard: () => void;
  onEdit: () => void;
  pending?: boolean;
}) {
  const isApproved = item.status === "aprobado";
  const confidencePct = Math.round(item.extracted.confidence * 100);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-ai-400/30 bg-ai-500/15">
              <Sparkles className="h-4 w-4 text-ai-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">Registro detectado</div>
              <div className="text-[11px] text-ink-muted">
                Borrador generado por la IA
              </div>
            </div>
          </div>
          <Badge tone="ai">{item.extracted.tipo}</Badge>
        </div>

        {/* Confidence bar */}
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-ink-subtle">Confianza de la IA</span>
            <span className="font-semibold text-ai-400 tabular-nums">{confidencePct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${confidencePct}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="h-full rounded-full bg-gradient-to-r from-ai-400 to-ai-600"
            />
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-5 py-4 scrollbar-thin">
        {item.extracted.monto !== undefined && (
          <div className="mb-3 rounded-xl border border-brand-500/20 bg-brand-500/[0.05] p-3">
            <div className="text-[10px] uppercase tracking-wider text-brand-300/80">
              Monto detectado
            </div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-gradient-brand tabular-nums">
              {formatARS(item.extracted.monto)}
            </div>
          </div>
        )}

        {debtPreview && <InboxDebtReview preview={debtPreview} onCancel={onCancelDebtPreview} pending={pending} />}
        <FieldRow label="Tipo de movimiento" value={item.extracted.tipo} />
        {item.extracted.proveedor && <FieldRow label="Proveedor" value={item.extracted.proveedor} />}
        {item.extracted.empleado && <FieldRow label="Empleado" value={item.extracted.empleado} />}
        {item.extracted.insumo && <FieldRow label="Insumo" value={item.extracted.insumo} />}
        {item.extracted.cantidad && <FieldRow label="Cantidad" value={item.extracted.cantidad} />}
        {item.extracted.medioPago && <FieldRow label="Medio de pago" value={item.extracted.medioPago} />}
        {item.extracted.canal && <FieldRow label="Canal" value={item.extracted.canal} />}
        <FieldRow label="Categoría" value={item.extracted.categoria ?? "—"} />
        <FieldRow label="Fecha" value={item.extracted.fecha} />

        {item.extracted.missing && item.extracted.missing.length > 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-warn-500/30 bg-warn-500/[0.08] p-3 text-xs">
            <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warn-400" />
            <div>
              <div className="font-medium text-warn-400">Falta confirmar</div>
              <div className="mt-0.5 text-ink-muted">
                {item.extracted.missing.join(", ")}. La IA te lo está preguntando por WhatsApp.
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-line bg-bg-subtle/40 p-3">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" size="sm" onClick={onReview} disabled={pending}>
            <CircleHelp className="h-3.5 w-3.5" />
            Pedir dato
          </Button>
          <Button variant="ghost" size="sm" onClick={onEdit} disabled={pending}>
            <Edit3 className="h-3.5 w-3.5" />
            Editar
          </Button>
          <Button variant="ghost" size="sm" onClick={onDiscard} disabled={pending}>
            <XCircle className="h-3.5 w-3.5" />
            Descartar
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onApprove}
            disabled={isApproved && item.extracted.tipo !== "Adelanto a empleado" || pending}
          >
            {isApproved ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {item.extracted.tipo === "Adelanto a empleado" ? "Verificar adelanto" : "Aprobado"}
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                {debtPreview ? "Confirmar este detalle" : "Aprobar"}
              </>
            )}
          </Button>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-subtle">
          La IA no reemplaza tu criterio: te muestra lo que antes no veías.
        </p>
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-2 last:border-b-0">
      <span className="text-xs text-ink-subtle">{label}</span>
      <span className="text-right text-sm text-ink">{value}</span>
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
        Dato faltante
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

function InboxDebtReview({ preview, onCancel, pending }: { preview: InboxDebtPreview; onCancel: () => void; pending?: boolean }) {
  const money = (cents: number) => `${preview.currency} ${(cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return <section aria-label="Detalle de deuda para confirmar" className="mb-4 space-y-2 rounded-xl border border-warn-500/40 bg-bg-subtle p-3 text-sm">
    <h3 className="font-semibold">Revisá antes de guardar</h3>
    <p>{preview.creditor}</p><p className="break-all text-xs">Sucursal: {preview.branchId}</p>
    {preview.creation && <><p>Origen: {preview.creation.takenAt} · {preview.creation.creditorType}</p><p>{preview.creation.concept}</p>{preview.creation.reference && <p>Referencia: {preview.creation.reference}</p>}{preview.creation.notes && <p>Notas: {preview.creation.notes}</p>}{preview.creation.expectedPaymentMethod && <p>Método previsto: {preview.creation.expectedPaymentMethod}</p>}</>}
    {preview.schedule && <>
      <p>Capital original: {money(preview.schedule.originalAmountCents)}</p>
      <p>Total financiado: {money(preview.schedule.totalFinancedCents)}</p>
      {preview.schedule.downPaymentCents !== null && <p>Anticipo histórico confirmado: {money(preview.schedule.downPaymentCents)}</p>}
      {preview.schedule.interestRate && <p>Tasa informada: {preview.schedule.interestRate.value} ({preview.schedule.interestRate.period})</p>}
      <ol className="max-h-72 space-y-2 overflow-auto" aria-label="Cronograma completo">{preview.schedule.installments.map(part => <li key={part.installmentNumber}>Cuota {part.installmentNumber}: {money(part.totalAmountCents)} · {part.dueDate ?? "sin vencimiento informado"}</li>)}</ol>
    </>}
    {preview.payment && <>
      <p>Pago: {money(preview.payment.amountCents)} · {preview.payment.paidAt}</p>
      <p>Método: {preview.payment.paymentMethod}</p>
      <p className="break-all">Imputación: {preview.payment.allocation.rule === "oldest_due" ? "cuotas pendientes más antiguas" : `sólo cuota ${preview.payment.allocation.installmentId}, sin distribuir a otras cuotas`}</p>
      {preview.payment.reference && <p>Referencia: {preview.payment.reference}</p>}{preview.payment.notes && <p>Notas: {preview.payment.notes}</p>}
    </>}
    <p className="text-xs text-ink-muted">La confirmación usa exactamente este detalle. Si cambia, será necesario revisarlo otra vez.</p>
    <Button variant="ghost" size="sm" onClick={onCancel} disabled={pending}>Cancelar revisión</Button>
  </section>;
}
