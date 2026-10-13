"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { FlaskConical, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { KpiCard } from "@/components/ui/kpi-card";
import { useToast } from "@/components/ui/toast";
import { formatARS, formatPercent } from "@/lib/format";
import { getCatalogDataAction, saveRecipeAction, type CatalogData, type RecipeInput } from "@/app/actions/catalog";
import { RECIPE_UNITS, convertQuantity, calculateIngredientCost, calculateGrossMargin } from "@/lib/recipes/quantities";
import { createProductAction, getProductsPageDataAction, updateProductAction, type ProductInput, type ProductRow } from "@/app/actions/products-page";
import { IngredientsPanel } from "./ingredients-panel";
import { RecipeEditor } from "./recipe-editor";

type FormState = { name: string; category: string; price: string; cost: string; active: boolean };
const EMPTY_FORM: FormState = { name: "", category: "", price: "", cost: "", active: true };
const inputClass = "h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand-500 disabled:opacity-60";

export default function DatabaseProductsPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"products" | "ingredients">("products");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogData | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [productEditor, setProductEditor] = useState<{ product: ProductRow | null } | null>(null);
  const [recipeProduct, setRecipeProduct] = useState<ProductRow | null>(null);
  const [ingredientEditorOpen, setIngredientEditorOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [uncertainCreate, setUncertainCreate] = useState(false);
  const [createdPendingRecipe, setCreatedPendingRecipe] = useState<string | null>(null);
  const productRequest = useRef(0);
  const catalogRequest = useRef(0);
  const editorVersion = useRef(0);
  const saving = useRef(false);

  const loadProducts = useCallback(async () => {
    const version = ++productRequest.current;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getProductsPageDataAction();
      if (version !== productRequest.current) return;
      if (!result.ok) {
        setLoadError("message" in result ? result.message : result.error);
        return;
      }
      setProducts(result.data);
    } catch {
      if (version === productRequest.current) setLoadError("No pudimos cargar los productos.");
    } finally {
      if (version === productRequest.current) setLoading(false);
    }
  }, []);

  const loadCatalog = useCallback(async () => {
    const version = ++catalogRequest.current;
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const result = await getCatalogDataAction();
      if (version !== catalogRequest.current) return;
      if (!result.ok) {
        setCatalogError("message" in result ? result.message : result.error);
        setCatalog(null);
        return;
      }
      setCatalog(result.data);
    } catch {
      if (version === catalogRequest.current) {
        setCatalogError("No pudimos cargar los insumos y permisos del catálogo.");
        setCatalog(null);
      }
    } finally {
      if (version === catalogRequest.current) setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
    void loadCatalog();
    return () => { productRequest.current += 1; catalogRequest.current += 1; editorVersion.current += 1; };
  }, [loadProducts, loadCatalog]);

  const canEdit = catalog?.canEdit === true && !catalogLoading && !catalogError;
  const editorOpen = productEditor !== null || recipeProduct !== null || ingredientEditorOpen;
  const activeProducts = products.filter((product) => product.active);
  const withPrice = activeProducts.filter((product) => product.price > 0 && Number.isFinite(product.cost) && !product.recipeNeedsReview);
  const averageMargin = withPrice.length ? withPrice.reduce((sum, product) => sum + ((product.price - product.cost) / product.price) * 100, 0) / withPrice.length : null;
  const lowMargin = withPrice.filter((product) => ((product.price - product.cost) / product.price) * 100 < 50).length;
  const recipesReady = products.filter((product) => product.recipeId && product.ingredientCount > 0 && !product.recipeNeedsReview).length;

  function openProduct(product: ProductRow | null) {
    if (!canEdit || saving.current || editorOpen) return;
    editorVersion.current += 1;
    setSaveError(null);
    setUncertainCreate(false);
    setCreatedPendingRecipe(null);
    setProductEditor({ product });
  }

  function closeProduct() {
    if (saving.current) return;
    editorVersion.current += 1;
    setProductEditor(null);
    setSaveError(null);
    if (uncertainCreate || createdPendingRecipe) void loadProducts();
    setCreatedPendingRecipe(null);
    setUncertainCreate(false);
  }

  async function saveProduct(input: ProductInput, recipeItems: RecipeInput["items"]) {
    if (!canEdit || saving.current || uncertainCreate || !productEditor) return;
    const editing = productEditor.product;
    const version = editorVersion.current;
    saving.current = true;
    setPending(true);
    setSaveError(null);
    let productId = createdPendingRecipe;
    try {
      if (!productId) {
        const result = editing ? await updateProductAction(editing.id, input) : await createProductAction(input);
        if (version !== editorVersion.current) return;
        if (!result.ok) {
          setSaveError("message" in result ? result.message : result.error);
          return;
        }
        productId = result.productId;
        if (!editing && recipeItems.length > 0) setCreatedPendingRecipe(productId);
      }
      if (!editing && productId && recipeItems.length > 0) {
        const result = await saveRecipeAction(productId, { expectedUpdatedAt: null, items: recipeItems });
        if (version !== editorVersion.current) return;
        if (!result.ok) {
          setSaveError(`El producto ya se creó, pero la receta no pudo guardarse: ${"message" in result ? result.message : result.error}. Reintentá guardar la composición sin duplicar el producto.`);
          void loadProducts();
          return;
        }
      }
      toast({ tone: "success", title: editing ? "Producto actualizado" : "Producto y receta registrados", description: recipeItems.length ? "La composición y el costo calculado quedaron guardados." : "El producto quedó guardado en tu negocio." });
      setCreatedPendingRecipe(null);
      setProductEditor(null);
      void loadProducts();
    } catch {
      if (version === editorVersion.current) {
        if (!editing && !productId) setUncertainCreate(true);
        setSaveError(productId ? "El producto ya está creado. No pudimos confirmar la receta. Comprobá su composición antes de reintentar." : "No pudimos confirmar el alta. Cerrá y revisá el catálogo antes de repetirla para evitar duplicados.");
      }
    } finally {
      saving.current = false;
      if (version === editorVersion.current) setPending(false);
    }
  }

  async function refreshCatalog() {
    await Promise.all([loadCatalog(), loadProducts()]);
  }

  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Productos, insumos y composición" title="Tu catálogo y sus costos, en un solo lugar." description="Administrá lo que vendés, lo que comprás y las cantidades que utiliza cada producto." actions={tab === "products" && canEdit ? <Button size="sm" variant="primary" onClick={() => openProduct(null)} disabled={editorOpen || pending}><Plus className="h-4 w-4" /> Nuevo producto</Button> : undefined} />
      <div className="flex gap-2 border-b border-line pb-3" role="tablist" aria-label="Catálogo">
        <Button role="tab" id="products-tab" aria-selected={tab === "products"} aria-controls="products-panel" variant={tab === "products" ? "primary" : "ghost"} onClick={() => setTab("products")} disabled={editorOpen}>Productos</Button>
        <Button role="tab" id="ingredients-tab" aria-selected={tab === "ingredients"} aria-controls="ingredients-panel" variant={tab === "ingredients" ? "primary" : "ghost"} onClick={() => setTab("ingredients")} disabled={editorOpen}>Insumos</Button>
      </div>
      {catalogError && <ErrorPanel title="No pudimos cargar los insumos y permisos." message={catalogError} onRetry={() => void loadCatalog()} />}
      {!catalogLoading && catalog && !catalog.canEdit && <p className="rounded-lg border border-line p-3 text-sm text-ink-muted">Tu rol permite consultar el catálogo. La edición requiere permisos de gestión de productos.</p>}
      {tab === "ingredients" ? (
        <div role="tabpanel" id="ingredients-panel" aria-labelledby="ingredients-tab">
          {catalogLoading ? <Loading label="Cargando insumos…" /> : catalog && <IngredientsPanel ingredients={catalog.ingredients} suppliers={catalog.suppliers} branches={catalog.branches} canEdit={canEdit} onSaved={refreshCatalog} onEditorOpenChange={setIngredientEditorOpen} />}
        </div>
      ) : (
        <div role="tabpanel" id="products-panel" aria-labelledby="products-tab" className="space-y-6">
          {loadError ? <ErrorPanel title="No pudimos cargar tus productos." message={loadError} onRetry={() => void loadProducts()} /> : loading ? <Loading label="Cargando productos…" /> : <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <KpiCard label="Productos activos" value={String(activeProducts.length)} tone="brand" />
              <KpiCard label="Margen promedio" value={averageMargin === null ? "Sin datos" : formatPercent(averageMargin, 0)} hint="Sobre productos activos con precio" />
              <KpiCard label="Margen menor al 50%" value={String(lowMargin)} tone={lowMargin > 0 ? "danger" : "default"} />
              <KpiCard label="Con composición" value={`${recipesReady}/${products.length}`} hint="Con insumos vinculados" />
            </div>
            <Card>
              <CardHeader><div><CardTitle>Productos</CardTitle><p className="mt-1 text-xs text-ink-muted">Precio de venta, costo actual, estado y composición opcional.</p></div></CardHeader>
              {products.length === 0 ? <CardContent><div className="rounded-xl border border-dashed border-line px-5 py-10 text-center"><div className="text-sm font-semibold text-ink">Todavía no cargaste productos.</div><p className="mt-1 text-xs text-ink-muted">Creá el primero con su nombre, categoría, precio y costo reales.</p>{canEdit && <Button size="sm" variant="primary" className="mt-4" onClick={() => openProduct(null)} disabled={editorOpen}><Plus className="h-4 w-4" /> Nuevo producto</Button>}</div></CardContent> : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle"><tr><th scope="col" className="px-5 py-2.5 font-medium">Producto</th><th scope="col" className="px-5 py-2.5 font-medium">Categoría</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Precio</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Costo actual</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Margen</th><th scope="col" className="px-5 py-2.5 font-medium">Composición</th><th scope="col" className="px-5 py-2.5 font-medium">Estado</th><th scope="col" className="px-5 py-2.5 text-right font-medium">Acciones</th></tr></thead>
                  <tbody>{products.map((product) => {
                    const margin = product.price > 0 && Number.isFinite(product.cost) && !product.recipeNeedsReview ? ((product.price - product.cost) / product.price) * 100 : null;
                    return <tr key={product.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle"><td className="px-5 py-3 font-medium text-ink">{product.name}</td><td className="px-5 py-3 text-ink-muted">{product.category}</td><td className="px-5 py-3 text-right tabular-nums text-ink">{formatARS(product.price)}</td><td className="px-5 py-3 text-right tabular-nums text-ink-muted">{product.recipeNeedsReview ? "Composición por revisar" : Number.isFinite(product.cost) ? formatARS(product.cost) : "Sin dato"}</td><td className="px-5 py-3 text-right font-medium tabular-nums text-ink">{margin === null ? "Sin calcular" : formatPercent(margin, 0)}</td><td className="px-5 py-3"><Badge tone={product.recipeNeedsReview ? "warn" : product.recipeId && product.ingredientCount > 0 ? "success" : "default"}>{product.recipeNeedsReview ? "Revisar cantidades" : product.recipeId && product.ingredientCount > 0 ? `${product.ingredientCount} insumos` : "Sin composición"}</Badge></td><td className="px-5 py-3"><Badge tone={product.active ? "success" : "default"}>{product.active ? "Activo" : "Inactivo"}</Badge></td><td className="px-5 py-3"><div className="flex justify-end gap-2"><Button size="sm" variant="ghost" disabled={editorOpen || catalogLoading || !catalog} onClick={() => setRecipeProduct(product)}><FlaskConical className="h-4 w-4" /> Composición</Button>{canEdit && <Button size="sm" variant="ghost" disabled={editorOpen} onClick={() => openProduct(product)}><Pencil className="h-4 w-4" /> Editar</Button>}</div></td></tr>;
                  })}</tbody>
                </table></div>
              )}
            </Card>
          </>}
        </div>
      )}
      {productEditor && <Drawer open onClose={closeProduct} title={productEditor.product ? `Editar · ${productEditor.product.name}` : "Nuevo producto"} description="Cargá el producto y su receta en un mismo formulario." width="max-w-2xl"><ProductForm key={productEditor.product?.id ?? "new"} product={productEditor.product} ingredients={catalog?.ingredients ?? []} catalogLoading={catalogLoading} pending={pending} createdPendingRecipe={Boolean(createdPendingRecipe)} canEdit={canEdit && !uncertainCreate} saveError={saveError} onCancel={closeProduct} onSubmit={saveProduct} /></Drawer>}
      {recipeProduct && catalog && <RecipeEditor key={recipeProduct.id} product={recipeProduct} ingredients={catalog.ingredients} canEdit={canEdit} onClose={() => setRecipeProduct(null)} onSaved={loadProducts} />}
    </div>
  );
}

type DraftIngredient = { key: number; ingredientId: string; quantity: string; unit: string };
const unitLabels: Record<string,string> = { unit: "unidad", kg: "kg", g: "g", l: "l", ml: "ml" };

function ProductForm({ product, ingredients, catalogLoading, pending, createdPendingRecipe, canEdit, saveError, onCancel, onSubmit }: {
  product: ProductRow | null; ingredients: CatalogData["ingredients"]; catalogLoading: boolean;
  pending: boolean; createdPendingRecipe: boolean; canEdit: boolean; saveError: string | null;
  onCancel: () => void; onSubmit: (input: ProductInput, items: RecipeInput["items"]) => void;
}) {
  const [form, setForm] = useState<FormState>(() => product ? { name: product.name, category: product.category, price: String(product.price), cost: String(product.cost), active: product.active } : EMPTY_FORM);
  const [error, setError] = useState("");
  const [recipeRows, setRecipeRows] = useState<DraftIngredient[]>([]);
  const nextKey = useRef(0);
  const hasRecipe = Boolean(product?.recipeId && product.ingredientCount > 0);
  const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const itemsCost = recipeRows.map((row) => {
    const ingredient = ingredientMap.get(row.ingredientId);
    if (!ingredient || !ingredient.active || ingredient.unitCost === null) return null;
    try { return calculateIngredientCost(row.quantity, row.unit, ingredient.unit, ingredient.unitCost); }
    catch { return null; }
  });
  const recipeCost = recipeRows.length > 0 && itemsCost.every((cost) => cost !== null)
    ? Math.round(itemsCost.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 100) / 100
    : null;
  const previewMargin = recipeCost !== null && Number(form.price) > 0 ? calculateGrossMargin(Number(form.price), recipeCost) : null;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !canEdit) return;
    const price = Number(form.price.replace(",", "."));
    const cost = Number(form.cost.replace(",", "."));
    if (!form.name.trim()) return setError("Ingresá el nombre del producto.");
    if (!form.category.trim()) return setError("Ingresá una categoría.");
    if (!form.price.trim() || !Number.isFinite(price) || price < 0) return setError("Ingresá un precio válido.");
    if ((!form.cost.trim() || !Number.isFinite(cost) || cost < 0) && recipeRows.length === 0) return setError("Ingresá un costo base válido.");
    if (recipeRows.length > 0 && recipeCost === null) return setError("Revisá el costo, cantidad y unidad de cada insumo antes de guardar.");
    const seen = new Set<string>();
    const items: RecipeInput["items"] = [];
    for (const row of recipeRows) {
      const ingredient = ingredientMap.get(row.ingredientId);
      const quantity = Number(row.quantity.replace(",", "."));
      if (!ingredient || !ingredient.active || seen.has(row.ingredientId) || !Number.isFinite(quantity) || quantity <= 0) return setError("Seleccioná insumos activos sin repetirlos y con cantidades mayores a cero.");
      try { convertQuantity(quantity, row.unit, ingredient.unit); } catch { return setError("Hay unidades incompatibles con un insumo."); }
      seen.add(row.ingredientId);
      items.push({ ingredientId: row.ingredientId, quantity, unit: row.unit });
    }
    setError("");
    onSubmit({ name: form.name.trim(), category: form.category.trim(), price, cost: recipeCost ?? cost, active: form.active }, items);
  }
  return <form onSubmit={submit} className="space-y-5 p-6" aria-busy={pending}>
    <fieldset disabled={pending || !canEdit} className="min-w-0 space-y-5">
      <Field label="Nombre" required><input required className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={200} /></Field>
      <Field label="Categoría" required><input required className={inputClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} maxLength={100} /></Field>
      <div className="grid grid-cols-2 gap-4"><Field label="Precio (ARS)" required><input required className={inputClass} type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} /></Field><Field label={hasRecipe ? "Costo actual (ARS)" : "Costo base (ARS)"} required={recipeRows.length === 0}><input required={recipeRows.length === 0} className={inputClass} type="number" min="0" step="0.01" readOnly={hasRecipe || recipeRows.length > 0} placeholder={recipeRows.length ? "Se calcula con la receta" : undefined} value={recipeRows.length > 0 ? (recipeCost === null ? "" : String(recipeCost)) : form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} /></Field></div>
      {!product && <section className="space-y-3 rounded-xl border border-line p-4" aria-label="Receta e insumos">
        <div><h3 className="text-sm font-semibold text-ink">Receta e insumos</h3><p className="mt-1 text-xs text-ink-muted">Elegí qué insumos lleva una unidad de producto. Su costo se calculará automáticamente. La receta es opcional.</p></div>
        {recipeRows.map((row, index) => {
          const ingredient = ingredientMap.get(row.ingredientId);
          return <div key={row.key} className="space-y-2 rounded-lg border border-line bg-bg-subtle/40 p-3">
            <div className="flex items-end gap-2"><label className="min-w-0 flex-1 space-y-1"><span className="text-xs text-ink-muted">Insumo {index + 1}</span><select required className={inputClass} value={row.ingredientId} onChange={(event) => { const selected = ingredientMap.get(event.target.value); setRecipeRows((current) => current.map((item) => item.key === row.key ? { ...item, ingredientId: event.target.value, unit: selected?.unit ?? "" } : item)); }}>
              <option value="">Seleccionar insumo</option>{ingredients.filter((i) => i.active).map((i) => <option key={i.id} value={i.id} disabled={recipeRows.some((r) => r.key !== row.key && r.ingredientId === i.id)}>{i.name}</option>)}
            </select></label><Button type="button" variant="ghost" size="icon" aria-label={`Quitar insumo ${index + 1}`} onClick={() => setRecipeRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 className="h-4 w-4" /></Button></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Cantidad por producto" required><input required type="number" min="0" step="any" inputMode="decimal" className={inputClass} value={row.quantity} onChange={(event) => setRecipeRows((current) => current.map((item) => item.key === row.key ? { ...item, quantity: event.target.value } : item))} /></Field><Field label="Unidad" required><select required className={inputClass} value={row.unit} onChange={(event) => setRecipeRows((current) => current.map((item) => item.key === row.key ? { ...item, unit: event.target.value } : item))}><option value="">Seleccionar</option>{RECIPE_UNITS.map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}</select></Field></div>
            <p className="text-xs text-ink-muted">{ingredient?.unitCost === null ? "Este insumo no tiene un costo válido." : ingredient ? `Costo de referencia: ${formatARS(ingredient.unitCost ?? 0)} por ${unitLabels[ingredient.unit] ?? ingredient.unit}` : "Elegí un insumo."}</p>
          </div>;
        })}
        <Button type="button" size="sm" variant="subtle" disabled={catalogLoading || ingredients.filter((i) => i.active).length <= recipeRows.length || recipeRows.length >= 100} onClick={() => setRecipeRows((current) => [...current, { key: ++nextKey.current, ingredientId: "", quantity: "", unit: "" }])}><Plus className="h-4 w-4" /> Agregar insumo</Button>
        {ingredients.length === 0 && <p className="text-xs text-ink-muted">Todavía no hay insumos. Cargalos en la pestaña Insumos y luego creá el producto con su receta.</p>}
        {recipeRows.length > 0 && <div aria-live="polite" className="rounded-lg bg-bg-subtle p-3 text-sm"><div>Costo de receta: <strong>{recipeCost === null ? "Sin calcular" : formatARS(recipeCost)}</strong></div><div>Margen bruto: <strong>{previewMargin === null ? "Sin calcular" : formatPercent(previewMargin)}</strong></div></div>}
      </section>}
      <p className="text-xs text-ink-muted">{hasRecipe ? "Revisá los insumos y cantidades en Composición para recalcular el costo." : recipeRows.length > 0 ? "El costo se calcula desde los insumos seleccionados. No modifica el stock hasta registrar ventas." : "Sin receta, el costo base se carga manualmente."}</p>
      <label className="flex items-center justify-between gap-3 rounded-xl border border-line bg-bg-subtle/50 px-4 py-3"><div><div className="text-sm font-medium text-ink">Producto activo</div><div className="text-xs text-ink-muted">Los inactivos se conservan sin contarlos como oferta activa.</div></div><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="h-4 w-4" /></label>
    </fieldset>
    {createdPendingRecipe && <p role="status" className="rounded-lg border border-warn-500/30 p-3 text-xs text-ink-muted">El producto ya existe. Guardá su receta o cerrá para verla en el catálogo; no se creará otra copia.</p>}
    {(error || saveError) && <div role="alert" className="rounded-lg border border-danger-500/30 bg-danger-500/[0.06] px-3 py-2 text-xs text-danger-300">{error || saveError}</div>}
    <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button><Button type="submit" variant="primary" disabled={pending || !canEdit}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{pending ? "Guardando…" : product ? "Guardar cambios" : "Crear producto con receta"}</Button></div>
  </form>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-muted">{label}{required ? " *" : ""}</span>{children}</label>;
}

function Loading({ label }: { label: string }) {
  return <div role="status" className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />{label}</div>;
}

function ErrorPanel({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return <Card><CardContent className="pt-6"><div role="alert" className="rounded-xl border border-warn-500/30 bg-warn-500/[0.06] p-4 text-sm text-ink-muted"><div className="font-semibold text-ink">{title}</div><p className="mt-1">{message}</p><Button size="sm" variant="ghost" className="mt-3" onClick={onRetry}>Reintentar</Button></div></CardContent></Card>;
}
