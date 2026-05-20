"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CheckCircle2,
  Minus,
  Send,
  Sparkles,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PriorityBadge } from "@/components/ui/priority-badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { ExpensesDonut } from "@/components/charts/expenses-donut";
import { SalesAreaChart } from "@/components/charts/sales-area-chart";
import {
  expensesByCategory,
  reportInsights,
  reportSuggestions,
  salesByDay,
  weeklyDecisions,
} from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const ANSWER =
  "En lo que va de mayo facturaste $18,42M, +8,7% vs abril. WhatsApp es tu canal más rentable (margen 36%). La carne subió 14% con Don José: cotizando con Frigorífico Sur ahorrás ~$16k por compra. Mi recomendación esta semana: probar un combo del martes (bajas ventas) y empujar la base de WhatsApp con campaña de 10% off para inactivos.";

const ANSWER_BULLETS = [
  { label: "Facturación del mes", value: "$18,42M", trend: "up" },
  { label: "Mejor canal por margen", value: "WhatsApp · 36%", trend: "up" },
  { label: "Mayor riesgo", value: "Carne +14%", trend: "down" },
  { label: "Acción sugerida", value: "Combo del martes", trend: "neutral" },
];

export default function ReportesPage() {
  const [question, setQuestion] = useState("");
  const [answered, setAnswered] = useState(false);
  const { toast } = useToast();

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Reportes IA · Copiloto"
        title="El cerebro del negocio."
        description="Cruzamos ventas, costos, stock y empleados para responder lo que necesitás decidir esta semana — no el mes que viene."
      />

      {/* Hero chat */}
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ai-400/60 to-transparent" />
        <div className="absolute -right-32 -top-32 h-72 w-72 rounded-full bg-ai-500/15 blur-3xl" />
        <CardContent className="relative space-y-6 p-6 md:p-10">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-ai-400/30 bg-ai-500/15">
              <Bot className="h-5 w-5 text-ai-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">Copiloto GastroPilot</div>
              <div className="flex items-center gap-2 text-xs text-ink-muted">
                <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-success-500" />
                Conectado a ventas, costos y stock en tiempo real
              </div>
            </div>
            <Badge tone="ai" className="ml-auto">
              <Sparkles className="h-3 w-3" /> Beta
            </Badge>
          </div>

          <div>
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-ink md:text-3xl">
              Hacele preguntas a tu negocio.{" "}
              <span className="text-gradient-ai">Te responde en segundos.</span>
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-muted">
              La IA no reemplaza tu criterio: te muestra lo que antes no veías.
            </p>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-ai-400/30 bg-bg-elevated/80 p-2 shadow-soft ring-glow-ai">
            <Sparkles className="ml-2 h-4 w-4 text-ai-400" />
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim()) setAnswered(true);
              }}
              placeholder="¿Qué te gustaría saber esta semana?"
              className="h-11 flex-1 bg-transparent px-1 text-base text-ink placeholder:text-ink-subtle focus:outline-none"
            />
            <Button
              variant="ai"
              size="md"
              onClick={() => question.trim() && setAnswered(true)}
            >
              Preguntar
              <Send className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {reportSuggestions.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setQuestion(s);
                  setAnswered(true);
                }}
                className="rounded-full border border-line bg-bg-subtle px-3 py-1.5 text-xs text-ink-muted transition-colors hover:border-ai-400/40 hover:text-ai-400"
              >
                {s}
              </button>
            ))}
          </div>

          {answered && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35 }}
              className="rounded-2xl border border-ai-400/30 bg-ai-500/[0.06] p-5"
            >
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-ai-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-ai-400">
                  Informe del copiloto
                </span>
              </div>
              <p className="text-sm leading-relaxed text-ink">{ANSWER}</p>

              <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
                {ANSWER_BULLETS.map((b) => (
                  <div key={b.label} className="card-quiet p-3">
                    <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{b.label}</div>
                    <div className="mt-1 flex items-center gap-1 text-sm font-semibold text-ink">
                      {b.value}
                      {b.trend === "up" && <ArrowUpRight className="h-3.5 w-3.5 text-success-400" />}
                      {b.trend === "down" && <ArrowDownRight className="h-3.5 w-3.5 text-danger-400" />}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <Link href="/productos">
                  <Button variant="ghost" size="sm">Ver detalle de margen</Button>
                </Link>
                <Link href="/compras">
                  <Button variant="ghost" size="sm">Comparar proveedores</Button>
                </Link>
                <Link href="/marketing">
                  <Button variant="ghost" size="sm">Armar campaña WhatsApp</Button>
                </Link>
              </div>
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* DECISIONES RECOMENDADAS ESTA SEMANA */}
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <div className="eyebrow mb-1">Decisiones recomendadas esta semana</div>
            <h2 className="text-lg font-semibold tracking-tight text-ink">
              Detectamos el problema antes de que se coma tu margen.
            </h2>
          </div>
          <Badge tone="ai">
            <Sparkles className="h-3 w-3" /> {weeklyDecisions.length} acciones
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {weeklyDecisions.map((d, idx) => (
            <motion.div
              key={d.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: idx * 0.05 }}
              className="card relative overflow-hidden p-5"
            >
              <div className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full bg-brand-500/10 blur-3xl" />
              <div className="relative">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <PriorityBadge priority={d.prioridad} />
                    <span className="text-[10px] uppercase tracking-wider text-ink-subtle">
                      · {d.area}
                    </span>
                  </div>
                  <ConfidenceMeter value={d.confianza} />
                </div>

                <h3 className="text-base font-semibold tracking-tight text-ink">
                  {d.titulo}
                </h3>
                <p className="mt-1.5 text-xs text-ink-muted leading-relaxed">
                  <span className="font-semibold text-ink/80">Motivo: </span>
                  {d.motivo}
                </p>

                <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-success-500/25 bg-success-500/[0.06] p-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-success-400/80">
                      Impacto estimado
                    </div>
                    <div className="text-lg font-semibold text-success-400 tabular-nums">
                      {d.impacto}
                    </div>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-success-400/60" />
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() =>
                      toast({
                        tone: "ai",
                        title: `Simulación: ${d.titulo}`,
                        description: `Impacto proyectado ${d.impacto} con ${Math.round(d.confianza * 100)}% de confianza.`,
                      })
                    }
                  >
                    <Wand2 className="h-3.5 w-3.5" />
                    Simular impacto
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toast(ToastPresets.comingSoon("Vista de detalle"))}
                  >
                    Ver detalle
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Resumen ejecutivo */}
      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-ink-subtle">
          Resumen ejecutivo
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {reportInsights.map((r, idx) => (
            <motion.div
              key={r.titulo}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: idx * 0.05 }}
              className="card relative overflow-hidden p-5"
            >
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-ai-500/10 blur-3xl" />
              <div className="relative">
                <div className="text-[10px] uppercase tracking-wider text-ai-400">
                  Insight #{idx + 1}
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <h3 className="text-sm font-medium text-ink">{r.titulo}</h3>
                  {r.tendencia === "up" && <ArrowUpRight className="h-4 w-4 text-success-400" />}
                  {r.tendencia === "down" && <ArrowDownRight className="h-4 w-4 text-danger-400" />}
                  {r.tendencia === "neutral" && <Minus className="h-4 w-4 text-ink-subtle" />}
                </div>
                <div className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">
                  {r.metrica}
                </div>
                <p className="mt-2 text-xs text-ink-muted">{r.detalle}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Tendencia · ventas vs costos</CardTitle>
            <Badge tone="ai">11 días</Badge>
          </CardHeader>
          <CardContent>
            <SalesAreaChart data={salesByDay} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Gastos del mes</CardTitle>
            <p className="text-xs text-ink-muted">Por categoría</p>
          </CardHeader>
          <CardContent>
            <ExpensesDonut data={expensesByCategory} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = pct >= 85 ? "success" : pct >= 70 ? "warn" : "danger";
  const color =
    tone === "success" ? "text-success-400" : tone === "warn" ? "text-warn-400" : "text-danger-400";
  const bar =
    tone === "success" ? "bg-success-500" : tone === "warn" ? "bg-warn-500" : "bg-danger-500";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-16 overflow-hidden rounded-full bg-bg-subtle">
        <div className={cn("h-full", bar)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-[11px] font-semibold tabular-nums", color)}>
        {pct}%
      </span>
    </div>
  );
}
