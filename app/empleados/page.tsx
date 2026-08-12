"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, Download, Loader2, Plus, Users } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { exportEmployeesCsvAction } from "@/app/actions/exports";
import { getEmployeesPageDataAction, type EmployeesPageData } from "@/app/actions/employees-page";
import { triggerCsvDownload } from "@/lib/csv-download";
import { employees as demoEmployees, laborStats } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";

export default function EmpleadosPage() {
  const { toast } = useToast();
  const [exporting, startExport] = useTransition();
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseData, setDatabaseData] = useState<EmployeesPageData | null>(null);

  useEffect(() => {
    if (!IS_DATABASE) return;
    let cancelled = false;
    void getEmployeesPageDataAction()
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(res.error);
          setDatabaseData(null);
        } else {
          setDatabaseData(res.data);
          setLoadError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("No pudimos cargar el equipo real.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  function handleExportNovedades() {
    startExport(async () => {
      const res = await exportEmployeesCsvAction();
      if (res.ok) {
        triggerCsvDownload(res.filename, res.content);
        toast({ tone: "success", title: "Novedades listas para liquidación", description: `${res.rows} empleados exportados.` });
      } else {
        toast({ tone: "warn", title: "No pudimos exportar", description: res.error });
      }
    });
  }

  const rows = IS_DATABASE
    ? (databaseData?.employees ?? []).map((row) => ({
        id: row.id,
        nombre: row.fullName,
        rol: row.role,
        turno: row.shift ?? "—",
        horas: row.monthlyHours,
        costo: row.monthlyCost,
        adelanto: row.pendingAdvance,
        faltas: row.absences,
        tardes: row.lateArrivals,
        activo: row.active,
      }))
    : demoEmployees.map((row, index) => ({
        id: `demo-${index}`,
        nombre: row.nombre,
        rol: row.rol,
        turno: "Demo",
        horas: row.horasMes,
        costo: row.costoMes,
        adelanto: 0,
        faltas: 0,
        tardes: 0,
        activo: true,
      }));

  const activeCount = IS_DATABASE ? databaseData?.activeCount ?? 0 : laborStats.empleadosActivos;
  const totalCost = IS_DATABASE ? databaseData?.totalMonthlyCost ?? 0 : laborStats.costoTotal;
  const pendingAdvances = IS_DATABASE ? databaseData?.pendingAdvances ?? 0 : laborStats.adelantosPendientes;
  const incidentCount = IS_DATABASE ? (databaseData?.totalAbsences ?? 0) + (databaseData?.totalLateArrivals ?? 0) : 0;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Equipo"
        title="Tu equipo, ordenado."
        description={IS_DATABASE
          ? "Nómina persistida del negocio: horas, costo, adelantos y novedades reales. No mostramos empleados ni alertas de la demo."
          : "Turnos, horas, adelantos y costo laboral. La IA cruza esta info con las ventas para detectar oportunidades."}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={handleExportNovedades} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {exporting ? "Generando…" : "Exportar novedades"}
            </Button>
            <Button size="sm" variant="primary" onClick={() => toast(ToastPresets.comingSoon("Alta de empleado"))}>
              <Plus className="h-4 w-4" /> Agregar empleado
            </Button>
          </>
        }
      />

      {IS_DATABASE && loadError && (
        <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
          <div className="text-sm font-semibold text-ink">No pudimos leer el equipo real</div>
          <p className="mt-1 text-xs text-ink-muted">{loadError} No mostramos empleados, costos ni alertas demo.</p>
        </div>
      )}

      {IS_DATABASE && loading ? (
        <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando equipo real…
        </div>
      ) : loadError ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Costo laboral mes" value={formatARS(totalCost, { compact: true })} delta={IS_DATABASE ? undefined : 3.1} tone="brand" />
            <KpiCard label="Sobre ventas" value={IS_DATABASE ? "—" : formatPercent(laborStats.ratio, 0)} delta={IS_DATABASE ? undefined : 1.5} tone="warn" hint={IS_DATABASE ? "Requiere cruce con ventas reales" : "Objetivo 25%"} />
            <KpiCard label="Activos" value={String(activeCount)} />
            <KpiCard label="Adelantos pendientes" value={formatARS(pendingAdvances)} tone="danger" />
          </div>

          {IS_DATABASE && incidentCount > 0 && (
            <div className="rounded-2xl border border-warn-500/25 bg-warn-500/[0.05] p-4 text-sm text-ink">
              <div className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4 text-warn-400" /> Novedades registradas</div>
              <p className="mt-1 text-xs text-ink-muted">{databaseData?.totalAbsences ?? 0} faltas · {databaseData?.totalLateArrivals ?? 0} llegadas tarde.</p>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Equipo</CardTitle>
              <Badge tone="default">{rows.length} miembros</Badge>
            </CardHeader>
            {rows.length === 0 ? (
              <CardContent>
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                  Todavía no hay empleados registrados.
                </div>
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Empleado</th>
                      <th className="px-5 py-2.5 font-medium">Rol</th>
                      <th className="px-5 py-2.5 font-medium">Turno</th>
                      <th className="px-5 py-2.5 text-right font-medium">Horas mes</th>
                      <th className="px-5 py-2.5 text-right font-medium">Costo mes</th>
                      <th className="px-5 py-2.5 text-right font-medium">Adelanto</th>
                      <th className="px-5 py-2.5 text-right font-medium">Faltas</th>
                      <th className="px-5 py-2.5 text-right font-medium">Tardes</th>
                      <th className="px-5 py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                        <td className="px-5 py-3 font-medium text-ink">{row.nombre}</td>
                        <td className="px-5 py-3 text-ink-muted">{row.rol}</td>
                        <td className="px-5 py-3 text-ink-muted">{row.turno}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-ink">{row.horas}h</td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">{formatARS(row.costo)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{formatARS(row.adelanto)}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{row.faltas}</td>
                        <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{row.tardes}</td>
                        <td className="px-5 py-3"><Badge tone={row.activo ? "success" : "default"}>{row.activo ? "Activo" : "Inactivo"}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
