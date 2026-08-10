import type { ReactNode } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ReportesLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return children;

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Reportes IA · Copiloto"
        title="Reportes basados en tus datos reales."
        description="En database mode no mostramos informes, métricas ni recomendaciones de ejemplo."
      />

      <Card>
        <CardContent className="p-8">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-ai-400/25 bg-ai-500/[0.06]">
              <Bot className="h-6 w-6 text-ai-400" />
            </div>
            <h2 className="mt-4 text-xl font-semibold tracking-tight text-ink">
              Todavía no hay un informe generado
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              Cuando exista historial real suficiente y el copiloto de reportes esté conectado a ese contexto,
              acá aparecerán análisis verificables. Hasta entonces no respondemos preguntas con datos de demo.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link href="/ventas">
                <Button variant="ghost" size="sm">Ver ventas</Button>
              </Link>
              <Link href="/compras">
                <Button variant="ghost" size="sm">Ver compras</Button>
              </Link>
              <Link href="/balances">
                <Button variant="ghost" size="sm">Ver balances</Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
