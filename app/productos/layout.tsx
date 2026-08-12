import type { ReactNode } from "react";
import { PackageSearch } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatARS, formatPercent } from "@/lib/format";

type ProductRow = {
  id: string;
  name: string;
  category: string | null;
  price: number | string;
  cost: number | string;
  active: boolean;
};

export default async function ProductosLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return children;

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return <DatabaseUnavailable message="Supabase no está configurado. No mostramos productos demo como fallback." />;
  }

  const result = await supabase
    .from("products")
    .select("id, name, category, price, cost, active")
    .eq("active", true)
    .order("category")
    .order("name");

  if (result.error) {
    return <DatabaseUnavailable message={`No pudimos leer los productos reales (${result.error.code ?? "error"}).`} />;
  }

  const products = (result.data ?? []) as ProductRow[];
  const margins = products.map((product) => {
    const price = Number(product.price ?? 0);
    const cost = Number(product.cost ?? 0);
    return price > 0 ? ((price - cost) / price) * 100 : 0;
  });
  const averageMargin = margins.length
    ? margins.reduce((sum, margin) => sum + margin, 0) / margins.length
    : 0;
  const lowMargin = margins.filter((margin) => margin < 50).length;
  const categories = new Set(products.map((product) => product.category).filter(Boolean)).size;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Productos y recetas"
        title="Productos reales del negocio."
        description="En database mode sólo mostramos productos persistidos en Supabase. Costeo histórico, recomendaciones y recetas aparecen únicamente cuando existan datos reales para calcularlos."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Productos activos" value={String(products.length)} tone="brand" />
        <KpiCard
          label="Margen promedio"
          value={products.length ? formatPercent(averageMargin) : "—"}
          hint={products.length ? "Calculado sobre productos registrados" : "Sin productos todavía"}
        />
        <KpiCard label="Margen bajo" value={String(lowMargin)} tone={lowMargin > 0 ? "danger" : "success"} />
        <KpiCard label="Categorías" value={String(categories)} hint="Categorías registradas" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PackageSearch className="h-4 w-4" /> Productos
          </CardTitle>
          <Badge tone="default">{products.length} registrados</Badge>
        </CardHeader>

        {products.length === 0 ? (
          <CardContent>
            <div className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-ink-muted">
              Todavía no hay productos registrados. No mostramos el menú de ejemplo de la demo dentro de un negocio real.
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
                  <th className="px-5 py-2.5 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => {
                  const price = Number(product.price ?? 0);
                  const cost = Number(product.cost ?? 0);
                  const margin = price > 0 ? ((price - cost) / price) * 100 : 0;
                  const tone = margin < 50 ? "danger" as const : margin < 60 ? "warn" as const : "success" as const;
                  return (
                    <tr key={product.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                      <td className="px-5 py-3 font-medium text-ink">{product.name}</td>
                      <td className="px-5 py-3 text-ink-muted">{product.category || "—"}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink">{formatARS(price)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink-muted">{formatARS(cost)}</td>
                      <td className="px-5 py-3 text-right tabular-nums text-ink">{price > 0 ? formatPercent(margin) : "—"}</td>
                      <td className="px-5 py-3"><Badge tone={tone}>{margin < 50 ? "Margen bajo" : margin < 60 ? "Atención" : "Saludable"}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function DatabaseUnavailable({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Productos y recetas"
        title="Productos temporalmente no disponibles."
        description="No podemos confirmar los datos reales en este momento."
      />
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">
            {message}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
