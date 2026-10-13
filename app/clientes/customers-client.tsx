"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Archive, Loader2, Pencil, Plus, RotateCcw, UserSquare2 } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getCustomersPageDataAction, type CustomersPageResult } from "@/app/actions/customers-page";
import { getCustomerSalesHistoryAction, type CustomerSalesHistoryResult } from "@/app/actions/customer-history";
import { saveCustomerAction } from "@/app/actions/customers";
import { validateCustomerInput, type CustomerInput, type CustomerRow } from "@/lib/customers/validation";

const inputClass = "mt-1 w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink";
const EMPTY: CustomerInput = { id: null, expectedUpdatedAt: null, name: "", phone: null, email: null, channel: null, notes: null, active: true };
function asInput(row: CustomerRow): CustomerInput {
  const { updatedAt, ...fields } = row;
  return { ...fields, expectedUpdatedAt: updatedAt };
}
function CustomerDialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-labelledby="customer-dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
    className="w-[calc(100%-2rem)] max-w-xl rounded-2xl border border-line bg-bg-elevated p-6 text-ink shadow-2xl backdrop:bg-black/60">
    <div className="mb-5 flex items-center justify-between gap-3"><h2 id="customer-dialog-title" className="text-lg font-semibold">{title}</h2>
      <Button type="button" size="sm" disabled={busy} onClick={onClose}>Cerrar</Button></div>{children}
  </dialog>;
}
export function CustomersClient({ databaseMode, initial }: { databaseMode: boolean; initial: CustomersPageResult }) {
  const [result, setResult] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const verificationRef = useRef(false);
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [form, setForm] = useState<CustomerInput | null>(null);
  const [changeStatus, setChangeStatus] = useState<CustomerRow | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [historyCustomer, setHistoryCustomer] = useState<CustomerRow | null>(null);
  const [historyResult, setHistoryResult] = useState<CustomerSalesHistoryResult | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setHistoryResult(null);
    if (!historyCustomer || !databaseMode) { setHistoryLoading(false); return; }
    setHistoryLoading(true);
    void getCustomerSalesHistoryAction(historyCustomer.id).then(value => { if (!cancelled) setHistoryResult(value); }).catch(() => { if (!cancelled) setHistoryResult({ ok: false, error: "No pudimos leer el historial completo." }); }).finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [historyCustomer, databaseMode]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("active");
  const data = result.ok ? result.data : null;
  const rows = data?.customers ?? [];
  const filtered = rows.filter((row) => (status === "all" || row.active === (status === "active"))
    && [row.name, row.phone, row.email, row.channel].some((value) => value?.toLocaleLowerCase().includes(search.toLocaleLowerCase())));

  async function reload() {
    if (!databaseMode) return;
    setHistoryCustomer(null);
    setLoading(true);
    try {
      const loaded = await getCustomersPageDataAction();
      setResult(loaded);
      if (loaded.ok) { verificationRef.current = false; setVerificationRequired(false); }
    }
    catch { setResult({ ok: false, error: "No pudimos cargar los clientes reales. Revisá tu conexión e intentá recargar." }); }
    finally { setLoading(false); }
  }
  async function save(input: CustomerInput) {
    if (busyRef.current || verificationRef.current) return;
    const validation = validateCustomerInput(input);
    if (!validation.ok) { setFormError(validation.error); return; }
    busyRef.current = true; setBusy(true); setFormError(null); setMessage(null);
    try {
      if (databaseMode) {
        const saved = await saveCustomerAction(validation.value);
        if (!saved.ok) {
          if (saved.persisted === "unknown") { verificationRef.current = true; setVerificationRequired(true); }
          setFormError(saved.error); return;
        }
        setForm(null); setChangeStatus(null);
        setMessage("Cliente guardado. El cambio quedó registrado en auditoría.");
        await reload();
      } else if (data) {
        const { expectedUpdatedAt: _token, id, ...fields } = validation.value;
        const row: CustomerRow = { ...fields, id: id ?? crypto.randomUUID(), updatedAt: new Date().toISOString() };
        setResult({ ok: true, data: { ...data, customers: id ? rows.map((item) => item.id === id ? row : item) : [...rows, row] } });
        setForm(null); setChangeStatus(null); setMessage("Cambio de demostración. No se guardó en una base de datos y se pierde al recargar.");
      }
    } catch {
      verificationRef.current = true; setVerificationRequired(true);
      setFormError("Se interrumpió la conexión. Cerrá el formulario y recargá para comprobar si el cambio se guardó antes de reintentar.");
    } finally { busyRef.current = false; setBusy(false); }
  }

  function closeEditor() {
    if (busyRef.current) return;
    setForm(null); setChangeStatus(null);
    if (verificationRef.current) void reload();
  }

  return <div className="space-y-6">
    <SectionHeader eyebrow="Clientes" title="Clientes del negocio" description="Gestioná nombres, datos de contacto y notas. El archivo conserva el registro. Esta base de clientes se comparte entre las sucursales del negocio."
      actions={data?.canManage ? <Button variant="primary" size="sm" disabled={loading || busy || verificationRequired} onClick={() => { setForm({ ...EMPTY }); setFormError(null); }}><Plus className="h-4 w-4" />Nuevo cliente</Button> : undefined} />
    {!databaseMode && <p className="rounded-lg border border-line p-3 text-sm text-ink-muted">Modo demo: datos de ejemplo. Los cambios sólo duran mientras permanezcas en esta página.</p>}
    {message && <p role="status" className="rounded-lg border border-line p-3 text-sm text-ink">{message}</p>}
    {!result.ok && <div role="alert" className="rounded-lg border border-warn-500/30 p-4"><p>{result.error}</p><p className="mt-1 text-sm text-ink-muted">No mostramos datos de ejemplo en el negocio real.</p></div>}
    {databaseMode && <Button size="sm" disabled={loading || busy} onClick={() => void reload()}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}Recargar clientes</Button>}
    {data && <>
      <div className="grid grid-cols-2 gap-4"><KpiCard label="Activos en esta lista" value={String(rows.filter((row) => row.active).length)} tone="brand" /><KpiCard label="Archivados en esta lista" value={String(rows.filter((row) => !row.active).length)} /></div>
      {data.truncated && <p role="status" className="text-sm text-warn-500">Se muestran los primeros {rows.length} clientes por nombre. Los conteos y la búsqueda corresponden a esta lista.</p>}
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><UserSquare2 className="h-4 w-4" />Directorio</CardTitle>{!data.canManage && <Badge>Solo lectura</Badge>}</CardHeader>
        <CardContent><div className="flex flex-col gap-3 sm:flex-row"><label className="flex-1 text-xs text-ink-muted">Buscar en la lista<input className={inputClass} type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nombre, teléfono, email o canal" /></label><label className="text-xs text-ink-muted">Estado<select aria-label="Estado" className={inputClass} value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Activos</option><option value="archived">Archivados</option><option value="all">Todos</option></select></label></div></CardContent>
        {filtered.length === 0 ? <CardContent><p className="rounded-lg border border-dashed border-line p-6 text-center text-sm text-ink-muted">{rows.length ? "No hay clientes que coincidan con estos filtros." : "Todavía no hay clientes registrados."}</p></CardContent>
          : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-y border-line bg-bg-subtle text-xs text-ink-muted"><tr><th className="px-5 py-3">Cliente</th><th className="px-5 py-3">Contacto</th><th className="px-5 py-3">Canal</th><th className="px-5 py-3">Estado</th>{data.canManage && <th className="px-5 py-3">Acciones</th>}</tr></thead><tbody>
            {filtered.map((row) => <tr key={row.id} className="border-b border-line/60 align-top last:border-0"><td className="px-5 py-3"><p className="font-medium">{row.name}</p>{databaseMode && <Button size="sm" variant="ghost" aria-label={`Historial de ventas de ${row.name}`} onClick={() => setHistoryCustomer(row)}>Ver ventas relacionadas</Button>}{row.notes && <p className="mt-1 max-w-sm whitespace-pre-wrap break-words text-xs text-ink-muted">{row.notes}</p>}</td><td className="px-5 py-3"><p className="break-all">{row.email || "Sin email"}</p><p className="text-xs text-ink-muted">{row.phone || "Sin teléfono"}</p></td><td className="px-5 py-3">{row.channel || "Sin canal"}</td><td className="px-5 py-3"><Badge tone={row.active ? "success" : "default"}>{row.active ? "Activo" : "Archivado"}</Badge></td>{data.canManage && <td className="px-5 py-3"><div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || loading || verificationRequired} aria-label={`Editar ${row.name}`} onClick={() => { setForm(asInput(row)); setFormError(null); }}><Pencil className="h-3 w-3" />Editar</Button><Button size="sm" disabled={busy || loading || verificationRequired} aria-label={`${row.active ? "Archivar" : "Restaurar"} ${row.name}`} onClick={() => { setChangeStatus(row); setFormError(null); }}>{row.active ? <Archive className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}{row.active ? "Archivar" : "Restaurar"}</Button></div></td>}</tr>)}
          </tbody></table></div>}
      </Card>
      <p className="text-xs text-ink-muted">Las ventas cargadas con un cliente quedan vinculadas y se pueden consultar en Ventas. No se calculan visitas, gasto ni ticket promedio a partir de registros sin vincular.</p>
    </>}
    {historyCustomer && <CustomerDialog title={`Ventas de ${historyCustomer.name}`} busy={false} onClose={() => setHistoryCustomer(null)}>
      <p className="mb-3 text-sm text-ink-muted">Sólo ventas vinculadas a este cliente, en las sucursales que podés consultar. Moneda no informada; las anuladas se conservan como historial.</p>
      {historyLoading && <p role="status">Cargando historial…</p>}
      {historyResult && !historyResult.ok && <p role="alert" className="text-sm text-warn-500">{historyResult.error}</p>}
      {historyResult?.ok && (historyResult.rows.length ? <div className="max-h-[60vh] space-y-3 overflow-y-auto">{historyResult.rows.map(sale => <div key={sale.id} className="rounded-lg border border-line p-3 text-sm">
        <p className="font-medium">{new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: historyResult.timezone }).format(new Date(sale.occurredAt))} · {sale.branch}</p>
        <p className="break-words">{sale.description}</p><p>{new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(sale.amount))} · {sale.status === "voided" ? "Anulada" : "Activa"}</p>
        <p className="text-xs text-ink-muted">Origen: {({ manual: "Carga manual", whatsapp: "WhatsApp", inbox: "Inbox", ocr: "Factura OCR", api: "API", system: "Sistema" } as Record<string, string>)[sale.source ?? ""] ?? "No informado"}</p>
      </div>)}</div> : <p>No hay ventas vinculadas a este cliente en las sucursales permitidas.</p>)}
    </CustomerDialog>}
    {form && <CustomerDialog title={form.id ? "Editar cliente" : "Nuevo cliente"} busy={busy} onClose={closeEditor}><form onSubmit={(e) => { e.preventDefault(); void save(form); }} className="space-y-4">
      <fieldset disabled={busy || verificationRequired} className="space-y-4">
        <label className="block text-sm">Nombre *<input autoFocus required maxLength={200} className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoComplete="name" /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Teléfono<input type="tel" maxLength={40} className={inputClass} value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} autoComplete="tel" /></label><label className="text-sm">Email<input type="email" maxLength={254} className={inputClass} value={form.email ?? ""} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="email" /></label></div>
        <label className="block text-sm">Canal de contacto<input maxLength={80} className={inputClass} value={form.channel ?? ""} onChange={(e) => setForm({ ...form, channel: e.target.value })} placeholder="Por ejemplo: teléfono, local o WhatsApp" /></label>
        <label className="block text-sm">Notas<textarea aria-label="Notas" rows={4} maxLength={2000} className={inputClass} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
      </fieldset>
      {formError && <p role="alert" className="text-sm text-warn-500">{formError}</p>}
      {verificationRequired && <p role="status" className="text-sm text-ink-muted">El resultado necesita verificación. Cerrá este formulario para recargar el catálogo antes de guardar otra vez.</p>}
      <div className="flex justify-end gap-2"><Button type="button" disabled={busy} onClick={closeEditor}>Cancelar</Button><Button type="submit" variant="primary" disabled={busy || verificationRequired}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}Guardar cliente</Button></div>
    </form></CustomerDialog>}
    {changeStatus && <CustomerDialog title={changeStatus.active ? "Archivar cliente" : "Restaurar cliente"} busy={busy} onClose={closeEditor}>
      <p className="text-sm">{changeStatus.active ? `¿Archivar a ${changeStatus.name}? Se conservarán sus datos y la auditoría. Podés restaurarlo desde el filtro Archivados.` : `¿Restaurar a ${changeStatus.name} a la lista de clientes activos?`}</p>
      {formError && <p role="alert" className="mt-3 text-sm text-warn-500">{formError}</p>}
      <div className="mt-5 flex justify-end gap-2"><Button disabled={busy} onClick={closeEditor}>Cancelar</Button><Button variant="primary" disabled={busy || verificationRequired} onClick={() => void save({ ...asInput(changeStatus), active: !changeStatus.active })}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{changeStatus.active ? "Archivar" : "Restaurar"}</Button></div>
    </CustomerDialog>}
  </div>;
}
