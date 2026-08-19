"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, Boxes, Loader2, Plus, Sparkles } from "lucide-react";
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
import {
  adjustStockManualAction,
  getStockPageDataAction,
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
  if (!value) return "Sin movimientos";
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Argentina/Buenos_Aires",
  }).format(new Date(value));
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

  const loadStock = async () => {
    if (!IS_DATABASE) return;
    setLoading(true);
    try {
      const res = await getStockPageDataAction();
      if (!res.ok) {
        setLoadError(res.error);
        setDatabaseData(null);
        return;
      }
      setDatabaseData(res.data);
      setLoadError(null);
    } catch {
      setLoadError("No pudimos cargar el stock.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStock();
  }, []);

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
    IS_DATABASE && databaseData?.branches.length && databaseData?.ingredients.length,
  );

  const openMovement = () => {
    if (!databaseData) return;
    setIngredientId((current) => current || databaseData.ingredients[0]?.id || "");
    setBranchId((current) => current || databaseData.branches[0]?.id || "");
    setOperation("in");
    setQuantity("");
    setMovementOpen(true);
  };

  const submitMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!ingredientId || !branchId) return;
    const parsedQuantity = Number(quantity.replace(",", "."));
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0 || (operation !== "set" && parsedQuantity <= 0)) {
      toast({ tone: "danger", title: "Revisá la cantidad", description: "Ingresá una cantidad válida para continuar." });
      return;
    }

    setSaving(true);
    try {
      const result = await adjustStockManualAction({
        ingredientId,
        branchId,
        operation,
        quantity: parsedQuantity,
      });
      if (!result.ok) {
        toast({ tone: "danger", title: "No pudimos registrar el movimiento", description: result.error });
        return;
      }
      toast({
        tone: "success",
        title: "Movimiento registrado",
        description: `${selectedIngredient?.name ?? "Insumo"}: stock actualizado a ${result.newCurrent} ${selectedIngredient?.unit ?? "u"}.`,
      });
      setMovementOpen(false);
      setQuantity("");
      await loadStock();
    } catch {
      toast({ tone: "danger", title: "No pudimos registrar el movimiento", description: "Intentá nuevamente." });
    } finally {
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
            <Button
              size="sm"
              variant="ghost"
              disabled={IS_DATABASE}
              onClick={() =>
                toast({
                  tone: "ai",
                  title: "Reposición sugerida",
                  description: "Generamos un borrador de orden con pan brioche, cheddar y bacon.",
                })
              }
            >
              <Sparkles className="h-4 w-4" /> Sugerir reposición
            </Button>
            <Button size="sm" variant="primary" disabled={!canRegisterMovement} onClick={openMovement}>
              <Plus className="h-4 w-4" /> Movimiento manual
            </Button>
          </>
        }
      />

      {IS_DATABASE && loadError && (
        <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
          <div className="text-sm font-semibold text-ink">No pudimos cargar el stock</div>
          <p className="mt-1 text-xs text-ink-muted">{loadError} Intentá nuevamente en unos minutos.</p>
        </div>
      )}

      {IS_DATABASE && loading ? (
        <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando stock…
        </div>
      ) : loadError ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Insumos críticos" value={String(criticos)} tone="danger" hint="En o por debajo del mínimo" />
            <KpiCard label="En alerta" value={String(alertas)} tone="default" />
            <KpiCard label="Cobertura promedio" value={IS_DATABASE ? "—" : "4 días"} delta={IS_DATABASE ? undefined : -1.2} hint={IS_DATABASE ? "Se calcula con historial de consumo" : undefined} />
            <KpiCard label="Última actualización" value={IS_DATABASE ? formatLastUpdated(databaseData?.lastUpdatedAt ?? null) : "hace 9 min"} hint={IS_DATABASE ? "Último movimiento registrado" : "Foto enviada por Lucía"} />
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
                  Todavía no hay existencias cargadas. Usá “Movimiento manual” para registrar el primer stock de un insumo.
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

      <Drawer
        open={movementOpen}
        onClose={() => !saving && setMovementOpen(false)}
        title="Registrar movimiento de stock"
        description="La operación queda registrada en el historial de la sucursal."
      >
        <form onSubmit={submitMovement} className="space-y-5 p-6">
          <label className="block space-y-2">
            <span className="text-xs font-medium text-ink-muted">Insumo</span>
            <select
              value={ingredientId}
              onChange={(event) => setIngredientId(event.target.value)}
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
            <div className="grid grid-cols-3 gap-2">
              {([
                ["in", "Entrada"],
                ["out", "Salida"],
                ["set", "Stock exacto"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setOperation(value)}
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
              {operation === "set" ? "Nuevo stock" : "Cantidad"} {selectedIngredient?.unit ? `(${selectedIngredient.unit})` : ""}
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none focus:border-brand-500"
              placeholder={operation === "set" ? "Ej. 25" : "Ej. 5"}
              required
            />
            <p className="text-xs text-ink-subtle">
              {operation === "in" && "Suma la cantidad al stock actual."}
              {operation === "out" && "Descuenta la cantidad. No se permiten existencias negativas."}
              {operation === "set" && "Reemplaza el stock actual por el valor indicado."}
            </p>
          </label>

          <div className="flex justify-end gap-2 border-t border-line pt-5">
            <Button type="button" variant="ghost" onClick={() => setMovementOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !ingredientId || !branchId}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Registrar movimiento
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}
