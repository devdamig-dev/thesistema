"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { getRecipeAction, saveRecipeAction, type IngredientRow } from "@/app/actions/catalog";
import type { ProductRow } from "@/app/actions/products-page";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { formatARS, formatPercent } from "@/lib/format";
import { RECIPE_UNITS, RecipeCalculationError, calculateGrossMargin, calculateIngredientCost, calculateRecipeCost, convertQuantity, normalizeUnit } from "@/lib/recipes/quantities";

const inputClass = "h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none focus:border-brand-500 disabled:opacity-60";
const units = RECIPE_UNITS;
const moneyFormatter = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 6 });
const quantityFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 9 });
const unitLabels: Record<string, string> = { unit: "unidad", kg: "kg", g: "g", l: "l", ml: "ml" };
type RecipeDraftItem = { key: number; ingredientId: string; quantity: string; unit: string; name: string };

export function RecipeEditor({ product, ingredients, canEdit, onClose, onSaved }: {
  product: ProductRow;
  ingredients: IngredientRow[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<RecipeDraftItem[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [conflict, setConflict] = useState(false);
  const request = useRef(0);
  const saving = useRef(false);
  const nextKey = useRef(0);
  const ingredientMap = useMemo(() => new Map(ingredients.map((item) => [item.id, item])), [ingredients]);

  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true);
    setLoadError(null);
    setError(null);
    setConflict(false);
    try {
      const result = await getRecipeAction(product.id);
      if (version !== request.current) return;
      if (!result.ok) {
        setLoadError("message" in result ? result.message : result.error);
        return;
      }
      if (result.data.productId !== product.id) {
        setLoadError("La respuesta no corresponde a este producto. Volvé a cargar la composición.");
        return;
      }
      setUpdatedAt(result.data.updatedAt);
      setRows(result.data.items.map((item) => ({
        key: ++nextKey.current,
        ingredientId: item.ingredientId,
        quantity: item.quantity === null ? "" : String(item.quantity),
        unit: normalizeUnit(item.unit) ?? item.unit ?? "",
        name: item.name,
      })));
    } catch {
      if (version === request.current) setLoadError("No pudimos cargar la composición. Reintentá en unos segundos.");
    } finally {
      if (version === request.current) setLoading(false);
    }
  }, [product.id]);

  useEffect(() => {
    void load();
    return () => { request.current += 1; };
  }, [load]);

  const calculations = rows.map((row) => {
    const ingredient = ingredientMap.get(row.ingredientId);
    if (!ingredient) return { cost: null, base: null, reason: "Seleccioná un insumo disponible." };
    try {
      const quantity = row.quantity.replace(",", ".");
      const base = convertQuantity(quantity, row.unit, ingredient.unit);
      const cost = calculateIngredientCost(quantity, row.unit, ingredient.unit, ingredient.unitCost);
      return { cost, base, reason: null };
    } catch (failure) {
      return { cost: null, base: null, reason: failure instanceof RecipeCalculationError ? failure.message : "No pudimos calcular el costo de este insumo." };
    }
  });
  let cost: number | null = null;
  let margin: number | null = null;
  let previewError: string | null = null;
  if (rows.length > 0 && calculations.every((item) => item.cost !== null)) {
    try {
      cost = calculateRecipeCost(rows.map((row) => {
        const ingredient = ingredientMap.get(row.ingredientId);
        return { quantity: row.quantity.replace(",", "."), unit: row.unit, ingredient: ingredient ? { unit: ingredient.unit, avg_unit_cost: ingredient.unitCost } : null };
      }));
      margin = calculateGrossMargin(product.price, cost);
    } catch (failure) {
      previewError = failure instanceof RecipeCalculationError ? failure.message : "No pudimos calcular el costo total.";
    }
  }

  function patchRow(key: number, patch: Partial<RecipeDraftItem>) {
    if (saving.current || !canEdit) return;
    setRows((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
    setError(null);
  }

  function close() {
    if (saving.current) return;
    request.current += 1;
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || loading || loadError || !canEdit) return;
    if (previewError) return setError(previewError);
    const ids = new Set<string>();
    const items: { ingredientId: string; quantity: number; unit: string }[] = [];
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (calculations[index].reason) return setError(`Insumo ${index + 1}: ${calculations[index].reason}`);
      if (ids.has(row.ingredientId)) return setError("Cada insumo debe aparecer una sola vez. Sumá sus cantidades en una fila.");
      if (!ingredientMap.get(row.ingredientId)?.active) return setError("La composición contiene un insumo archivado. Reactivalo o reemplazalo antes de guardar.");
      ids.add(row.ingredientId);
      items.push({ ingredientId: row.ingredientId, quantity: Number(row.quantity.replace(",", ".")), unit: row.unit });
    }
    saving.current = true;
    setPending(true);
    setError(null);
    const version = request.current;
    try {
      const result = await saveRecipeAction(product.id, { expectedUpdatedAt: updatedAt, items });
      if (version !== request.current) return;
      if (!result.ok) {
        const message = "message" in result ? result.message : result.error;
        setError(message);
        setConflict(/conflict|modific|cambi|actualiz|recarg/i.test(message));
        return;
      }
      toast({ tone: "success", title: rows.length ? "Composición guardada" : "Producto sin composición", description: "Los cambios quedaron guardados. El stock actual no se modifica al editar una receta." });
      onClose();
      void onSaved();
    } catch {
      if (version === request.current) setError("No pudimos confirmar el guardado. Tus cambios siguen acá; podés reintentar. Si se guardaron, el control de versión evitará sobrescribirlos.");
    } finally {
      saving.current = false;
      if (version === request.current) setPending(false);
    }
  }

  return (
    <Drawer open onClose={close} title={`Composición · ${product.name}`} description="Insumos utilizados por cada unidad vendida. La composición es opcional." width="max-w-2xl">
      {loading ? (
        <div className="p-8 text-center text-sm text-ink-muted" role="status"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando composición…</div>
      ) : loadError ? (
        <div className="space-y-3 p-6"><p role="alert" className="text-sm text-danger-300">{loadError}</p><Button onClick={() => void load()}>Reintentar</Button></div>
      ) : (
        <form onSubmit={submit} className="space-y-5 p-6" aria-busy={pending}>
          {!canEdit && <p className="rounded-lg border border-line p-3 text-sm text-ink-muted">Tu rol permite consultar la composición, pero no modificarla.</p>}
          <fieldset disabled={pending || !canEdit} className="min-w-0 space-y-4">
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line p-5 text-sm text-ink-muted">Sin composición. Al guardar, el producto deja de tener consumo teórico de insumos y conserva su costo actual como costo base editable.</div>
            ) : rows.map((row, index) => {
              const ingredient = ingredientMap.get(row.ingredientId);
              const calculation = calculations[index];
              return (
                <div key={row.key} className="space-y-3 rounded-xl border border-line p-4">
                  <div className="flex items-end gap-2">
                    <label className="min-w-0 flex-1 space-y-1.5"><span className="text-xs font-medium text-ink-muted">Insumo {index + 1}</span>
                      <select required className={inputClass} value={row.ingredientId} onChange={(event) => {
                        const selected = ingredientMap.get(event.target.value);
                        patchRow(row.key, { ingredientId: event.target.value, unit: normalizeUnit(selected?.unit) ?? selected?.unit ?? "", name: selected?.name ?? "" });
                      }}>
                        <option value="">Seleccionar insumo</option>
                        {row.ingredientId && !ingredient && <option value={row.ingredientId}>{row.name || "Insumo no disponible"} · no disponible</option>}
                        {ingredients.filter((item) => item.active || item.id === row.ingredientId).map((item) => <option key={item.id} value={item.id} disabled={item.id !== row.ingredientId && rows.some((other) => other.ingredientId === item.id)}>{item.name}{!item.active ? " · archivado" : ""}</option>)}
                      </select>
                    </label>
                    {canEdit && <Button type="button" variant="subtle" size="icon" aria-label={`Quitar ${ingredient?.name || `insumo ${index + 1}`}`} onClick={() => { if (!saving.current) setRows((current) => current.filter((item) => item.key !== row.key)); }}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1.5"><span className="text-xs font-medium text-ink-muted">Cantidad por producto</span><input required type="number" min="0" step="any" inputMode="decimal" className={inputClass} value={row.quantity} onChange={(event) => patchRow(row.key, { quantity: event.target.value })} /></label>
                    <label className="space-y-1.5"><span className="text-xs font-medium text-ink-muted">Unidad utilizada</span><select required className={inputClass} value={row.unit} onChange={(event) => patchRow(row.key, { unit: event.target.value })}><option value="">Seleccionar unidad</option>{row.unit && !units.includes(row.unit as typeof units[number]) && <option value={row.unit}>{row.unit} · revisar unidad</option>}{units.map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}</select></label>
                  </div>
                  <p className="text-xs text-ink-muted">{ingredient ? `Costo base: ${ingredient.unitCost !== null && Number.isFinite(ingredient.unitCost) ? moneyFormatter.format(ingredient.unitCost) : "sin dato"} por ${unitLabels[ingredient.unit] ?? ingredient.unit}. ` : ""}{calculation.cost !== null && calculation.base !== null ? `${quantityFormatter.format(calculation.base)} ${unitLabels[ingredient?.unit ?? ""] ?? ingredient?.unit} = ${moneyFormatter.format(calculation.cost)}` : calculation.reason}</p>
                  {ingredient && !ingredient.active && <p className="text-xs text-warn-300">Este insumo está archivado. Reactivalo o reemplazalo para guardar.</p>}
                </div>
              );
            })}
            {canEdit && <Button type="button" size="sm" onClick={() => { if (!saving.current) setRows((current) => [...current, { key: ++nextKey.current, ingredientId: "", quantity: "", unit: "", name: "" }]); }} disabled={rows.length >= 100 || !ingredients.some((item) => item.active && !rows.some((row) => row.ingredientId === item.id))}><Plus className="h-4 w-4" /> Agregar insumo</Button>}
          </fieldset>
          {ingredients.length === 0 && <p className="text-xs text-ink-muted">Creá insumos en la pestaña Insumos para poder vincularlos.</p>}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-bg-subtle/50 p-4" aria-live="polite">
            <div><p className="text-xs text-ink-muted">Costo estimado por producto</p><p className="mt-1 text-lg font-semibold text-ink">{cost !== null && Number.isFinite(cost) ? moneyFormatter.format(cost) : "Sin calcular"}</p></div>
            <div><p className="text-xs text-ink-muted">Margen bruto aproximado</p><p className="mt-1 text-lg font-semibold text-ink">{margin !== null ? formatPercent(margin) : "Sin calcular"}</p></div>
            <p className="col-span-2 text-xs text-ink-muted">Precio de venta: {formatARS(product.price)}. Se usa la cantidad convertida a la unidad base y el costo actual de cada insumo. No incluye merma ni otros gastos.</p>
          </div>
          {previewError && <p role="alert" className="text-sm text-danger-300">{previewError}</p>}
          {error && <div role="alert" className="space-y-2 rounded-lg border border-danger-500/30 bg-danger-500/[0.06] p-3 text-sm text-danger-300"><p>{error}</p>{conflict && <Button type="button" size="sm" onClick={() => void load()} disabled={pending}>Descartar cambios y recargar</Button>}</div>}
          <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" onClick={close} disabled={pending}>{canEdit ? "Cancelar" : "Cerrar"}</Button>{canEdit && <Button type="submit" variant="primary" disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{pending ? "Guardando…" : "Guardar composición"}</Button>}</div>
        </form>
      )}
    </Drawer>
  );
}
