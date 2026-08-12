"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink, FileText, Loader2, Upload, XCircle } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import {
  approveInvoiceAction,
  getInvoiceAttachmentUrlAction,
  rejectInvoiceAction,
  uploadInvoiceAction,
} from "@/app/actions/invoices";
import { formatARS } from "@/lib/format";

export type DatabaseInvoiceRow = {
  id: string;
  proveedor: string;
  tipo: string;
  numero: string;
  fecha: string;
  total: number;
  iva: number;
  status: string;
  confidence: number;
};

export function DatabaseInvoicesView({ rows }: { rows: DatabaseInvoiceRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function upload(files: FileList | null) {
    if (!files?.length) return;
    const formData = new FormData();
    formData.append("file", files[0]);
    startTransition(async () => {
      const result = await uploadInvoiceAction(formData);
      if (result.ok) {
        toast({
          tone: "success",
          title: result.persisted ? "Factura procesada" : "Factura procesada",
          description: result.persisted
            ? "El comprobante quedó persistido y ya podés revisarlo."
            : "El procesamiento terminó sin persistencia real.",
        });
        router.refresh();
      } else {
        toast({ tone: "warn", title: "No pudimos procesar la factura", description: result.error });
      }
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  function openAttachment(id: string) {
    startTransition(async () => {
      const result = await getInvoiceAttachmentUrlAction(id);
      if (result.ok && !result.demo) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      } else if (result.ok) {
        toast({ tone: "warn", title: "Adjunto no persistido", description: "Este comprobante no tiene un archivo real disponible." });
      } else {
        toast({ tone: "warn", title: "No pudimos abrir el adjunto", description: result.error });
      }
    });
  }

  function approve(id: string) {
    startTransition(async () => {
      const result = await approveInvoiceAction(id);
      if (result.ok && result.persisted) {
        toast({ tone: "success", title: "Factura aprobada", description: "El estado y los impactos asociados quedaron persistidos." });
        router.refresh();
      } else if (result.ok) {
        toast({ tone: "warn", title: "No se persistió la aprobación", description: "La acción terminó sin guardar cambios reales." });
      } else {
        toast({ tone: "warn", title: "No pudimos aprobar", description: result.error });
      }
    });
  }

  function reject(id: string) {
    startTransition(async () => {
      const result = await rejectInvoiceAction(id);
      if (result.ok && result.persisted) {
        toast({ tone: "success", title: "Factura enviada a revisión", description: "El cambio quedó persistido." });
        router.refresh();
      } else if (result.ok) {
        toast({ tone: "warn", title: "No se persistió el cambio", description: "La acción terminó sin guardar cambios reales." });
      } else {
        toast({ tone: "warn", title: "No pudimos rechazar", description: result.error });
      }
    });
  }

  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const iva = rows.reduce((sum, row) => sum + row.iva, 0);

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Facturas · OCR + datos reales"
        title="Tus facturas, ordenadas automáticamente."
        description="En producción se muestran únicamente comprobantes persistidos. Podés seguir cargando archivos y revisando su estado sin mezclar datos demo."
        actions={
          <>
            <Button size="sm" variant="primary" onClick={() => inputRef.current?.click()} disabled={pending}>
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {pending ? "Procesando…" : "Subir factura"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(event) => upload(event.target.files)}
            />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label="Facturas" value={String(rows.length)} />
        <Metric label="Monto total" value={formatARS(total, { compact: true })} />
        <Metric label="IVA discriminado" value={formatARS(iva, { compact: true })} />
        <Metric label="Aprobadas" value={String(rows.filter((row) => row.status === "aprobado").length)} />
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardHeader><CardTitle>Sin facturas registradas</CardTitle></CardHeader>
          <CardContent className="space-y-4 text-sm text-ink-muted">
            <p>Todavía no hay comprobantes reales para este negocio. Subí una foto o PDF para probar el circuito OCR de punta a punta.</p>
            <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={pending}>
              <Upload className="h-4 w-4" /> Subir primera factura
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((invoice) => (
            <Card key={invoice.id}>
              <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="font-medium text-ink">{invoice.proveedor}</div>
                  <div className="mt-1 text-xs text-ink-muted">Factura {invoice.tipo} · {invoice.numero} · {invoice.fecha}</div>
                  <div className="mt-1 text-xs text-ink-subtle">Confianza OCR: {Math.round(invoice.confidence * 100)}%</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={invoice.status === "aprobado" ? "success" : invoice.status === "revision" ? "warn" : "default"}>{invoice.status}</Badge>
                  <div className="mr-2 font-semibold tabular-nums text-ink">{formatARS(invoice.total)}</div>
                  <Button size="sm" variant="ghost" onClick={() => openAttachment(invoice.id)} disabled={pending}>
                    <ExternalLink className="h-3.5 w-3.5" /> Adjunto
                  </Button>
                  {invoice.status !== "aprobado" && (
                    <Button size="sm" variant="primary" onClick={() => approve(invoice.id)} disabled={pending}>
                      <CheckCircle2 className="h-3.5 w-3.5" /> Aprobar
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => reject(invoice.id)} disabled={pending}>
                    <XCircle className="h-3.5 w-3.5" /> Revisar
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-line bg-bg-subtle/40 p-4 text-xs text-ink-muted">
        <div className="flex items-center gap-2 font-medium text-ink"><FileText className="h-4 w-4" /> Modo producción</div>
        <p className="mt-1">Los estados que ves provienen de Supabase. No se aplican overrides locales ni facturas de ejemplo.</p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
        <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
      </CardContent>
    </Card>
  );
}
