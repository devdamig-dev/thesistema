"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import { Calculator, Loader2, Plus, Receipt, Target, TrendingUp } from "lucide-react";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { useToast } from "@/components/ui/toast";
import {
  createExpenseAction,
  getExpensesPageDataAction,
  type ExpenseInput,
  type ExpenseRow,
  type ExpensesPageData,
} from "@/app/actions/expenses-page";
import { balanceSnapshot, dashboardKpis, fixedExpenses, topSuppliers } from "@/lib/mock-data";
import { formatARS, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

const IS_DATABASE = process.env.NEXT_PUBLIC_APP_MODE === "database";

type Scenario = "conservador" | "esperado" | "agresivo";

const SCENARIO_LABEL: Record<Scenario, { label: string; description: string; tone: "success" | "ai" | "warn" }> = {
  agresivo: { label: "Agresivo", description: "Asume mejor mix de canales y costos contenidos.", tone: "success" },
  esperado: { label: "Esperado", description: "Replica el margen disponible del último balance.", tone: "ai" },
  conservador: { label: "Conservador", description: "Castiga el margen 4 pts ante suba de insumos.", tone: "warn" },
};

const SCENARIO_DELTA: Record<Scenario, number> = { agresivo: 4, esperado: 0, conservador: -4 };
const inputClass = "h-10 w-full rounded-lg border border-line bg-bg px-3 text-sm text-ink outline-none transition placeholder:text-ink-subtle focus:border-brand-500";

function statusTone(status: string): "success" | "info" | "warn" | "default" | "ai" {
  const normalized = status.toLowerCase();
  if (normalized === "pagado" || normalized === "paid") return "success";
  if (normalized === "programado" || normalized === "scheduled") return "info";
  if (normalized === "pendiente" || normalized === "pending") return "warn";
  if (normalized === "automático" || normalized === "automatic") return "ai";
  return "default";
}

function statusLabel(status: string) {
  if (status === "paid") return "Pagado";
  if (status === "scheduled") return "Programado";
  if (status === "pending") return "Pendiente";
  return status;
}

function formatDueDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" })
    .format(new Date(`${value}T12:00:00-03:00`));
}

export default function GastosPage() {
  const { toast } = useToast();
  const [scenario, setScenario] = useState<Scenario>("esperado");
  const [loading, setLoading] = useState(IS_DATABASE);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [databaseData, setDatabaseData] = useState<ExpensesPageData | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  async function loadExpenses() {
    if (!IS_DATABASE) return;
    setLoading(true);
    try {
      const res = await getExpensesPageDataAction();
      if (!res.ok) {
        setLoadError(res.error);
        setDatabaseData(null);
        return;
      }
      setDatabaseData(res.data);
      setLoadError(null);
    } catch {
      setLoadError("No pudimos cargar los gastos.");
      setDatabaseData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadExpenses();
  }, []);

  const demoExpenses: ExpenseRow[] = useMemo(() => fixedExpenses.map((row, index) => ({
    id: `demo-${index}`,
    nombre: row.nombre,
    categoria: "demo",
    monto: row.monto,
    vencimiento: null,
    estado: row.estado,
  })), []);

  const expenses = IS_DATABASE ? databaseData?.expenses ?? [] : demoExpenses;
  const totalFijos = IS_DATABASE
    ? databaseData?.totalFixed ?? 0
    : fixedExpenses.reduce((sum, row) => sum + row.monto, 0);
  const totalVariables = IS_DATABASE
    ? databaseData?.totalVariable ?? 0
    : topSuppliers.reduce((sum, row) => sum + row.totalMes, 0);
  const margenBase = IS_DATABASE
    ? databaseData?.grossMarginPct ?? null
    : balanceSnapshot.margenBrutoPct ?? dashboardKpis.margenEstimado ?? 31;
  const hasMargin = margenBase != null && Number.isFinite(margenBase) && margenBase > 0;
  const margenEscenario = hasMargin ? Math.max(5, margenBase + SCENARIO_DELTA[scenario]) : null;
  const ventasMensuales = margenEscenario ? Math.round((totalFijos / margenEscenario) * 100) : null;
  const ventasSemanales = ventasMensuales == null ? null : Math.round(ventasMensuales / 4.3);
  const ventasDiarias = ventasMensuales == null ? null : Math.round(ventasMensuales / 30);

  function saveExpense(input: ExpenseInput) {
    startTransition(async () => {
      const result = await createExpenseAction(input);
      if (!result.ok) {
        toast({ tone: "warn", title: "No pudimos registrar el gasto", description: result.error });
        return;
      }
      toast({ tone: "success", title: "Gasto registrado", description: "El gasto quedó agregado al mes." });
      setDrawerOpen(false);
      await loadExpenses();
    });
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Gastos fijos"
        title="Lo que cuesta abrir cada día."
        description={IS_DATABASE
          ? "Costos estructurales y compras del mes. El punto de equilibrio se calcula cuando existe un margen guardado."
          : "Costos estructurales del mes y cuánto tenés que facturar diariamente para cubrirlos."}
        actions={
          <Button size="sm" variant="primary" onClick={() => setDrawerOpen(true)} disabled={!IS_DATABASE || pending}>
            <Plus className="h-4 w-4" /> Nuevo gasto fijo
          </Button>
        }
      />

      {IS_DATABASE && loadError && (
        <div className="rounded-2xl border border-warn-500/30 bg-warn-500/[0.06] p-5">
          <div className="text-sm font-semibold text-ink">No pudimos cargar Gastos</div>
          <p className="mt-1 text-xs text-ink-muted">{loadError}</p>
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => void loadExpenses()}>Reintentar</Button>
        </div>
      )}

      {IS_DATABASE && loading ? (
        <div className="rounded-2xl border border-line p-8 text-center text-sm text-ink-muted">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Cargando gastos…
        </div>
      ) : loadError ? null : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Costos fijos" value={formatARS(totalFijos, { compact: true })} tone="brand" hint="Registros de gastos" />
            <KpiCard label="Costos variables (mes)" value={formatARS(totalVariables, { compact: true })} hint="Compras del mes" />
            <KpiCard label="Margen promedio" value={hasMargin ? formatPercent(margenBase, 0) : "—"} tone="ai" hint={hasMargin ? "Último balance" : "Sin balance todavía"} />
            <KpiCard label="Punto de equilibrio mes" value={ventasMensuales == null ? "—" : formatARS(ventasMensuales, { compact: true })} icon={<Target />} tone="success" hint={ventasMensuales == null ? "Requiere margen disponible" : `Escenario: ${SCENARIO_LABEL[scenario].label}`} />
          </div>

          <Card>
            <CardHeader>
              <div>
                <CardTitle>Detalle de gastos fijos</CardTitle>
                <p className="mt-1 text-xs text-ink-muted">Conceptos recurrentes que forman el costo mensual del negocio.</p>
              </div>
              <Badge tone="default">{expenses.length} ítems</Badge>
            </CardHeader>
            {expenses.length === 0 ? (
              <CardContent>
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center">
                  <div className="text-sm font-semibold text-ink">Todavía no hay gastos registrados.</div>
                  <p className="mt-1 text-xs text-ink-muted">Cargá alquiler, servicios, impuestos u otros costos recurrentes.</p>
                  {IS_DATABASE && (
                    <Button size="sm" variant="primary" className="mt-4" onClick={() => setDrawerOpen(true)}>
                      <Plus className="h-4 w-4" /> Nuevo gasto fijo
                    </Button>
                  )}
                </div>
              </CardContent>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
                    <tr><th className="px-5 py-2.5 font-medium">Concepto</th><th className="px-5 py-2.5 font-medium">Categoría</th><th className="px-5 py-2.5 font-medium">Vencimiento</th><th className="px-5 py-2.5 font-medium">Estado</th><th className="px-5 py-2.5 text-right font-medium">Monto</th></tr>
                  </thead>
                  <tbody>
                    {expenses.map((expense) => (
                      <tr key={expense.id} className="border-b border-line/60 last:border-0 hover:bg-bg-subtle">
                        <td className="px-5 py-3"><div className="flex items-center gap-2"><div className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-bg-subtle text-ink-muted"><Receipt className="h-3.5 w-3.5" /></div><span className="font-medium text-ink">{expense.nombre}</span></div></td>
                        <td className="px-5 py-3 text-ink-muted">{expense.categoria || "—"}</td>
                        <td className="px-5 py-3 text-ink-muted">{IS_DATABASE ? formatDueDate(expense.vencimiento) : fixedExpenses.find((row) => row.nombre === expense.nombre)?.vencimiento ?? "—"}</td>
                        <td className="px-5 py-3"><Badge tone={statusTone(expense.estado)}>{statusLabel(expense.estado)}</Badge></td>
                        <td className="px-5 py-3 text-right font-semibold tabular-nums text-ink">{formatARS(expense.monto)}</td>
                      </tr>
                    ))}
                    <tr className="bg-bg-elevated/60"><td colSpan={4} className="px-5 py-3 text-right text-xs uppercase tracking-wider text-ink-subtle">Total mensual</td><td className="px-5 py-3 text-right text-base font-semibold tabular-nums text-brand-300">{formatARS(totalFijos)}</td></tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader>
              <div><CardTitle className="flex items-center gap-2"><Calculator className="h-4 w-4" /> Simulación de punto de equilibrio</CardTitle><p className="mt-0.5 text-xs text-ink-muted">Cuánto necesitás facturar para cubrir los gastos fijos según el margen disponible.</p></div>
              <Badge tone="ai"><TrendingUp className="h-3 w-3" /> {margenEscenario == null ? "Margen pendiente" : `Margen ${formatPercent(margenEscenario, 0)}`}</Badge>
            </CardHeader>
            <CardContent className="space-y-5">
              {!hasMargin ? (
                <div className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-sm text-ink-muted">Todavía no hay un balance con margen bruto suficiente para calcular el punto de equilibrio.</div>
              ) : (
                <>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    {(Object.keys(SCENARIO_LABEL) as Scenario[]).map((key) => {
                      const cfg = SCENARIO_LABEL[key];
                      return <button key={key} type="button" onClick={() => setScenario(key)} className={cn("rounded-xl border p-3 text-left transition-all", scenario === key ? "border-brand-500/60 bg-brand-500/[0.08] ring-1 ring-brand-500/30" : "border-line bg-bg-subtle/40 hover:border-line-strong")}><div className="flex items-center justify-between"><span className="text-sm font-semibold text-ink">{cfg.label}</span><Badge tone={cfg.tone}>{SCENARIO_DELTA[key] > 0 ? "+" : ""}{SCENARIO_DELTA[key]} pts</Badge></div><p className="mt-1 text-xs text-ink-muted">{cfg.description}</p></button>;
                    })}
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <ObjetivoCard label="Por día" value={ventasDiarias!} hint="Promedio sobre 30 días." />
                    <ObjetivoCard label="Por semana" value={ventasSemanales!} hint="Promedio mensual / 4,3." accent />
                    <ObjetivoCard label="Por mes" value={ventasMensuales!} hint="Cobertura estimada de costos fijos." />
                  </div>
                  <div className="rounded-xl border border-line bg-bg-subtle/40 p-4 text-xs text-ink-muted"><span className="font-semibold text-ink">Cómo lo calculamos.</span> Dividimos {formatARS(totalFijos, { compact: true })} de gastos fijos por un margen de {formatPercent(margenEscenario!, 0)}. No incluye reinversión, retiros ni amortizaciones.</div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Drawer
        open={drawerOpen}
        onClose={() => !pending && setDrawerOpen(false)}
        title="Nuevo gasto fijo"
        description="Registrá un costo recurrente del negocio."
        width="max-w-lg"
      >
        <ExpenseForm pending={pending} onCancel={() => setDrawerOpen(false)} onSubmit={saveExpense} />
      </Drawer>
    </div>
  );
}

function ExpenseForm({ pending, onCancel, onSubmit }: { pending: boolean; onCancel: () => void; onSubmit: (input: ExpenseInput) => void }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<ExpenseInput["status"]>("pending");
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedAmount = Number(amount.replace(",", "."));
    if (!name.trim()) return setError("Ingresá el concepto del gasto.");
    if (!category.trim()) return setError("Ingresá una categoría.");
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return setError("Ingresá un monto mayor a cero.");
    setError("");
    onSubmit({ name: name.trim(), category: category.trim(), amount: parsedAmount, dueDate: dueDate || null, status });
  }

  return (
    <form onSubmit={submit} className="space-y-5 p-6">
      <Field label="Concepto" required><input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Alquiler" /></Field>
      <Field label="Categoría" required><input className={inputClass} value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ej. Local" /></Field>
      <div className="grid grid-cols-2 gap-4">
        <Field label="Monto" required><input className={inputClass} type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0" /></Field>
        <Field label="Vencimiento"><input className={inputClass} type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></Field>
      </div>
      <Field label="Estado" required>
        <select className={inputClass} value={status} onChange={(event) => setStatus(event.target.value as ExpenseInput["status"])}>
          <option value="pending">Pendiente</option>
          <option value="scheduled">Programado</option>
          <option value="paid">Pagado</option>
        </select>
      </Field>
      {error && <div className="rounded-lg border border-danger-500/30 bg-danger-500/[0.06] px-3 py-2 text-xs text-danger-300">{error}</div>}
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {pending ? "Guardando…" : "Registrar gasto"}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-muted">{label}{required ? " *" : ""}</span>{children}</label>;
}

function ObjetivoCard({ label, value, hint, accent }: { label: string; value: number; hint: string; accent?: boolean }) {
  return <div className={cn("rounded-2xl border p-4", accent ? "border-brand-500/30 bg-brand-500/[0.06]" : "border-line bg-bg-subtle/40")}><div className="eyebrow">{label}</div><div className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", accent ? "text-brand-300" : "text-ink")}>{formatARS(value)}</div><p className="mt-1 text-xs text-ink-muted">{hint}</p></div>;
}