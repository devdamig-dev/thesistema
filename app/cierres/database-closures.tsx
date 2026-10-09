"use client";
import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { getClosuresWorkspaceAction, getClosureHistoryAction, saveClosureAction, archiveClosureAction } from "@/app/actions/closures";
import { closureJournalKey, parseClosureOperation, readClosureOperation, type ClosureHistory, type ClosureOperation, type ClosureRecord, type ClosureWorkspace, type SaveClosure } from "@/lib/closures/domain";
const fieldClass = "w-full min-w-0 rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink disabled:opacity-60";
const amount = (value: string) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 space-y-1 text-xs text-ink-muted"><span>{label}</span>{isValidElement(children) ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, { "aria-label": label }) : children}</label>; }
function ErrorText({ children }: { children: ReactNode }) { return <p role="alert" className="rounded-lg border border-warn-500/30 bg-warn-500/10 p-3 text-sm">{children}</p>; }
type Draft = Omit<SaveClosure, "requestId" | "businessId" | "userId">;
export default function DatabaseClosures() {
  const [workspace, setWorkspace] = useState<ClosureWorkspace | null>(null);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null); const [archive, setArchive] = useState<ClosureRecord | null>(null); const [reason, setReason] = useState("");
  const [detail, setDetail] = useState<ClosureRecord | null>(null); const [history, setHistory] = useState<ClosureHistory[]>([]); const [historyError, setHistoryError] = useState(""); const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState(false); const lock = useRef(false);
  const [pending, setPending] = useState<ClosureOperation | null>(null); const pendingRef = useRef<ClosureOperation | null>(null);
  const [operationError, setOperationError] = useState(""); const [storageError, setStorageError] = useState(""); const [notice, setNotice] = useState("");
  const [branch, setBranch] = useState(""); const [status, setStatus] = useState("active"); const [page, setPage] = useState(1);
  const mounted = useRef(true); const generation = useRef(0); const contextKey = useRef("");
  const refresh = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setLoadError("");
    try {
      const result = await getClosuresWorkspaceAction(); if (!mounted.current || request !== generation.current) return;
      if (!result.ok) { setWorkspace(null); setLoadError(result.error); setDraft(null); setArchive(null); setDetail(null); contextKey.current = ""; return; }
      const data = result.data; const key = closureJournalKey(data.businessId, data.userId);
      if (key !== contextKey.current) { contextKey.current = key; setDraft(null); setArchive(null); setDetail(null); setBranch(""); setPage(1); setOperationError(""); setNotice(""); setStorageError(""); lock.current = false; setBusy(false); }
      try { const saved = readClosureOperation(sessionStorage.getItem(key), data.businessId, data.userId); pendingRef.current = saved; setPending(saved); }
      catch { setStorageError("No pudimos recuperar el intento de esta pestaña. Bloqueamos nuevas operaciones para evitar duplicados."); }
      setWorkspace(data); setDetail(current => current ? data.closures.find(row => row.id === current.id) ?? null : null);
    } catch { if (mounted.current && request === generation.current) { setWorkspace(null); setDraft(null); setArchive(null); setDetail(null); contextKey.current = ""; setLoadError("No pudimos cargar los cierres completos. Volvé a intentar."); } }
    finally { if (mounted.current && request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void refresh(); const focus = () => { void refresh(); }; const visible = () => { if (document.visibilityState === "visible") focus(); }; window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visible); return () => { mounted.current = false; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visible); }; }, [refresh]);
  useEffect(() => { if (!pending && !busy) return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [pending, busy]);
  useEffect(() => {
    setHistory([]); setHistoryError(""); if (!detail) { setHistoryLoading(false); return; }
    let cancelled = false; setHistoryLoading(true);
    void getClosureHistoryAction(detail.id).then(result => { if (!cancelled) { if (result.ok) setHistory(result.history); else setHistoryError(result.error); } }).catch(() => { if (!cancelled) setHistoryError("No pudimos leer el historial del cierre."); }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [detail]);
  const canStart = !!workspace?.canManage && !loading && !busy && !pending && !storageError;
  function close() { if (lock.current) return; setDraft(null); setArchive(null); setOperationError(""); }
  function edit(row?: ClosureRecord) {
    if (!workspace || !canStart || row?.archived_at) return;
    setArchive(null); setOperationError(""); setNotice("");
    setDraft(row ? { id: row.id, expectedVersion: row.version, branchId: row.branch_id, closureDate: row.closure_date, grossTotal: String(row.gross_total), netTotal: String(row.net_total), note: row.manual_note ?? "", reason: "" } : { id: null, expectedVersion: null, branchId: workspace.branches.length === 1 ? workspace.branches[0].id : "", closureDate: "", grossTotal: "", netTotal: "", note: "", reason: null });
  }
  async function execute(proposed: ClosureOperation) {
    if (!workspace?.canManage || lock.current || storageError || proposed.input.businessId !== workspace.businessId || proposed.input.userId !== workspace.userId) return;
    lock.current = true; setBusy(true); setOperationError(""); setNotice("");
    const key = contextKey.current; const recovery = pendingRef.current !== null; const operation = pendingRef.current ?? proposed;
    try { sessionStorage.setItem(key, JSON.stringify(operation)); pendingRef.current = operation; setPending(operation); }
    catch { setStorageError("No pudimos conservar el intento. No se enviaron cambios. Permití el almacenamiento de la aplicación y recargá."); lock.current = false; setBusy(false); return; }
    try {
      const result = operation.kind === "save" ? await saveClosureAction(operation.input) : await archiveClosureAction(operation.input);
      if (result.ok || !result.ok && result.persisted === false && !recovery) { try { sessionStorage.removeItem(key); } catch { if (key === contextKey.current) setStorageError("El resultado está confirmado, pero no pudimos limpiar la referencia local. Recargá antes de continuar."); } }
      if (!mounted.current || key !== contextKey.current) return;
      if (result.ok) { pendingRef.current = null; setPending(null); setDraft(null); setArchive(null); setNotice(operation.kind === "save" ? "Cierre guardado con historial." : "Cierre archivado. Se conserva su historial."); await refresh(); }
      else { if (result.persisted === false && !recovery) { pendingRef.current = null; setPending(null); } setOperationError(result.error + (recovery ? " Conservamos la referencia anterior hasta confirmar su resultado." : "")); if (result.persisted === false) await refresh(); }
    } catch { if (mounted.current && key === contextKey.current) setOperationError("No pudimos confirmar el resultado. Conservamos el mismo intento para reintentarlo sin duplicados."); }
    finally { if (mounted.current && key === contextKey.current) { lock.current = false; setBusy(false); } }
  }
  function save(event: FormEvent) {
    event.preventDefault(); if (!workspace || !draft || lock.current || pendingRef.current) return;
    try { void execute(parseClosureOperation("save", { ...draft, requestId: crypto.randomUUID(), businessId: workspace.businessId, userId: workspace.userId })); }
    catch (error) { setOperationError(error instanceof Error ? error.message : "Datos inválidos."); }
  }
  const filtered = (workspace?.closures ?? []).filter(row => (!branch || row.branch_id === branch) && (status === "all" || (status === "archived") === !!row.archived_at));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)); const currentPage = Math.min(page, pages); const rows = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const branchName = (row: ClosureRecord) => workspace?.branches.find(b => b.id === row.branch_id)?.name ?? "Sucursal no informada";
  return <div className="space-y-6">
    <SectionHeader eyebrow="Cierres operativos" title="Registrá y corregí tus cierres" description="Resúmenes manuales con origen e historial. Los importes no generan ventas, gastos, pagos ni movimientos de stock. Moneda no informada." actions={<><Button size="sm" variant="ghost" disabled={loading || busy} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Actualizar</Button><Button size="sm" disabled={!canStart} onClick={() => edit()}><Plus className="h-4 w-4" />Nuevo cierre</Button></>} />
    {loading && <p role="status">Cargando cierres…</p>}{loadError && <ErrorText>{loadError}</ErrorText>}{storageError && <ErrorText>{storageError}</ErrorText>}{notice && <p role="status" className="rounded-lg border border-line p-3 text-sm">{notice}</p>}
    {pending && <div className="space-y-2 rounded-xl border border-warn-500/30 p-4"><p className="text-sm">Hay un cierre pendiente de confirmar. Las nuevas operaciones quedan bloqueadas hasta verificarlo.</p><p className="break-all text-xs">Referencia: {pending.input.requestId}</p><Button size="sm" disabled={busy || !workspace?.canManage || !!storageError} onClick={() => void execute(pending)}>Reintentar mismo intento</Button></div>}
    {operationError && !draft && !archive && <ErrorText>{operationError}</ErrorText>}
    {workspace && <>
      {!workspace.canManage && <p>Tu rol permite consultar los cierres, pero no modificarlos.</p>}
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Filtrar por sucursal"><select className={fieldClass} value={branch} onChange={e => { setBranch(e.target.value); setPage(1); }}><option value="">Todas las sucursales permitidas</option>{workspace.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field><Field label="Estado de los cierres"><select className={fieldClass} value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="active">Vigentes</option><option value="archived">Archivados</option><option value="all">Todos</option></select></Field></div>
      {rows.length === 0 ? <Card><CardContent className="py-10 text-center"><p>No hay cierres para estos filtros.</p><p className="mt-2 text-xs text-ink-muted">Podés registrar el primer cierre manual del negocio.</p></CardContent></Card> : <div className="grid gap-3 lg:grid-cols-2">{rows.map(row => <Card key={row.id}><CardContent className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><h2 className="font-semibold">{branchName(row)}</h2><p className="text-xs text-ink-muted">{row.closure_date} · Versión {row.version}</p></div><p className="text-xs">{row.archived_at ? "Archivado" : "Vigente"} · {row.source === "manual" ? "Carga manual" : row.source ?? "Origen no informado"}</p></div><p className="text-sm">Bruto: {amount(row.gross_total)} · Neto: {amount(row.net_total)}</p>{row.manual_note && <p className="break-words text-sm text-ink-muted">{row.manual_note}</p>}{row.archive_reason && <p className="break-words text-xs">Motivo de archivo: {row.archive_reason}</p>}<div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => setDetail(row)}>Detalle e historial</Button>{!row.archived_at && <><Button size="sm" variant="ghost" disabled={!canStart} onClick={() => edit(row)}>Corregir</Button><Button size="sm" variant="ghost" disabled={!canStart} onClick={() => { if (canStart) { setArchive(row); setDraft(null); setReason(""); setOperationError(""); } }}>Archivar</Button></>}</div></CardContent></Card>)}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span>{filtered.length} cierres · Página {currentPage} de {pages}</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</Button><Button size="sm" variant="ghost" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Siguiente</Button></div></div>
    </>}
    <Drawer open={!!draft} onClose={close} title={draft?.id ? "Corregir cierre" : "Nuevo cierre manual"} description="El texto original y los datos recibidos se conservan. Ingresá los totales reales del resumen.">
      {draft && workspace && <form className="space-y-4 p-5" onSubmit={save} aria-busy={busy}><fieldset disabled={busy || !!pending || !!storageError || !workspace.canManage} className="space-y-4">
        <Field label="Sucursal"><select className={fieldClass} value={draft.branchId ?? ""} required={!draft.id} disabled={!!draft.id} onChange={e => setDraft({ ...draft, branchId: e.target.value })}><option value="">{draft.id ? "Sucursal histórica no informada" : "Elegir sucursal"}</option>{workspace.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
        <Field label="Fecha del cierre"><input className={fieldClass} type="date" required value={draft.closureDate} onChange={e => setDraft({ ...draft, closureDate: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Total bruto"><input className={fieldClass} inputMode="decimal" required value={draft.grossTotal} onChange={e => setDraft({ ...draft, grossTotal: e.target.value.replace(",", ".") })} /></Field><Field label="Total neto"><input className={fieldClass} inputMode="decimal" required value={draft.netTotal} onChange={e => setDraft({ ...draft, netTotal: e.target.value.replace(",", ".") })} /></Field></div>
        <Field label="Notas del cierre"><textarea className={fieldClass} rows={4} maxLength={4000} value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })} /></Field>
        {draft.id && <Field label="Motivo de corrección"><textarea className={fieldClass} rows={3} required maxLength={1000} value={draft.reason ?? ""} onChange={e => setDraft({ ...draft, reason: e.target.value })} /></Field>}
        <p className="text-xs text-ink-muted">Moneda no informada. Registrar este resumen no imputa ni duplica operaciones contables.</p>
      </fieldset>{operationError && <ErrorText>{operationError}</ErrorText>}<div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !!pending || !!storageError || !workspace.canManage}>{busy ? "Guardando…" : "Guardar cierre"}</Button>{pending && <Button type="button" variant="ghost" disabled={busy || !workspace.canManage || !!storageError} onClick={() => void execute(pending)}>Reintentar mismo intento</Button>}<Button type="button" variant="ghost" disabled={busy} onClick={close}>{pending ? "Cerrar y revisar" : "Cancelar"}</Button></div></form>}
    </Drawer>
    <Drawer open={!!archive} onClose={close} title="Archivar cierre" description="El registro y su historial se conservan. No se anulan ventas, gastos ni pagos relacionados.">
      {archive && workspace && <form className="space-y-4 p-5" aria-busy={busy} onSubmit={e => { e.preventDefault(); if (!reason.trim() || pendingRef.current) return; void execute({ kind: "archive", input: { requestId: crypto.randomUUID(), businessId: workspace.businessId, userId: workspace.userId, id: archive.id, expectedVersion: archive.version, reason: reason.trim() } }); }}><p>{branchName(archive)} · {archive.closure_date}</p><Field label="Motivo de archivo"><textarea required maxLength={1000} className={fieldClass} rows={3} value={reason} disabled={busy || !!pending} onChange={e => setReason(e.target.value)} /></Field>{operationError && <ErrorText>{operationError}</ErrorText>}<div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !!pending || !reason.trim() || !workspace.canManage || !!storageError}>Confirmar archivo</Button>{pending && <Button type="button" variant="ghost" disabled={busy || !workspace.canManage || !!storageError} onClick={() => void execute(pending)}>Reintentar mismo intento</Button>}<Button type="button" variant="ghost" disabled={busy} onClick={close}>{pending ? "Cerrar y revisar" : "Cancelar"}</Button></div></form>}
    </Drawer>
    <Drawer open={!!detail} onClose={() => setDetail(null)} title="Detalle e historial del cierre">
      {detail && <div className="space-y-5 p-5 text-sm"><p>{branchName(detail)} · {detail.closure_date}</p><p>Bruto: {amount(detail.gross_total)} · Neto: {amount(detail.net_total)}</p><p>Origen: {detail.source ?? "No informado"} · Estado recibido: {detail.status}</p><p className="text-xs text-ink-muted">El estado recibido pertenece al registro original; las correcciones manuales no representan una aprobación contable.</p><section><h3 className="font-semibold">Texto original conservado</h3><p className="mt-2 whitespace-pre-wrap break-words">{detail.raw_text || "Sin texto original informado."}</p></section><details className="rounded-lg border border-line p-3"><summary>Datos recibidos e inconsistencias</summary><pre className="mt-3 max-w-full overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify({ parsed: detail.parsed, inconsistencies: detail.inconsistencies }, null, 2)}</pre></details>
        <section className="space-y-3"><h3 className="font-semibold">Historial auditado</h3>{historyLoading ? <p>Cargando historial…</p> : historyError ? <ErrorText>{historyError}</ErrorText> : history.length === 0 ? <p className="text-xs text-ink-muted">No hay revisiones manuales auditadas para este registro histórico.</p> : history.map(entry => <details key={entry.request_id} className="rounded-lg border border-line p-3"><summary>{entry.operation === "archive" ? "Archivo" : entry.before_snapshot ? "Corrección" : "Creación"} · Versión {entry.result.version}</summary><div className="mt-3 space-y-2 break-words text-xs"><p>Responsable: {entry.actor_role} · {entry.created_at}</p>{entry.reason && <p>Motivo: {entry.reason}</p>}{entry.before_snapshot && <p>Antes: bruto {amount(entry.before_snapshot.gross_total)} · neto {amount(entry.before_snapshot.net_total)} · {entry.before_snapshot.closure_date}</p>}<p>Después: bruto {amount(entry.after_snapshot.gross_total)} · neto {amount(entry.after_snapshot.net_total)} · {entry.after_snapshot.closure_date}</p><p>Notas: {entry.after_snapshot.manual_note ?? "Sin notas"}</p><p>Referencia: {entry.request_id}</p></div></details>)}</section><Button variant="ghost" onClick={() => setDetail(null)}>Cerrar detalle</Button>
      </div>}
    </Drawer>
  </div>;
}
