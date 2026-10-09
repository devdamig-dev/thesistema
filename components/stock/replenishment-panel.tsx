"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getStockReplenishmentAction, type StockOption } from "@/app/actions/stock-page";
import type { ReplenishmentReport, ReplenishmentRow } from "@/lib/replenishment/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const labels: Record<ReplenishmentRow["attention"], string> = {
  archived: "Insumo archivado; sin reposición sugerida", below_minimum: "Por debajo del mínimo", at_minimum: "En el mínimo",
  below_recorded_period_usage: "Existencia ≤ salidas del período",
  below_theoretical_period_usage: "Existencia ≤ consumo teórico del período",
  no_basis: "Stock, mínimo o unidad sin verificar", none: "Sin señal de reposición en estos datos",
};
const qty = (value: number | null) => value === null ? "Sin verificar" : value.toLocaleString("es-AR", { maximumFractionDigits: 6 });

export function ReplenishmentPanel({ branches, revision }: { branches: StockOption[]; revision: number }) {
  const [branchId, setBranchId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [report, setReport] = useState<ReplenishmentReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const request = useRef(0);
  const busy = useRef(false);
  const invalidate = () => { request.current++; busy.current = false; setLoading(false); setReport(null); setError(null); };
  useEffect(() => {
    request.current++; busy.current = false; setLoading(false); setReport(null); setError(null);
    const activeRequest = request;
    return () => { activeRequest.current++; };
  }, [revision]);
  const selectedBranch = branchId || (branches.length === 1 ? branches[0].id : "");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || !selectedBranch || !from || !to) return;
    const id = ++request.current; busy.current = true;
    setLoading(true); setReport(null); setError(null);
    try {
      const result = await getStockReplenishmentAction({ branchId: selectedBranch, from, to });
      if (id !== request.current) return;
      if (result.ok) setReport(result.data); else setError(result.error);
    } catch { if (id === request.current) setError("No pudimos consultar la reposición. Intentá nuevamente."); }
    finally { if (id === request.current) { busy.current = false; setLoading(false); } }
  };
  return <Card>
    <CardHeader><CardTitle>Reposición basada en datos reales</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-ink-muted">Elegí un período para revisar salidas registradas, recetas de productos vendidos y compras vinculadas. La cantidad sugerida solo repone el faltante hasta el mínimo actual.</p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3" aria-busy={loading}>
        <label className="min-w-0 flex-1 space-y-1 text-xs">Sucursal de reposición
          <select className="h-10 w-full rounded-lg border border-line bg-bg px-3" aria-label="Sucursal de reposición" value={selectedBranch} required onChange={(event) => { invalidate(); setBranchId(event.target.value); }}>
            <option value="">Elegí una sucursal</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-xs">Desde<input className="block h-10 rounded-lg border border-line bg-bg px-3" aria-label="Reposición desde" type="date" required value={from} onChange={(event) => { invalidate(); setFrom(event.target.value); }} /></label>
        <label className="min-w-0 space-y-1 text-xs">Hasta<input className="block h-10 rounded-lg border border-line bg-bg px-3" aria-label="Reposición hasta" type="date" required value={to} min={from} onChange={(event) => { invalidate(); setTo(event.target.value); }} /></label>
        <Button size="sm" type="submit" disabled={loading || !selectedBranch || !from || !to}>Consultar reposición</Button>
        {(loading || report || error) && <Button size="sm" type="button" variant="ghost" onClick={invalidate}>Limpiar consulta</Button>}
      </form>
      {loading && <p role="status" className="text-sm">Consultando datos del período…</p>}
      {error && <p role="alert" className="text-sm text-danger-500">{error}</p>}
      {report && <div className="space-y-4" aria-label="Informe de reposición">
        <p className="text-sm">{report.branchName} · {report.from} a {report.to} · {report.timezone}{report.partialCurrentDay ? " · Hoy parcial" : ""}. Stock actual al {new Date(report.readAt).toLocaleString("es-AR", { timeZone: report.timezone })}.</p>
        <p className="text-xs text-ink-muted">Salidas físicas, mermas, ajustes y consumo teórico se muestran por separado. No se suman ni se descuentan nuevamente del stock. Comparar el consumo del período con la existencia actual es una señal para revisar; no predice cuándo se agotará. Cobertura en días e integridad del historial: sin verificar. Existencias negativas o inválidas requieren revisión; no se interpretan como cero.</p>
        {!report.visibility.sales && <p className="text-xs">Ventas y recetas no disponibles para tus permisos o módulos.</p>}
        {!report.visibility.purchases && <p className="text-xs">Compras no disponibles para tus permisos o módulos.</p>}
        {report.visibility.sales && <p className="text-xs">Ventas activas: {report.evidence.activeSales}. Sin detalle: {report.evidence.salesWithoutDetail}. Líneas sin receta utilizable: {report.evidence.missingRecipeLines}. Recetas incompletas: {report.evidence.incompleteRecipeLines}. El teórico incluye solo componentes verificables de las recetas guardadas al vender.</p>}
        {report.visibility.purchases && <p className="text-xs">Compras activas: {report.evidence.activePurchases}. Sin detalle vinculado verificable: {report.evidence.purchasesWithoutLinkedDetail}.</p>}
        {!report.rows.length && <p>No hay insumos registrados.</p>}
        {report.rows.map((row) => <details key={row.ingredientId} className="rounded-xl border border-line p-4">
          <summary className="cursor-pointer text-sm"><strong>{row.name}</strong> · {labels[row.attention]} {row.active && <>· Reponer al mínimo: {qty(row.minimumShortfall)} {row.unit}</>}</summary>
          <div className="mt-3 space-y-2 text-sm">
            <p>Actual: {qty(row.current)} {row.unit}. Mínimo: {qty(row.minimum)} {row.unit}.</p>
            <p>Salidas registradas: {qty(row.recordedOutflow)} {row.unit}. Mermas: {qty(row.recordedWaste)} {row.unit}. Ajustes netos: {qty(row.recordedAdjustment)} {row.unit}.</p>
            <p>Reversas de compras: {qty(row.recordedPurchaseReversal)} {row.unit}. Se excluyen del consumo registrado.</p>
            <p>Movimientos verificados: {row.recordedMovementCount}. Sin verificar y excluidos: {row.unverifiedMovementCount}.</p>
            <p>Consumo teórico de recetas: {qty(row.theoreticalUsage)} {row.unit}.</p>
            {row.contributors.length > 0 && <ul className="space-y-1">{row.contributors.map((product) => <li key={`${product.productId}:${product.productName}`}>{product.productName}: {qty(product.soldQuantity)} vendidos → {qty(product.theoreticalQuantity)} {row.unit} teóricos ({product.saleLineCount} líneas).</li>)}</ul>}
            {report.visibility.purchases && <><p>Compras vinculadas en el período ({row.recentReceipts.length}). Cantidades ya registradas; no se agregan al stock en esta consulta.</p>
              {row.recentReceipts.map((receipt) => <p key={receipt.lineId} className="break-words text-xs">{receipt.purchasedAt}: {receipt.description}, {qty(receipt.quantity)} {receipt.unit}. Compra {receipt.purchaseId}.</p>)}
              {row.unverifiedReceiptCount > 0 && <p className="text-xs">{row.unverifiedReceiptCount} líneas de compra excluidas por cantidad o unidad sin verificar.</p>}</>}
          </div>
        </details>)}
      </div>}
    </CardContent>
  </Card>;
}
