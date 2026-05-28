"use client";

import { useTransition } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Download,
  Loader2,
  Plus,
  Sparkles,
  Users,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightCard } from "@/components/common/insight-card";
import { LaborVsSales } from "@/components/charts/labor-vs-sales";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { exportEmployeesCsvAction } from "@/app/actions/exports";
import { triggerCsvDownload } from "@/lib/csv-download";
import {
  employeeAlerts,
  employees,
  laborByDay,
  laborStats,
  weeklyShifts,
} from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const ROLE_TONE = {
  Cocina: "warn",
  Caja: "info",
  Encargada: "brand",
  Atención: "ai",
  Delivery: "success",
} as const;

const DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const HOURLY_RATE = 3_100; // ARS por hora aprox

export default function EmpleadosPage() {
  const { toast } = useToast();
  const [exporting, startExport] = useTransition();

  function handleExportNovedades() {
    startExport(async () => {
      const res = await exportEmployeesCsvAction();
      if (res.ok) {
        triggerCsvDownload(res.filename, res.content);
        toast({
          tone: "success",
          title: "Novedades listas para liquidación",
          description: `${res.rows} empleados · adelantos, faltas, tardes y horas incluidos.`,
        });
      } else {
        toast({ tone: "warn", title: "No pudimos exportar", description: res.error });
      }
    });
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Equipo"
        title="Tu equipo, ordenado."
        description="Turnos, horas, adelantos y costo laboral. La IA cruza esta info con las ventas para detectar oportunidades."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExportNovedades}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? "Generando…" : "Exportar novedades"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                toast({
                  tone: "ai",
                  title: "Grilla sugerida lista",
                  description: "Reasignamos un turno del martes para bajar el costo laboral 8%.",
                })
              }
            >
              <Sparkles className="h-4 w-4 text-ai-400" /> Sugerir grilla
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => toast(ToastPresets.comingSoon("Alta de empleado"))}
            >
              <Plus className="h-4 w-4" /> Agregar empleado
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Costo laboral mes" value={formatARS(laborStats.costoTotal, { compact: true })} delta={3.1} tone="brand" />
        <KpiCard label="Sobre ventas" value={formatPercent(laborStats.ratio, 0)} delta={1.5} tone="warn" hint="Objetivo 25%" />
        <KpiCard label="Activos" value={String(laborStats.empleadosActivos)} />
        <KpiCard label="Adelantos pendientes" value={formatARS(laborStats.adelantosPendientes)} tone="danger" />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <InsightCard tone="warn" icon="PieChart" title="Costo laboral 27% de las ventas" detail="Dos puntos por encima del objetivo. Sumar turno a otro día y reducir el martes podría compensar." />
        <InsightCard tone="info" icon="CalendarDays" title="Martes de 19 a 23: baja venta, alta carga" detail="Promedio $186k de costo laboral y $478k de venta los últimos 4 martes." />
        <InsightCard tone="danger" icon="Sparkles" title="Bruno suma 4 llegadas tarde" detail="Tres más que el promedio del equipo este mes." />
      </div>

      {/* Ventas vs costo laboral */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Ventas vs costo laboral por día</CardTitle>
            <p className="mt-0.5 text-xs text-ink-muted">
              Semana en curso · jueves arrastra mejor ratio
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-brand-500" /> Ventas
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-ai-500" /> Costo laboral
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <LaborVsSales data={laborByDay} />
        </CardContent>
      </Card>

      {/* Planificación semanal */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-4 w-4" />
              Planificación semanal
            </CardTitle>
            <p className="mt-0.5 text-xs text-ink-muted">
              Turnos asignados · semana del 13 al 19 de mayo
            </p>
          </div>
          <Badge tone="ai">
            <Sparkles className="h-3 w-3" /> IA sugiere ajustar el martes
          </Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-xs">
            <thead className="border-y border-line bg-bg-subtle/60 text-left uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Empleado</th>
                {DAYS.map((d) => (
                  <th key={d} className="px-2 py-2.5 text-center font-medium">
                    {d}
                  </th>
                ))}
                <th className="px-5 py-2.5 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const shifts = weeklyShifts[e.nombre] ?? [];
                const totalHours = shifts.reduce((s, x) => s + x.horas, 0);
                return (
                  <tr key={e.nombre} className="border-b border-line/60 last:border-0">
                    <td className="whitespace-nowrap px-5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-7 w-7 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-[10px] font-semibold text-brand-300">
                          {e.nombre
                            .split(" ")
                            .map((n) => n[0])
                            .join("")
                            .slice(0, 2)}
                        </div>
                        <div className="leading-tight">
                          <div className="text-sm font-medium text-ink">{e.nombre}</div>
                          <div className="text-[10px] text-ink-subtle">{e.rol}</div>
                        </div>
                      </div>
                    </td>
                    {DAYS.map((d) => {
                      const shift = shifts.find((s) => s.dia === d);
                      const isCritical = d === "Mar" && shift; // martes flag
                      return (
                        <td key={d} className="px-1.5 py-1.5 align-top">
                          {shift ? (
                            <div
                              className={cn(
                                "rounded-md border px-2 py-1.5 text-center",
                                isCritical
                                  ? "border-warn-500/40 bg-warn-500/10"
                                  : "border-line bg-bg-subtle/60",
                              )}
                            >
                              <div className="text-[10px] text-ink tabular-nums">
                                {shift.from}–{shift.to}
                              </div>
                              <div
                                className={cn(
                                  "text-[10px] tabular-nums",
                                  isCritical ? "text-warn-400" : "text-ink-subtle",
                                )}
                              >
                                {shift.horas}h · {formatARS(shift.horas * HOURLY_RATE, { compact: true })}
                              </div>
                            </div>
                          ) : (
                            <div className="grid h-10 place-items-center rounded-md border border-dashed border-line/60 text-[11px] text-ink-subtle">
                              —
                            </div>
                          )}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-5 py-2.5 text-right">
                      <div className="text-sm font-semibold text-ink tabular-nums">
                        {totalHours}h
                      </div>
                      <div className="text-[10px] text-ink-subtle">
                        {formatARS(totalHours * HOURLY_RATE, { compact: true })}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line bg-bg-subtle/40 px-5 py-3">
          <div className="text-xs text-ink-muted">
            <span className="font-semibold text-warn-400">Martes 19–23 hs:</span> baja venta proyectada con cobertura completa.
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => toast(ToastPresets.comingSoon("Editor de turnos"))}
            >
              <Clock className="h-3.5 w-3.5" />
              Ajustar turnos
            </Button>
            <Button
              size="sm"
              variant="ai"
              onClick={() =>
                toast({
                  tone: "success",
                  title: "Sugerencia IA aplicada",
                  description: "Reducimos un turno del martes y reasignamos cobertura el sábado.",
                })
              }
            >
              <Sparkles className="h-3.5 w-3.5" />
              Aplicar sugerencia IA
            </Button>
          </div>
        </div>
      </Card>

      {/* Empleados + alertas */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Equipo activo
            </CardTitle>
            <Badge tone="default">{employees.length} miembros</Badge>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Empleado</th>
                  <th className="px-5 py-2.5 font-medium">Rol</th>
                  <th className="px-5 py-2.5 text-right font-medium">Horas mes</th>
                  <th className="px-5 py-2.5 text-right font-medium">Costo mes</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.nombre} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-[11px] font-semibold text-brand-300">
                          {e.nombre.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                        </div>
                        <span className="font-medium text-ink">{e.nombre}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={ROLE_TONE[e.rol as keyof typeof ROLE_TONE] ?? "default"}>{e.rol}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-ink">{e.horasMes}h</td>
                    <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                      {formatARS(e.costoMes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warn-400" />
              Alertas del equipo
            </CardTitle>
            <Badge tone="warn">{employeeAlerts.length}</Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            {employeeAlerts.map((a, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-2.5 rounded-xl border p-3",
                  a.tone === "danger" && "border-danger-500/25 bg-danger-500/[0.06]",
                  a.tone === "warn" && "border-warn-500/25 bg-warn-500/[0.06]",
                  a.tone === "info" && "border-line bg-bg-subtle/60",
                )}
              >
                <span
                  className={cn(
                    "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                    a.tone === "danger" && "bg-danger-500",
                    a.tone === "warn" && "bg-warn-500",
                    a.tone === "info" && "bg-ink-subtle",
                  )}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{a.empleado}</div>
                  <div className="text-xs text-ink-muted">{a.tipo}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
