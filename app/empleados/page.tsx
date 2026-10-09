"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Archive, Download, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { getEmployeesPageDataAction, getEmployeeManualAction, setEmployeeActiveAction } from "@/app/actions/employees-page";
import { exportEmployeesCsvAction } from "@/app/actions/exports";
import { EmployeeForm } from "@/components/employees/employee-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { KpiCard } from "@/components/ui/kpi-card";
import { SectionHeader } from "@/components/ui/section-header";
import { useToast } from "@/components/ui/toast";
import { formatARS } from "@/lib/format";
import { triggerCsvDownload } from "@/lib/csv-download";
import type { EmployeeRow, EmployeesPageData } from "@/lib/employees/domain";

export default function EmpleadosPage() {
  const { toast } = useToast();
  const [data, setData] = useState<EmployeesPageData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [branchId, setBranchId] = useState("");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<EmployeeRow | "new" | null>(null);
  const [changing, setChanging] = useState<EmployeeRow | null>(null);
  const [pending, setPending] = useState(false);
  const [exporting, startExport] = useTransition();
  const [changeError, setChangeError] = useState("");
  const [mustReload, setMustReload] = useState(false);
  const busy = useRef(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true);
    try {
      const result = await getEmployeesPageDataAction({ query, status, branchId, page });
      if (request.current !== sequence) return;
      if (result.ok) { setData(result.data); setError(""); }
      else { setData(null); setError(result.error); }
    } catch { if (request.current === sequence) { setData(null); setError("No pudimos cargar el equipo."); } }
    finally { if (request.current === sequence) setLoading(false); }
  }, [query, status, branchId, page]);
  useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => { clearTimeout(timer); request.current += 1; }; }, [load]);

  async function changeActive() {
    if (!changing || busy.current || mustReload) return;
    busy.current = true; setPending(true); setChangeError("");
    try {
      const result = await setEmployeeActiveAction({ id: changing.id, expectedUpdatedAt: changing.updatedAt, active: !changing.active });
      if (result.ok) { setChanging(null); toast({ tone: "success", title: result.employee.active ? "Empleado restaurado" : "Empleado archivado" }); await load(); }
      else { setChangeError("message" in result ? result.message : result.error); if ("status" in result && result.status !== "rejected") setMustReload(true); }
    } catch { setChangeError("No pudimos confirmar el cambio. Verificá el estado guardado antes de continuar."); setMustReload(true); }
    finally { busy.current = false; setPending(false); }
  }
  async function verifyStatus() {
    if (!changing || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const result = await getEmployeeManualAction(changing.id);
      if (result.ok && result.employee) {
        if (result.employee.active === !changing.active) {
          setChanging(null); toast({ tone: "success", title: result.employee.active ? "Restauración confirmada" : "Archivo confirmado" });
        } else { setChanging(result.employee); setMustReload(false); setChangeError("Este es el estado guardado actualmente. Revisalo antes de continuar."); }
        await load();
      } else setChangeError(result.ok ? "El empleado ya no está disponible." : result.error);
    } catch { setChangeError("No pudimos verificar el estado."); }
    finally { busy.current = false; setPending(false); }
  }
  function exportRows() {
    startExport(async () => {
      try {
        const result = await exportEmployeesCsvAction();
        if (result.ok) { triggerCsvDownload(result.filename, result.content); toast({ tone: "success", title: "Novedades exportadas", description: `${result.rows} empleados visibles, activos y archivados.` }); }
        else toast({ tone: "warn", title: "No pudimos exportar", description: result.error });
      } catch { toast({ tone: "warn", title: "No pudimos exportar", description: "Volvé a intentarlo cuando se recupere la conexión." }); }
    });
  }
  return <div className="space-y-6">
    <SectionHeader eyebrow="Equipo" title="Tu equipo, ordenado." description="Registrá empleados, turnos, horas, costo, adelantos y novedades reales. Archivar conserva los datos y el historial." actions={data ? <><Button onClick={exportRows} disabled={exporting || pending} variant="ghost"><Download className="h-4 w-4" />{exporting ? "Exportando…" : "Exportar novedades"}</Button>{data.canManage && <Button variant="primary" onClick={() => setEditing("new")} disabled={pending}><Plus className="h-4 w-4" />Agregar empleado</Button>}</> : undefined} />
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 text-xs text-ink-muted">Buscar por nombre<input className="mt-1 block h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm" value={query} maxLength={200} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>
      <label className="text-xs text-ink-muted">Estado<select className="mt-1 block h-10 rounded-lg border border-line bg-bg px-3 text-sm" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }}><option value="active">Activos</option><option value="archived">Archivados</option><option value="all">Todos</option></select></label>
      <label className="max-w-full text-xs text-ink-muted">Sucursal<select className="mt-1 block h-10 max-w-full rounded-lg border border-line bg-bg px-3 text-sm" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(0); }}><option value="">Todas las visibles</option>{data?.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
      <Button onClick={() => void load()} disabled={loading}>Actualizar</Button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-warn-500/30 p-5 text-sm">{error}</div>}
    {loading ? <div role="status" className="flex items-center justify-center gap-2 p-12 text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" />Cargando equipo…</div> : data && <>
      <p className="text-xs text-ink-muted">{data.count} empleados en este filtro{!data.canManage ? " · Acceso de lectura" : ""}. Los indicadores incluyen todo el filtro; la exportación incluye toda la nómina visible.</p>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4"><KpiCard label="Costo mensual activo" value={formatARS(data.totalMonthlyCost, { compact: true })} tone="brand" /><KpiCard label="Activos" value={String(data.activeCount)} /><KpiCard label="Adelantos pendientes" value={formatARS(data.pendingAdvances, { compact: true })} tone="warn" /><KpiCard label="Faltas / tardes" value={`${data.totalAbsences} / ${data.totalLateArrivals}`} /></div>
      {data.employees.length === 0 ? <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink-muted">No hay empleados que coincidan con este filtro.</div> : <div className="grid gap-4 lg:grid-cols-2">
        {data.employees.map((employee) => <article key={employee.id} className="space-y-3 rounded-xl border border-line bg-bg-elevated p-5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold text-ink">{employee.fullName}</h2><p className="break-words text-sm text-ink-muted">{employee.role} · {employee.shift || "Turno sin registrar"}</p><p className="mt-1 text-xs text-ink-muted">{data.branches.find((branch) => branch.id === employee.branchId)?.name ?? "Sucursal sin asignar"}</p></div><Badge tone={employee.active ? "success" : "default"}>{employee.active ? "Activo" : "Archivado"}</Badge></div>
          <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-ink-muted">Horas del mes</dt><dd>{employee.monthlyHours} h</dd></div><div><dt className="text-xs text-ink-muted">Costo del mes</dt><dd>{formatARS(employee.monthlyCost)}</dd></div><div><dt className="text-xs text-ink-muted">Adelantos pendientes</dt><dd>{formatARS(employee.pendingAdvance)}</dd></div><div><dt className="text-xs text-ink-muted">Faltas / tardes</dt><dd>{employee.absences} / {employee.lateArrivals}</dd></div></dl>
          {data.canManage && <div className="flex flex-wrap gap-2 border-t border-line pt-3"><Button size="sm" variant="ghost" onClick={() => setEditing(employee)}><Pencil className="h-3.5 w-3.5" />Editar</Button><Button size="sm" variant="ghost" onClick={() => { setChanging(employee); setMustReload(false); setChangeError(""); }}>{employee.active ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{employee.active ? "Archivar" : "Restaurar"}</Button></div>}
        </article>)}
      </div>}
      <div className="flex items-center justify-between gap-3"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span className="text-xs text-ink-muted">Página {page + 1} de {Math.max(1, Math.ceil(data.count / data.pageSize))}</span><Button disabled={(page + 1) * data.pageSize >= data.count} onClick={() => setPage(page + 1)}>Siguiente</Button></div>
    </>}
    <Drawer open={editing !== null} onClose={() => !pending && setEditing(null)} title={editing === "new" ? "Nuevo empleado" : "Editar empleado"} description="Cargá únicamente datos reales del equipo." width="max-w-lg">
      {editing && data && <EmployeeForm key={editing === "new" ? "new" : editing.id} branches={data.branches} draftScope={data.draftScope} employee={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onBusyChange={setPending} onSaved={() => { setEditing(null); toast({ tone: "success", title: "Empleado guardado" }); void load(); }} />}
    </Drawer>
    <Drawer open={changing !== null} onClose={() => !pending && setChanging(null)} title={changing?.active ? "Archivar empleado" : "Restaurar empleado"} width="max-w-lg">
      {changing && <div className="space-y-4 p-6"><p className="font-semibold">{changing.fullName} · {changing.active ? "Activo" : "Archivado"}</p><p className="text-sm text-ink-muted">{changing.active ? "Dejará de contarse como activo. Sus adelantos pendientes, turnos y registros históricos se conservan." : "Volverá a contarse como activo, con sus datos guardados."}</p>{changeError && <p role="alert" className="text-sm text-warn-400">{changeError}</p>}<div className="flex flex-wrap justify-end gap-2"><Button disabled={pending} variant="ghost" onClick={() => setChanging(null)}>Cerrar</Button>{mustReload ? <Button disabled={pending} onClick={() => void verifyStatus()}>Verificar estado</Button> : <Button disabled={pending} variant="primary" onClick={() => void changeActive()}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{changing.active ? "Confirmar archivo" : "Confirmar restauración"}</Button>}</div></div>}
    </Drawer>
  </div>;
}
