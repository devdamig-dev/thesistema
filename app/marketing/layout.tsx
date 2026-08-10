import type { ReactNode } from "react";
import Link from "next/link";
import { Sparkles, Users } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { marketing } from "@/lib/data";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { Button } from "@/components/ui/button";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return children;

  const [summary, campaigns, insights, audiences] = await Promise.all([
    marketing.summary(),
    marketing.campaigns(),
    marketing.insights(),
    marketing.audiences(),
  ]);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Marketing IA · Centro de crecimiento"
        title="Marketing basado en datos reales."
        description="No mostramos oportunidades, campañas, audiencias ni calendarios de ejemplo en database mode."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Campañas" value={String(campaigns.length)} tone="brand" />
        <KpiCard label="Audiencias" value={String(audiences.length)} />
        <KpiCard label="Insights" value={String(insights.length)} />
        <KpiCard label="Clientes activos" value={String(summary.clientesActivos ?? 0)} icon={<Users />} />
      </div>

      <Card>
        <CardContent className="p-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-ai-400/25 bg-ai-500/[0.06]">
              <Sparkles className="h-6 w-6 text-ai-400" />
            </div>
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">
              {campaigns.length ? "Campañas reales disponibles" : "Todavía no hay campañas generadas"}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Las oportunidades y recomendaciones aparecerán cuando el negocio tenga historial suficiente y el motor de Marketing IA pueda justificarlas con datos reales. Hasta entonces no usamos cifras, fechas ni audiencias demo.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/clientes"><Button variant="ghost" size="sm">Ver clientes</Button></Link>
              <Link href="/ventas"><Button variant="ghost" size="sm">Ver ventas</Button></Link>
              <Link href="/reportes"><Button variant="ghost" size="sm">Ver reportes</Button></Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
