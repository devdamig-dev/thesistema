"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
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
  createPurchaseAction,
  createSupplierAction,
  getPurchasesPageDataAction,
  type PurchaseInput,
  type PurchasesPageData,
  type SupplierInput,
} from "@/app/actions/purchases-page";
import { triggerCsvDownload } from "@/lib/csv-download";
import { recentPurchases as demoRecentPurchases, topSuppliers as demoTopSuppliers } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";
const inputClass = "h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand-500";

export default function ComprasPage() {
  const { toast } = useToast();
  const [exporting, startExport] = useTransition();
  const [pending, startMutation] = useTransition();
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseData, setDatabaseData] = useState<PurchasesPageData | null>(null);
  const [supplierDrawerOpen, setSupplierDrawerOpen] = useState(false);
  const [purchaseDrawerOpen, setPurchaseDrawerOpen] = useState(false);

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

  function saveSupplier(input: SupplierInput) {
    startMutation(async () => {
      const res = await createSupplierAction(input);
      if (!res.ok) {
        toast({ tone: "warn", title: "No pudimos registrar el proveedor", description: res.error });
        return;
      }
      toast({ tone: "success", title: "Proveedor registrado", description: "Ya podés usarlo al cargar una compra." });
      setSupplierDrawerOpen(false);
      await loadPurchases();
    });
  }

  function savePurchase(input: PurchaseInput) {
    startMutation(async () => {
      const res = await createPurchaseAction(input);
      if (!res.ok) {
        toast({ tone: "warn", title: "No pudimos registrar la compra", description: res.error });
        return;
      }
      toast({ tone: "success", title: "Compra registrada", description: "La compra quedó incorporada al mes y a los reportes." });
      setPurchaseDrawerOpen(false);
      await loadPurchases();
    });
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
            <Button size="sm" variant="ghost" onClick={() => setSupplierDrawerOpen(true)} disabled={!IS_DATABASE || pending}>
              <Truck className="h-4 w-4" /> Nuevo proveedor
            </Button>
            <Button size="sm" variant="primary" onClick={() => setPurchaseDrawerOpen(true)} disabled={!IS_DATABASE || pending}>
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
                      <Button size="sm" variant="primary" className="mt-4" onClick={() => setPurchaseDrawerOpen(true)} disabled={supplierCount === 0}>
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
                        <th className="px-5 py-2.5 font-medium">Proveedor</th>
                        <th className="px-5 py-2.5 font-medium">Insumo</th>
                        <th className="px-5 py-2.5 text-right font-medium">Cant.</th>
                        <th className="px-5 py-2.5 text-right font-medium">Var.</th>
                        <th className="px-5 py-2.5 text-right font-medium">Monto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentPurchases.map((p, i) => (
                        <tr key={`${p.fecha}-${p.proveedor}-${i}`} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                          <td className="px-5 py-3 text-ink-muted">{p.fecha}</td>
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
                      <Button size="sm" variant="ghost" className="mt-3" onClick={() => setSupplierDrawerOpen(true)}>
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
        onClose={() => !pending && setSupplierDrawerOpen(false)}
        title="Nuevo proveedor"
        description="Guardá los datos básicos para asociarlo a futuras compras."
        width="max-w-lg"
      >
        <SupplierForm pending={pending} onCancel={() => setSupplierDrawerOpen(false)} onSubmit={saveSupplier} />
      </Drawer>

      <Drawer
        open={purchaseDrawerOpen}
        onClose={() => !pending && setPurchaseDrawerOpen(false)}
        title="Registrar compra"
        description="Cargá una compra manual con su proveedor y detalle principal."
        width="max-w-lg"
      >
        <PurchaseForm
          pending={pending}
          suppliers={databaseData?.suppliers ?? []}
          onCancel={() => setPurchaseDrawerOpen(false)}
          onCreateSupplier={() => {
            setPurchaseDrawerOpen(false);
            setSupplierDrawerOpen(true);
          }}
          onSubmit={savePurchase}
        />
      </Drawer>
    </div>
  );
}

function SupplierForm({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (input: SupplierInput) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [taxId, setTaxId] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) {
      setError("Ingresá el nombre del proveedor.");
      return;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("Ingresá un email válido.");
      return;
    }
    setError("");
    onSubmit({ name, category, taxId, phone, email });
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Nombre *"><input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Frigorífico Sur" /></Field>
      <Field label="Categoría"><input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Ej. Carnes" /></Field>
      <Field label="CUIT"><input className={inputClass} value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="30-12345678-9" /></Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Teléfono"><input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="11 5555 5555" /></Field>
        <Field label="Email"><input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ventas@proveedor.com" /></Field>
      </div>
      {error && <p className="text-xs text-danger-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Guardar proveedor</Button>
      </div>
    </form>
  );
}

function PurchaseForm({ pending, suppliers, onCancel, onCreateSupplier, onSubmit }: {
  pending: boolean;
  suppliers: Array<{ id: string; name: string; category: string | null }>;
  onCancel: () => void;
  onCreateSupplier: () => void;
  onSubmit: (input: PurchaseInput) => void;
}) {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [purchasedAt, setPurchasedAt] = useState(today);
  const [paymentMethod, setPaymentMethod] = useState("Transferencia");
  const [description, setDescription] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("u");
  const [unitPrice, setUnitPrice] = useState("");
  const [error, setError] = useState("");
  const total = Number(qty.replace(",", ".")) * Number(unitPrice.replace(",", "."));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedQty = Number(qty.replace(",", "."));
    const parsedUnitPrice = Number(unitPrice.replace(",", "."));
    if (!supplierId) return setError("Elegí un proveedor.");
    if (!description.trim()) return setError("Ingresá el insumo o concepto comprado.");
    if (!Number.isFinite(parsedQty) || parsedQty <= 0) return setError("Ingresá una cantidad mayor a cero.");
    if (!unit.trim()) return setError("Ingresá la unidad.");
    if (!Number.isFinite(parsedUnitPrice) || parsedUnitPrice < 0) return setError("Ingresá un precio unitario válido.");
    setError("");
    onSubmit({ supplierId, purchasedAt, paymentMethod, description, qty: parsedQty, unit, unitPrice: parsedUnitPrice });
  }

  if (suppliers.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-muted">Para registrar una compra primero necesitás un proveedor.</div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Cancelar</Button>
          <Button variant="primary" onClick={onCreateSupplier}><Truck className="h-4 w-4" /> Nuevo proveedor</Button>
        </div>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <Field label="Proveedor *">
        <select className={inputClass} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.category ? ` · ${supplier.category}` : ""}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Fecha *"><input className={inputClass} type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} /></Field>
        <Field label="Medio de pago *">
          <select className={inputClass} value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
            <option>Transferencia</option><option>Efectivo</option><option>Tarjeta</option><option>Cuenta corriente</option><option>Otro</option>
          </select>
        </Field>
      </div>
      <Field label="Insumo o concepto *"><input className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ej. Carne picada premium" /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Cantidad *"><input className={inputClass} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        <Field label="Unidad *"><input className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="kg" /></Field>
        <Field label="Precio unit. *"><input className={inputClass} inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0" /></Field>
      </div>
      <div className="rounded-xl border border-line bg-bg-subtle/50 p-3 text-sm text-ink-muted">Total: <span className="font-semibold text-ink">{Number.isFinite(total) ? formatARS(total) : "—"}</span></div>
      {error && <p className="text-xs text-danger-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Registrar compra</Button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-muted">{label}</span>{children}</label>;
}
