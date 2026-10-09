"use client";

import Link from "next/link";
import { SupplierForm } from "@/components/suppliers/supplier-form";
import { cloneElement, isValidElement, type ReactElement, FormEvent, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDownRight, ArrowUpRight, FileSpreadsheet, Loader2, Plus, Truck } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { InsightCard } from "@/components/common/insight-card";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { exportPurchasesCsvAction } from "@/app/actions/exports";
import {
  createPurchaseAction, refreshPurchaseCostsAction, voidPurchaseAction, getPurchaseCorrectionAction, type PurchasesPageRow,
  getPurchasesPageDataAction,
  type PurchaseInput,
  type PurchasesPageData,
} from "@/app/actions/purchases-page";
import { triggerCsvDownload } from "@/lib/csv-download";
import { recentPurchases as demoRecentPurchases, topSuppliers as demoTopSuppliers } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";
const inputClass = "h-10 w-full min-w-0 rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand-500";

export default function ComprasPage() {
  const { toast } = useToast();
  const [exporting, startExport] = useTransition();
  const [mutationPending, startMutation] = useTransition();
  const [purchaseSaving,setPurchaseSaving]=useState(false);
  const pending=mutationPending || purchaseSaving;
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseData, setDatabaseData] = useState<PurchasesPageData | null>(null);
  const [supplierDrawerOpen, setSupplierDrawerOpen] = useState(false);
  const [supplierBusy, setSupplierBusy] = useState(false);
  const [purchaseDrawerOpen, setPurchaseDrawerOpen] = useState(false);
  const [correction,setCorrection]=useState<PurchaseInput | null>(null);
  const [voidTarget,setVoidTarget]=useState<PurchasesPageRow | null>(null);
  const [voidReason,setVoidReason]=useState("");
  const voidBusy=useRef(false);

  async function loadPurchases() {
    if (!IS_DATABASE) return;
    setLoading(true);
    try {
      const res = await getPurchasesPageDataAction();
      if (!res.ok) {
        setLoadError(res.error);
        setDatabaseData(null);
        return;
      }
      setDatabaseData(res.data);
      setLoadError(null);
    } catch {
      setLoadError("No pudimos cargar Compras.");
      setDatabaseData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPurchases();
  }, []);

  const recentPurchases = IS_DATABASE ? databaseData?.recentPurchases ?? [] : demoRecentPurchases;
  const topSuppliers = IS_DATABASE ? databaseData?.topSuppliers ?? [] : demoTopSuppliers;
  const supplierCount = IS_DATABASE ? databaseData?.supplierCount ?? 0 : topSuppliers.length;
  const demoTotalMes = useMemo(() => demoTopSuppliers.reduce((s, p) => s + p.totalMes, 0), []);
  const totalMes = IS_DATABASE ? databaseData?.totalMonth ?? 0 : demoTotalMes;
  const orderCount = IS_DATABASE ? databaseData?.orderCount ?? 0 : recentPurchases.length;

  function handleExport() {
    startExport(async () => {
      const res = await exportPurchasesCsvAction();
      if (res.ok) {
        triggerCsvDownload(res.filename, res.content);
        toast({
          tone: "success",
          title: "Exporte contable listo",
          description: `${res.rows} filas · ${res.filename}. Abrí con Excel y conciliá con IVA Compras.`,
        });
      } else {
        toast({ tone: "warn", title: "No pudimos exportar", description: res.error });
      }
    });
  }

  async function savePurchase(input: PurchaseInput): Promise<false | null | true> {
    setPurchaseSaving(true);
    try {
      const res = await createPurchaseAction(input);
      if (!res.ok) {
        toast({ tone: "warn", title: "No pudimos registrar la compra", description: res.error });
        return res.persisted;
      }
      toast({ tone: "success", title: "Compra registrada", description: res.costRefreshPending ? "Compra y stock guardados. Un propietario o administrador debe actualizar los costos en Compras." : "Compra y detalle declarado guardados juntos." });
      setPurchaseDrawerOpen(false);
      await loadPurchases();
      return true;
    } catch {
      toast({tone:"warn",title:"Resultado incierto",description:"Conservá y verificá el mismo intento antes de registrar otra compra."});
      return null;
    } finally { setPurchaseSaving(false); }
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Compras y proveedores"
        title="Cada compra, su proveedor y su variación."
        description={IS_DATABASE
          ? "Seguimiento de compras y proveedores con información registrada por tu equipo."
          : "Comparamos precios entre proveedores y alertamos cuando un insumo se sale del rango habitual."}
        actions={
          <>
            <Button size="sm" variant="ghost" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
              {exporting ? "Generando…" : "Exportar compras Excel"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSupplierDrawerOpen(true)} disabled={!IS_DATABASE || pending || !databaseData?.canManageSuppliers}>
              <Truck className="h-4 w-4" /> Nuevo proveedor
            </Button>
            {IS_DATABASE && <Link href="/compras/proveedores" className="inline-flex items-center px-3 text-sm text-ink-muted hover:text-ink">Gestionar proveedores</Link>}
            <Button size="sm" variant="primary" onClick={() => {setCorrection(null);setPurchaseDrawerOpen(true);}} disabled={!IS_DATABASE || pending}>
              <Plus className="h-4 w-4" /> Registrar compra
            </Button>
          </>
        }
      />

      {IS_DATABASE && loadError && (
        <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
          <div className="text-sm font-semibold text-ink">No pudimos cargar Compras</div>
          <p className="mt-1 text-xs text-ink-muted">{loadError}</p>
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => void loadPurchases()}>Reintentar</Button>
        </div>
      )}

      {IS_DATABASE && loading ? (
        <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando compras…
        </div>
      ) : loadError ? null : (
        <>
          {IS_DATABASE && databaseData?.costRefreshPending && <div role="status" className="rounded-xl border border-warn-500/30 p-4 text-sm">Hay compras con costos pendientes de actualización. Los márgenes afectados requieren revisión por un propietario o administrador.
            {databaseData.canRefreshCosts && <Button disabled={pending} onClick={()=>startMutation(async()=>{const result=await refreshPurchaseCostsAction();if(result.ok){toast({tone:"success",title:result.pending ? "Costos todavía por verificar" : "Costos actualizados",description:result.pending ? "Hay insumos sin compras activas. Se conserva el último costo conocido y sus márgenes siguen ocultos." : undefined});await loadPurchases();}else toast({tone:"warn",title:"No se pudieron actualizar los costos",description:result.error});})}>Actualizar costos de compras</Button>}
          </div>}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Compras del mes" value={formatARS(totalMes, { compact: true })} delta={IS_DATABASE ? undefined : 14.1} tone="brand" />
            <KpiCard label="Órdenes" value={String(orderCount)} delta={IS_DATABASE ? undefined : 5} />
            <KpiCard label="Proveedores activos" value={String(supplierCount)} />
            <KpiCard label="Insumo más caro" value={IS_DATABASE ? "—" : "Carne premium"} hint={IS_DATABASE ? "Se habilita con historial comparable" : "$10.260/kg"} />
          </div>

          {!IS_DATABASE && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <InsightCard tone="warn" icon="TrendingUp" title="Don José aumentó 14% el kilo de carne" detail="De $9.000 a $10.260 en la última compra del 16/05." />
              <InsightCard tone="info" icon="Sparkles" title="Frigorífico Sur cotiza $9.450/kg" detail="Ahorro estimado de $16.200 por compra de 20kg." />
              <InsightCard tone="success" icon="Target" title="Verdulería Centro bajó 2%" detail="Lechuga y tomate vienen estables hace 3 semanas." />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Últimas compras</CardTitle>
                {!IS_DATABASE && <Badge tone="ai">Detectadas por IA</Badge>}
              </CardHeader>
              {recentPurchases.length === 0 ? (
                <CardContent>
                  <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                    <div className="text-sm font-semibold text-ink">Todavía no hay compras registradas.</div>
                    <p className="mt-1 text-xs text-ink-muted">Cargá la primera compra para empezar a comparar proveedores y costos.</p>
                    {IS_DATABASE && (
                      <Button size="sm" variant="primary" className="mt-4" onClick={() => {setCorrection(null);setPurchaseDrawerOpen(true);}} disabled={supplierCount === 0}>
                        <Plus className="h-4 w-4" /> Registrar compra
                      </Button>
                    )}
                    {IS_DATABASE && supplierCount === 0 && (
                      <p className="mt-3 text-xs text-ink-muted">Primero registrá un proveedor.</p>
                    )}
                  </div>
                </CardContent>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                      <tr>
                        <th className="px-5 py-2.5 font-medium">Fecha</th>
                        <th className="px-5 py-2.5 font-medium">Sucursal</th>
                        <th className="px-5 py-2.5 font-medium">Proveedor</th>
                        <th className="px-5 py-2.5 font-medium">Insumo</th>
                        <th className="px-5 py-2.5 text-right font-medium">Cant.</th>
                        <th className="px-5 py-2.5 text-right font-medium">Var.</th>
                        <th className="px-5 py-2.5 text-right font-medium">Monto</th><th className="px-5 py-2.5">Origen y referencia</th><th className="px-5 py-2.5">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPurchases.map((p, i) => (
                        <tr key={`${p.fecha}-${p.proveedor}-${i}`} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                          <td className="px-5 py-3 text-ink-muted">{p.fecha}</td>
                          <td className="px-5 py-3 text-ink-muted">{(p as { sucursal?: string }).sucursal ?? "—"}</td>
                          <td className="px-5 py-3 text-ink">{p.proveedor}</td>
                          <td className="px-5 py-3 text-ink-muted">{p.insumo}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{p.cantidad}</td>
                          <td className="px-5 py-3 text-right">
                            {p.variacion === 0 ? <span className="text-xs text-ink-subtle">—</span> : (
                              <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", p.variacion > 5 ? "text-danger-400" : p.variacion > 0 ? "text-warn-400" : "text-success-400")}>
                                {p.variacion > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                                {formatPercent(Math.abs(p.variacion))}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">{formatARS(p.monto)}</td>
                          <td className="px-5 py-3 text-xs">{IS_DATABASE && "status" in p ? <>{purchaseOriginLabel(p as PurchasesPageRow)}{(p as PurchasesPageRow).receiptReference && <div>Referencia: {(p as PurchasesPageRow).receiptReference}</div>}{(p as PurchasesPageRow).costRefreshPending && <div>Costos pendientes</div>}</> : "Demo"}</td>
                          <td className="px-5 py-3">{IS_DATABASE && "status" in p ? p.status === "voided" ? "Anulada" : ["manual","inbox","whatsapp"].includes((p as PurchasesPageRow).source ?? "") ? <div className="flex gap-1"><Button size="sm" variant="ghost" disabled={pending} onClick={() => {const id=(p as PurchasesPageRow).id;startMutation(async()=>{const result=await getPurchaseCorrectionAction(id);if(result.ok){setCorrection(result.input);setPurchaseDrawerOpen(true);}else toast({tone:"warn",title:"No se pudo abrir",description:result.error});});}}>Corregir</Button><Button size="sm" variant="ghost" disabled={pending} onClick={() => {setVoidTarget(p as PurchasesPageRow);setVoidReason("");}}>Anular</Button></div> : "Original" : "Demo"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Ranking de proveedores</CardTitle>
                  <p className="text-xs text-ink-muted">Mes en curso</p>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {topSuppliers.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                    <div className="text-sm text-ink-muted">Sin proveedores con movimientos todavía.</div>
                    {IS_DATABASE && (
                      <Button size="sm" variant="ghost" className="mt-3" onClick={() => setSupplierDrawerOpen(true)} disabled={!databaseData?.canManageSuppliers}>
                        <Truck className="h-4 w-4" /> Nuevo proveedor
                      </Button>
                    )}
                  </div>
                ) : topSuppliers.map((s) => (
                  <div key={s.nombre} className="rounded-xl border border-line bg-bg-subtle/60 p-3">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{s.nombre}</div>
                        <div className="text-[11px] text-ink-subtle">{s.rubro} · {s.ordenes} órdenes</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums text-ink">{formatARS(s.totalMes, { compact: true })}</div>
                        {!IS_DATABASE && <div className={cn("text-[11px] tabular-nums", s.tendencia > 5 ? "text-danger-400" : s.tendencia > 0 ? "text-warn-400" : "text-success-400")}>{s.tendencia > 0 ? "+" : ""}{formatPercent(s.tendencia)}</div>}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Drawer
        open={supplierDrawerOpen}
        onClose={() => !supplierBusy && setSupplierDrawerOpen(false)}
        title="Nuevo proveedor"
        description="Guardá los datos básicos para asociarlo a futuras compras."
        width="max-w-lg"
      >
        {supplierDrawerOpen && databaseData?.canManageSuppliers && <SupplierForm draftScope={databaseData.supplierDraftScope} onBusyChange={setSupplierBusy} onCancel={() => setSupplierDrawerOpen(false)} onSaved={() => { setSupplierDrawerOpen(false); toast({ tone: "success", title: "Proveedor guardado" }); void loadPurchases(); }} />}
      </Drawer>

      <Drawer open={voidTarget !== null} onClose={() => !pending && setVoidTarget(null)} title="Anular compra" description="Conserva el historial y revierte sus entradas de stock. Si los insumos ya se consumieron, la operación se rechaza completa.">
        <Field label="Motivo obligatorio"><input className={inputClass} value={voidReason} disabled={pending} onChange={e => setVoidReason(e.target.value)}/></Field>
        <Button disabled={pending || !voidReason.trim()} onClick={() => { if(!voidTarget || voidBusy.current)return; voidBusy.current=true; const target=voidTarget; const reason=voidReason; startMutation(async()=>{try{const result=await voidPurchaseAction({id:target.id,expectedVersion:target.version,reason});if(result.ok){setVoidTarget(null);await loadPurchases();}else toast({tone:"warn",title:"Revisá la anulación",description:result.error});}finally{voidBusy.current=false;}});}}>Confirmar anulación</Button>
      </Drawer>
      <Drawer
        open={purchaseDrawerOpen}
        onClose={() => !pending && setPurchaseDrawerOpen(false)}
        title={correction ? "Corregir compra" : "Registrar compra"}
        description="Cargá una compra manual con su proveedor y detalle principal."
        width="max-w-lg"
      >
        <PurchaseForm
          key={`${databaseData?.supplierDraftScope}:${correction?.replacesPurchaseId ?? "new"}`}
          correction={correction}
          pending={pending}
          suppliers={databaseData?.suppliers ?? []}
          canCreateSupplier={databaseData?.canManageSuppliers ?? false}
          branches={databaseData?.branches ?? []}
          onCancel={() => setPurchaseDrawerOpen(false)}
          onCreateSupplier={() => {
            setPurchaseDrawerOpen(false);
            setSupplierDrawerOpen(true);
          }}
          scope={databaseData?.supplierDraftScope ?? ""}
          ingredients={databaseData?.ingredients ?? []}
          onSubmit={savePurchase}
        />
      </Drawer>
    </div>
  );
}

function PurchaseForm({ pending, suppliers, branches, ingredients, scope, correction, canCreateSupplier, onCancel, onCreateSupplier, onSubmit }: {
  pending: boolean;
  suppliers: Array<{ id: string; name: string; category: string | null }>;
  branches: Array<{ id: string; name: string }>;
  ingredients: Array<{ id: string; name: string; unit: string }>;
  scope: string;
  correction: PurchaseInput | null;
  onCancel: () => void; canCreateSupplier: boolean; onCreateSupplier: () => void;
  onSubmit: (input: PurchaseInput) => Promise<false | null | true>;
}) {
  const journalKey=`gastropilot:purchase-attempt:${scope}`;
  const [initialAttempt]=useState<{key:string;input:PurchaseInput}|null>(()=>{
    if(typeof window === "undefined" || !scope)return null;
    try {const value=JSON.parse(sessionStorage.getItem(journalKey) ?? "null");return value && typeof value.key === "string" && value.input?.requestId === value.key ? value : null;}catch{return null;}
  });
  const initialInput=initialAttempt?.input ?? correction;
  const [supplierId, setSupplierId] = useState(initialInput?.supplierId ?? "");
  const [branchId, setBranchId] = useState(initialInput?.branchId ?? "");
  const [purchasedAt, setPurchasedAt] = useState(initialInput?.purchasedAt ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }));
  const [kind,setKind]=useState<"summary"|"detailed">(initialInput?.kind ?? "detailed");
  const [amount,setAmount]=useState(initialInput?.amount ?? "");
  const [receiptReference,setReceiptReference]=useState(initialInput?.receiptReference ?? "");
  const [paymentMethod, setPaymentMethod] = useState(initialInput?.paymentMethod ?? "Transferencia");
  const blank = () => ({ ingredientId: "", description: "", qty: "1", unit: "u", unitPrice: "" });
  const [lines, setLines] = useState(() => initialInput && initialInput.kind !== "summary" ? (initialInput.items ?? [initialInput]).map(line => ({ ingredientId:line.ingredientId ?? "",description:line.description,qty:String(line.qty),unit:line.unit,unitPrice:String(line.unitPrice) })) : [blank()]);
  const [correctionReason,setCorrectionReason]=useState(initialInput?.correctionReason ?? "");
  const [error, setError] = useState("");
  const attempt = useRef<{ key: string; input: PurchaseInput } | null>(initialAttempt);
  // Any restored journal may already have committed, including pre-upgrade v1 entries.
  const uncertainAttempt=useRef(initialAttempt !== null);
  const sending=useRef(false);
  const [attemptKey, setAttemptKey] = useState<string | null>(initialAttempt?.key ?? null);
  const locked = pending || attemptKey !== null;
  const total = kind === "summary" ? Number(amount.replace(",",".")) : lines.reduce((sum,line) => sum + Number(line.qty.replace(",",".")) * Number(line.unitPrice.replace(",",".")),0);
  function patch(index: number, fields: Partial<ReturnType<typeof blank>>) {
    setLines(previous => previous.map((line,i) => i === index ? { ...line, ...fields } : line));
  }
  async function sendAttempt(input: PurchaseInput) {
    if(sending.current)return;
    sending.current=true;
    const wasUncertain=uncertainAttempt.current;
    try {
      try { sessionStorage.setItem(journalKey,JSON.stringify({key:input.requestId,input})); }
      catch {setError("No se puede conservar el intento en este navegador. Habilitá almacenamiento antes de guardar.");return;}
      uncertainAttempt.current=true;
      let result: false | null | true=null;
      try { result=await onSubmit(input); } catch { /* The first request may have committed. */ }
      if(result === true || result === false && !wasUncertain){
        sessionStorage.removeItem(journalKey);attempt.current=null;uncertainAttempt.current=false;setAttemptKey(null);
      } else if(result === false) {
        setError("Este rechazo no descarta que el intento anterior se haya guardado. Se conserva la misma referencia; verificá la compra antes de iniciar otra.");
      }
    } finally {sending.current=false;}
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !scope) return;
    if (attempt.current) { void sendAttempt(attempt.current.input); return; }
    if (!supplierId || !branchId) return setError("Elegí proveedor y sucursal.");
    const items = lines.map(line => ({ ...line, ingredientId: line.ingredientId || null, qty: Number(line.qty.replace(",",".")), unitPrice: Number(line.unitPrice.replace(",",".")) }));
    if (kind === "summary" && (!/^(0|[1-9]\d{0,9})(?:[.,]\d{1,2})?$/.test(amount) || Number(amount.replace(",","."))<=0))return setError("Ingresá un importe total explícito mayor a cero.");
    if (kind === "detailed" && items.some(line => !line.description.trim() || !line.unit.trim() || !Number.isFinite(line.qty) || line.qty <= 0 || !Number.isFinite(line.unitPrice) || line.unitPrice < 0)) return setError("Revisá descripción, cantidad, unidad y precio de cada línea.");
    if(correction && !correctionReason.trim())return setError("Ingresá el motivo de la corrección.");
    const input: PurchaseInput = { ...(correction ? {replacesPurchaseId:correction.replacesPurchaseId,expectedVersion:correction.expectedVersion,correctionReason} : {}), requestId: crypto.randomUUID(), branchId, supplierId, purchasedAt, paymentMethod, kind, ...(kind==="summary"?{amount:amount.replace(",",".")} : {}), receiptReference:receiptReference.trim(), ...items[0], ingredientId: items[0].ingredientId, items };
    attempt.current = { key: input.requestId, input };
    setAttemptKey(input.requestId);
    setError(""); void sendAttempt(input);
  }
  return <form className="space-y-4 p-6" onSubmit={submit}>
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
      {correction && <><p className="text-sm">La corrección conserva y anula la compra original; registra su reemplazo y ajusta el stock dentro de una misma transacción.</p><Field label="Motivo de corrección *"><input className={inputClass} value={correctionReason} onChange={e=>setCorrectionReason(e.target.value)}/></Field></>}
      <Field label="Sucursal *"><select className={inputClass} value={branchId} onChange={e => setBranchId(e.target.value)}><option value="">Elegir sucursal</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
      <Field label="Proveedor *"><select className={inputClass} value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Elegir proveedor</option>{suppliers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      {suppliers.length === 0 && canCreateSupplier && <Button type="button" onClick={onCreateSupplier}>Crear proveedor</Button>}
      <Field label="Fecha *"><input className={inputClass} type="date" value={purchasedAt} onChange={e => setPurchasedAt(e.target.value)} /></Field>
      <Field label="Medio de pago declarado *"><select className={inputClass} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}><option>Transferencia</option><option>Efectivo</option><option>Tarjeta</option><option>Cuenta corriente</option><option>Otro</option></select></Field>
      <Field label="Referencia de comprobante (opcional)"><input maxLength={200} className={inputClass} value={receiptReference} onChange={e=>setReceiptReference(e.target.value)}/></Field>
      <p className="text-xs text-ink-muted">Referencia de texto, como un número de ticket. No adjunta ni sube archivos.</p>
      <Field label="Tipo de compra"><select className={inputClass} value={kind} onChange={e=>setKind(e.target.value as "summary"|"detailed")}><option value="detailed">Detallada</option><option value="summary">Resumida, sin stock</option></select></Field>
      {kind === "summary" && <Field label="Importe total *"><input className={inputClass} inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></Field>}
      {kind === "detailed" && lines.map((line,i) => <div key={i} className="space-y-3 rounded-xl border border-line p-3">
        <Field label={`Línea ${i + 1}: insumo opcional`}><select className={inputClass} value={line.ingredientId} onChange={e => { const ingredient = ingredients.find(v => v.id === e.target.value); patch(i,{ ingredientId:e.target.value, ...(ingredient ? { description:ingredient.name, unit:ingredient.unit } : {}) }); }}><option value="">Concepto sin entrada de stock</option>{ingredients.map(v => <option key={v.id} value={v.id}>{v.name} ({v.unit})</option>)}</select></Field>
        <Field label="Descripción *"><input className={inputClass} value={line.description} onChange={e => patch(i,{description:e.target.value})}/></Field>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><Field label="Cantidad *"><input className={inputClass} inputMode="decimal" value={line.qty} onChange={e => patch(i,{qty:e.target.value})}/></Field><Field label="Unidad *"><input className={inputClass} value={line.unit} onChange={e => patch(i,{unit:e.target.value})}/></Field><Field label="Precio unitario *"><input className={inputClass} inputMode="decimal" value={line.unitPrice} onChange={e => patch(i,{unitPrice:e.target.value})}/></Field></div>
        {lines.length > 1 && <Button type="button" variant="ghost" onClick={() => setLines(values => values.filter((_,n) => n !== i))}>Quitar línea</Button>}
      </div>)}
      {kind === "detailed" && <Button type="button" disabled={lines.length >= 100} onClick={() => setLines(values => [...values,blank()])}>Agregar línea</Button>}
    </fieldset>
    <p className="text-sm">Total: {Number.isFinite(total) ? formatARS(total) : "—"}. {kind === "summary" ? "Compra resumida sin movimiento de stock." : "Elegir un insumo registra su entrada de stock; un concepto libre no modifica existencias."}</p>
    {error && <p role="alert" className="text-sm text-danger-400">{error}</p>}
    {attemptKey && <p className="text-sm text-ink-muted">Intento {attemptKey}. Si la respuesta se interrumpió, reintentar conserva exactamente los datos y evita duplicados. Antes de cancelar y crear otra compra, revisá el listado.</p>}
    <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cerrar</Button><Button type="submit" variant="primary" disabled={pending}>{pending ? "Guardando…" : attemptKey ? "Verificar el mismo intento" : "Registrar compra"}</Button></div>
  </form>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const control = isValidElement(children) ? cloneElement(children as ReactElement<{ "aria-label"?: string }>, { "aria-label": label }) : children;
  return <label className="block min-w-0 space-y-1.5"><span className="text-xs font-medium text-ink-muted">{label}</span>{control}</label>;
}

function purchaseOriginLabel(row: PurchasesPageRow) {
 const source=row.correctionOrigin ?? row.source;
 const label=source==="whatsapp"?"WhatsApp":source==="inbox"?"Inbox":source==="manual"?"Manual":row.invoiceSource==="manual"?"Factura manual":row.invoiceSource?"Factura OCR":"Histórico sin origen informado";
 return `${label}${row.correctionOrigin ? " · corrección manual" : ""}`;
}
