"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Loader2, Pencil, Plus } from "lucide-react";
import { saveIngredientAction, type IngredientRow } from "@/app/actions/catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import { formatNumber } from "@/lib/format";
import { RECIPE_UNITS, normalizeUnit } from "@/lib/recipes/quantities";

const inputClass = "h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none focus:border-brand-500 disabled:opacity-60";
const units = RECIPE_UNITS;
const unitCostFormatter = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", minimumFractionDigits: 2, maximumFractionDigits: 6 });
const unitLabels: Record<string, string> = { unit: "unidad", kg: "kg", g: "g", l: "l", ml: "ml" };
type NamedItem = { id: string; name: string };

export function IngredientsPanel({ ingredients, suppliers, branches, canEdit, onSaved, onEditorOpenChange }: {
  ingredients: IngredientRow[];
  suppliers: NamedItem[];
  branches: NamedItem[];
  canEdit: boolean;
  onSaved: () => void | Promise<void>;
  onEditorOpenChange: (open: boolean) => void;
}) {
  const [editor, setEditor] = useState<{ ingredient: IngredientRow | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  function openEditor(ingredient: IngredientRow | null) {
    setEditor({ ingredient });
    onEditorOpenChange(true);
  }
  function closeEditor() {
    setEditor(null);
    onEditorOpenChange(false);
  }
  const visible = ingredients.filter((item) => showArchived || item.active);
  return (
    <>
      <Card>
        <CardHeader>
          <div><CardTitle>Insumos</CardTitle><p className="mt-1 text-xs text-ink-muted">Lo que comprás, almacenás y consumís. Costos por unidad base y mínimos por sucursal.</p></div>
          {canEdit && <Button size="sm" variant="primary" onClick={() => openEditor(null)} disabled={editor !== null}><Plus className="h-4 w-4" /> Nuevo insumo</Button>}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <label className="flex items-center gap-2 text-sm text-ink-muted"><input type="checkbox" className="h-4 w-4" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} /> Mostrar archivados</label>
          <Link href="/stock" aria-disabled={editor !== null} tabIndex={editor ? -1 : undefined} onClick={(event) => { if (editor) event.preventDefault(); }} className="inline-flex items-center gap-1 text-sm text-brand-500 hover:underline">Registrar movimientos de stock <ArrowUpRight className="h-4 w-4" /></Link>
        </CardContent>
        {visible.length === 0 ? <CardContent><div className="rounded-xl border border-dashed border-line p-8 text-center"><p className="text-sm font-medium text-ink">{ingredients.length ? "No hay insumos activos." : "Todavía no cargaste insumos."}</p><p className="mt-1 text-xs text-ink-muted">{canEdit ? "Agregá un insumo con su unidad y costo para usarlo en una composición." : "Los insumos disponibles aparecerán acá."}</p></div></CardContent> : (
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle"><tr><th scope="col" className="px-5 py-2.5 font-medium">Insumo</th><th scope="col" className="px-5 py-2.5 font-medium">Unidad base</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Costo / unidad</th><th scope="col" className="px-5 py-2.5 font-medium">Proveedor habitual</th><th scope="col" className="px-5 py-2.5 font-medium">Stock / mínimo por sucursal</th><th scope="col" className="px-5 py-2.5 font-medium">Estado</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Acción</th></tr></thead>
            <tbody>{visible.map((ingredient) => <tr key={ingredient.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
              <td className="px-5 py-3 font-medium text-ink">{ingredient.name}</td><td className="px-5 py-3 text-ink-muted">{unitLabels[ingredient.unit] ?? ingredient.unit}</td><td className="px-5 py-3 text-right tabular-nums text-ink">{ingredient.unitCost !== null && Number.isFinite(ingredient.unitCost) ? unitCostFormatter.format(ingredient.unitCost) : "Sin dato"}</td><td className="px-5 py-3 text-ink-muted">{suppliers.find((item) => item.id === ingredient.supplierId)?.name ?? (ingredient.supplierId ? "Proveedor no disponible" : "Sin asignar")}</td>
              <td className="px-5 py-3 text-xs text-ink-muted">{ingredient.stock.length ? <ul className="space-y-1">{ingredient.stock.map((stock) => <li key={stock.branchId}><span className="font-medium">{stock.branchName}: </span>{formatNumber(stock.current)} / {formatNumber(stock.minimum)} {unitLabels[ingredient.unit] ?? ingredient.unit}{stock.current < stock.minimum && <span className="ml-2 text-warn-300">Bajo mínimo</span>}</li>)}</ul> : "Sin registros de stock"}</td>
              <td className="px-5 py-3"><Badge tone={ingredient.active ? "success" : "default"}>{ingredient.active ? "Activo" : "Archivado"}</Badge></td>
              <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => openEditor(ingredient)} disabled={editor !== null}>{canEdit && <Pencil className="h-4 w-4" />}{canEdit ? "Editar" : "Ver detalle"}</Button></td>
            </tr>)}</tbody>
          </table></div>
        )}
      </Card>
      {editor && <IngredientEditor key={editor.ingredient?.id ?? "new"} ingredient={editor.ingredient} suppliers={suppliers} branches={branches} canEdit={canEdit} onClose={closeEditor} onSaved={onSaved} />}
    </>
  );
}

function IngredientEditor({ ingredient, suppliers, branches, canEdit, onClose, onSaved }: {
  ingredient: IngredientRow | null;
  suppliers: NamedItem[];
  branches: NamedItem[];
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(ingredient?.name ?? "");
  const [unit, setUnit] = useState(normalizeUnit(ingredient?.unit) ?? ingredient?.unit ?? "unit");
  const [cost, setCost] = useState(ingredient?.unitCost == null ? "" : String(ingredient.unitCost));
  const [supplierId, setSupplierId] = useState(ingredient?.supplierId ?? "");
  const [active, setActive] = useState(ingredient?.active ?? true);
  const [minimums, setMinimums] = useState<Record<string, string>>(() => Object.fromEntries(branches.map((branch) => {
    const stock = ingredient?.stock.find((item) => item.branchId === branch.id);
    return [branch.id, stock ? String(stock.minimum) : ""];
  })));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  function close() {
    if (!saving.current) onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current || uncertainCreate || !canEdit) return;
    if (!name.trim()) return setError("Ingresá el nombre del insumo.");
    if (!units.includes(unit as typeof units[number])) return setError("Elegí una unidad base válida.");
    const unitCost = Number(cost.replace(",", "."));
    if (!cost.trim() || !Number.isFinite(unitCost) || unitCost < 0) return setError("Ingresá un costo por unidad válido, mayor o igual a cero.");
    const parsedMinimums: { branchId: string; minimum: number }[] = [];
    for (const branch of branches) {
      const raw = minimums[branch.id] ?? "";
      if (!raw.trim()) continue;
      const minimum = Number(raw.replace(",", "."));
      if (!Number.isFinite(minimum) || minimum < 0) return setError(`El mínimo de ${branch.name} debe ser mayor o igual a cero.`);
      parsedMinimums.push({ branchId: branch.id, minimum });
    }
    saving.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await saveIngredientAction(ingredient?.id ?? null, { name: name.trim(), unit, unitCost, active, supplierId: supplierId || null, minimums: parsedMinimums });
      if (!mounted.current) return;
      if (!result.ok) {
        setError("message" in result ? result.message : result.error);
        return;
      }
      toast({ tone: "success", title: active ? (ingredient ? "Insumo actualizado" : "Insumo creado") : "Insumo archivado", description: "El stock actual no cambió. Registrá entradas, salidas o ajustes desde Stock." });
      onClose();
      void onSaved();
    } catch {
      if (mounted.current) {
        if (!ingredient) setUncertainCreate(true);
        setError("No pudimos confirmar el guardado. Revisá el listado antes de repetir el alta para evitar duplicados.");
      }
    } finally {
      saving.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return <Drawer open onClose={close} title={ingredient ? `${canEdit ? "Editar" : "Detalle"} · ${ingredient.name}` : "Nuevo insumo"} description="La unidad base define cómo se expresa el stock y cuánto cuesta una unidad." width="max-w-xl">
    <form onSubmit={submit} className="space-y-5 p-6" aria-busy={pending}>
      <fieldset disabled={pending || uncertainCreate || !canEdit} className="min-w-0 space-y-5">
        <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-muted">Nombre *</span><input required className={inputClass} value={name} onChange={(event) => setName(event.target.value)} maxLength={200} /></label>
        <div className="grid grid-cols-2 gap-4">
          <label className="space-y-1.5"><span className="text-xs font-medium text-ink-muted">Unidad base *</span><select required className={inputClass} value={unit} onChange={(event) => setUnit(event.target.value)}>{!units.includes(unit as typeof units[number]) && <option value={unit}>{unit} · revisar unidad</option>}{units.map((value) => <option key={value} value={value}>{unitLabels[value]}</option>)}</select></label>
          <label className="space-y-1.5"><span className="text-xs font-medium text-ink-muted">Costo por {unitLabels[unit] ?? unit} (ARS) *</span><input required className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={cost} onChange={(event) => setCost(event.target.value)} /></label>
        </div>
        {ingredient && unit !== (normalizeUnit(ingredient.unit) ?? ingredient.unit) && <p className="text-xs text-warn-300">Cambiar la unidad base afecta la interpretación de costos y cantidades. Si ya tiene stock o recetas, el sistema puede impedir el cambio para conservar su coherencia.</p>}
        <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-muted">Proveedor habitual</span><select className={inputClass} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Sin asignar</option>{supplierId && !suppliers.some((item) => item.id === supplierId) && <option value={supplierId}>Proveedor no disponible · quitá la asignación o elegí otro</option>}{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
        <label className="flex items-start justify-between gap-3 rounded-xl border border-line p-4"><div><span className="text-sm font-medium text-ink">Insumo activo</span><p className="mt-1 text-xs text-ink-muted">Desmarcá para archivarlo. Conserva su historial y las composiciones que lo usan.</p></div><input type="checkbox" className="mt-0.5 h-4 w-4" checked={active} onChange={(event) => setActive(event.target.checked)} /></label>
        <div className="space-y-3"><h3 className="text-sm font-medium text-ink">Mínimos por sucursal</h3><p className="text-xs text-ink-muted">Expresados en {unitLabels[unit] ?? unit}. El mínimo es un umbral de alerta; no modifica existencias. Usá 0 para quitar un mínimo existente.</p>
          {branches.length === 0 ? <p className="rounded-lg border border-line p-3 text-xs text-ink-muted">No hay sucursales disponibles para configurar mínimos.</p> : branches.map((branch) => {
            const stock = ingredient?.stock.find((item) => item.branchId === branch.id);
            return <div key={branch.id} className="grid grid-cols-2 items-center gap-4 rounded-lg border border-line p-3"><div><p className="text-sm font-medium text-ink">{branch.name}</p><p className="text-xs text-ink-muted">Stock actual: {stock ? `${formatNumber(stock.current)} ${unitLabels[ingredient?.unit ?? ""] ?? ingredient?.unit}` : "sin registro"}</p></div><label className="space-y-1.5"><span className="text-xs text-ink-muted">Stock mínimo</span><input aria-label={`Stock mínimo en ${branch.name}`} className={inputClass} type="number" min="0" step="any" inputMode="decimal" value={minimums[branch.id] ?? ""} placeholder="Sin configurar" onChange={(event) => setMinimums((current) => ({ ...current, [branch.id]: event.target.value }))} /></label></div>;
          })}
        </div>
      </fieldset>
      <p className="text-xs text-ink-muted">Las existencias son de sólo lectura acá. {pending ? "Los movimientos se registran en Stock." : <Link href="/stock" className="text-brand-500 hover:underline">Ir a Stock para registrar movimientos.</Link>}</p>
      {error && <p role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/[0.06] p-3 text-sm text-danger-300">{error}</p>}
      {uncertainCreate && <Button type="button" onClick={() => { onClose(); void onSaved(); }}>Cerrar y revisar catálogo</Button>}
      <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" onClick={close} disabled={pending}>{canEdit ? "Cancelar" : "Cerrar"}</Button>{canEdit && <Button type="submit" variant="primary" disabled={pending || uncertainCreate}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{pending ? "Guardando…" : active ? "Guardar insumo" : "Guardar y archivar"}</Button>}</div>
    </form>
  </Drawer>;
}
