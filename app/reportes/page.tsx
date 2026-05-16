"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  ArrowDownRight,
  Bot,
  Minus,
  Sparkles,
} from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { reportInsights, reportSuggestions } from "@/lib/mock-data";
import { ExpensesDonut } from "@/components/charts/expenses-donut";
import { SalesAreaChart } from "@/components/charts/sales-area-chart";
import { expensesByCategory, salesByDay } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const ANSWER =
  "En lo que va de mayo facturaste $18,42M, +8,7% vs abril. WhatsApp es tu canal más rentable (margen 36%). La carne subió 14% con Don José: cotizando con Frigorífico Sur ahorrás ~$16k por compra. Mi recomendación esta semana: probar un combo del martes (bajas ventas) y empujar la base de WhatsApp con campaña de 10% off para inactivos.";

export default function ReportesPage() {
  const [question, setQuestion] = useState("");
  const [answered, setAnswered] = useState(false);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Reportes IA · Copiloto"
        title="Hacele preguntas a tu negocio."
        description="Tu copiloto cruza ventas, costos, stock y empleados para responder en segundos. Pensado para tomar decisiones esta semana, no el mes que viene."
      />

      {/* Hero chat */}
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-50" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ai-400/60 to-transparent" />
        <CardContent className="relative space-y-5 p-6 md:p-8">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-xl border border-ai-400/30 bg-ai-500/15">
              <Bot className="h-4 w-4 text-ai-400" />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">Copiloto GastroPilot</div>
              <div className="text-xs text-ink-muted">
                Conectado a tus ventas, costos y stock en tiempo real
              </div>
            </div>
            <Badge tone="ai" className="ml-auto">
              <Sparkles className="h-3 w-3" /> Beta
            </Badge>
          </div>

          <div className="flex items-center gap-2 rounded-2xl border border-ai-400/30 bg-bg-elevated/80 p-2 shadow-soft">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim()) setAnswered(true);
              }}
              placeholder="¿Qué te gustaría saber esta semana?"
              className="h-10 flex-1 bg-transparent px-3 text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
            />
            <Button
              variant="ai"
              size="md"
              onClick={() => question.trim() && setAnswered(true)}
            >
              Preguntar
              <ArrowRight className="h-4 w-4" />
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
              className="rounded-2xl border border-ai-400/30 bg-ai-500/[0.06] p-4"
            >
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-ai-400" />
                <span className="text-xs font-semibold uppercase tracking-wider text-ai-400">
                  Respuesta del copiloto
                </span>
              </div>
              <p className="text-sm leading-relaxed text-ink">{ANSWER}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="ghost" size="sm">Ver detalle de margen</Button>
                <Button variant="ghost" size="sm">Comparar proveedores</Button>
                <Button variant="ghost" size="sm">Armar campaña WhatsApp</Button>
              </div>
            </motion.div>
          )}
        </CardContent>
      </Card>

      {/* Insights ejecutivos */}
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
                  {r.tendencia === "up" && (
                    <span className="text-success-400">
                      <ArrowUpRight className="h-4 w-4" />
                    </span>
                  )}
                  {r.tendencia === "down" && (
                    <span className="text-danger-400">
                      <ArrowDownRight className="h-4 w-4" />
                    </span>
                  )}
                  {r.tendencia === "neutral" && (
                    <span className="text-ink-subtle">
                      <Minus className="h-4 w-4" />
                    </span>
                  )}
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

      {/* Recomendación de la semana */}
      <Card className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-brand-500/10 via-transparent to-ai-500/10" />
        <div className="relative grid grid-cols-1 gap-6 p-6 md:grid-cols-[1fr_auto] md:p-8">
          <div>
            <Badge tone="brand" className="mb-3">
              <Sparkles className="h-3 w-3" /> Recomendación de la semana
            </Badge>
            <h3 className="text-xl font-semibold tracking-tight text-ink md:text-2xl">
              Subí 4% el precio de la Doble Cheddar y empujá WhatsApp con un combo del martes.
            </h3>
            <p className="mt-3 max-w-3xl text-sm text-ink-muted">
              Tu producto estrella permite un ajuste sin afectar demanda. El martes es tu día de menor venta con mayor costo laboral relativo: un combo armado para WhatsApp puede sumar ~$120k semanales y mejorar el margen 2 puntos.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2 md:flex-col">
            <Button variant="primary">Aplicar al menú</Button>
            <Button variant="ghost">Ver simulación</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
