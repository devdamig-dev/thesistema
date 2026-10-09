"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Calculator, Loader2, Plus, Receipt, RefreshCw, Target } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { getExpensesPageDataAction, getExpenseHistoryAction, saveExpenseAction, voidExpenseAction, restoreExpenseAction, type ExpenseRow, type ExpensesPageData } from "@/app/actions/expenses-page";
import { expenseJournalKey, readExpenseOperation, retainExpenseOperation } from "@/lib/expenses/journal";
import { parseSaveExpense } from "@/lib/expenses/validation";
import type { ExpenseMutation, ExpenseOperation, SaveExpenseInput } from "@/lib/expenses/types";
import { balanceSnapshot, dashboardKpis, fixedExpenses, topSuppliers } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";
const inputClass = "w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand-500 disabled:opacity-60";
const sourceLabel: Record<string, string> = { manual: "Manual", whatsapp: "WhatsApp", inbox: "Inbox", api: "API", system: "Sistema" };
function statusLabel(status: string) { return ({ paid: "Pagado", scheduled: "Programado", pending: "Pendiente" } as Record<string, string>)[status] ?? status; }
function statusTone(status: string): "success" | "info" | "warn" | "default" { return status === "paid" ? "success" : status === "scheduled" ? "info" : status === "pending" ? "warn" : "default"; }
function dateLabel(value: string | null) { return value ? value.split("-").reverse().join("/") : "Sin vencimiento"; }
function ErrorText({ children }: { children: ReactNode }) { return <p role="alert" className="rounded-xl border border-warn-500/30 bg-warn-500/10 p-3 text-sm text-ink">{children}</p>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block space-y-1.5 text-xs text-ink-muted"><span>{label}</span>{children}</label>; }

type Draft = Omit<SaveExpenseInput, "requestId" | "businessId" | "userId" | "status"> & { status: string };
export default function GastosPage() {
  const [data, setData] = useState<ExpensesPageData | null>(null);
  const [loading, setLoading] = useState(IS_DATABASE); const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [draft, setDraft] = useState<Draft | null>(null); const [stateTarget, setStateTarget] = useState<ExpenseRow | null>(null); const [reason, setReason] = useState("");
  const [detail, setDetail] = useState<ExpenseRow | null>(null); const [history, setHistory] = useState<ExpenseMutation[]>([]); const [historyError, setHistoryError] = useState(""); const [historyLoading, setHistoryLoading] = useState(false);
  const [pending, setPending] = useState<ExpenseOperation | null>(null); const pendingRef = useRef<ExpenseOperation | null>(null);
  const [operationError, setOperationError] = useState(""); const [notice, setNotice] = useState(""); const [storageError, setStorageError] = useState("");
  const [query, setQuery] = useState(""); const [filter, setFilter] = useState("active"); const [branch, setBranch] = useState(""); const [page, setPage] = useState(1); const [scenario, setScenario] = useState(0);
  const contextKey = useRef(""); const generation = useRef(0); const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (!IS_DATABASE || lock.current) return;
    const request = ++generation.current; setLoading(true); setLoadError("");
    try {
      const result = await getExpensesPageDataAction();
      if (!mounted.current || request !== generation.current) return;
      if (!result.ok) { setData(null); setLoadError(result.error); setDraft(null); setStateTarget(null); setDetail(null); return; }
      const key = expenseJournalKey(result.data.businessId, result.data.userId);
      if (contextKey.current !== key) { contextKey.current = key; setDraft(null); setStateTarget(null); setDetail(null); setReason(""); setOperationError(""); setNotice(""); setStorageError(""); setBranch(""); setPage(1); }
      try { const saved = readExpenseOperation(sessionStorage.getItem(key), result.data.businessId, result.data.userId); pendingRef.current = saved; setPending(saved); }
      catch { pendingRef.current = null; setPending(null); setStorageError("No pudimos recuperar el intento de esta pestaña. Las nuevas operaciones están bloqueadas para evitar duplicados."); }
      setDetail((current) => current ? result.data.expenses.find((row) => row.id === current.id) ?? null : null);
      setData(result.data);
    } catch { if (mounted.current && request === generation.current) { setData(null); setLoadError("No pudimos cargar los gastos. Reintentá para recuperar los datos reales."); } }
    finally { if (mounted.current && request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void refresh(); const focus = () => void refresh(); window.addEventListener("focus", focus); return () => { mounted.current = false; window.removeEventListener("focus", focus); }; }, [refresh]);
  useEffect(() => {
    setHistory([]); setHistoryError("");
    if (!detail || !IS_DATABASE) { setHistoryLoading(false); return; }
    let cancelled = false; setHistoryLoading(true);
    void getExpenseHistoryAction(detail.id).then((result) => { if (cancelled) return; if (result.ok) setHistory(result.history); else setHistoryError(result.error); }).catch(() => { if (!cancelled) setHistoryError("No pudimos leer el historial."); }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [detail, data]);

  const demoExpenses: ExpenseRow[] = useMemo(() => fixedExpenses.map((row, index) => ({ id: `demo-${index}`, nombre: row.nombre, categoria: "Demo", monto: row.monto, amount: String(row.monto), vencimiento: null, estado: row.estado, sucursal: "Principal", branchId: "demo", version: 0, recordStatus: "active", source: null, voidReason: null })), []);
  const expenses = IS_DATABASE ? data?.expenses ?? [] : demoExpenses;
  const filtered = expenses.filter((row) => (filter === "all" || row.recordStatus === filter) && (!branch || row.branchId === branch) && `${row.nombre} ${row.categoria}`.toLocaleLowerCase("es-AR").includes(query.toLocaleLowerCase("es-AR")));
  const visible = filtered.slice((page - 1) * 25, page * 25); const pages = Math.max(1, Math.ceil(filtered.length / 25));
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const totalFixed = IS_DATABASE ? data?.totalFixed ?? 0 : fixedExpenses.reduce((sum, row) => sum + row.monto, 0);
  const totalVariable = IS_DATABASE ? data?.totalVariable ?? 0 : topSuppliers.reduce((sum, row) => sum + row.totalMes, 0);
  const margin = IS_DATABASE ? data?.grossMarginPct ?? null : balanceSnapshot.margenBrutoPct ?? dashboardKpis.margenEstimado ?? 31;
  const scenarioMargin = margin !== null && margin > 0 ? Math.max(5, margin + scenario) : null;
  const target = scenarioMargin ? Math.round(totalFixed / scenarioMargin * 100) : null;
  const canStart = IS_DATABASE && !!data?.canManage && !loading && !busy && !pending && !storageError;
  function closeEditor() { if (lock.current) return; setDraft(null); setStateTarget(null); setOperationError(""); }
  function edit(row?: ExpenseRow) {
    if (!canStart || !data || (row && row.recordStatus !== "active")) return;
    setDetail(null); setStateTarget(null); setOperationError(""); setNotice("");
    setDraft(row ? { id: row.id, expectedVersion: row.version, branchId: row.branchId, name: row.nombre, category: row.categoria, amount: row.amount, dueDate: row.vencimiento, status: ["pending", "scheduled", "paid"].includes(row.estado) ? row.estado : "" } : { id: null, expectedVersion: null, branchId: data.branches.length === 1 ? data.branches[0].id : "", name: "", category: "", amount: "", dueDate: null, status: "pending" });
  }
  async function execute(proposed: ExpenseOperation) {
    if (!data?.canManage || lock.current || storageError) return;
    const key = contextKey.current; const recovering = pendingRef.current !== null;
    lock.current = true; setBusy(true); setOperationError(""); setNotice(""); ++generation.current;
    let frozen: ExpenseOperation;
    try { frozen = retainExpenseOperation(pendingRef.current, proposed); sessionStorage.setItem(key, JSON.stringify(frozen)); pendingRef.current = frozen; setPending(frozen); }
    catch { setStorageError("No pudimos conservar el intento. No se enviaron cambios; permití el almacenamiento de esta aplicación y recargá."); lock.current = false; setBusy(false); return; }
    try {
      const result = frozen.kind === "save" ? await saveExpenseAction(frozen.input) : frozen.kind === "void" ? await voidExpenseAction(frozen.input) : await restoreExpenseAction(frozen.input);
      const confirmed = result.ok || (result.persisted === false && !recovering);
      if (confirmed) { try { sessionStorage.removeItem(key); } catch { if (mounted.current && key === contextKey.current) setStorageError("El resultado se confirmó, pero no pudimos limpiar la referencia local. Recargá para verificarla."); } }
      if (!mounted.current || key !== contextKey.current) return;
      if (confirmed) { pendingRef.current = null; setPending(null); }
      if (!result.ok) { setOperationError(result.error + (recovering && result.persisted === false ? " El intento previo sigue pendiente de confirmación; no se descartó." : "")); return; }
      setDraft(null); setStateTarget(null); setNotice(frozen.kind === "void" ? "Gasto anulado. El registro y su historial se conservan; podés restaurarlo." : frozen.kind === "restore" ? "Gasto restaurado con su historial." : "Gasto guardado. El estado de pago es un registro contable; no se ejecutó ningún pago.");
    } catch { if (mounted.current && key === contextKey.current) setOperationError("La conexión se interrumpió. No sabemos si el gasto quedó guardado. Reintentá el mismo intento."); }
    finally { lock.current = false; if (mounted.current && key === contextKey.current) { setBusy(false); await refresh(); } }
  }
  function save(event: FormEvent) {
    event.preventDefault(); if (!draft || !data || !canStart) return;
    try { const input = parseSaveExpense({ ...draft, amount: draft.amount.replace(",", "."), requestId: crypto.randomUUID(), businessId: data.businessId, userId: data.userId }); void execute({ kind: "save", input }); }
    catch (error) { setOperationError(error instanceof Error ? error.message : "Revisá los datos."); }
  }
  const mutateState = (event: FormEvent) => { event.preventDefault(); if (!stateTarget || !data || !canStart || !reason.trim()) return; void execute({ kind: stateTarget.recordStatus === "active" ? "void" : "restore", input: { requestId: crypto.randomUUID(), businessId: data.businessId, userId: data.userId, id: stateTarget.id, expectedVersion: stateTarget.version, reason: reason.trim() } }); };

  return <div className="space-y-6">
    <SectionHeader eyebrow="Gastos fijos" title="Lo que cuesta abrir cada día." description="Registrá, corregí y anulá gastos conservando su historial. Los estados de pago son información contable." actions={<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading || busy || !IS_DATABASE}><RefreshCw className="h-4 w-4" /> Actualizar</Button><Button size="sm" onClick={() => edit()} disabled={!canStart}><Plus className="h-4 w-4" /> Nuevo gasto fijo</Button></div>} />
    {notice && <p role="status" className="rounded-xl border border-success-500/30 p-3 text-sm">{notice}</p>}
    {storageError && <ErrorText>{storageError}</ErrorText>}
    {pending && <div className="space-y-2 rounded-xl border border-warn-500/30 p-4"><p className="text-sm">Hay una operación pendiente de confirmar. Conservamos sus datos y referencia; las nuevas operaciones están bloqueadas.</p><p className="break-all text-xs text-ink-muted">Referencia: {pending.input.requestId}</p><Button size="sm" disabled={busy || !data?.canManage || !!storageError} onClick={() => void execute(pending)}>Reintentar mismo intento</Button></div>}
    {operationError && !draft && !stateTarget && <ErrorText>{operationError}</ErrorText>}
    {loadError && <ErrorText>{loadError}</ErrorText>}
    {loading ? <p className="p-8 text-center text-sm text-ink-muted"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Cargando gastos…</p> : loadError ? <Button variant="ghost" onClick={() => void refresh()}>Reintentar carga</Button> : <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4"><KpiCard label="Costos fijos activos" value={formatARS(totalFixed, { compact: true })} hint="Anulados excluidos" tone="brand" /><KpiCard label="Costos variables (mes)" value={formatARS(totalVariable, { compact: true })} hint="Compras del mes" /><KpiCard label="Margen promedio" value={margin === null ? "—" : formatPercent(margin, 0)} hint={margin === null ? "Sin balance vigente" : "Último balance"} tone="ai" /><KpiCard label="Punto de equilibrio" value={target === null ? "—" : formatARS(target, { compact: true })} hint="Simulación mensual" icon={<Target />} /></div>
      <Card><CardHeader><div><CardTitle>Detalle de gastos fijos</CardTitle><p className="mt-1 text-xs text-ink-muted">Anular conserva todos los datos; restaurar revierte la anulación.</p></div><Badge>{filtered.length} registros</Badge></CardHeader>
        <div className="grid gap-3 border-b border-line p-4 sm:grid-cols-3"><Field label="Buscar gasto"><input aria-label="Buscar gasto" className={inputClass} value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Concepto o categoría" /></Field><Field label="Registros"><select aria-label="Registros" className={inputClass} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}><option value="active">Activos</option><option value="voided">Anulados</option><option value="all">Todos</option></select></Field><Field label="Filtrar sucursal"><select aria-label="Filtrar sucursal" className={inputClass} value={branch} onChange={(e) => { setBranch(e.target.value); setPage(1); }}><option value="">Todas las disponibles</option>{(data?.branches ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
        {visible.length === 0 ? <CardContent><p className="py-8 text-center text-sm text-ink-muted">No hay gastos para estos filtros.</p></CardContent> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-line text-xs text-ink-subtle"><tr><th className="px-4 py-3">Concepto</th><th className="px-4 py-3">Sucursal</th><th className="px-4 py-3">Vencimiento</th><th className="px-4 py-3">Estado</th><th className="px-4 py-3 text-right">Monto</th><th className="px-4 py-3">Acciones</th></tr></thead><tbody>{visible.map((row) => <tr key={row.id} className="border-b border-line/60"><td className="px-4 py-3"><div className="flex items-center gap-2 font-medium"><Receipt className="h-4 w-4 shrink-0" />{row.nombre}</div><p className="mt-1 text-xs text-ink-muted">{row.categoria}</p></td><td className="px-4 py-3">{row.sucursal}</td><td className="px-4 py-3">{dateLabel(row.vencimiento)}</td><td className="px-4 py-3"><Badge tone={row.recordStatus === "voided" ? "default" : statusTone(row.estado)}>{row.recordStatus === "voided" ? "Anulado" : statusLabel(row.estado)}</Badge></td><td className="px-4 py-3 text-right font-semibold tabular-nums">{formatARS(row.monto)}</td><td className="px-4 py-3"><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={!IS_DATABASE || busy} onClick={() => setDetail(row)}>Detalle</Button>{row.recordStatus === "active" && <Button size="sm" variant="ghost" disabled={!canStart} onClick={() => edit(row)}>Editar</Button>}<Button size="sm" variant="ghost" disabled={!canStart} onClick={() => { setStateTarget(row); setReason(""); setOperationError(""); }}>{row.recordStatus === "active" ? "Anular" : "Restaurar"}</Button></div></td></tr>)}</tbody></table></div>}
        <div className="flex items-center justify-between p-4 text-xs text-ink-muted"><span>Página {page} de {pages}</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>Anterior</Button><Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Siguiente</Button></div></div>
      </Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Calculator className="h-4 w-4" /> Simulación de punto de equilibrio</CardTitle></CardHeader><CardContent className="space-y-4">{scenarioMargin === null ? <p className="text-sm text-ink-muted">Necesitamos un balance vigente para calcular el punto de equilibrio.</p> : <><div className="grid grid-cols-3 gap-3">{[["Conservador", -4], ["Esperado", 0], ["Agresivo", 4]].map(([label, delta]) => <button key={label} className={cn("rounded-xl border p-3 text-sm", scenario === delta ? "border-brand-500 bg-brand-500/10" : "border-line")} onClick={() => setScenario(Number(delta))}>{label}</button>)}</div><div className="grid gap-3 sm:grid-cols-3">{[["Por día", Math.round(target! / 30)], ["Por semana", Math.round(target! / 4.3)], ["Por mes", target!]].map(([label, value]) => <div key={label} className="rounded-xl border border-line p-4"><p className="text-xs text-ink-muted">{label}</p><p className="mt-1 text-xl font-semibold">{formatARS(Number(value))}</p></div>)}</div><p className="text-xs text-ink-muted">Gastos activos / margen de {formatPercent(scenarioMargin, 0)}. No incluye reinversión, retiros ni amortizaciones.</p></>}</CardContent></Card>
    </>}

    <Drawer open={draft !== null} onClose={closeEditor} title={draft?.id ? "Editar gasto" : "Nuevo gasto fijo"} description="El cambio queda registrado con su historial. Marcar pagado no ejecuta un pago." width="max-w-lg">
      {draft && <form onSubmit={save} className="space-y-4 p-6" aria-busy={busy}><fieldset disabled={!canStart} className="space-y-4">
        <Field label="Sucursal"><select aria-label="Sucursal" required className={inputClass} value={draft.branchId} onChange={(e) => setDraft({ ...draft, branchId: e.target.value })}><option value="">Seleccioná una sucursal</option>{data?.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Concepto"><input aria-label="Concepto" required maxLength={200} className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field><Field label="Categoría"><input aria-label="Categoría" required maxLength={80} className={inputClass} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-4"><Field label="Monto"><input aria-label="Monto" required inputMode="decimal" className={inputClass} value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="0,00" /></Field><Field label="Vencimiento"><input aria-label="Vencimiento" type="date" className={inputClass} value={draft.dueDate ?? ""} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })} /></Field></div>
        <Field label="Estado contable"><select aria-label="Estado contable" className={inputClass} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as Draft["status"] })}><option value="">Seleccioná un estado</option><option value="pending">Pendiente</option><option value="scheduled">Programado</option><option value="paid">Pagado</option></select></Field>
      </fieldset>{operationError && <ErrorText>{operationError}</ErrorText>}<div className="flex flex-wrap gap-2"><Button type="submit" disabled={!canStart}>{busy ? "Guardando…" : "Guardar gasto"}</Button><Button type="button" variant="ghost" onClick={closeEditor} disabled={busy}>{pending ? "Cerrar y revisar" : "Cancelar"}</Button></div></form>}
    </Drawer>
    <Drawer open={stateTarget !== null} onClose={closeEditor} title={stateTarget?.recordStatus === "active" ? "Anular gasto" : "Restaurar gasto"} description="Se conserva el importe, estado de pago e historial. No se ejecuta ningún pago." width="max-w-lg">
      {stateTarget && <form onSubmit={mutateState} className="space-y-4 p-6"><p className="font-semibold">{stateTarget.nombre} · {formatARS(stateTarget.monto)}</p><Field label="Motivo obligatorio"><input aria-label="Motivo obligatorio" required maxLength={1000} className={inputClass} disabled={!canStart} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>{operationError && <ErrorText>{operationError}</ErrorText>}<div className="flex gap-2"><Button type="submit" disabled={!canStart || !reason.trim()}>{stateTarget.recordStatus === "active" ? "Confirmar anulación" : "Confirmar restauración"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={closeEditor}>{pending ? "Cerrar y revisar" : "Cancelar"}</Button></div></form>}
    </Drawer>
    <Drawer open={detail !== null} onClose={() => setDetail(null)} title={detail?.nombre} description="Detalle actual e historial de cambios." width="max-w-xl">
      {detail && <div className="space-y-5 p-6"><p className="text-2xl font-semibold">{formatARS(detail.monto)}</p><div className="grid grid-cols-2 gap-3 text-sm"><p>Sucursal: {detail.sucursal}</p><p>Categoría: {detail.categoria}</p><p>Estado: {detail.recordStatus === "voided" ? "Anulado" : "Activo"}</p><p>Pago: {statusLabel(detail.estado)}</p><p>Origen: {detail.source ? sourceLabel[detail.source] ?? detail.source : "Sin dato histórico"}</p><p>Versión: {detail.version}</p><p>Vencimiento: {dateLabel(detail.vencimiento)}</p></div>{detail.voidReason && <p className="text-sm">Motivo de anulación: {detail.voidReason}</p>}<h3 className="text-sm font-semibold">Historial</h3>{historyLoading ? <p>Cargando historial…</p> : historyError ? <ErrorText>{historyError}</ErrorText> : history.length === 0 ? <p className="text-sm text-ink-muted">No hay revisiones registradas para este gasto histórico.</p> : history.map((entry) => <div key={entry.request_id} className="space-y-2 rounded-xl border border-line p-3 text-xs"><p className="font-semibold">{entry.operation === "void" ? "Anulado" : entry.operation === "restore" ? "Restaurado" : entry.before_snapshot ? "Editado" : "Creado"} · {new Date(entry.created_at).toLocaleString("es-AR")}</p><p>{sourceLabel[entry.source] ?? entry.source} · {entry.actor_role} · versión {entry.after_snapshot.version}</p>{entry.before_snapshot && <p>Antes: {entry.before_snapshot.name} · {entry.before_snapshot.category} · {formatARS(Number(entry.before_snapshot.amount))} · {statusLabel(entry.before_snapshot.status)} · {dateLabel(entry.before_snapshot.due_date)}</p>}<p>Después: {entry.after_snapshot.name} · {entry.after_snapshot.category} · {formatARS(Number(entry.after_snapshot.amount))} · {statusLabel(entry.after_snapshot.status)} · {dateLabel(entry.after_snapshot.due_date)}</p>{entry.payload.input.reason && <p>Motivo: {entry.payload.input.reason}</p>}<p className="break-all text-ink-subtle">Referencia: {entry.request_id}</p></div>)}</div>}
    </Drawer>
  </div>;
}
