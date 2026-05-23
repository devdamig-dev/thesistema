"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Download,
  FileText,
  Filter,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  Search,
  Send,
  Sparkles,
  Upload,
  XCircle,
  Zap,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { SegmentedTabs } from "@/components/ui/tabs";
import { ToastPresets, useToast } from "@/components/ui/toast";
import {
  approveInvoiceAction,
  rejectInvoiceAction,
  uploadInvoiceAction,
} from "@/app/actions/invoices";
import {
  Invoice,
  InvoiceStatus,
  invoices,
} from "@/lib/mock-data";
import { formatARS, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const FILTERS: { value: "todas" | InvoiceStatus; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "procesando", label: "Procesando" },
  { value: "revision", label: "Revisión" },
  { value: "aprobado", label: "Aprobadas" },
  { value: "contador", label: "Contador" },
];

export default function FacturasPage() {
  const router = useRouter();
  const [filter, setFilter] = useState<"todas" | InvoiceStatus>("todas");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [overrides, setOverrides] = useState<Record<string, InvoiceStatus>>({});
  const [pending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  function handleFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    const formData = new FormData();
    formData.append("file", file);

    toast(ToastPresets.invoiceUploaded());

    startTransition(async () => {
      const result = await uploadInvoiceAction(formData);
      if (result.ok) {
        const summary = (result as any).summary;
        const detected = summary?.extraction?.supplier ?? summary?.extraction?.items?.length;
        toast({
          tone: "success",
          title: result.persisted ? "Factura procesada" : "Procesada en modo demo",
          description: detected
            ? `IA detectó: ${summary.extraction.supplier ?? "—"} · ${summary.extraction.items?.length ?? 0} ítems · ${Math.round((summary.extraction.confidence ?? 0) * 100)}% confianza`
            : "Listo. Mirá el detalle abajo.",
        });
        router.refresh();
      } else {
        toast({
          tone: "warn",
          title: "No pudimos procesar",
          description: result.error,
        });
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
    });
  }

  const items = useMemo(
    () => invoices.map((i) => ({ ...i, status: overrides[i.id] ?? i.status })),
    [overrides],
  );
  const filtered = filter === "todas" ? items : items.filter((i) => i.status === filter);

  const counts = {
    todas: items.length,
    procesando: items.filter((i) => i.status === "procesando").length,
    revision: items.filter((i) => i.status === "revision").length,
    aprobado: items.filter((i) => i.status === "aprobado").length,
    contador: items.filter((i) => i.status === "contador").length,
  };

  const totalMes = items.reduce((s, i) => s + i.total, 0);
  const ivaMes = items.reduce((s, i) => s + i.iva, 0);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Documentación · OCR + IA"
        title="Tus facturas, ordenadas automáticamente."
        description="Mandá la foto o el PDF por WhatsApp. La IA lee el comprobante, lo cruza con tus insumos y deja la factura lista para vos y para el contador."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toast(ToastPresets.exported())}
            >
              <Download className="h-4 w-4" /> Exportar mes
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={pending}
            >
              {pending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {pending ? "Procesando…" : "Subir factura"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => handleFilesPicked(e.target.files)}
            />
          </>
        }
      />

      {/* Upload Zone + Stats */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        <UploadZone
          pending={pending}
          onUpload={() => fileInputRef.current?.click()}
          onWhatsapp={() =>
            toast({
              tone: "ai",
              title: "Abriendo WhatsApp",
              description: "Te abrimos un chat para enviar la factura.",
            })
          }
        />
        <StatStrip
          stats={[
            { label: "Facturas del mes", value: String(counts.todas), tone: "brand" },
            { label: "Monto total", value: formatARS(totalMes, { compact: true }), tone: "default" },
            { label: "IVA discriminado", value: formatARS(ivaMes, { compact: true }), tone: "ai" },
            { label: "Listas para contador", value: String(counts.contador), tone: "success" },
          ]}
        />
      </div>

      {/* Filters + Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            value: f.value,
            label: f.label,
            count: f.value === "todas" ? counts.todas : counts[f.value],
          }))}
        />
        <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-3 py-1.5">
          <Search className="h-3.5 w-3.5 text-ink-subtle" />
          <input
            placeholder="Buscar proveedor, CUIT, número…"
            className="w-56 bg-transparent text-xs placeholder:text-ink-subtle focus:outline-none"
          />
          <Filter className="h-3.5 w-3.5 text-ink-subtle" />
        </div>
      </div>

      {/* Grid de facturas */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((inv, idx) => (
          <motion.button
            key={inv.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.03 }}
            onClick={() => {
              setSelected(inv);
              setOpen(true);
            }}
            className="card group relative overflow-hidden text-left transition-all hover:border-line-strong hover:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)]"
          >
            <InvoicePreview invoice={inv} />
            <div className="space-y-3 p-4 pt-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{inv.proveedor}</div>
                  <div className="truncate text-[11px] text-ink-subtle">
                    {inv.tipo} · {inv.numero}
                  </div>
                </div>
                <StatusChip status={inv.status} />
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Total</div>
                  <div className="text-lg font-semibold text-ink tabular-nums">
                    {formatARS(inv.total)}
                  </div>
                </div>
                <div className="text-right text-[11px] text-ink-subtle">
                  <div>{inv.fecha}</div>
                  <div className="flex items-center justify-end gap-1">
                    {inv.source === "foto" ? (
                      <ImageIcon className="h-3 w-3" />
                    ) : (
                      <FileText className="h-3 w-3" />
                    )}
                    {inv.source === "foto" ? "Foto WhatsApp" : "PDF WhatsApp"}
                  </div>
                </div>
              </div>
              {inv.status !== "procesando" && (
                <ConfidenceMini value={inv.confidence} />
              )}
            </div>
          </motion.button>
        ))}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={selected?.proveedor}
        description={selected ? `Factura ${selected.tipo}-${selected.numero}` : undefined}
        width="max-w-3xl"
      >
        {selected && (
          <InvoiceDetail
            invoice={selected}
            onApprove={() => {
              // Si la invoice tiene id formato uuid (database mode),
              // dispara el server action. En demo (mock-data) sólo
              // actualiza estado local.
              setOverrides((s) => ({ ...s, [selected.id]: "aprobado" }));
              startTransition(async () => {
                const result = await approveInvoiceAction(selected.id);
                if (result.ok) {
                  const recalc = (result as any).recalc;
                  const recommendations =
                    Array.isArray(recalc)
                      ? recalc.reduce((s: number, r: any) => s + (r.recommendationsCreated ?? 0), 0)
                      : 0;
                  toast({
                    tone: "success",
                    title: "Factura aprobada",
                    description: result.persisted
                      ? `Stock actualizado · ${recommendations} alertas de margen generadas.`
                      : "Modo demo · sin impacto en stock real.",
                  });
                  router.refresh();
                } else {
                  toast({ tone: "warn", title: "Error al aprobar", description: result.error });
                }
              });
            }}
            onSendAccountant={() => {
              setOverrides((s) => ({ ...s, [selected.id]: "contador" }));
              toast(ToastPresets.invoiceSentToAccountant());
            }}
            onReject={() => {
              setOverrides((s) => ({ ...s, [selected.id]: "revision" }));
              startTransition(async () => {
                const result = await rejectInvoiceAction(selected.id);
                if (result.ok) {
                  toast(ToastPresets.dismissed("Factura"));
                  router.refresh();
                } else {
                  toast({ tone: "warn", title: "Error", description: result.error });
                }
              });
            }}
            onEdit={() => toast(ToastPresets.comingSoon("Editor de factura"))}
          />
        )}
      </Drawer>
    </div>
  );
}

/* -------------------- subcomponentes -------------------- */

function UploadZone({
  onUpload,
  onWhatsapp,
  pending,
}: {
  onUpload: () => void;
  onWhatsapp: () => void;
  pending?: boolean;
}) {
  return (
    <div className="card relative overflow-hidden p-6">
      <div className="absolute inset-0 grid-dots opacity-30" />
      <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-ai-500/15 blur-3xl" />
      <div className="relative flex flex-col items-start gap-4 md:flex-row md:items-center">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-ai-400/30 bg-ai-500/15">
          <Sparkles className="h-6 w-6 text-ai-400" />
        </div>
        <div className="flex-1">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone="ai">
              <Zap className="h-3 w-3" /> OCR + IA
            </Badge>
            <span className="text-[10px] uppercase tracking-wider text-ink-subtle">
              · 8 seg promedio
            </span>
          </div>
          <h3 className="text-base font-semibold tracking-tight text-ink">
            Subí una factura desde WhatsApp o arrastrala acá.
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            Detectamos proveedor, CUIT, ítems, IVA y total. Lo asociamos a tus insumos
            y actualizamos stock y precios automáticamente.
          </p>
        </div>
        <div className="flex gap-2 md:flex-col">
          <Button variant="primary" size="sm" onClick={onUpload} disabled={pending}>
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {pending ? "Procesando…" : "Subir archivo"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onWhatsapp}>
            <Paperclip className="h-3.5 w-3.5" /> Desde WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
}

function StatStrip({
  stats,
}: {
  stats: { label: string; value: string; tone: "brand" | "default" | "ai" | "success" }[];
}) {
  const toneClass = (t: string) =>
    ({
      brand: "text-brand-300",
      default: "text-ink",
      ai: "text-ai-400",
      success: "text-success-400",
    })[t]!;
  return (
    <div className="card grid grid-cols-2 divide-x divide-line">
      {stats.map((s) => (
        <div key={s.label} className="p-4">
          <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
            {s.label}
          </div>
          <div className={`mt-1 text-xl font-semibold tabular-nums ${toneClass(s.tone)}`}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function InvoicePreview({ invoice }: { invoice: Invoice }) {
  return (
    <div className="relative h-32 overflow-hidden border-b border-line bg-gradient-to-br from-bg-subtle to-bg-elevated">
      <div className="grid-dots absolute inset-0 opacity-50" />
      <div className="absolute left-3 top-3">
        <Badge tone="default">
          {invoice.source === "foto" ? (
            <ImageIcon className="h-3 w-3" />
          ) : (
            <FileText className="h-3 w-3" />
          )}
          {invoice.source.toUpperCase()}
        </Badge>
      </div>
      <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md border border-line bg-bg-elevated/80 px-1.5 py-0.5 text-[10px] text-ink-muted backdrop-blur">
        Tipo {invoice.tipo}
      </div>
      <div className="absolute inset-x-4 bottom-3">
        <div className="rounded-md border border-line bg-bg-elevated/70 p-2 backdrop-blur">
          <div className="grid grid-cols-3 gap-2 text-[10px]">
            <FakeLine w="80%" />
            <FakeLine w="60%" />
            <FakeLine w="70%" />
            <FakeLine w="90%" />
            <FakeLine w="50%" />
            <FakeLine w="40%" />
          </div>
        </div>
      </div>
      {invoice.status === "procesando" && (
        <div className="absolute inset-0 grid place-items-center bg-ai-500/[0.06] backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-ai-400" />
            <div className="text-[11px] font-medium text-ai-400">Procesando con IA…</div>
          </div>
        </div>
      )}
    </div>
  );
}

function FakeLine({ w }: { w: string }) {
  return (
    <div className="h-1.5 rounded-full bg-ink-subtle/20" style={{ width: w }} />
  );
}

function StatusChip({ status }: { status: InvoiceStatus }) {
  if (status === "procesando")
    return (
      <Badge tone="ai">
        <Loader2 className="h-3 w-3 animate-spin" /> Procesando
      </Badge>
    );
  if (status === "revision")
    return (
      <Badge tone="warn">
        <Sparkles className="h-3 w-3" /> Revisión
      </Badge>
    );
  if (status === "aprobado")
    return (
      <Badge tone="success">
        <CheckCircle2 className="h-3 w-3" /> Aprobada
      </Badge>
    );
  return (
    <Badge tone="info">
      <Send className="h-3 w-3" /> Contador
    </Badge>
  );
}

function ConfidenceMini({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 90 ? "success" : pct >= 75 ? "warn" : "danger";
  const color =
    tone === "success" ? "text-success-400" : tone === "warn" ? "text-warn-400" : "text-danger-400";
  const bar =
    tone === "success" ? "bg-success-500" : tone === "warn" ? "bg-warn-500" : "bg-danger-500";
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-ink-subtle">IA</span>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-subtle">
        <div className={cn("h-full", bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-[11px] font-semibold tabular-nums", color)}>{pct}%</span>
    </div>
  );
}

function InvoiceDetail({
  invoice,
  onApprove,
  onSendAccountant,
  onReject,
  onEdit,
}: {
  invoice: Invoice;
  onApprove: () => void;
  onSendAccountant: () => void;
  onReject: () => void;
  onEdit: () => void;
}) {
  const isApproved = invoice.status === "aprobado" || invoice.status === "contador";
  const sentAccountant = invoice.status === "contador";
  const pct = Math.round(invoice.confidence * 100);

  return (
    <div className="grid grid-cols-1 gap-0 md:grid-cols-[280px_1fr]">
      {/* Preview lateral */}
      <div className="border-b border-line bg-bg-subtle/40 p-4 md:border-b-0 md:border-r">
        <div className="rounded-xl border border-line bg-bg-elevated p-3">
          <div className="mb-2 flex items-center justify-between">
            <Badge tone="default">{invoice.source.toUpperCase()}</Badge>
            <Button size="sm" variant="ghost">
              <Download className="h-3 w-3" />
            </Button>
          </div>
          <div className="rounded-lg border border-line bg-gradient-to-b from-bg-subtle to-bg-elevated p-3">
            <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
              Factura {invoice.tipo}
            </div>
            <div className="text-[10px] text-ink-subtle">{invoice.numero}</div>
            <div className="my-2 h-px bg-line" />
            <div className="space-y-1.5">
              {Array.from({ length: 8 }).map((_, i) => (
                <FakeLine key={i} w={`${50 + ((i * 17) % 50)}%`} />
              ))}
            </div>
            <div className="my-2 h-px bg-line" />
            <div className="flex items-center justify-between text-[10px] text-ink-muted">
              <span>TOTAL</span>
              <span className="font-semibold text-ink tabular-nums">{formatARS(invoice.total)}</span>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-ink-subtle">
            Recibida {relativeTime(invoice.recibida)} · {invoice.sender}
          </div>
        </div>
      </div>

      {/* Detalle */}
      <div className="space-y-5 p-6">
        {/* Confianza */}
        <div className="rounded-xl border border-ai-400/30 bg-ai-500/[0.06] p-3">
          <div className="mb-1.5 flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-ai-400">
              <Sparkles className="h-3.5 w-3.5" />
              <span className="font-semibold uppercase tracking-wider">IA detectó</span>
            </span>
            <span className="font-semibold tabular-nums text-ai-400">{pct}% confianza</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-bg-subtle">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.5 }}
              className="h-full rounded-full bg-gradient-to-r from-ai-400 to-ai-600"
            />
          </div>
        </div>

        {/* Datos del comprobante */}
        <section>
          <h3 className="eyebrow mb-2">Datos del comprobante</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Proveedor" value={invoice.proveedor} mono={false} />
            <Field label="CUIT" value={invoice.cuit} />
            <Field label="Tipo / N°" value={`${invoice.tipo}-${invoice.numero}`} />
            <Field label="Fecha" value={invoice.fecha} />
            <Field label="Vencimiento" value={invoice.vencimiento ?? "—"} />
            <Field label="Método de pago" value={invoice.metodoPago} mono={false} />
          </div>
        </section>

        {/* Items */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="eyebrow">Ítems detectados</h3>
            <Badge tone="default">{invoice.items.length}</Badge>
          </div>
          <div className="card-quiet divide-y divide-line overflow-hidden">
            {invoice.items.map((it, i) => (
              <div key={i} className="p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink">{it.desc}</div>
                    {it.matched && (
                      <div className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-success-400">
                        <Check className="h-3 w-3" />
                        Vinculado a insumo:{" "}
                        <span className="font-medium">{it.matched}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-sm tabular-nums text-ink">{formatARS(it.total)}</div>
                    <div className="text-[10px] text-ink-subtle tabular-nums">
                      {it.qty} · {formatARS(it.unit)} c/u
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Totales */}
        <section className="rounded-xl border border-line bg-bg-subtle/40 p-3">
          <div className="space-y-1.5 text-sm">
            <Row label="Subtotal" value={formatARS(invoice.subtotal)} muted />
            <Row label="IVA" value={formatARS(invoice.iva)} muted accent="ai" />
            <div className="my-1.5 h-px bg-line" />
            <Row label="Total" value={formatARS(invoice.total)} bold accent="brand" />
          </div>
        </section>

        {/* Acciones automáticas */}
        <section className="rounded-xl border border-success-500/25 bg-success-500/[0.05] p-3 text-xs text-ink">
          <div className="mb-1.5 flex items-center gap-1.5 text-success-400">
            <Sparkles className="h-3.5 w-3.5" />
            <span className="font-semibold uppercase tracking-wider">Acciones automáticas</span>
          </div>
          <ul className="space-y-1 text-ink-muted">
            <li className="flex items-center gap-2">
              <Check className="h-3 w-3 text-success-400" />
              Stock actualizado:{" "}
              <span className="font-medium text-ink">
                {invoice.items.map((i) => i.matched).filter(Boolean).join(", ") || "—"}
              </span>
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-3 w-3 text-success-400" />
              Precio promedio de insumos recalculado.
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-3 w-3 text-success-400" />
              Compra registrada con el proveedor.
            </li>
            <li className="flex items-center gap-2">
              <Check className="h-3 w-3 text-success-400" />
              Documento guardado en el centro documental.
            </li>
          </ul>
        </section>

        {/* Botones */}
        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <Button variant="ghost" size="md" onClick={onReject}>
            <XCircle className="h-4 w-4" /> Rechazar
          </Button>
          <Button variant="ghost" size="md" onClick={onEdit}>
            Editar campos
          </Button>
          <Button variant="primary" size="md" onClick={onApprove} disabled={isApproved}>
            {isApproved ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                {sentAccountant ? "En contador" : "Aprobada"}
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                Aprobar factura
              </>
            )}
          </Button>
          <Button variant="ai" size="md" onClick={onSendAccountant} disabled={sentAccountant}>
            <Send className="h-4 w-4" />
            {sentAccountant ? "Imputada al contador" : "Enviar al contador"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-bg-subtle/40 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className={cn("mt-0.5 text-sm text-ink", mono && "tabular-nums")}>{value}</div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  bold,
  accent,
}: {
  label: string;
  value: string;
  muted?: boolean;
  bold?: boolean;
  accent?: "brand" | "ai";
}) {
  return (
    <div className="flex items-center justify-between">
      <span className={muted ? "text-ink-muted" : "text-ink"}>{label}</span>
      <span
        className={cn(
          "tabular-nums",
          bold && "text-base font-semibold",
          accent === "brand" && "text-brand-300",
          accent === "ai" && "text-ai-400",
          !accent && !bold && "text-ink",
        )}
      >
        {value}
      </span>
    </div>
  );
}
