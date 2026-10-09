"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, ArrowLeft, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { getSuppliersPageDataAction, getSupplierHistoryAction, getSupplierManualAction, setSupplierActiveAction } from "@/app/actions/suppliers-page";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { SectionHeader } from "@/components/ui/section-header";
import { useToast } from "@/components/ui/toast";
import { formatARS } from "@/lib/format";
import type { SupplierHistory, SupplierListData, SupplierRow } from "@/lib/suppliers/domain";

export default function ProveedoresPage() {
  const { toast } = useToast();
  const [data, setData] = useState<SupplierListData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<SupplierRow | "new" | null>(null);
  const [history, setHistory] = useState<SupplierRow | null>(null);
  const [changing, setChanging] = useState<SupplierRow | null>(null);
  const [pending, setPending] = useState(false);
  const [changeError, setChangeError] = useState("");
  const [mustReload, setMustReload] = useState(false);
  const busy = useRef(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++request.current;
    setLoading(true);
    try {
      const result = await getSuppliersPageDataAction({ query, status, page });
      if (request.current !== sequence) return;
      if (result.ok) { setData(result.data); setError(""); }
      else { setData(null); setError(result.error); }
    } catch { if (request.current === sequence) { setData(null); setError("No pudimos cargar los proveedores."); } }
    finally { if (request.current === sequence) setLoading(false); }
  }, [query, status, page]);
  const cancelLoads = useCallback(() => { request.current += 1; }, []);
  useEffect(() => { const timer = setTimeout(() => void load(), 200); return () => { clearTimeout(timer); cancelLoads(); }; }, [load, cancelLoads]);

  async function changeActive() {
    if (!changing || busy.current || mustReload) return;
    busy.current = true; setPending(true); setChangeError("");
    try {
      const result = await setSupplierActiveAction({ id: changing.id, expectedUpdatedAt: changing.updated_at, active: !changing.active });
      if (result.ok) { setChanging(null); toast({ tone: "success", title: result.supplier.active ? "Proveedor restaurado" : "Proveedor archivado" }); await load(); }
      else { setChangeError("message" in result ? result.message : result.error); if ("status" in result && result.status !== "rejected") setMustReload(true); }
    } catch { setChangeError("No pudimos confirmar el cambio. Verificá el estado guardado antes de continuar."); setMustReload(true); }
    finally { busy.current = false; setPending(false); }
  }
  async function verifyStatus() {
    if (!changing || busy.current) return;
    busy.current = true; setPending(true);
    try {
      const result = await getSupplierManualAction(changing.id);
      if (result.ok && result.supplier) {
        if (result.supplier.active === !changing.active) {
          setChanging(null);
          toast({ tone: "success", title: result.supplier.active ? "Restauración confirmada" : "Archivo confirmado" });
        } else {
          setChanging(result.supplier); setMustReload(false);
          setChangeError("Este es el estado guardado actualmente. Revisalo antes de continuar.");
        }
        await load();
      }
      else setChangeError(result.ok ? "El proveedor ya no está disponible." : result.error);
    } catch { setChangeError("No pudimos verificar el estado."); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className="space-y-6">
    <Link href="/compras" className="inline-flex items-center gap-2 text-sm text-ink-muted"><ArrowLeft className="h-4 w-4" /> Volver a Compras</Link>
    <SectionHeader eyebrow="Proveedores" title="Contactos y condiciones, en un solo lugar." description="Los proveedores se comparten entre las sucursales del negocio. Archivar conserva las compras y los insumos relacionados." actions={data?.canManage ? <Button variant="primary" onClick={() => setEditing("new")} disabled={pending}><Plus className="h-4 w-4" />Nuevo proveedor</Button> : undefined} />
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 text-xs text-ink-muted">Buscar por nombre<input className="mt-1 block h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm" value={query} maxLength={200} onChange={(e) => { setQuery(e.target.value); setPage(0); }} /></label>
      <label className="text-xs text-ink-muted">Estado<select aria-label="Estado" className="mt-1 block h-10 rounded-lg border border-line bg-bg px-3 text-sm" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }}><option value="active">Activos</option><option value="archived">Archivados</option><option value="all">Todos</option></select></label>
      <Button onClick={() => void load()} disabled={loading}>Actualizar</Button>
    </div>
    {error && <div role="alert" className="rounded-xl border border-warn-500/30 p-5 text-sm">{error}</div>}
    {loading ? <div role="status" className="flex items-center justify-center gap-2 p-12 text-ink-muted"><Loader2 className="h-5 w-5 animate-spin" />Cargando proveedores…</div> : data && <>
      <p className="text-xs text-ink-muted">{data.count} proveedores en este filtro{!data.canManage ? " · Acceso de lectura" : ""}</p>
      {data.suppliers.length === 0 ? <div className="rounded-xl border border-dashed border-line p-10 text-center text-sm text-ink-muted">No hay proveedores que coincidan con este filtro.</div> : <div className="grid gap-4 lg:grid-cols-2">
        {data.suppliers.map((supplier) => <article key={supplier.id} className="space-y-3 rounded-xl border border-line bg-bg-elevated p-5">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold text-ink">{supplier.name}</h2><p className="break-words text-xs text-ink-muted">{supplier.category || "Sin categoría"}{supplier.tax_id ? ` · ${supplier.tax_id}` : ""}</p></div><Badge tone={supplier.active ? "success" : "default"}>{supplier.active ? "Activo" : "Archivado"}</Badge></div>
          <div className="space-y-1 break-words text-sm text-ink-muted"><p>Teléfono: {supplier.phone || "Sin registrar"}</p><p>Email: {supplier.email || "Sin registrar"}</p></div>
          {supplier.payment_terms && <p className="whitespace-pre-wrap break-words text-sm text-ink-muted"><span className="font-medium text-ink">Condiciones: </span>{supplier.payment_terms}</p>}
          {supplier.notes && <details className="text-sm text-ink-muted"><summary className="cursor-pointer">Notas</summary><p className="mt-2 whitespace-pre-wrap break-words">{supplier.notes}</p></details>}
          <div className="flex flex-wrap gap-2 border-t border-line pt-3">
            <Button size="sm" variant="ghost" onClick={() => setHistory(supplier)}>Compras e insumos</Button>
            {data.canManage && <><Button size="sm" variant="ghost" onClick={() => setEditing(supplier)}><Pencil className="h-3.5 w-3.5" />Editar</Button><Button size="sm" variant="ghost" onClick={() => { setChanging(supplier); setMustReload(false); setChangeError(""); }}>{supplier.active ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}{supplier.active ? "Archivar" : "Restaurar"}</Button></>}
          </div>
        </article>)}
      </div>}
      <div className="flex items-center justify-between gap-3"><Button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</Button><span className="text-xs text-ink-muted">Página {page + 1} de {Math.max(1, Math.ceil(data.count / data.pageSize))}</span><Button disabled={(page + 1) * data.pageSize >= data.count} onClick={() => setPage(page + 1)}>Siguiente</Button></div>
    </>}
    <Drawer open={editing !== null} onClose={() => !pending && setEditing(null)} title={editing === "new" ? "Nuevo proveedor" : "Editar proveedor"} description="Cargá únicamente datos reales del proveedor." width="max-w-lg">
      {editing && data && <SupplierForm key={editing === "new" ? "new" : editing.id} draftScope={data.draftScope} supplier={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onBusyChange={setPending} onSaved={() => { setEditing(null); toast({ tone: "success", title: "Proveedor guardado" }); void load(); }} />}
    </Drawer>
    <Drawer open={changing !== null} onClose={() => !pending && setChanging(null)} title={changing?.active ? "Archivar proveedor" : "Restaurar proveedor"} width="max-w-lg">
      {changing && <div className="space-y-4 p-6"><p className="font-semibold">{changing.name} · {changing.active ? "Activo" : "Archivado"}</p><p className="text-sm text-ink-muted">{changing.active ? "Dejará de estar disponible para nuevas compras. Se conservan el historial y las relaciones existentes." : "Volverá a estar disponible para nuevas compras."}</p>{changeError && <p role="alert" className="text-sm text-warn-400">{changeError}</p>}<div className="flex flex-wrap justify-end gap-2"><Button disabled={pending} variant="ghost" onClick={() => setChanging(null)}>Cerrar</Button>{mustReload ? <Button disabled={pending} onClick={() => void verifyStatus()}>Verificar estado</Button> : <Button disabled={pending} variant="primary" onClick={() => void changeActive()}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{changing.active ? "Confirmar archivo" : "Confirmar restauración"}</Button>}</div></div>}
    </Drawer>
    <Drawer open={history !== null} onClose={() => setHistory(null)} title={history?.name} description="Últimas 30 compras visibles según tu acceso a sucursales." width="max-w-xl">{history && <SupplierPurchases key={history.id} supplier={history} />}</Drawer>
  </div>;
}

function SupplierPurchases({ supplier }: { supplier: SupplierRow }) {
  const [purchases, setPurchases] = useState<SupplierHistory[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    getSupplierHistoryAction(supplier.id).then((result) => { if (!current) return; if (result.ok) setPurchases(result.purchases); else setError(result.error); }).catch(() => { if (current) setError("No pudimos cargar el historial."); });
    return () => { current = false; };
  }, [supplier.id]);
  return <div className="space-y-4 p-6">
    <p className="text-xs text-ink-muted">Los insumos listados provienen del detalle registrado en cada compra.</p>
    {error ? <p role="alert" className="text-sm text-warn-400">{error}</p> : purchases === null ? <p role="status" className="text-sm text-ink-muted">Cargando historial…</p> : purchases.length === 0 ? <p className="text-sm text-ink-muted">Todavía no hay compras visibles relacionadas con este proveedor.</p> : purchases.map((purchase) => <article key={purchase.id} className="space-y-2 rounded-lg border border-line p-4"><div className="flex flex-wrap justify-between gap-2 text-sm font-medium"><span>{purchase.purchasedAt} · {purchase.branch}</span><span>{formatARS(purchase.total)}</span></div>{purchase.items.length === 0 ? <p className="text-xs text-ink-muted">Sin detalle registrado.</p> : <ul className="space-y-1 text-sm text-ink-muted">{purchase.items.map((item, index) => <li key={index}>{item.quantity} {item.unit} · {item.description}{item.ingredient && item.ingredient !== item.description ? ` (${item.ingredient})` : ""}</li>)}</ul>}</article>)}
  </div>;
}
