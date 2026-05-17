"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Beef,
  ChefHat,
  Coffee,
  Package,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wand2,
} from "lucide-react";
import { motion } from "framer-motion";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { SegmentedTabs } from "@/components/ui/tabs";
import { CostHistoryChart } from "@/components/charts/cost-history-chart";
import {
  costingAlerts,
  ingredientCostHistory,
  productCostHistory,
  productRecommendations,
  products,
  recipes,
} from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

type Categoria = "Todos" | "Hamburguesa" | "Combo" | "Acompañamiento" | "Bebida";

const CAT_ICON: Record<string, any> = {
  Hamburguesa: Beef,
  Combo: Package,
  Acompañamiento: ChefHat,
  Bebida: Coffee,
};

function marginHealth(margin: number) {
  if (margin >= 60) return { label: "Saludable", tone: "success" as const };
  if (margin >= 50) return { label: "Atención", tone: "warn" as const };
  return { label: "Crítico", tone: "danger" as const };
}

export default function ProductosPage() {
  const [cat, setCat] = useState<Categoria>("Todos");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<typeof products[number] | null>(null);

  const counts = useMemo(() => {
    const map: Record<string, number> = { Todos: products.length };
    products.forEach((p) => (map[p.categoria] = (map[p.categoria] ?? 0) + 1));
    return map;
  }, []);

  const filtered = cat === "Todos" ? products : products.filter((p) => p.categoria === cat);

  const total = products.length;
  const margenBajo = products.filter((p) => {
    const m = ((p.precio - p.costo) / p.precio) * 100;
    return m < 50;
  }).length;
  const margenPromedio =
    (products.reduce((s, p) => s + (p.precio - p.costo) / p.precio, 0) / total) * 100;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Productos y recetas"
        title="Menú con márgenes en tiempo real."
        description="Cada producto está vinculado a sus insumos. Si cambia el costo de un ingrediente, recalculamos el margen y avisamos."
        actions={
          <>
            <Button size="sm" variant="ghost">
              <Sparkles className="h-4 w-4 text-ai-400" /> Sugerir precios
            </Button>
            <Button size="sm" variant="primary">
              <Plus className="h-4 w-4" /> Nuevo producto
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Productos activos" value={String(total)} tone="brand" />
        <KpiCard label="Margen promedio" value={formatPercent(margenPromedio)} delta={-1.4} />
        <KpiCard label="Margen bajo" value={String(margenBajo)} tone="danger" />
        <KpiCard label="Estrella del mes" value="Clásica" hint="38% de las ventas" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={cat}
          onChange={setCat}
          options={[
            { value: "Todos", label: "Todos", count: counts["Todos"] },
            { value: "Hamburguesa", label: "Hamburguesas", count: counts["Hamburguesa"] ?? 0 },
            { value: "Combo", label: "Combos", count: counts["Combo"] ?? 0 },
            { value: "Acompañamiento", label: "Acompañamientos", count: counts["Acompañamiento"] ?? 0 },
            { value: "Bebida", label: "Bebidas", count: counts["Bebida"] ?? 0 },
          ]}
        />
        <div className="flex items-center gap-2 text-xs text-ink-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-success-500" /> Saludable
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-warn-500" /> Atención
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-danger-500" /> Crítico
          </span>
        </div>
      </div>

      {/* Banner costeo dinámico */}
      <CosteoBanner />

      {/* Grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p, idx) => {
          const margin = ((p.precio - p.costo) / p.precio) * 100;
          const health = marginHealth(margin);
          const Icon = CAT_ICON[p.categoria] ?? ChefHat;

          return (
            <motion.button
              key={p.nombre}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.03 }}
              onClick={() => {
                setSelected(p);
                setOpen(true);
              }}
              className="card group relative overflow-hidden text-left transition-all hover:border-line-strong hover:shadow-[0_24px_60px_-24px_rgba(0,0,0,0.6)]"
            >
              <div className="relative h-28 overflow-hidden">
                <div
                  className={cn(
                    "absolute inset-0 bg-gradient-to-br",
                    health.tone === "success" && "from-success-500/20 via-brand-500/10 to-transparent",
                    health.tone === "warn" && "from-warn-500/20 via-brand-500/10 to-transparent",
                    health.tone === "danger" && "from-danger-500/25 via-brand-500/10 to-transparent",
                  )}
                />
                <div className="grid-dots absolute inset-0 opacity-40" />
                <div className="absolute right-3 top-3 flex gap-1.5">
                  <Badge tone="default">{p.categoria}</Badge>
                  <Badge tone={health.tone}>{health.label}</Badge>
                </div>
                <div className="absolute bottom-3 left-4 grid h-12 w-12 place-items-center rounded-xl border border-line bg-bg-elevated/80 backdrop-blur">
                  <Icon className="h-5 w-5 text-brand-400" />
                </div>
              </div>
              <CardContent className="space-y-3 pt-4">
                <div>
                  <h3 className="text-base font-semibold text-ink">{p.nombre}</h3>
                  <p className="text-xs text-ink-muted">
                    {p.ingredientes.length} ingredientes
                  </p>
                </div>
                <div className="grid grid-cols-3 gap-2 rounded-xl border border-line bg-bg-subtle/60 p-2.5">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Precio</div>
                    <div className="text-sm font-semibold text-ink tabular-nums">
                      {formatARS(p.precio)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Costo</div>
                    <div className="text-sm font-medium text-ink-muted tabular-nums">
                      {formatARS(p.costo)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Margen</div>
                    <div
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        health.tone === "danger"
                          ? "text-danger-400"
                          : health.tone === "warn"
                            ? "text-warn-400"
                            : "text-success-400",
                      )}
                    >
                      {formatPercent(margin, 0)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span>Ver receta y simulador</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </CardContent>
            </motion.button>
          );
        })}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={selected?.nombre}
        description={selected?.categoria}
        width="max-w-2xl"
      >
        {selected && <ProductDetail product={selected} />}
      </Drawer>
    </div>
  );
}

function CosteoBanner() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-ai-400/25 bg-gradient-to-r from-ai-500/[0.07] via-bg-elevated/40 to-brand-500/[0.05] p-5">
      <div className="absolute -right-16 -top-16 h-44 w-44 rounded-full bg-ai-500/15 blur-3xl" />
      <div className="relative grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-2">
          <div className="mb-1.5 flex items-center gap-2">
            <Badge tone="ai">
              <Sparkles className="h-3 w-3" /> Costeo dinámico
            </Badge>
            <span className="text-[10px] uppercase tracking-wider text-ink-subtle">
              · Recalcula con cada factura
            </span>
          </div>
          <h3 className="text-base font-semibold tracking-tight text-ink md:text-lg">
            Cuando cambia el precio de un insumo, cambia el costo real de tus productos.
          </h3>
          <p className="mt-1 max-w-2xl text-xs text-ink-muted md:text-sm">
            Cada factura procesada por OCR actualiza el precio promedio de la materia prima
            y recalcula automáticamente la rentabilidad de cada producto que la usa.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {costingAlerts.slice(0, 3).map((a, i) => (
            <div
              key={i}
              className={cn(
                "rounded-xl border p-2.5",
                a.tone === "danger" && "border-danger-500/25 bg-danger-500/[0.06]",
                a.tone === "warn" && "border-warn-500/25 bg-warn-500/[0.06]",
                a.tone === "info" && "border-ai-400/25 bg-ai-500/[0.06]",
              )}
            >
              <div
                className={cn(
                  "mb-1 h-1.5 w-1.5 rounded-full",
                  a.tone === "danger" && "bg-danger-500",
                  a.tone === "warn" && "bg-warn-500",
                  a.tone === "info" && "bg-ai-500",
                )}
              />
              <div className="text-[10px] font-semibold leading-snug text-ink line-clamp-3">
                {a.title}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type DetailTab = "receta" | "costeo" | "ia";

function ProductDetail({ product }: { product: typeof products[number] }) {
  const recipe = recipes[product.nombre] ?? [];
  const recos = productRecommendations[product.nombre] ?? [];

  const baseMargin = ((product.precio - product.costo) / product.precio) * 100;
  const [meatBump, setMeatBump] = useState(0);
  const [tab, setTab] = useState<DetailTab>("receta");

  const productHistory = productCostHistory[product.nombre];
  const variation = productHistory
    ? ((productHistory[productHistory.length - 1].precio - productHistory[0].precio) /
        productHistory[0].precio) *
      100
    : 0;

  // Simulación: aumento de carne sube costo proporcional al share de carne en la receta.
  const meatShare =
    recipe.find((i) => /carne|medall/i.test(i.nombre))?.share ?? 0;
  const newCost = product.costo * (1 + (meatShare / 100) * (meatBump / 100));
  const newMargin = ((product.precio - newCost) / product.precio) * 100;
  const marginDelta = newMargin - baseMargin;

  return (
    <div className="space-y-6 p-6">
      {/* Hero metrics */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card-quiet p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Precio</div>
          <div className="mt-1 text-xl font-semibold text-ink tabular-nums">{formatARS(product.precio)}</div>
        </div>
        <div className="card-quiet p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Costo</div>
          <div className="mt-1 text-xl font-semibold text-ink-muted tabular-nums">{formatARS(product.costo)}</div>
        </div>
        <div className="card-quiet p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Margen</div>
          <div
            className={cn(
              "mt-1 text-xl font-semibold tabular-nums",
              baseMargin >= 60 ? "text-success-400" : baseMargin >= 50 ? "text-warn-400" : "text-danger-400",
            )}
          >
            {formatPercent(baseMargin, 0)}
          </div>
        </div>
      </div>

      {/* Tabs internos */}
      <div className="flex">
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          options={[
            { value: "receta", label: "Receta" },
            { value: "costeo", label: "Costeo dinámico" },
            { value: "ia", label: "Recomendaciones IA", count: recos.length || undefined },
          ]}
        />
      </div>

      {tab === "receta" && (
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Receta y composición de costo</h3>
          <Badge tone="default">{recipe.length} ítems</Badge>
        </div>
        <div className="card-quiet divide-y divide-line/70 overflow-hidden">
          {recipe.map((i) => (
            <div key={i.nombre} className="p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-ink">{i.nombre}</div>
                  <div className="text-[11px] text-ink-subtle">{i.cantidad}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm tabular-nums text-ink">{formatARS(i.costoUnit)}</div>
                  <div className="text-[11px] text-ink-subtle">{formatPercent(i.share, 1)} del costo</div>
                </div>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-bg-subtle">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-brand-400 to-brand-600"
                  style={{ width: `${i.share}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>
      )}

      {tab === "costeo" && (
        <CosteoTab product={product} history={productHistory} variation={variation} recipe={recipe} />
      )}

      {tab === "receta" && (
      <>
      {/* Simulador */}
      <section className="rounded-2xl border border-ai-400/30 bg-ai-500/[0.05] p-4">
        <div className="mb-3 flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg border border-ai-400/30 bg-ai-500/15">
            <Wand2 className="h-3.5 w-3.5 text-ai-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink">Simulador de impacto</div>
            <div className="text-[11px] text-ink-muted">
              Si el precio de la carne sube, ¿qué pasa con tu margen?
            </div>
          </div>
        </div>

        <div className="mb-3 flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={meatBump}
            onChange={(e) => setMeatBump(Number(e.target.value))}
            className="flex-1 accent-ai-500"
          />
          <span className="w-14 text-right text-sm font-semibold tabular-nums text-ai-400">
            +{meatBump}%
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="card-quiet p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Nuevo costo</div>
            <div className="mt-1 text-sm font-semibold text-ink tabular-nums">{formatARS(newCost)}</div>
          </div>
          <div className="card-quiet p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Nuevo margen</div>
            <div
              className={cn(
                "mt-1 text-sm font-semibold tabular-nums",
                newMargin >= 60 ? "text-success-400" : newMargin >= 50 ? "text-warn-400" : "text-danger-400",
              )}
            >
              {formatPercent(newMargin, 1)}
            </div>
          </div>
          <div className="card-quiet p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Variación</div>
            <div
              className={cn(
                "mt-1 inline-flex items-center gap-0.5 text-sm font-semibold tabular-nums",
                marginDelta >= 0 ? "text-success-400" : "text-danger-400",
              )}
            >
              {marginDelta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {formatPercent(Math.abs(marginDelta), 1)}
            </div>
          </div>
        </div>

        {meatBump > 0 && (
          <p className="mt-3 text-xs text-ink-muted">
            <Sparkles className="mr-1 inline h-3 w-3 text-ai-400" />
            Si la carne sube {meatBump}%, deberías subir el precio a{" "}
            <span className="font-semibold text-ink">
              {formatARS(Math.round(newCost / (baseMargin / 100)))}
            </span>{" "}
            para mantener tu margen actual.
          </p>
        )}
      </section>

      </>
      )}

      {/* Recomendaciones IA */}
      {tab === "ia" && recos.length > 0 && (
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-ai-400" />
            <h3 className="text-sm font-semibold text-ink">Recomendaciones de la IA</h3>
          </div>
          <div className="space-y-2">
            {recos.map((r, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start justify-between gap-3 rounded-xl border p-3",
                  r.tone === "success" && "border-success-500/25 bg-success-500/[0.06]",
                  r.tone === "warn" && "border-warn-500/25 bg-warn-500/[0.06]",
                  r.tone === "info" && "border-ai-400/25 bg-ai-500/[0.06]",
                  r.tone === "danger" && "border-danger-500/25 bg-danger-500/[0.06]",
                )}
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{r.action}</div>
                  <div className="mt-0.5 text-xs text-ink-muted">{r.detail}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs font-semibold text-ink tabular-nums">{r.impact}</div>
                  <div className="text-[10px] text-ink-subtle">Impacto estimado</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Acciones */}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button variant="primary">
          <Sparkles className="h-4 w-4" />
          Sugerir nuevo precio
        </Button>
        <Button variant="ghost">
          <AlertTriangle className="h-4 w-4 text-warn-400" />
          Pausar producto
        </Button>
        <Button variant="ghost">
          Ver impacto en menú
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function CosteoTab({
  product,
  history,
  variation,
  recipe,
}: {
  product: typeof products[number];
  history?: { fecha: string; precio: number }[];
  variation: number;
  recipe: { nombre: string; share: number }[];
}) {
  // Top ingredientes con historial conocido
  const ingHistKeys = Object.keys(ingredientCostHistory);
  const tracked = recipe
    .map((i) => ({
      nombre: i.nombre,
      share: i.share,
      key: ingHistKeys.find(
        (k) =>
          i.nombre.toLowerCase().includes(k.toLowerCase()) ||
          k.toLowerCase().includes(i.nombre.split(" ")[0].toLowerCase()),
      ),
    }))
    .filter((x) => x.key)
    .slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Header costo histórico */}
      <div className="rounded-2xl border border-line bg-bg-subtle/40 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow mb-1">Costo del producto · últimos 5 meses</div>
            <h3 className="text-lg font-semibold tracking-tight text-ink">
              {product.nombre}
            </h3>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-ink-subtle">
              Variación acumulada
            </div>
            <div
              className={cn(
                "text-2xl font-semibold tabular-nums",
                variation > 0 ? "text-danger-400" : "text-success-400",
              )}
            >
              {variation > 0 ? "+" : ""}
              {variation.toFixed(1)}%
            </div>
          </div>
        </div>
        <div className="mt-3">
          {history ? (
            <CostHistoryChart data={history} tone="brand" height={160} />
          ) : (
            <p className="text-xs text-ink-muted">Sin historial registrado todavía.</p>
          )}
        </div>
      </div>

      {/* Insumos sensibles */}
      {tracked.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-ink">
              Insumos que más impactan el costo
            </h3>
            <Badge tone="ai">
              <Sparkles className="h-3 w-3" /> Detectados por IA
            </Badge>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {tracked.map((t) => {
              const hist = ingredientCostHistory[t.key!];
              const lastV = hist[hist.length - 1].precio;
              const firstV = hist[0].precio;
              const variation = ((lastV - firstV) / firstV) * 100;
              return (
                <div key={t.key} className="card-quiet overflow-hidden">
                  <div className="border-b border-line p-3">
                    <div className="text-xs text-ink-muted">{t.key}</div>
                    <div className="mt-0.5 flex items-baseline justify-between">
                      <div className="text-sm font-semibold text-ink tabular-nums">
                        {formatARS(lastV)}
                      </div>
                      <div
                        className={cn(
                          "text-xs tabular-nums",
                          variation > 0 ? "text-danger-400" : "text-success-400",
                        )}
                      >
                        {variation > 0 ? "+" : ""}
                        {variation.toFixed(1)}%
                      </div>
                    </div>
                    <div className="mt-0.5 text-[10px] text-ink-subtle">
                      {t.share.toFixed(1)}% del costo del producto
                    </div>
                  </div>
                  <CostHistoryChart data={hist} tone="danger" height={80} />
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Alertas de costeo */}
      <section className="rounded-2xl border border-warn-500/20 bg-warn-500/[0.04] p-4">
        <div className="mb-2 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-warn-400" />
          <h3 className="text-sm font-semibold text-ink">Alertas de margen y costeo</h3>
        </div>
        <ul className="space-y-2 text-sm">
          {costingAlerts.map((a, idx) => (
            <li
              key={idx}
              className={cn(
                "flex items-start gap-2 rounded-xl border p-3",
                a.tone === "danger" && "border-danger-500/25 bg-danger-500/[0.06]",
                a.tone === "warn" && "border-warn-500/25 bg-warn-500/[0.06]",
                a.tone === "info" && "border-ai-400/25 bg-ai-500/[0.06]",
              )}
            >
              <span
                className={cn(
                  "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                  a.tone === "danger" && "bg-danger-500",
                  a.tone === "warn" && "bg-warn-500",
                  a.tone === "info" && "bg-ai-500",
                )}
              />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink">{a.title}</div>
                <div className="mt-0.5 text-xs text-ink-muted">{a.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
