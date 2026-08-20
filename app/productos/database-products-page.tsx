"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { KpiCard } from "@/components/ui/kpi-card";
import { useToast } from "@/components/ui/toast";
import { formatARS, formatPercent } from "@/lib/format";
import {
  createProductAction,
  getProductsPageDataAction,
  updateProductAction,
  type ProductInput,
  type ProductRow,
} from "@/app/actions/products-page";

type FormState = {
  name: string;
  category: string;
  price: string;
  cost: string;
  active: boolean;
};

const EMPTY_FORM: FormState = { name: "", category: "", price: "", cost: "", active: true };
const inputClass = "h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand-500";

export default function DatabaseProductsPage() {
  const { toast } = useToast();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRow | null>(null);
  const [pending, startTransition] = useTransition();

  async function loadProducts() {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getProductsPageDataAction();
      if (!result.ok) {
        setLoadError("message" in result ? result.message : result.error);
        setProducts([]);
        return;
      }
      setProducts(result.data);
    } catch {
      setLoadError("No pudimos cargar los productos.");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  const activeProducts = products.filter((product) => product.active);
  const averageMargin = useMemo(() => {
    const withPrice = activeProducts.filter((product) => product.price > 0);
    if (withPrice.length === 0) return 0;
    return withPrice.reduce((sum, product) => sum + ((product.price - product.cost) / product.price) * 100, 0) / withPrice.length;
  }, [activeProducts]);
  const lowMargin = activeProducts.filter((product) => product.price > 0 && ((product.price - product.cost) / product.price) * 100 < 50).length;
  const recipesReady = products.filter((product) => product.recipeId && product.ingredientCount > 0).length;

  function openCreate() {
    setEditing(null);
    setDrawerOpen(true);
  }

  function openEdit(product: ProductRow) {
    setEditing(product);
    setDrawerOpen(true);
  }

  function saveProduct(input: ProductInput) {
    startTransition(async () => {
      const result = editing
        ? await updateProductAction(editing.id, input)
        : await createProductAction(input);

      if (!result.ok) {
        toast({
          tone: "warn",
          title: editing ? "No pudimos actualizar el producto" : "No pudimos registrar el producto",
          description: "message" in result ? result.message : result.error,
        });
        return;
      }

      toast({
        tone: "success",
        title: editing ? "Producto actualizado" : "Producto registrado",
        description: "Los cambios quedaron guardados en tu negocio.",
      });
      setDrawerOpen(false);
      setEditing(null);
      await loadProducts();
    });
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Productos y recetas"
        title="Productos con precios y costos reales."
        description="Administrá el catálogo de tu negocio. Las recetas se muestran sólo cuando ya tienen ingredientes vinculados."
        actions={
          <Button size="sm" variant="primary" onClick={openCreate} disabled={pending}>
            <Plus className="h-4 w-4" /> Nuevo producto
          </Button>
        }
      />

      {loadError ? (
        <Card>
          <CardContent className="pt-6">
            <div className="rounded-xl border border-warn-500/30 bg-warn-500/[0.06] p-4 text-sm text-ink-muted">
              <div className="font-semibold text-ink">No pudimos cargar tus productos.</div>
              <p className="mt-1">{loadError}</p>
              <Button size="sm" variant="ghost" className="mt-3" onClick={() => void loadProducts()}>Reintentar</Button>
            </div>
          </CardContent>
        </Card>
      ) : loading ? (
        <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando productos…
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Productos activos" value={String(activeProducts.length)} tone="brand" />
            <KpiCard label="Margen promedio" value={formatPercent(averageMargin, 0)} />
            <KpiCard label="Margen bajo" value={String(lowMargin)} tone={lowMargin > 0 ? "danger" : "default"} />
            <KpiCard label="Recetas configuradas" value={`${recipesReady}/${products.length}`} hint="Con ingredientes vinculados" />
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Catálogo</CardTitle>
                <p className="mt-1 text-xs text-ink-muted">Precio, costo base, estado y disponibilidad de receta.</p>
              </div>
            </CardHeader>
            {products.length === 0 ? (
              <CardContent>
                <div className="rounded-xl border border-dashed border-line px-5 py-10 text-center">
                  <div className="text-sm font-semibold text-ink">Todavía no cargaste productos.</div>
                  <p className="mt-1 text-xs text-ink-muted">Creá el primero con el nombre, categoría, precio y costo reales.</p>
                  <Button size="sm" variant="primary" className="mt-4" onClick={openCreate}>
                    <Plus className="h-4 w-4" /> Nuevo producto
                  </Button>
                </div>
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                    <tr>
                      <th className="px-5 py-2.5 font-medium">Producto</th>
                      <th className="px-5 py-2.5 font-medium">Categoría</th>
                      <th className="px-5 py-2.5 text-right font-medium">Precio</th>
                      <th className="px-5 py-2.5 text-right font-medium">Costo</th>
                      <th className="px-5 py-2.5 text-right font-medium">Margen</th>
                      <th className="px-5 py-2.5 font-medium">Receta</th>
                      <th className="px-5 py-2.5 font-medium">Estado</th>
                      <th className="px-5 py-2.5 text-right font-medium">Acción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((product) => {
                      const margin = product.price > 0 ? ((product.price - product.cost) / product.price) * 100 : 0;
                      return (
                        <tr key={product.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                          <td className="px-5 py-3 font-medium text-ink">{product.name}</td>
                          <td className="px-5 py-3 text-ink-muted">{product.category}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-ink">{formatARS(product.price)}</td>
                          <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{formatARS(product.cost)}</td>
                          <td className="px-5 py-3 text-right font-medium tabular-nums text-ink">{formatPercent(margin, 0)}</td>
                          <td className="px-5 py-3">
                            {product.recipeId && product.ingredientCount > 0 ? (
                              <Badge tone="success">{product.ingredientCount} ingredientes</Badge>
                            ) : (
                              <Badge tone="default">Sin receta</Badge>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <Badge tone={product.active ? "success" : "default"}>{product.active ? "Activo" : "Inactivo"}</Badge>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Button size="sm" variant="ghost" onClick={() => openEdit(product)}>
                              <Pencil className="h-4 w-4" /> Editar
                            </Button>
                          </td>
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
        open={drawerOpen}
        onClose={() => !pending && setDrawerOpen(false)}
        title={editing ? `Editar · ${editing.name}` : "Nuevo producto"}
        description="Usá valores reales del negocio. Podés modificar estos datos después."
        width="max-w-lg"
      >
        <ProductForm product={editing} pending={pending} onCancel={() => setDrawerOpen(false)} onSubmit={saveProduct} />
      </Drawer>
    </div>
  );
}

function ProductForm({
  product,
  pending,
  onCancel,
  onSubmit,
}: {
  product: ProductRow | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (input: ProductInput) => void;
}) {
  const [form, setForm] = useState<FormState>(() => product ? {
    name: product.name,
    category: product.category,
    price: String(product.price),
    cost: String(product.cost),
    active: product.active,
  } : EMPTY_FORM);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(product ? {
      name: product.name,
      category: product.category,
      price: String(product.price),
      cost: String(product.cost),
      active: product.active,
    } : EMPTY_FORM);
    setError("");
  }, [product]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const price = Number(form.price.replace(",", "."));
    const cost = Number(form.cost.replace(",", "."));
    if (!form.name.trim()) return setError("Ingresá el nombre del producto.");
    if (!form.category.trim()) return setError("Ingresá una categoría.");
    if (!Number.isFinite(price) || price < 0) return setError("Ingresá un precio válido.");
    if (!Number.isFinite(cost) || cost < 0) return setError("Ingresá un costo válido.");

    setError("");
    onSubmit({ name: form.name.trim(), category: form.category.trim(), price, cost, active: form.active });
  }

  return (
    <form onSubmit={submit} className="space-y-5 p-6">
      <Field label="Nombre" required>
        <input className={inputClass} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Ej. Hamburguesa clásica" />
      </Field>
      <Field label="Categoría" required>
        <input className={inputClass} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Ej. Hamburguesas" />
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Precio" required>
          <input className={inputClass} type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm({ ...form, price: event.target.value })} placeholder="0" />
        </Field>
        <Field label="Costo base" required>
          <input className={inputClass} type="number" min="0" step="0.01" value={form.cost} onChange={(event) => setForm({ ...form, cost: event.target.value })} placeholder="0" />
        </Field>
      </div>
      <label className="flex items-center justify-between rounded-xl border border-line bg-bg-subtle/50 px-4 py-3">
        <div>
          <div className="text-sm font-medium text-ink">Producto activo</div>
          <div className="text-xs text-ink-muted">Los inactivos se conservan sin contarlos como oferta activa.</div>
        </div>
        <input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="h-4 w-4" />
      </label>
      {error && <div className="rounded-lg border border-danger-500/30 bg-danger-500/[0.06] px-3 py-2 text-xs text-danger-300">{error}</div>}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? "Guardando…" : product ? "Guardar cambios" : "Crear producto"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-ink-muted">{label}{required ? " *" : ""}</span>
      {children}
    </label>
  );
}
