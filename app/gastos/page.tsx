"use client";

import { useMemo, useState } from "react";
import { Calculator, Plus, Receipt, Target, TrendingUp } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import {
  balanceSnapshot,
  breakEven,
  dashboardKpis,
  fixedExpenses,
  topSuppliers,
} from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_TONE = {
  pagado: "success",
  programado: "info",
  pendiente: "warn",
  variable: "default",
  automático: "ai",
} as const;

type Scenario = "conservador" | "esperado" | "agresivo";

/**
 * Punto de equilibrio:
 *   ventas_objetivo = costos_fijos / margen_contribucion
 *
 * El margen de contribución es (precio − costo_variable) / precio.
 * En la app usamos `margenBrutoPct` como proxy del margen de
 * contribución mensual estimado.
 *
 * Los escenarios ajustan el margen estimado hacia arriba/abajo
 * para reflejar incertidumbre sobre costos variables (insumos,
 * comisiones de apps, descuentos):
 *
 *   - Agresivo:    +4 pts de margen (mejor caso · sin sobresaltos)
 *   - Esperado:     margen vigente (último cierre)
 *   - Conservador: −4 pts de margen (insumos suben, comisiones también)
 */
const SCENARIO_LABEL: Record<Scenario, { label: string; description: string; tone: "success" | "ai" | "warn" }> = {
  agresivo: {
    label: "Agresivo",
    description: "Asume mejor mix de canales y costos contenidos.",
    tone: "success",
  },
  esperado: {
    label: "Esperado",
    description: "Replica el margen del último cierre real.",
    tone: "ai",
  },
  conservador: {
    label: "Conservador",
    description: "Castiga el margen 4 pts ante suba de insumos.",
    tone: "warn",
  },
};

const SCENARIO_DELTA: Record<Scenario, number> = {
  agresivo: +4,
  esperado: 0,
  conservador: -4,
};

export default function GastosPage() {
  const { toast } = useToast();
  const [scenario, setScenario] = useState<Scenario>("esperado");

  const totalFijos = useMemo(
    () => fixedExpenses.reduce((s, e) => s + e.monto, 0),
    [],
  );
  // Estimación simple de variables a partir de proveedores top.
  const totalVariables = useMemo(
    () => topSuppliers.reduce((s, p) => s + p.totalMes, 0),
    [],
  );

  const margenBase = balanceSnapshot.margenBrutoPct ?? dashboardKpis.margenEstimado ?? 31;
  const margenEscenario = Math.max(5, margenBase + SCENARIO_DELTA[scenario]);

  // Ventas necesarias para cubrir costos fijos al margen del escenario.
  const ventasMensuales = Math.round((totalFijos / margenEscenario) * 100);
  const ventasSemanales = Math.round(ventasMensuales / 4.3);
  const ventasDiarias = Math.round(ventasMensuales / 30);

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Gastos fijos"
        title="Lo que cuesta abrir cada día."
        description="Costos estructurales del mes y cuánto tenés que facturar diariamente para cubrirlos. Simulá distintos escenarios de margen para anticiparte."
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={() => toast(ToastPresets.comingSoon("Alta de gasto fijo"))}
          >
            <Plus className="h-4 w-4" /> Nuevo gasto fijo
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Costos fijos" value={formatARS(totalFijos, { compact: true })} tone="brand" hint="Alquiler, sueldos, servicios" />
        <KpiCard label="Costos variables (mes)" value={formatARS(totalVariables, { compact: true })} hint="Compras a proveedores" />
        <KpiCard label="Margen promedio" value={formatPercent(margenBase, 0)} tone="ai" hint="Último cierre real" />
        <KpiCard label="Punto de equilibrio mes" value={formatARS(ventasMensuales, { compact: true })} icon={<Target />} tone="success" hint={`Escenario: ${SCENARIO_LABEL[scenario].label}`} />
      </div>

      {/* Detalle de gastos fijos */}
      <Card>
        <CardHeader>
          <CardTitle>Detalle de gastos fijos</CardTitle>
          <Badge tone="default">{fixedExpenses.length} ítems</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Concepto</th>
                <th className="px-5 py-2.5 font-medium">Vencimiento</th>
                <th className="px-5 py-2.5 font-medium">Estado</th>
                <th className="px-5 py-2.5 text-right font-medium">Monto</th>
              </tr>
            </thead>
            <tbody>
              {fixedExpenses.map((e) => (
                <tr key={e.nombre} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <div className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-bg-subtle text-ink-muted">
                        <Receipt className="h-3.5 w-3.5" />
                      </div>
                      <span className="font-medium text-ink">{e.nombre}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-ink-muted">{e.vencimiento}</td>
                  <td className="px-5 py-3">
                    <Badge tone={STATUS_TONE[e.estado as keyof typeof STATUS_TONE]}>
                      {e.estado}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">
                    {formatARS(e.monto)}
                  </td>
                </tr>
              ))}
              <tr className="bg-bg-elevated/60">
                <td colSpan={3} className="px-5 py-3 text-right text-xs uppercase tracking-wider text-ink-subtle">
                  Total mensual
                </td>
                <td className="px-5 py-3 text-right text-base font-semibold tabular-nums text-brand-300">
                  {formatARS(totalFijos)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Simulación punto de equilibrio */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle className="flex items-center gap-2">
              <Calculator className="h-4 w-4" />
              Simulación de punto de equilibrio
            </CardTitle>
            <p className="mt-0.5 text-xs text-ink-muted">
              Cuánto necesitás facturar para cubrir los gastos fijos según el margen estimado. Elegí escenario.
            </p>
          </div>
          <Badge tone="ai">
            <TrendingUp className="h-3 w-3" />
            Margen {formatPercent(margenEscenario, 0)}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Selector escenario */}
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {(Object.keys(SCENARIO_LABEL) as Scenario[]).map((s) => {
              const cfg = SCENARIO_LABEL[s];
              const active = scenario === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScenario(s)}
                  className={cn(
                    "rounded-xl border p-3 text-left transition-all",
                    active
                      ? "border-brand-500/60 bg-brand-500/[0.08] ring-1 ring-brand-500/30"
                      : "border-line bg-bg-subtle/40 hover:border-line-strong",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-ink">{cfg.label}</span>
                    <Badge tone={cfg.tone}>
                      {SCENARIO_DELTA[s] > 0 ? "+" : ""}
                      {SCENARIO_DELTA[s]} pts
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">{cfg.description}</p>
                </button>
              );
            })}
          </div>

          {/* Objetivos */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ObjetivoCard
              label="Por día"
              value={ventasDiarias}
              hint="Promedio 30 días — Lunes a domingo."
            />
            <ObjetivoCard
              label="Por semana"
              value={ventasSemanales}
              hint="Útil si abrís 5 o 6 días."
              accent
            />
            <ObjetivoCard
              label="Por mes"
              value={ventasMensuales}
              hint="Si lo cubrís, el negocio no pierde plata."
            />
          </div>

          {/* Microcopy explicativo */}
          <div className="rounded-xl border border-line bg-bg-subtle/40 p-4 text-xs text-ink-muted">
            <p>
              <span className="font-semibold text-ink">Cómo lo calculamos.</span>{" "}
              Sumamos los <span className="text-ink">{fixedExpenses.length} gastos fijos</span> ({formatARS(totalFijos, { compact: true })}) y los dividimos por el margen de contribución estimado de tu negocio ({formatPercent(margenEscenario, 0)}).
              No incluye reinversión, retiro de socios ni amortizaciones.
              {scenario === "conservador" && (
                <> El escenario conservador anticipa una baja de margen (subas de proveedores o más peso de canales con comisión).</>
              )}
              {scenario === "agresivo" && (
                <> El escenario agresivo asume mix favorable: más salón / WhatsApp y menos PedidosYa.</>
              )}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Tracking del mes */}
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2">
          <div className="p-6 md:p-8">
            <Badge tone="ai" className="mb-3">
              <Calculator className="h-3 w-3" /> Mes en curso
            </Badge>
            <h3 className="text-xl font-semibold tracking-tight text-ink">
              Necesitás facturar{" "}
              <span className="text-brand-300">{formatARS(ventasDiarias)}</span>{" "}
              por día para cubrir tus costos fijos.
            </h3>
            <p className="mt-2 text-sm text-ink-muted">
              Calculado sobre {formatARS(totalFijos, { compact: true })} mensuales y 30 días de operación. Incluye sueldos, alquiler, servicios, comisiones y publicidad.
              <span className="text-ink"> Punto de equilibrio histórico:</span>{" "}
              {formatARS(breakEven.diario)} por día.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toast(ToastPresets.comingSoon("Editor de supuestos"))}
              >
                Ajustar supuestos
              </Button>
            </div>
          </div>
          <div className="relative grid-bg border-t border-line p-6 md:border-l md:border-t-0">
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-bold tracking-tight text-ink tabular-nums">
                11
              </span>
              <span className="text-ink-muted">de 16 días</span>
            </div>
            <p className="text-sm text-ink-muted">por encima del objetivo en mayo</p>
            <div className="mt-6 grid gap-1" style={{ gridTemplateColumns: "repeat(16, minmax(0,1fr))" }}>
              {Array.from({ length: 16 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-8 rounded-sm ${
                    [1, 2, 4, 6, 9, 10, 12, 13, 14, 15, 16].includes(i + 1)
                      ? "bg-gradient-to-t from-brand-600 to-brand-400"
                      : "bg-bg-subtle"
                  }`}
                />
              ))}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-ink-subtle">
              <span>1/05</span>
              <span>16/05</span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ObjetivoCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        accent
          ? "border-brand-500/30 bg-brand-500/[0.06]"
          : "border-line bg-bg-subtle/40",
      )}
    >
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums",
          accent ? "text-brand-300" : "text-ink",
        )}
      >
        {formatARS(value)}
      </div>
      <p className="mt-1 text-xs text-ink-muted">{hint}</p>
    </div>
  );
}
