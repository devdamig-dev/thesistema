"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, MessageSquareText, ScrollText, Sparkles } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { closures as demoClosures } from "@/lib/mock-data";
import { formatARS, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getClosuresPageDataAction, type ClosurePageRow } from "@/app/actions/closures-page";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";

type UiClosure = {
  id: string;
  point: string;
  date: string;
  sender: string;
  raw: string;
  gross: number;
  net: number;
  status: string;
  inconsistencies: unknown[];
  receivedAt: string;
  parsed: Record<string, unknown>;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(`${value}T12:00:00-03:00`));
}

function normalizeDb(row: ClosurePageRow): UiClosure {
  return {
    id: row.id,
    point: row.branchName,
    date: formatDate(row.closureDate),
    sender: "Registro persistido",
    raw: row.rawText,
    gross: row.grossTotal,
    net: row.netTotal,
    status: row.status,
    inconsistencies: row.inconsistencies,
    receivedAt: row.createdAt,
    parsed: row.parsed,
  };
}

function normalizeDemo(row: (typeof demoClosures)[number]): UiClosure {
  return {
    id: row.id,
    point: row.punto,
    date: row.fecha,
    sender: row.sender,
    raw: row.raw,
    gross: row.parsed.total,
    net: row.parsed.neto,
    status: row.status,
    inconsistencies: row.inconsistencias,
    receivedAt: row.recibida,
    parsed: row.parsed as unknown as Record<string, unknown>,
  };
}

export default function CierresPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseRows, setDatabaseRows] = useState<ClosurePageRow[]>([]);
  const rows = useMemo<UiClosure[]>(
    () => (IS_DATABASE ? databaseRows.map(normalizeDb) : demoClosures.map(normalizeDemo)),
    [databaseRows],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!IS_DATABASE) {
      setSelectedId(demoClosures[0]?.id ?? null);
      return;
    }
    let cancelled = false;
    void getClosuresPageDataAction()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(res.error);
          setDatabaseRows([]);
          return;
        }
        setDatabaseRows(res.data);
        setSelectedId(res.data[0]?.id ?? null);
        setLoadError(null);
      })
      .catch(() => {
        if (!cancelled) setLoadError("No pudimos cargar los cierres reales.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const selected = rows.find((row) => row.id === selectedId) ?? rows[0] ?? null;

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Cierres operativos · IA"
        title="El cierre del día llega por WhatsApp. La IA lo arma."
        description={IS_DATABASE
          ? "Cierres persistidos del negocio. Si todavía no hay registros, no mostramos ejemplos de la demo."
          : "Tu equipo manda el resumen en texto libre. Detectamos ingresos, gastos, retiros e inconsistencias."}
        actions={
          <Button size="sm" variant="ai" onClick={() => toast(ToastPresets.comingSoon("Plantilla automática"))}>
            <Sparkles className="h-4 w-4" /> Plantilla automática
          </Button>
        }
      />

      {IS_DATABASE && loadError && (
        <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
          <div className="text-sm font-semibold text-ink">No pudimos leer los cierres reales</div>
          <p className="mt-1 text-xs text-ink-muted">{loadError} No mostramos cierres demo ni estados inventados.</p>
        </div>
      )}

      {IS_DATABASE && loading ? (
        <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando cierres reales…
        </div>
      ) : loadError ? null : rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <ScrollText className="mx-auto h-8 w-8 text-ink-subtle" />
            <h3 className="mt-3 text-sm font-semibold text-ink">Todavía no hay cierres registrados</h3>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">
              Cuando un cierre real sea procesado y guardado, aparecerá acá. No se mezclan datos de ejemplo en database mode.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_1fr]">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ScrollText className="h-4 w-4" /> Cierres recibidos</CardTitle>
              <Badge tone="default">{rows.length}</Badge>
            </CardHeader>
            <ul className="divide-y divide-line border-t border-line">
              {rows.map((row) => {
                const active = row.id === selected?.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={cn("w-full px-4 py-3 text-left transition-colors", active ? "bg-bg-elevated" : "hover:bg-bg-subtle/60")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-ink">{row.point}</div>
                          <div className="mt-0.5 text-[11px] text-ink-muted">{row.date}</div>
                          <div className="mt-1 text-sm font-semibold text-brand-300 tabular-nums">{formatARS(row.gross, { compact: true })}</div>
                        </div>
                        <StatusBadge row={row} />
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {selected && <ClosureDetail closure={selected} />}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ row }: { row: UiClosure }) {
  const approved = ["approved", "aprobado"].includes(row.status.toLowerCase());
  if (approved) return <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Aprobado</Badge>;
  if (row.inconsistencies.length > 0) return <Badge tone="warn"><AlertTriangle className="h-3 w-3" /> {row.inconsistencies.length}</Badge>;
  return <Badge tone="brand"><Sparkles className="h-3 w-3" /> {row.status || "pendiente"}</Badge>;
}

function ClosureDetail({ closure }: { closure: UiClosure }) {
  const ingresos = Array.isArray(closure.parsed.ingresos) ? closure.parsed.ingresos : [];
  const gastos = Array.isArray(closure.parsed.gastos) ? closure.parsed.gastos : [];
  const retiros = Array.isArray(closure.parsed.retiros) ? closure.parsed.retiros : [];
  const productos = Array.isArray(closure.parsed.productos) ? closure.parsed.productos : [];

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-line p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs text-ink-muted">{closure.point} · {closure.date}</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight text-ink tabular-nums">
              {formatARS(closure.gross)} <span className="text-sm font-normal text-ink-muted">bruto</span>
            </div>
            <div className="mt-1 text-xs text-ink-muted">Neto: <span className="font-semibold text-success-400">{formatARS(closure.net)}</span></div>
          </div>
          <StatusBadge row={closure} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2">
        <div className="border-b border-line p-5 md:border-b-0 md:border-r">
          <div className="mb-2 flex items-center gap-2 text-xs text-success-400"><MessageSquareText className="h-3.5 w-3.5" /> Mensaje original</div>
          <div className="rounded-xl border border-line bg-bg-subtle p-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">{closure.raw || "Sin texto original guardado."}</pre>
            <div className="mt-2 text-[10px] text-ink-subtle">{relativeTime(closure.receivedAt)}</div>
          </div>
        </div>

        <div className="space-y-3 p-5">
          <DataBlock label="Ingresos" value={ingresos} />
          <DataBlock label="Gastos" value={gastos} />
          <DataBlock label="Retiros" value={retiros} />
          <DataBlock label="Productos" value={productos} />
        </div>
      </div>

      {closure.inconsistencies.length > 0 && (
        <div className="border-t border-line p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink"><AlertTriangle className="h-4 w-4 text-warn-400" /> Inconsistencias detectadas</div>
          <pre className="overflow-auto rounded-xl border border-line bg-bg-subtle p-3 text-xs text-ink-muted">{JSON.stringify(closure.inconsistencies, null, 2)}</pre>
        </div>
      )}

      {IS_DATABASE && (
        <div className="border-t border-line bg-bg-subtle/40 p-4 text-xs text-ink-muted">
          La aprobación desde esta pantalla queda deshabilitada hasta conectar la imputación transaccional real. No cambiamos estados sólo en la UI.
        </div>
      )}
    </Card>
  );
}

function DataBlock({ label, value }: { label: string; value: unknown[] }) {
  return (
    <div className="rounded-xl border border-line bg-bg-subtle/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      {value.length === 0 ? (
        <div className="mt-1 text-xs text-ink-muted">Sin datos</div>
      ) : (
        <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-ink">{JSON.stringify(value, null, 2)}</pre>
      )}
    </div>
  );
}
