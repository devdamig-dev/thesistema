"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, Boxes, History, Loader2, Plus, RefreshCw, Sparkles } from "lucide-react";
import { ReplenishmentPanel } from "@/components/stock/replenishment-panel";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { InsightCard } from "@/components/common/insight-card";
import { useToast } from "@/components/ui/toast";
import { stockItems as demoStockItems } from "@/lib/mock-data";
import { cn } from "@/lib/utils";
import { convertQuantity, normalizeUnit } from "@/lib/recipes/quantities";
import { getRoleLabel, type Role } from "@/lib/permissions";
import {
  adjustStockManualAction,
  getStockPageDataAction,
  getStockMovementHistoryAction,
  type StockHistoryData,
  type ManualStockOperation,
  type StockPageData,
} from "@/app/actions/stock-page";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";

function stateFor(stock: number, minimo: number): "ok" | "alerta" | "critico" {
  if (minimo <= 0) return "ok";
  if (stock <= minimo) return "critico";
  if (stock <= minimo * 1.5) return "alerta";
  return "ok";
}

const STATE_STYLES = {
  ok: { tone: "success" as const, label: "Stock OK" },
  alerta: { tone: "warn" as const, label: "Atención" },
  critico: { tone: "danger" as const, label: "Crítico" },
};

function formatLastUpdated(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Sin datos";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
}

const SOURCE_LABELS: Record<string, string> = {
  manual: "Carga manual", whatsapp: "WhatsApp", inbox: "Inbox", ocr: "Factura OCR", api: "API", system: "Sistema",
};
const OPERATION_LABELS: Record<string, string> = {
  in: "Entrada", out: "Salida", waste: "Merma", set: "Corrección",
  purchase: "Compra", sale: "Venta", manual_adjust: "Ajuste manual", closure: "Cierre",
};
function formatQuantity(value: number | null, unit: string | null, signed = false) {
  if (value === null) return "Sin registrar";
  return `${signed && value > 0 ? "+" : ""}${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 20 }).format(value)}${unit ? ` ${unit}` : ""}`;
}
function formatMovementDate(value: string) {
  if (!Number.isFinite(Date.parse(value))) return "Fecha sin registrar";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(value));
}

export default function StockPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseData, setDatabaseData] = useState<StockPageData | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [ingredientId, setIngredientId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [operation, setOperation] = useState<ManualStockOperation>("in");
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [reason, setReason] = useState("");
  const [inputUnit, setInputUnit] = useState("");
  const [movementError, setMovementError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [historyData, setHistoryData] = useState<StockHistoryData | null>(null);
  const [historyLoading, setHistoryLoading] = useState(IS_DATABASE);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyQuery, setHistoryQuery] = useState({ page: 1, branchId: "", ingredientId: "", revision: 0 });
  const stockRequest = useRef(0);
  const historyRequest = useRef(0);
  const savingRef = useRef(false);

  const loadStock = useCallback(async () => {
    if (!IS_DATABASE) return;
    const request = ++stockRequest.current;
    setLoading(true);
    try {
      const res = await getStockPageDataAction();
      if (request !== stockRequest.current) return;
      if (!res.ok) {
        setLoadError(res.error);
        setDatabaseData(null);
        return;
      }
      setDatabaseData(res.data);
      setLoadError(null);
    } catch {
      if (request !== stockRequest.current) return;
      setDatabaseData(null);
      setLoadError("No pudimos cargar el stock.");
    } finally {
      if (request === stockRequest.current) setLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!IS_DATABASE) return;
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError(null);
    setHistoryData(null);
    try {
      const res = await getStockMovementHistoryAction({ page: historyQuery.page, branchId: historyQuery.branchId, ingredientId: historyQuery.ingredientId });
      if (request !== historyRequest.current) return;
      if (!res.ok) { setHistoryError(res.error); return; }
      // A concurrent deletion/filter change can make the requested page disappear.
      const lastPage = Math.max(1, Math.ceil(res.data.total / res.data.pageSize));
      if (historyQuery.page > lastPage) {
        setHistoryQuery((current) => ({ ...current, page: lastPage }));
        return;
      }
      setHistoryData(res.data);
    } catch {
      if (request === historyRequest.current) setHistoryError("No pudimos cargar el historial. Intentá nuevamente.");
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }, [historyQuery]);

  useEffect(() => {
    void loadStock();
    return () => { stockRequest.current += 1; };
  }, [loadStock]);
  useEffect(() => {
    void loadHistory();
    return () => { historyRequest.current += 1; };
  }, [loadHistory]);

  const rows = useMemo(() => {
    if (IS_DATABASE) {
      return (databaseData?.items ?? []).map((row) => ({
        id: row.id,
        branchName: row.branchName,
        insumo: row.insumo,
        stock: row.stock,
        minimo: row.minimo,
        unidad: row.unidad,
        dias: null as number | null,
        estado: stateFor(row.stock, row.minimo),
      }));
    }
    return demoStockItems.map((row, index) => ({ ...row, id: `demo-${index}`, branchName: "Principal" }));
  }, [databaseData]);

  const criticos = IS_DATABASE
    ? databaseData?.criticalCount ?? 0
    : rows.filter((row) => row.estado === "critico").length;
  const alertas = IS_DATABASE
    ? databaseData?.alertCount ?? 0
    : rows.filter((row) => row.estado === "alerta").length;
  const selectedIngredient = databaseData?.ingredients.find((item) => item.id === ingredientId);
  const canRegisterMovement = Boolean(
    IS_DATABASE && !loading && !loadError && databaseData?.canAdjust && databaseData?.branches.length && databaseData?.ingredients.length,
  );

  const baseUnit = normalizeUnit(selectedIngredient?.unit);
  const compatibleUnits = baseUnit === "kg" || baseUnit === "g" ? ["kg", "g"] : baseUnit === "l" || baseUnit === "ml" ? ["l", "ml"] : baseUnit === "unit" ? ["unit"] : [];
  const parsedQuantity = quantity.trim() ? Number(quantity.replace(",", ".")) : NaN;
  let convertedQuantity: number | null = null;
  if (baseUnit && Number.isFinite(parsedQuantity) && parsedQuantity >= 0) {
    try { convertedQuantity = parsedQuantity === 0 ? 0 : convertQuantity(parsedQuantity, inputUnit || baseUnit, baseUnit); } catch { /* Validation is also enforced on the server. */ }
  }

  const openMovement = () => {
    if (!databaseData || !canRegisterMovement || savingRef.current) return;
    setIngredientId((current) => databaseData.ingredients.some((item) => item.id === current) ? current : databaseData.ingredients[0]?.id || "");
    setBranchId((current) => databaseData.branches.some((item) => item.id === current) ? current : databaseData.branches[0]?.id || "");
    setOperation("in");
    setQuantity("");
    setReason("");
    setInputUnit("");
    setMovementError(null);
    setUnconfirmed(false);
    setMovementOpen(true);
  };

  const submitMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingRef.current || unconfirmed || !canRegisterMovement || !ingredientId || !branchId) return;
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0 || (operation !== "set" && parsedQuantity <= 0)) {
      setMovementError("Ingresá una cantidad válida para continuar.");
      return;
    }
    if (!reason.trim() || reason.trim().length > 1000) {
      setMovementError("Ingresá el motivo del movimiento (hasta 1000 caracteres).");
      return;
    }
    if (!baseUnit || convertedQuantity === null) {
      setMovementError("Revisá la unidad base del insumo y la cantidad ingresada.");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setMovementError(null);
    try {
      const result = await adjustStockManualAction({
        ingredientId, branchId, operation, quantity: parsedQuantity, reason: reason.trim(), unit: inputUnit || null,
      });
      if (!result.ok) {
        setMovementError("message" in result ? result.message : result.error);
        return;
      }
      toast({
        tone: "success", title: "Movimiento registrado",
        description: `${selectedIngredient?.name ?? "Insumo"}: stock actualizado a ${formatQuantity(result.newCurrent, selectedIngredient?.unit ?? null)}.`,
      });
      setMovementOpen(false);
      setQuantity("");
      setReason("");
      setHistoryQuery((current) => ({ ...current, page: 1, revision: current.revision + 1 }));
      await loadStock();
    } catch {
      setUnconfirmed(true);
      setMovementError("No pudimos confirmar el resultado. Cerrá este formulario y revisá el historial antes de volver a registrar el movimiento, para evitar duplicarlo.");
      setHistoryQuery((current) => ({ ...current, page: 1, revision: current.revision + 1 }));
      await loadStock();
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Stock e insumos"
        title="Lo que tenés y lo que se está acabando."
        description={IS_DATABASE
          ? "Seguimiento de existencias por sucursal, con mínimos y movimientos registrados."
          : "La IA actualiza tu stock con cada foto, audio o texto que mandás. Calcula cobertura en días y avisa cuándo reponer."}
        actions={
          <>
            {!IS_DATABASE && <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                toast({
                  tone: "ai",
                  title: "Reposición sugerida",
                  description: "Generamos un borrador de orden con pan brioche, cheddar y bacon.",
                })
              }
            >
              <Sparkles className="h-4 w-4" /> Sugerir reposición
            </Button>}
            <Button size="sm" variant="primary" disabled={!canRegisterMovement} onClick={openMovement}>
              <Plus className="h-4 w-4" /> Movimiento manual
            </Button>
          </>
        }
      />

      {IS_DATABASE && loadError && (
        <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
          <div className="text-sm font-semibold text-ink">No pudimos cargar el stock</div>
          <p className="mt-1 text-xs text-ink-muted" role="alert">{loadError}</p>
          <Button className="mt-3" size="sm" variant="outline" disabled={loading} onClick={() => void loadStock()}>Reintentar</Button>
        </div>
      )}

      {IS_DATABASE && loading ? (
        <div role="status" className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando stock…
        </div>
      ) : loadError ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Insumos críticos" value={String(criticos)} tone="danger" hint="En o por debajo del mínimo" />
            <KpiCard label="En alerta" value={String(alertas)} tone="default" />
            <KpiCard label="Cobertura promedio" value={IS_DATABASE ? "—" : "4 días"} delta={IS_DATABASE ? undefined : -1.2} hint={IS_DATABASE ? "Historial completo sin verificar" : undefined} />
            <KpiCard label="Última actualización" value={IS_DATABASE ? formatLastUpdated(databaseData?.lastUpdatedAt ?? null) : "hace 9 min"} hint={IS_DATABASE ? "Última actualización de existencias" : "Foto enviada por Lucía"} />
          </div>

          {!IS_DATABASE && (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <InsightCard tone="danger" icon="TrendingUp" title="Pan brioche se queda en menos de 24 horas" detail="Sugerimos pedir 200 unidades a La Espiga antes de las 14hs." />
              <InsightCard tone="warn" icon="Sparkles" title="Cheddar bajo: 8kg quedan" detail="Cobertura estimada de 2 días al ritmo actual de venta." />
              <InsightCard tone="success" icon="Target" title="Papas y aceite con buena cobertura" detail="9 y 6 días respectivamente. No requieren acción." />
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Boxes className="h-4 w-4" /> Estado actual de insumos</CardTitle>
              <Badge tone={criticos > 0 ? "warn" : "default"}><AlertTriangle className="h-3 w-3" /> {criticos} críticos</Badge>
            </CardHeader>
            {rows.length === 0 ? (
              <CardContent>
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">
                  {canRegisterMovement ? "Todavía no hay existencias cargadas. Usá “Movimiento manual” para registrar el primer stock de un insumo." : "No hay existencias registradas en las sucursales a las que tenés acceso."}
                </div>
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Insumo</th>
                      <th className="px-5 py-2.5 font-medium">Sucursal</th>
                      <th className="px-5 py-2.5 font-medium">Stock actual</th>
                      <th className="px-5 py-2.5 font-medium">Mínimo</th>
                      <th className="px-5 py-2.5 font-medium">Cobertura</th>
                      <th className="px-5 py-2.5 font-medium">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const ratio = row.minimo > 0 ? Math.min(100, (row.stock / row.minimo) * 80) : 100;
                      const cfg = STATE_STYLES[row.estado as keyof typeof STATE_STYLES];
                      return (
                        <tr key={row.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                          <td className="px-5 py-3 font-medium text-ink">{row.insumo}</td>
                          <td className="px-5 py-3 text-ink-muted">{row.branchName}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-3">
                              <span className="w-20 text-sm tabular-nums text-ink">{row.stock} {row.unidad}</span>
                              <div className="h-1.5 w-32 overflow-hidden rounded-full bg-bg-subtle">
                                <div className={cn("h-full rounded-full", row.estado === "critico" ? "bg-danger-500" : row.estado === "alerta" ? "bg-warn-500" : "bg-success-500")} style={{ width: `${ratio}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3 tabular-nums text-ink-muted">{row.minimo} {row.unidad}</td>
                          <td className="px-5 py-3 tabular-nums text-ink-muted">{row.dias == null ? "—" : `${row.dias} días`}</td>
                          <td className="px-5 py-3"><Badge tone={cfg.tone}>{cfg.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      {IS_DATABASE && databaseData && <ReplenishmentPanel branches={databaseData.branches} revision={historyQuery.revision} />}

      {IS_DATABASE && (
        <Card>
          <CardHeader className="flex-wrap gap-3">
            <CardTitle className="flex items-center gap-2"><History className="h-4 w-4" /> Historial de movimientos</CardTitle>
            <Button size="sm" variant="ghost" disabled={historyLoading} onClick={() => setHistoryQuery((current) => ({ ...current, page: 1, revision: current.revision + 1 }))}>
              <RefreshCw className="h-4 w-4" /> Actualizar historial
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-ink-muted">Todos los movimientos registrados, incluidos los anteriores a la auditoría ampliada. Fechas en hora argentina.</p>
            {databaseData && !databaseData.canAdjust && <p className="text-xs text-ink-muted">Tu rol permite consultar stock, pero no registrar movimientos.</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-ink-muted">
                <span>Sucursal</span>
                <select aria-label="Filtrar historial por sucursal" value={historyQuery.branchId} onChange={(event) => setHistoryQuery((current) => ({ ...current, branchId: event.target.value, page: 1 }))} className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink">
                  <option value="">Todas las sucursales accesibles</option>
                  {(databaseData?.branches ?? []).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              <label className="space-y-1 text-xs text-ink-muted">
                <span>Insumo</span>
                <select aria-label="Filtrar historial por insumo" value={historyQuery.ingredientId} onChange={(event) => setHistoryQuery((current) => ({ ...current, ingredientId: event.target.value, page: 1 }))} className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink">
                  <option value="">Todos los insumos</option>
                  {(databaseData?.ingredients ?? []).map((ingredient) => <option key={ingredient.id} value={ingredient.id}>{ingredient.name}</option>)}
                </select>
              </label>
            </div>
            {historyLoading ? (
              <div role="status" className="py-8 text-center text-sm text-ink-muted"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando movimientos…</div>
            ) : historyError ? (
              <div role="alert" className="rounded-xl border border-warn-500/30 p-4 text-sm text-ink-muted">
                <p>{historyError}</p>
                <Button className="mt-3" size="sm" variant="outline" onClick={() => void loadHistory()}>Reintentar historial</Button>
              </div>
            ) : historyData && historyData.items.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">No hay movimientos registrados para estos filtros.</p>
            ) : historyData ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[1000px] text-xs">
                    <thead className="border-y border-line text-left uppercase tracking-wider text-ink-subtle">
                      <tr>{["Fecha · insumo", "Sucursal · origen", "Movimiento · motivo", "Cantidad ingresada", "Variación", "Saldo anterior → nuevo", "Responsable"].map((label) => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {historyData.items.map((movement) => (
                        <tr key={movement.id} className="border-b border-line/60 align-top last:border-0">
                          <td className="px-3 py-3"><div className="whitespace-nowrap text-ink-muted">{formatMovementDate(movement.createdAt)}</div><div className="mt-1 font-medium text-ink">{movement.ingredientName}</div>{movement.legacy && <Badge className="mt-2" tone="default">Registro anterior (legacy)</Badge>}</td>
                          <td className="px-3 py-3"><div>{movement.branchName}</div><div className="mt-1 text-ink-muted">{movement.source ? SOURCE_LABELS[movement.source] ?? movement.source : "Origen sin registrar"}</div></td>
                          <td className="max-w-64 px-3 py-3"><div className="font-medium text-ink">{OPERATION_LABELS[movement.operation ?? movement.reason] ?? movement.operation ?? movement.reason}</div><p className="mt-1 whitespace-pre-wrap break-words text-ink-muted">{movement.reasonNote ?? "Motivo detallado sin registrar"}</p></td>
                          <td className="px-3 py-3 tabular-nums">{formatQuantity(movement.inputQuantity, movement.inputUnit)}</td>
                          <td className="px-3 py-3 tabular-nums">{formatQuantity(movement.delta, movement.baseUnit, true)}{!movement.baseUnit && <div className="mt-1 text-ink-subtle">Unidad no registrada</div>}{movement.legacy && <div className="mt-1 text-ink-subtle">Impacto histórico no verificado</div>}</td>
                          <td className="px-3 py-3 tabular-nums">{movement.balanceBefore === null || movement.balanceAfter === null ? "Saldos sin registrar" : `${formatQuantity(movement.balanceBefore, movement.baseUnit)} → ${formatQuantity(movement.balanceAfter, movement.baseUnit)}`}</td>
                          <td className="px-3 py-3"><div>{movement.actorName ?? "Sin registrar"}</div>{movement.actorRole && <div className="mt-1 text-ink-muted">{getRoleLabel(movement.actorRole as Role)}</div>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                  <span className="text-xs text-ink-muted">{(historyData.page - 1) * historyData.pageSize + 1}–{Math.min(historyData.page * historyData.pageSize, historyData.total)} de {historyData.total} movimientos · Página {historyData.page} de {Math.max(1, Math.ceil(historyData.total / historyData.pageSize))}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={historyData.page <= 1} onClick={() => setHistoryQuery((current) => ({ ...current, page: current.page - 1 }))}>Anterior</Button>
                    <Button size="sm" variant="outline" disabled={historyData.page * historyData.pageSize >= historyData.total} onClick={() => setHistoryQuery((current) => ({ ...current, page: current.page + 1 }))}>Siguiente</Button>
                  </div>
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      <Drawer
        open={movementOpen}
        onClose={() => !savingRef.current && setMovementOpen(false)}
        title="Registrar movimiento de stock"
        description="La operación queda registrada en el historial de la sucursal."
      >
        <form onSubmit={submitMovement} className="p-6" aria-busy={saving}>
          <fieldset disabled={saving} className="space-y-5 disabled:opacity-70">
            <label className="block space-y-2">
              <span className="text-xs font-medium text-ink-muted">Insumo</span>
              <select
                value={ingredientId}
                onChange={(event) => { setIngredientId(event.target.value); setInputUnit(""); }}
                className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none focus:border-brand-500"
                required
              >
                {(databaseData?.ingredients ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name} · {item.unit}</option>
                ))}
              </select>
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-medium text-ink-muted">Sucursal</span>
              <select
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
                className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none focus:border-brand-500"
                required
              >
                {(databaseData?.branches ?? []).map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium text-ink-muted">Tipo de movimiento</legend>
              <div className="grid grid-cols-2 gap-2">
                {([
                  ["in", "Entrada"],
                  ["out", "Salida"],
                  ["waste", "Merma"],
                  ["set", "Corrección"],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setOperation(value)}
                    aria-pressed={operation === value}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-xs font-medium transition",
                      operation === value
                        ? "border-brand-500 bg-brand-500/10 text-ink"
                        : "border-line bg-bg text-ink-muted hover:text-ink",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>

            <label className="block space-y-2">
              <span className="text-xs font-medium text-ink-muted">
                {operation === "set" ? "Nuevo stock exacto" : "Cantidad"}
              </span>
              <input
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none focus:border-brand-500"
                placeholder={operation === "set" ? "Ej. 25" : "Ej. 5"}
                required
              />
              <p className="text-xs text-ink-subtle">
                {operation === "in" && "Suma la cantidad al stock actual."}
                {(operation === "out" || operation === "waste") && "Descuenta la cantidad. No se permiten existencias negativas."}
                {operation === "set" && "Reemplaza el stock actual por el valor indicado."}
              </p>
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-medium text-ink-muted">Unidad de la cantidad</span>
              <select value={inputUnit} onChange={(event) => setInputUnit(event.target.value)} className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink">
                <option value="">Unidad base: {selectedIngredient?.unit ?? "Sin definir"}</option>
                {compatibleUnits.filter((unit) => unit !== baseUnit).map((unit) => <option key={unit} value={unit}>{unit}</option>)}
              </select>
              {baseUnit ? <p className="text-xs text-ink-subtle">{convertedQuantity !== null ? `Equivale a ${formatQuantity(convertedQuantity, baseUnit)}. ` : ""}Solo se convierten kg/g y l/ml; las unidades no equivalen a pesos ni volúmenes.</p> : <p className="text-xs text-danger-500">La unidad base no está soportada. Revisá el insumo antes de registrar un movimiento.</p>}
            </label>

            <label className="block space-y-2">
              <span className="text-xs font-medium text-ink-muted">Motivo obligatorio</span>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={1000} rows={3} placeholder="Ej. Merma por vencimiento o corrección por conteo físico" className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink outline-none focus:border-brand-500" />
            </label>
            {movementError && <p role="alert" className="rounded-lg border border-warn-500/30 bg-warn-500/5 p-3 text-sm text-ink">{movementError}</p>}
            <div className="flex justify-end gap-2 border-t border-line pt-5">
              <Button type="button" variant="ghost" onClick={() => !savingRef.current && setMovementOpen(false)} disabled={saving}>
                {unconfirmed ? "Cerrar y revisar historial" : "Cancelar"}
              </Button>
              <Button type="submit" variant="primary" disabled={saving || unconfirmed || !canRegisterMovement || !ingredientId || !branchId || !reason.trim() || !quantity.trim() || !baseUnit}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Registrar movimiento
              </Button>
            </div>
          </fieldset>
        </form>
      </Drawer>
    </div>
  );
}
