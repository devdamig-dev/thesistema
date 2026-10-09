"use client";
import { cloneElement, isValidElement, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode, type ReactElement } from "react";
import { Download, Plus, RefreshCw } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { ChannelBar } from "@/components/charts/channel-bar";
import { SalesAreaChart } from "@/components/charts/sales-area-chart";
import { getSaleHistoryAction, getSalesWorkspaceAction, saveSaleAction, voidSaleAction } from "@/app/actions/sales";
import { getSalesPageDataAction, type SalesPageData, type SalesPeriod } from "@/app/actions/sales-page";
import { exportSalesCsvAction } from "@/app/actions/exports";
import type { SaleRecord, SaveSaleInput, SaleMutation } from "@/lib/sales/types";
import { triggerCsvDownload } from "@/lib/csv-download";
import { channelLabels, sourceLabels, localDateTime, localDateTimeToIso, periodRange } from "./reporting";
import { lineTotal, readSaleOperation, retainSaleOperation, saleJournalKey, type PendingSaleOperation } from "./operation-journal";

type Workspace = { businessId: string; userId: string; timezone: string; branches: { id: string; name: string }[]; products: { id: string; name: string; price: string | number }[]; customers: { id: string; name: string }[]; canManage: boolean; sales: SaleRecord[] };
type DraftItem = { id?: string | null; productId: string | null; description: string; quantity: string; unitPrice: string };
type Draft = { originalOccurredAt?: string; id: string | null; expectedVersion: number | null; branchId: string; occurredAt: string; channel: string; paymentMethod: string; customerId: string; notes: string; items: DraftItem[] };
const fieldClass = "w-full min-w-0 rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:opacity-60";
const amount = (value: number | string) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block min-w-0 space-y-1 text-xs text-ink-muted"><span>{label}</span>{isValidElement(children) ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, { "aria-label": label }) : children}</label>; }
function ErrorText({ children }: { children: ReactNode }) { return <p role="alert" className="rounded-lg border border-warn-500/30 bg-warn-500/10 p-3 text-sm text-ink">{children}</p>; }
function initialDraft(workspace: Workspace): Draft { return { id: null, expectedVersion: null, branchId: workspace.branches.length === 1 ? workspace.branches[0].id : "", occurredAt: "", channel: "salon", paymentMethod: "", customerId: "", notes: "", items: [{ productId: null, description: "", quantity: "1", unitPrice: "" }] }; }
export default function DatabaseSales() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true); const [loadError, setLoadError] = useState("");
  const [report, setReport] = useState<SalesPageData | null>(null); const [reportError, setReportError] = useState(""); const [reportLoading, setReportLoading] = useState(true);
  const [period, setPeriod] = useState<SalesPeriod>("current_month"); const [branch, setBranch] = useState(""); const [status, setStatus] = useState("all"); const [revision, setRevision] = useState(0); const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<SaleRecord | null>(null);
  const [history, setHistory] = useState<SaleMutation[]>([]); const [historyLoading, setHistoryLoading] = useState(false); const [historyError, setHistoryError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null); const [voidTarget, setVoidTarget] = useState<SaleRecord | null>(null); const [reason, setReason] = useState("");
  const [pending, setPending] = useState<PendingSaleOperation | null>(null); const pendingRef = useRef<PendingSaleOperation | null>(null);
  const [busy, setBusy] = useState(false); const lock = useRef(false); const [operationError, setOperationError] = useState(""); const [notice, setNotice] = useState(""); const [storageError, setStorageError] = useState(""); const [exporting, setExporting] = useState(false);
  const contextKey = useRef(""); const generation = useRef(0); const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const request = ++generation.current; setLoading(true); setLoadError("");
    try {
      const result = await getSalesWorkspaceAction();
      if (!mounted.current || request !== generation.current) return;
      if (!result.ok) { setWorkspace(null); setLoadError(result.error); setDraft(null); setVoidTarget(null); setDetail(null); contextKey.current = ""; return; }
      const data = result.data as Workspace; const key = saleJournalKey(data.businessId, data.userId);
      if (contextKey.current !== key) {
        contextKey.current = key; setDetail(null); setDraft(null); setVoidTarget(null); setReason(""); setOperationError(""); setNotice(""); setBranch(""); setPage(1); lock.current = false; setBusy(false); setStorageError("");
      }
      try { const saved = readSaleOperation(sessionStorage.getItem(key), data.businessId, data.userId); pendingRef.current = saved; setPending(saved); }
      catch { pendingRef.current = null; setPending(null); setStorageError("No pudimos recuperar la operación de esta pestaña. Las nuevas cargas están bloqueadas para evitar duplicados."); }
      setDetail((current) => current ? data.sales.find((sale) => sale.id === current.id) ?? null : null);
      setWorkspace(data);
    } catch { if (mounted.current && request === generation.current) { setLoadError("No pudimos cargar los registros. Reintentá para recuperar los datos reales."); setWorkspace(null); } }
    finally { if (mounted.current && request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { mounted.current = true; void refresh(); const focus = () => { void refresh(); setRevision((v) => v + 1); }; const visible = () => { if (document.visibilityState === "visible") focus(); }; window.addEventListener("focus", focus); document.addEventListener("visibilitychange", visible); return () => { mounted.current = false; window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visible); }; }, [refresh]);
  useEffect(() => {
    if (!workspace) { setReport(null); setReportLoading(false); return; }
    let cancelled = false; setReportLoading(true); setReportError(""); setReport(null);
    void getSalesPageDataAction(period, branch || null).then((result) => { if (cancelled) return; if (result.ok) setReport(result.data); else setReportError(result.error); }).catch(() => { if (!cancelled) setReportError("No pudimos cargar el informe completo."); }).finally(() => { if (!cancelled) setReportLoading(false); });
    return () => { cancelled = true; };
  }, [workspace, period, branch, revision]);
  useEffect(() => {
    setHistory([]); setHistoryError("");
    if (!detail || !workspace) { setHistoryLoading(false); return; }
    let cancelled = false; setHistoryLoading(true);
    void getSaleHistoryAction(detail.id).then((result) => { if (cancelled) return; if (result.ok) setHistory(result.history); else setHistoryError(result.error); }).catch(() => { if (!cancelled) setHistoryError("No pudimos leer el historial completo."); }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [detail, workspace]);
  function close() { if (lock.current) return; setDraft(null); setVoidTarget(null); setOperationError(""); }
  const canStart = !!workspace?.canManage && !loading && !busy && !pending && !storageError;
  function edit(sale?: SaleRecord) {
    if (!workspace || !canStart || (sale && (sale.status !== "active" || sale.sale_kind !== "detailed"))) return;
    setOperationError(""); setNotice(""); setVoidTarget(null);
    setDraft(sale ? { originalOccurredAt: sale.occurred_at, id: sale.id, expectedVersion: sale.version, branchId: sale.branch_id ?? "", occurredAt: localDateTime(sale.occurred_at, workspace.timezone), channel: sale.channel, paymentMethod: sale.payment_method ?? "", customerId: sale.customer_id ?? "", notes: sale.notes ?? "", items: sale.items.map((item) => ({ id: item.id, productId: item.product_id, description: item.description, quantity: String(item.quantity), unitPrice: String(item.unit_price) })) } : initialDraft(workspace));
  }
  async function execute(proposed: PendingSaleOperation) {
    if (!workspace || lock.current || !workspace.canManage || storageError) return;
    lock.current = true; setBusy(true); setOperationError(""); setNotice("");
    const key = contextKey.current; const isRecovery = pendingRef.current !== null;
    let frozen: PendingSaleOperation;
    try { frozen = retainSaleOperation(pendingRef.current, proposed); sessionStorage.setItem(key, JSON.stringify(frozen)); pendingRef.current = frozen; setPending(frozen); }
    catch { setStorageError("No pudimos conservar el intento. No se enviaron cambios; permití el almacenamiento de esta aplicación y recargá."); lock.current = false; setBusy(false); return; }
    try {
      const result = frozen.kind === "save" ? await saveSaleAction(frozen.input) : await voidSaleAction(frozen.input);
      if (result.ok || (result.persisted === false && !isRecovery)) {
        try { sessionStorage.removeItem(key); } catch { if (key === contextKey.current) setStorageError("El resultado está confirmado, pero no pudimos limpiar su referencia local. Recargá para verificarla antes de continuar."); }
      }
      if (!mounted.current || key !== contextKey.current) return;
      if (result.ok) {
        pendingRef.current = null; setPending(null); setDraft(null); setVoidTarget(null); setNotice(frozen.kind === "save" ? "Venta guardada. El informe se está actualizando." : "Venta anulada. Ya no suma en los reportes.");
        await refresh(); setRevision((v) => v + 1);
      } else {
        if (result.persisted === false && !isRecovery) { pendingRef.current = null; setPending(null); }
        setOperationError(isRecovery ? `${result.error} El intento anterior sigue pendiente de confirmar; conservamos su referencia.` : result.error);
        if (result.persisted === false) { await refresh(); setRevision((v) => v + 1); }
      }
    } catch { if (mounted.current && key === contextKey.current) setOperationError("No pudimos confirmar el resultado. Conservamos el mismo intento para verificarlo sin duplicar la operación."); }
    finally { if (mounted.current && key === contextKey.current) { lock.current = false; setBusy(false); } }
  }
  function save(event: FormEvent) {
    event.preventDefault(); if (!workspace || !draft || lock.current || pendingRef.current) return;
    try {
      if (!draft.branchId) throw new Error("Elegí una sucursal.");
      if (!draft.items.length || draft.items.some((item) => !item.description.trim() || lineTotal(item.quantity, item.unitPrice) === null)) throw new Error("Completá cada concepto, cantidad positiva y precio con hasta dos decimales.");
      const input: SaveSaleInput = { requestId: crypto.randomUUID(), businessId: workspace.businessId, userId: workspace.userId, id: draft.id, expectedVersion: draft.expectedVersion, branchId: draft.branchId, occurredAt: draft.originalOccurredAt && localDateTime(draft.originalOccurredAt, workspace.timezone) === draft.occurredAt ? draft.originalOccurredAt : localDateTimeToIso(draft.occurredAt, workspace.timezone), channel: draft.channel as SaveSaleInput["channel"], paymentMethod: draft.paymentMethod.trim(), customerId: draft.customerId || null, notes: draft.notes.trim() || null, items: draft.items.map((item) => ({ ...item, description: item.description.trim() })) };
      void execute({ kind: "save", input });
    } catch (error) { setOperationError(error instanceof Error ? error.message : "Revisá los datos de la venta."); }
  }
  async function exportRows() {
    if (exporting) return; setExporting(true);
    try { const result = await exportSalesCsvAction(period, branch || null); if (result.ok) { triggerCsvDownload(result.filename, result.content); setNotice(`Exportación lista: ${result.rows} registros activos.`); } else setNotice(result.error); }
    catch { setNotice("No pudimos exportar las ventas."); } finally { setExporting(false); }
  }
  const range = workspace ? periodRange(period, workspace.timezone) : null;
  const filtered = (workspace?.sales ?? []).filter((sale) => (!branch || sale.branch_id === branch) && (status === "all" || sale.status === status) && (!range || (new Date(sale.occurred_at) >= new Date(range.start) && new Date(sale.occurred_at) < new Date(range.end))));
  const pages = Math.max(1, Math.ceil(filtered.length / 20)); const currentPage = Math.min(page, pages); const rows = filtered.slice((currentPage - 1) * 20, currentPage * 20);
  const total = report?.totalAmount ?? 0;
  const draftTotal = draft?.items.reduce((sum, item) => sum + (lineTotal(item.quantity, item.unitPrice) ?? 0), 0) ?? 0;
  return <div className="space-y-6">
    <SectionHeader eyebrow="Ventas" title="Registrá y analizá tus ventas" description="Cargá ventas manualmente y consultá su origen, detalle e historial. Moneda no informada." actions={<><Button size="sm" variant="ghost" onClick={() => { void refresh(); setRevision((v) => v + 1); }} disabled={loading || busy}><RefreshCw className="h-4 w-4" />Actualizar</Button><Button size="sm" variant="ghost" onClick={() => void exportRows()} disabled={!workspace || exporting || loading}><Download className="h-4 w-4" />Exportar ventas</Button><Button size="sm" onClick={() => edit()} disabled={!canStart}><Plus className="h-4 w-4" />Nueva venta</Button></>} />
    {loading && <p role="status" className="text-sm text-ink-muted">Cargando ventas…</p>}
    {loadError && <ErrorText>{loadError}</ErrorText>}
    {notice && <p role="status" className="rounded-lg border border-line p-3 text-sm">{notice}</p>}
    {storageError && <ErrorText>{storageError}</ErrorText>}
    {pending && <div className="space-y-2 rounded-xl border border-warn-500/30 p-4"><p className="text-sm">Hay una operación pendiente de confirmar. Conservamos su contenido y referencia; las nuevas operaciones están bloqueadas.</p><p className="break-all text-xs text-ink-muted">Referencia: {pending.input.requestId}</p><Button size="sm" onClick={() => void execute(pending)} disabled={busy || !workspace?.canManage || !!storageError}>Reintentar mismo intento</Button></div>}
    {operationError && !draft && !voidTarget && <ErrorText>{operationError}</ErrorText>}
    {workspace && <>
      {!workspace.canManage && <p className="text-sm text-ink-muted">Tu rol permite consultar ventas, pero no cargarlas, editarlas ni anularlas.</p>}
      <div className="grid gap-3 sm:grid-cols-3"><Field label="Período de ventas"><select className={fieldClass} value={period} onChange={(event) => { setPeriod(event.target.value as SalesPeriod); setPage(1); }}><option value="current_month">Mes actual</option><option value="previous_month">Mes anterior</option><option value="last_30_days">Últimos 30 días</option></select></Field><Field label="Filtrar por sucursal"><select className={fieldClass} value={branch} onChange={(event) => { setBranch(event.target.value); setPage(1); }}><option value="">Todas las sucursales permitidas</option>{workspace.branches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></Field><Field label="Estado de los registros"><select className={fieldClass} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">Activas y anuladas</option><option value="active">Activas</option><option value="voided">Anuladas</option></select></Field></div>
      {reportLoading ? <p role="status" className="text-sm text-ink-muted">Actualizando indicadores…</p> : reportError ? <ErrorText>{reportError}</ErrorText> : report && <>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[["Ventas activas", amount(total)], ["Registros activos", report.totalRecords.toLocaleString("es-AR")], ["Tickets detallados", report.totalTickets.toLocaleString("es-AR")], ["Promedio de tickets detallados", report.averageTicket === null ? "Sin detalle suficiente" : amount(report.averageTicket)]].map(([label, value]) => <Card key={label}><CardContent className="p-4"><p className="text-xs text-ink-muted">{label}</p><p className="mt-2 break-words text-xl font-semibold">{value}</p></CardContent></Card>)}</div>
        <p className="text-xs text-ink-muted">Importes en moneda no informada. Las anuladas no suman. Los resúmenes y registros históricos suman importes, pero no se consideran tickets individuales. No hay costos ni margen confirmados.</p>
        <div className="grid gap-4 lg:grid-cols-2"><Card><CardHeader><CardTitle>Ventas por día</CardTitle></CardHeader><CardContent>{report.salesByDay.length ? <SalesAreaChart data={report.salesByDay} currencyKnown={false} /> : <p className="text-sm text-ink-muted">Sin ventas en este período.</p>}</CardContent></Card><Card><CardHeader><CardTitle>Ventas por canal</CardTitle></CardHeader><CardContent>{report.salesByChannel.length ? <ChannelBar data={report.salesByChannel} currencyKnown={false} /> : <p className="text-sm text-ink-muted">Sin ventas por canal.</p>}</CardContent></Card></div>
      </>}
      <Card><CardHeader><div><CardTitle>Registro de ventas</CardTitle><p className="mt-1 text-xs text-ink-muted">Fechas en {workspace.timezone}. El consumo por receta es teórico; no modifica existencias.</p></div></CardHeader><CardContent>
        {!rows.length ? <p className="py-8 text-center text-sm text-ink-muted">No hay ventas registradas para estos filtros.</p> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-line text-xs text-ink-muted"><tr>{["Fecha / sucursal", "Detalle", "Importe", "Origen / estado", "Acciones"].map((label) => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map((sale) => <tr className="border-b border-line/60 align-top" key={sale.id}><td className="p-3"><p>{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: workspace.timezone }).format(new Date(sale.occurred_at))}</p><p className="text-xs text-ink-muted">{workspace.branches.find((item) => item.id === sale.branch_id)?.name ?? "Sucursal no informada"}</p></td><td className="max-w-xs p-3"><p>{channelLabels[sale.channel] ?? sale.channel}</p><p className="text-xs text-ink-muted">{sale.sale_kind === "detailed" ? sale.items.map((item) => `${item.quantity} × ${item.description}`).join(" · ") : sale.sale_kind === "summary" ? "Resumen agregado · sin tickets individuales" : "Registro histórico · detalle no informado"}</p>{sale.payment_method && <p className="text-xs">{sale.payment_method}</p>}{sale.customer_id && <p className="text-xs">Cliente: {workspace.customers.find((item) => item.id === sale.customer_id)?.name ?? "Cliente relacionado"}</p>}{sale.notes && <p className="mt-1 break-words text-xs text-ink-muted">{sale.notes}</p>}</td><td className="p-3 tabular-nums">{amount(sale.amount)}</td><td className="p-3"><p>{sale.source ? sourceLabels[sale.source] ?? sale.source : "Origen no informado"}</p><p className={sale.status === "voided" ? "text-warn-400" : "text-success-400"}>{sale.status === "voided" ? "Anulada" : "Activa"}</p>{sale.void_reason && <p className="max-w-xs break-words text-xs text-ink-muted">{sale.void_reason}</p>}</td><td className="p-3"><div className="flex flex-wrap gap-2"><Button size="sm" variant="ghost" onClick={() => setDetail(sale)}>Detalle</Button>{sale.sale_kind === "detailed" && sale.status === "active" && <Button size="sm" variant="ghost" disabled={!canStart} onClick={() => edit(sale)}>Editar</Button>}{sale.status === "active" && <Button size="sm" variant="ghost" disabled={!canStart} onClick={() => { if (!canStart) return; setVoidTarget(sale); setDraft(null); setReason(""); setOperationError(""); }}>Anular</Button>}</div></td></tr>)}</tbody></table></div>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted"><span>{filtered.length} registros · Página {currentPage} de {pages}</span><div className="flex gap-2"><Button size="sm" variant="ghost" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Anterior</Button><Button size="sm" variant="ghost" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Siguiente</Button></div></div>
      </CardContent></Card>
    </>}
    <Drawer open={!!draft} onClose={close} title={draft?.id ? "Editar venta" : "Nueva venta manual"} description={workspace ? `Fecha y hora en ${workspace.timezone} · Moneda no informada` : ""} width="max-w-2xl">
      {draft && workspace && <form onSubmit={save} className="space-y-4 p-5" aria-busy={busy}><fieldset disabled={busy || !!pending || !workspace.canManage || !!storageError} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Fecha y hora"><input type="datetime-local" step="1" className={fieldClass} value={draft.occurredAt} onChange={(event) => setDraft({ ...draft, occurredAt: event.target.value })} required /></Field><Field label="Sucursal"><select required className={fieldClass} value={draft.branchId} onChange={(event) => setDraft({ ...draft, branchId: event.target.value })}><option value="">Elegir sucursal</option>{workspace.branches.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><Field label="Canal"><select className={fieldClass} value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value })}>{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Medio de pago"><input className={fieldClass} required maxLength={80} placeholder="Efectivo, transferencia…" value={draft.paymentMethod} onChange={(event) => setDraft({ ...draft, paymentMethod: event.target.value })} /></Field><Field label="Cliente (opcional)"><select className={fieldClass} value={draft.customerId} onChange={(event) => setDraft({ ...draft, customerId: event.target.value })}><option value="">Sin cliente</option>{draft.customerId && !workspace.customers.some((item) => item.id === draft.customerId) && <option value={draft.customerId}>Cliente relacionado (inactivo)</option>}{workspace.customers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field></div>
        <div className="space-y-3">{draft.items.map((item, index) => <div className="space-y-3 rounded-xl border border-line p-3" key={index}><Field label={`Producto ${index + 1}`}><select className={fieldClass} value={item.productId ?? ""} onChange={(event) => { const product = workspace.products.find((p) => p.id === event.target.value); setDraft({ ...draft, items: draft.items.map((current, i) => i !== index ? current : { ...current, productId: product?.id ?? null, description: product?.name ?? "", unitPrice: product ? String(product.price) : "" }) }); }}><option value="">Concepto libre</option>{item.productId && !workspace.products.some((p) => p.id === item.productId) && <option value={item.productId}>Producto relacionado (inactivo)</option>}{workspace.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></Field><Field label={`Concepto ${index + 1}`}><input required maxLength={200} className={fieldClass} value={item.description} onChange={(event) => setDraft({ ...draft, items: draft.items.map((current, i) => i !== index ? current : { ...current, description: event.target.value }) })} /></Field><div className="grid grid-cols-2 gap-3"><Field label={`Cantidad ${index + 1}`}><input required inputMode="decimal" className={fieldClass} value={item.quantity} onChange={(event) => setDraft({ ...draft, items: draft.items.map((current, i) => i !== index ? current : { ...current, quantity: event.target.value.replace(",", ".") }) })} /></Field><Field label={`Precio unitario ${index + 1}`}><input required inputMode="decimal" className={fieldClass} value={item.unitPrice} onChange={(event) => setDraft({ ...draft, items: draft.items.map((current, i) => i !== index ? current : { ...current, unitPrice: event.target.value.replace(",", ".") }) })} /></Field></div><div className="flex items-center justify-between gap-2"><span className="text-sm">Subtotal: {lineTotal(item.quantity, item.unitPrice) === null ? "—" : amount(lineTotal(item.quantity, item.unitPrice)!)}</span><Button type="button" variant="ghost" size="sm" disabled={draft.items.length === 1} onClick={() => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })}>Quitar ítem {index + 1}</Button></div></div>)}<Button type="button" variant="ghost" size="sm" disabled={draft.items.length >= 100} onClick={() => setDraft({ ...draft, items: [...draft.items, { productId: null, description: "", quantity: "1", unitPrice: "" }] })}>Agregar ítem</Button></div>
        <Field label="Notas (opcional)"><textarea className={fieldClass} rows={3} maxLength={2000} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} /></Field><p className="text-lg font-semibold">Total: {amount(draftTotal)}</p><p className="text-xs text-ink-muted">Moneda no informada. Las recetas quedan como consumo teórico; esta venta no descuenta stock físico.</p>
      </fieldset>{operationError && <ErrorText>{operationError}</ErrorText>}<div className="flex flex-wrap gap-2"><Button type="submit" disabled={busy || !!pending || !workspace.canManage || !!storageError}>{busy ? "Guardando…" : "Guardar venta"}</Button>{pending && <Button type="button" variant="ghost" disabled={busy || !workspace.canManage || !!storageError} onClick={() => void execute(pending)}>Reintentar mismo intento</Button>}<Button type="button" variant="ghost" disabled={busy} onClick={close}>{pending ? "Cerrar y revisar" : "Cancelar"}</Button></div></form>}
    </Drawer>
    <Drawer open={!!voidTarget} onClose={close} title="Anular venta" description="La venta y su detalle se conservan para auditoría; deja de sumar en los reportes.">
      {voidTarget && workspace && <form className="space-y-4 p-5" aria-busy={busy} onSubmit={(event) => { event.preventDefault(); if (pendingRef.current || !reason.trim()) return; void execute({ kind: "void", input: { requestId: crypto.randomUUID(), businessId: workspace.businessId, userId: workspace.userId, id: voidTarget.id, expectedVersion: voidTarget.version, reason: reason.trim() } }); }}><p className="text-lg font-semibold">Importe: {amount(voidTarget.amount)}</p><Field label="Motivo obligatorio"><textarea required className={fieldClass} rows={3} maxLength={1000} disabled={busy || !!pending} value={reason} onChange={(event) => setReason(event.target.value)} /></Field>{operationError && <ErrorText>{operationError}</ErrorText>}<div className="flex gap-2"><Button type="submit" disabled={busy || !!pending || !reason.trim() || !workspace.canManage || !!storageError}>Confirmar anulación</Button>{pending && <Button type="button" variant="ghost" disabled={busy || !workspace.canManage || !!storageError} onClick={() => void execute(pending)}>Reintentar mismo intento</Button>}<Button type="button" variant="ghost" disabled={busy} onClick={close}>{pending ? "Cerrar y revisar" : "Cancelar"}</Button></div></form>}
    </Drawer>
    <Drawer open={!!detail} onClose={() => setDetail(null)} title="Detalle de venta" description={workspace ? `Fecha y hora en ${workspace.timezone} · Moneda no informada` : ""} width="max-w-2xl">
      {detail && workspace && <div className="space-y-5 p-5">
        <dl className="grid grid-cols-2 gap-3 text-sm">{[
          ["Fecha", new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium", timeZone: workspace.timezone }).format(new Date(detail.occurred_at))],
          ["Sucursal", workspace.branches.find((item) => item.id === detail.branch_id)?.name ?? "No informada"],
          ["Origen", detail.source ? sourceLabels[detail.source] ?? detail.source : "No informado"],
          ["Canal", channelLabels[detail.channel] ?? detail.channel],
          ["Medio de pago", detail.payment_method ?? "No informado"],
          ["Cliente", detail.customer_id ? workspace.customers.find((item) => item.id === detail.customer_id)?.name ?? "Cliente relacionado" : "No informado"],
          ["Estado", detail.status === "voided" ? "Anulada" : "Activa"], ["Versión", String(detail.version)],
        ].map(([label, value]) => <div key={label}><dt className="text-xs text-ink-muted">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>)}</dl>
        {detail.sale_kind !== "detailed" && <p className="rounded-lg border border-line p-3 text-sm">{detail.sale_kind === "summary" ? "Resumen agregado: no se conoce la cantidad de tickets ni los productos vendidos." : "Registro histórico sin detalle confirmado. No se atribuyen cantidades, productos ni recetas."}</p>}
        {detail.items.map((item) => <div className="space-y-3 rounded-xl border border-line p-4" key={item.id}>
          <h3 className="font-medium">{item.description}</h3><p className="text-sm">{item.quantity} × {amount(item.unit_price)} = {amount(item.total)}</p>
          <div className="text-xs text-ink-muted"><p className="font-medium">Composición registrada al guardar</p>
            {!item.recipe_snapshot || item.recipe_snapshot.state === "none" ? <p className="mt-1">Sin receta registrada.</p> : <><p className="mt-1">{item.recipe_snapshot.state === "complete" ? "Consumo teórico calculado" : "Receta incompleta: hay consumos sin calcular"}</p><ul className="mt-2 space-y-1">{item.recipe_snapshot.ingredients.map((ingredient, index) => <li key={`${ingredient.ingredientId ?? "unknown"}:${index}`}>{ingredient.name}: {ingredient.theoreticalQuantity ?? "Cantidad no calculada"}{ingredient.theoreticalQuantity !== null && ingredient.baseUnit ? ` ${ingredient.baseUnit}` : ""}</li>)}</ul></>}
          </div>
        </div>)}
        <p className="text-lg font-semibold">Total: {amount(detail.amount)}</p><p className="text-xs text-ink-muted">Moneda no informada. El consumo teórico no equivale a una salida de stock físico.</p>
        {detail.notes && <div><p className="text-xs text-ink-muted">Notas</p><p className="whitespace-pre-wrap break-words text-sm">{detail.notes}</p></div>}
        {detail.void_reason && <div className="rounded-lg border border-warn-500/30 p-3"><p className="text-sm font-medium">Motivo de anulación</p><p className="break-words text-sm">{detail.void_reason}</p>{detail.voided_at && <p className="mt-1 text-xs text-ink-muted">{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium", timeZone: workspace.timezone }).format(new Date(detail.voided_at))}</p>}</div>}
        <section className="space-y-3"><h3 className="font-semibold">Historial auditado</h3>
          {historyLoading ? <p role="status" className="text-sm text-ink-muted">Cargando historial…</p> : historyError ? <ErrorText>{historyError}</ErrorText> : history.length === 0 ? <p className="text-sm text-ink-muted">No hay revisiones auditadas disponibles para este registro histórico.</p> : history.map((entry) => <details className="rounded-xl border border-line p-3 text-sm" key={entry.request_id}><summary className="cursor-pointer font-medium">{entry.operation === "void" ? "Anulación" : entry.before_snapshot ? "Edición" : "Creación"} · Versión {entry.result.version} · {new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: workspace.timezone }).format(new Date(entry.created_at))}</summary><div className="mt-3 space-y-2 text-xs text-ink-muted">
            <p>{sourceLabels[entry.source] ?? "Origen no informado"} · Rol del responsable: {entry.actor_role}</p>
            {entry.before_snapshot && <p>Importe anterior: {typeof entry.before_snapshot.sale.amount === "string" || typeof entry.before_snapshot.sale.amount === "number" ? amount(entry.before_snapshot.sale.amount) : "No informado"}</p>}
            <p>Importe de esta versión: {typeof entry.after_snapshot.sale.amount === "string" || typeof entry.after_snapshot.sale.amount === "number" ? amount(entry.after_snapshot.sale.amount) : "No informado"}</p>
            <p>Estado de esta versión: {entry.after_snapshot.sale.status === "voided" ? "Anulada" : "Activa"}</p>
            {typeof entry.after_snapshot.sale.notes === "string" && <p className="whitespace-pre-wrap break-words">Notas: {entry.after_snapshot.sale.notes}</p>}
            {typeof entry.after_snapshot.sale.void_reason === "string" && <p className="break-words">Motivo: {entry.after_snapshot.sale.void_reason}</p>}
            {entry.after_snapshot.items.map((item) => <div key={item.id}><p>{item.quantity} × {item.description} · Precio {amount(item.unit_price)} · Subtotal {amount(item.total)}</p>{item.recipe_snapshot && item.recipe_snapshot.state !== "none" && <ul className="ml-3 list-disc">{item.recipe_snapshot.ingredients.map((ingredient, index) => <li key={index}>Consumo teórico: {ingredient.name} · {ingredient.theoreticalQuantity ?? "Sin calcular"}{ingredient.theoreticalQuantity !== null && ingredient.baseUnit ? ` ${ingredient.baseUnit}` : ""}</li>)}</ul>}</div>)}
          </div></details>)}
        </section>
        <Button variant="ghost" onClick={() => setDetail(null)}>Cerrar detalle</Button>
      </div>}
    </Drawer>
  </div>;
}
