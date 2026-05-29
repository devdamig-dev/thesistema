"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Download,
  FileText,
  Filter,
  HelpCircle,
  Inbox,
  MailCheck,
  MessageSquareText,
  Search,
  ShieldAlert,
  Users,
  X,
  XCircle,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/ui/tabs";
import {
  RANGE_LABELS,
  moduleOptions,
  type TelemetryDaily,
  type TelemetryEventRow,
  type TelemetryEventsFilters,
  type TelemetryMetrics,
  type TelemetryRange,
} from "@/lib/admin/telemetry";
import { cn } from "@/lib/utils";

type Props = {
  range: TelemetryRange;
  metrics: TelemetryMetrics;
  daily: TelemetryDaily;
  events: TelemetryEventRow[];
  filters: TelemetryEventsFilters;
};

const TONE_BAR = ["#F97316", "#A78BFA", "#22C55E", "#EAB308", "#EF4444", "#38BDF8", "#F472B6"];
const TONE_PIE: Record<"success" | "warn" | "danger", string> = {
  success: "#22C55E",
  warn: "#EAB308",
  danger: "#EF4444",
};

export default function TelemetriaClient({ range, metrics, daily, events, filters }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [search_q, setSearchQ] = useState(filters.q ?? "");

  function updateParam(key: string, value: string | null) {
    const params = new URLSearchParams(search?.toString() ?? "");
    if (!value) params.delete(key);
    else params.set(key, value);
    router.push(`/admin/telemetria?${params.toString()}`);
  }

  function submitSearch() {
    updateParam("q", search_q.trim() || null);
  }

  function clearFilters() {
    router.push("/admin/telemetria?range=" + range);
    setSearchQ("");
  }

  const totalApprovals =
    daily.approvalsBreakdown.reduce((s, r) => s + r.value, 0) || 1;

  const userOptions = useMemo(() => {
    const set = new Set<string>();
    daily.usageByUser.forEach((u) => set.add(u.user));
    events.forEach((e) => e.actorName && set.add(e.actorName));
    return Array.from(set).sort();
  }, [daily.usageByUser, events]);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Interno · GastroPilot"
        title="Telemetría del piloto"
        description="Qué está pasando realmente con el negocio piloto: WhatsApp, IA, OCR, exportes y errores. Visible sólo con ENABLE_INTERNAL_ADMIN=true."
        actions={
          <Badge tone="ai">
            <ShieldAlert className="h-3 w-3" />
            Interno
          </Badge>
        }
      />

      {/* Selector de rango */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={range}
          onChange={(v) => updateParam("range", v)}
          options={[
            { value: "24h", label: "24 h" },
            { value: "7d", label: "7 días" },
            { value: "30d", label: "30 días" },
          ]}
        />
        <span className="text-xs text-ink-muted">{RANGE_LABELS[range]}</span>
      </div>

      {/* KPIs */}
      <section className="space-y-4">
        <KpiGroup title="WhatsApp e IA">
          <Kpi label="Mensajes WhatsApp" value={metrics.whatsappReceived} icon={<MessageSquareText />} />
          <Kpi label="Procesados por IA" value={metrics.aiProcessed} icon={<Zap />} tone="ai" />
          <Kpi label="Extracciones aprobadas" value={metrics.aiApproved} icon={<CheckCircle2 />} tone="success" />
          <Kpi label="Extracciones rechazadas" value={metrics.aiRejected} icon={<XCircle />} tone="danger" />
          <Kpi label="Baja confianza (< 0.7)" value={metrics.aiLowConfidence} icon={<AlertTriangle />} tone="warn" />
        </KpiGroup>

        <KpiGroup title="Facturas OCR">
          <Kpi label="Facturas subidas" value={metrics.invoicesUploaded} icon={<FileText />} />
          <Kpi label="Procesadas por OCR" value={metrics.invoicesOcrProcessed} icon={<FileText />} tone="ai" />
          <Kpi label="Facturas aprobadas" value={metrics.invoicesApproved} icon={<CheckCircle2 />} tone="success" />
          <Kpi label="Errores OCR" value={metrics.ocrErrors} icon={<AlertOctagon />} tone="danger" />
          <Kpi label="Errores IA" value={metrics.aiErrors} icon={<AlertOctagon />} tone="danger" />
        </KpiGroup>

        <KpiGroup title="Equipo y salidas">
          <Kpi
            label="Tiempo prom. aprobación"
            value={metrics.avgApprovalMinutes != null ? `${metrics.avgApprovalMinutes} min` : "—"}
            icon={<Clock />}
            tone="default"
          />
          <Kpi label="Usuarios activos" value={metrics.activeUsers} icon={<Users />} tone="brand" />
          <Kpi label="Exportes descargados" value={metrics.exportsDownloaded} icon={<Download />} />
          <Kpi label="Notificaciones generadas" value={metrics.notificationsGenerated} icon={<Inbox />} tone="ai" />
          <Kpi label="Emails enviados" value={metrics.emailsSent} icon={<MailCheck />} tone="success" />
        </KpiGroup>

        <KpiGroup title="Infraestructura">
          <Kpi label="Errores webhook" value={metrics.webhookErrors} icon={<AlertOctagon />} tone="danger" />
          <Kpi label="Rate-limit activado" value={metrics.rateLimitTriggered} icon={<ShieldAlert />} tone="warn" />
        </KpiGroup>
      </section>

      {/* Gráficos */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-4 w-4" /> Actividad por día
            </CardTitle>
            <p className="text-xs text-ink-muted">Eventos registrados en `activity_logs`.</p>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily.activityByDay} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1a2230" strokeDasharray="3 3" />
                  <XAxis dataKey="day" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Line
                    type="monotone"
                    dataKey="count"
                    stroke="#F97316"
                    strokeWidth={2}
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquareText className="h-4 w-4" /> Mensajes WhatsApp por tipo
            </CardTitle>
            <p className="text-xs text-ink-muted">text / audio / image / document.</p>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={daily.messagesByChannel} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1a2230" strokeDasharray="3 3" />
                  <XAxis dataKey="channel" stroke="#64748B" fontSize={11} />
                  <YAxis stroke="#64748B" fontSize={11} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                    {daily.messagesByChannel.map((_, i) => (
                      <Cell key={i} fill={TONE_BAR[i % TONE_BAR.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Aprobaciones vs rechazos
            </CardTitle>
            <p className="text-xs text-ink-muted">
              Total: {totalApprovals} · ratio aprobadas {Math.round((daily.approvalsBreakdown[0]?.value ?? 0) / totalApprovals * 100)}%
            </p>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={daily.approvalsBreakdown}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={86}
                    paddingAngle={2}
                  >
                    {daily.approvalsBreakdown.map((d, i) => (
                      <Cell key={i} fill={TONE_PIE[d.tone]} />
                    ))}
                  </Pie>
                  <Legend wrapperStyle={{ fontSize: 11, color: "#94a3b8" }} />
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertOctagon className="h-4 w-4 text-danger-400" /> Errores por módulo
            </CardTitle>
            <p className="text-xs text-ink-muted">OCR / IA / webhook / rate limit / permisos.</p>
          </CardHeader>
          <CardContent>
            <div className="h-64 w-full">
              {daily.errorsByModule.length === 0 ? (
                <EmptyChart label="Sin errores en este período · buena señal" />
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={daily.errorsByModule}
                    layout="vertical"
                    margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid stroke="#1a2230" strokeDasharray="3 3" />
                    <XAxis type="number" stroke="#64748B" fontSize={11} allowDecimals={false} />
                    <YAxis type="category" dataKey="module" stroke="#64748B" fontSize={11} width={92} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="count" fill="#EF4444" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Uso por usuario
            </CardTitle>
            <p className="text-xs text-ink-muted">Top 8 actores por cantidad de acciones registradas.</p>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={daily.usageByUser}
                  layout="vertical"
                  margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
                >
                  <CartesianGrid stroke="#1a2230" strokeDasharray="3 3" />
                  <XAxis type="number" stroke="#64748B" fontSize={11} allowDecimals={false} />
                  <YAxis type="category" dataKey="user" stroke="#64748B" fontSize={11} width={140} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                    {daily.usageByUser.map((_, i) => (
                      <Cell key={i} fill={TONE_BAR[i % TONE_BAR.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Eventos con filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" /> Eventos
          </CardTitle>
          <Badge tone="default">{events.length}</Badge>
        </CardHeader>
        <div className="border-y border-line bg-bg-subtle/40 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Módulo"
              value={filters.module ?? ""}
              onChange={(v) => updateParam("module", v || null)}
              options={moduleOptions().map((m) => ({ value: m, label: m }))}
            />
            <FilterSelect
              label="Usuario"
              value={filters.user ?? ""}
              onChange={(v) => updateParam("user", v || null)}
              options={userOptions.map((u) => ({ value: u, label: u }))}
            />
            <FilterSelect
              label="Estado"
              value={filters.status ?? ""}
              onChange={(v) => updateParam("status", v || null)}
              options={[
                { value: "ok", label: "OK" },
                { value: "warn", label: "Advertencia" },
                { value: "error", label: "Error" },
              ]}
            />
            <div className="flex items-center gap-2 rounded-lg border border-line bg-bg-subtle px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-ink-subtle" />
              <input
                value={search_q}
                onChange={(e) => setSearchQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitSearch();
                }}
                placeholder="Buscar acción / resumen…"
                className="w-52 bg-transparent text-xs placeholder:text-ink-subtle focus:outline-none"
              />
              <Filter className="h-3.5 w-3.5 text-ink-subtle" />
            </div>
            <Button variant="ghost" size="sm" onClick={submitSearch}>
              Aplicar
            </Button>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-3.5 w-3.5" />
              Limpiar
            </Button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-bg-subtle/40 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Fecha</th>
                <th className="px-5 py-2.5 font-medium">Usuario</th>
                <th className="px-5 py-2.5 font-medium">Módulo</th>
                <th className="px-5 py-2.5 font-medium">Acción</th>
                <th className="px-5 py-2.5 font-medium">Estado</th>
                <th className="px-5 py-2.5 font-medium">Resumen / metadata</th>
                <th className="px-5 py-2.5 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-muted">
                    Sin eventos para los filtros actuales.
                  </td>
                </tr>
              )}
              {events.map((e) => (
                <tr key={e.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                  <td className="px-5 py-3 text-ink-muted tabular-nums">
                    {new Date(e.createdAt).toLocaleString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-5 py-3">
                    <div className="text-sm font-medium text-ink">{e.actorName ?? "—"}</div>
                    <div className="text-[10px] text-ink-subtle">{e.actorRole ?? ""}</div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge tone="default">{e.module ?? "—"}</Badge>
                  </td>
                  <td className="px-5 py-3 font-mono text-[11px] text-ink-muted">{e.action}</td>
                  <td className="px-5 py-3">
                    <StatusBadge status={e.status} />
                  </td>
                  <td className="px-5 py-3 text-ink-muted">{e.summary}</td>
                  <td className="px-5 py-3 font-mono text-[11px] text-danger-400">
                    {e.error ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-subtle/40 p-4 text-xs text-ink-muted">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-ink-subtle" />
          <span>
            ¿Cómo se usa este módulo durante el piloto? Ver{" "}
            <code className="text-ink">docs/pilot-runbook.md</code> · sección <em>Telemetría interna</em>.
          </span>
        </div>
      </div>
    </div>
  );
}

/* ----- subcomponents ----- */

function KpiGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-2">{title}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{children}</div>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  tone?: "ai" | "success" | "warn" | "danger" | "brand" | "default";
}) {
  const ring =
    tone === "danger"
      ? "border-danger-500/30"
      : tone === "warn"
        ? "border-warn-500/30"
        : tone === "success"
          ? "border-success-500/30"
          : tone === "ai"
            ? "border-ai-400/30"
            : tone === "brand"
              ? "border-brand-500/30"
              : "border-line";
  const color =
    tone === "danger"
      ? "text-danger-400"
      : tone === "warn"
        ? "text-warn-400"
        : tone === "success"
          ? "text-success-400"
          : tone === "ai"
            ? "text-ai-400"
            : tone === "brand"
              ? "text-brand-300"
              : "text-ink";
  return (
    <div className={cn("rounded-xl border bg-bg-subtle/40 p-3", ring)}>
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-subtle">
        <span>{label}</span>
        <span className={cn("h-3.5 w-3.5", color)}>{icon}</span>
      </div>
      <div className={cn("mt-1.5 text-2xl font-semibold tabular-nums", color)}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: "ok" | "warn" | "error" }) {
  if (status === "ok")
    return (
      <Badge tone="success">
        <CheckCircle2 className="h-3 w-3" /> OK
      </Badge>
    );
  if (status === "warn")
    return (
      <Badge tone="warn">
        <AlertTriangle className="h-3 w-3" /> Aviso
      </Badge>
    );
  return (
    <Badge tone="danger">
      <XCircle className="h-3 w-3" /> Error
    </Badge>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] text-ink-muted">
      <span className="uppercase tracking-wider text-ink-subtle">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-line bg-bg-subtle px-2 py-1 text-xs text-ink focus:outline-none focus:ring-1 focus:ring-brand-500/40"
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="grid h-full place-items-center text-center text-xs text-ink-muted">
      <div>
        <CheckCircle2 className="mx-auto h-6 w-6 text-success-400" />
        <p className="mt-2">{label}</p>
      </div>
    </div>
  );
}

const tooltipStyle = {
  background: "rgba(15, 20, 26, 0.95)",
  border: "1px solid #1a2230",
  borderRadius: 12,
  fontSize: 12,
  color: "#e2e8f0",
};
