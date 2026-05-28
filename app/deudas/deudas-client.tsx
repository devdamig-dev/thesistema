"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  Check,
  CheckCircle2,
  Download,
  HandCoins,
  History,
  Landmark,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Truck,
  Wallet,
} from "lucide-react";
import { motion } from "framer-motion";
import { SectionHeader } from "@/components/ui/section-header";
import { KpiCard } from "@/components/ui/kpi-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Drawer } from "@/components/ui/drawer";
import { SegmentedTabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  markDebtAsSettledAction,
  registerDebtAction,
  registerPaymentAction,
} from "@/app/actions/debts";
import { exportDebtsCsvAction } from "@/app/actions/exports";
import { triggerCsvDownload } from "@/lib/csv-download";
import {
  DEBT_CATEGORY_LABELS,
  type Debt,
  type DebtCategory,
  type DebtStatus,
} from "@/lib/mock-data";
import { formatARS } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<
  DebtStatus,
  { tone: "success" | "warn" | "danger"; label: string }
> = {
  activa: { tone: "warn", label: "Activa" },
  vencida: { tone: "danger", label: "Vencida" },
  saldada: { tone: "success", label: "Saldada" },
};

const CATEGORY_STYLES: Record<
  DebtCategory,
  { tone: "default" | "warn" | "info" | "ai" | "success" | "danger" | "brand" }
> = {
  proveedor: { tone: "info" },
  impuesto: { tone: "danger" },
  prestamo: { tone: "warn" },
  alquiler: { tone: "brand" },
  servicio: { tone: "default" },
  sueldo: { tone: "ai" },
  otro: { tone: "default" },
};

type Filter =
  | "todas"
  | "vencidas"
  | "por_vencer"
  | "impuestos"
  | "proveedores"
  | "saldadas";

function parseDmy(dmy?: string): Date | null {
  if (!dmy) return null;
  const m = dmy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function daysUntil(dmy?: string): number | null {
  const d = parseDmy(dmy);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

export default function DeudasClient({
  items,
  kpis,
}: {
  items: Debt[];
  kpis: { totalDeuda: number; vencidas: number; proximoVencimiento: string; impactoMensual: number };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("todas");
  const [selected, setSelected] = useState<Debt | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [exporting, startExport] = useTransition();

  const counts = useMemo(() => {
    const next: Record<Filter, number> = {
      todas: items.length,
      vencidas: 0,
      por_vencer: 0,
      impuestos: 0,
      proveedores: 0,
      saldadas: 0,
    };
    for (const d of items) {
      const days = daysUntil(d.vencimiento);
      if (d.estado === "vencida") next.vencidas++;
      else if (d.estado !== "saldada" && days != null && days >= 0 && days <= 7) {
        next.por_vencer++;
      }
      if (d.categoria === "impuesto" || d.categoria === "sueldo") next.impuestos++;
      if (d.categoria === "proveedor") next.proveedores++;
      if (d.estado === "saldada") next.saldadas++;
    }
    return next;
  }, [items]);

  const filtered = useMemo(() => {
    if (filter === "todas") return items;
    if (filter === "vencidas") return items.filter((d) => d.estado === "vencida");
    if (filter === "saldadas") return items.filter((d) => d.estado === "saldada");
    if (filter === "impuestos") {
      return items.filter((d) => d.categoria === "impuesto" || d.categoria === "sueldo");
    }
    if (filter === "proveedores") return items.filter((d) => d.categoria === "proveedor");
    // por_vencer
    return items.filter((d) => {
      if (d.estado === "saldada") return false;
      const days = daysUntil(d.vencimiento);
      return days != null && days >= 0 && days <= 7;
    });
  }, [filter, items]);

  function handleExport() {
    startExport(async () => {
      const res = await exportDebtsCsvAction();
      if (res.ok) {
        triggerCsvDownload(res.filename, res.content);
        toast({
          tone: "success",
          title: "Exporte listo",
          description: `${res.rows} deudas incluidas — separadas por categoría.`,
        });
      } else {
        toast({ tone: "warn", title: "No pudimos exportar", description: res.error });
      }
    });
  }

  function handleNewDebt() {
    // Mock simple sin modal: pide datos mínimos por window.prompt para no
    // sumar componentes nuevos. En sprint próximo lo reemplazamos por
    // un Drawer de creación con form completo.
    const creditor = window.prompt("Acreedor:");
    if (!creditor) return;
    const amountStr = window.prompt("Monto inicial ($):");
    if (!amountStr) return;
    const amount = Number(amountStr.replace(/[^\d]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const categoria = (window.prompt(
      "Categoría (proveedor / impuesto / prestamo / alquiler / servicio / sueldo / otro):",
      "proveedor",
    ) || "proveedor") as DebtCategory;
    const dbCategory =
      categoria === "proveedor"
        ? "supplier"
        : categoria === "impuesto"
          ? "tax"
          : categoria === "prestamo"
            ? "loan"
            : categoria === "alquiler"
              ? "rent"
              : categoria === "servicio"
                ? "utility"
                : categoria === "sueldo"
                  ? "payroll"
                  : "other";

    startTransition(async () => {
      const result = await registerDebtAction({
        creditor,
        original_amount: amount,
        category: dbCategory,
      });
      if (result.ok) {
        toast({
          tone: "success",
          title: "Deuda registrada",
          description: result.persisted
            ? "Guardada en Supabase."
            : "Modo demo · cambio local.",
        });
        router.refresh();
      } else {
        toast({ tone: "warn", title: "No pudimos guardar", description: result.error });
      }
    });
  }

  function handleRegisterPayment(debt: Debt) {
    const amountStr = window.prompt(
      `Pago para ${debt.acreedor} — saldo pendiente $${debt.saldoPendiente.toLocaleString("es-AR")}.\nMonto del pago ($):`,
    );
    if (!amountStr) return;
    const amount = Number(amountStr.replace(/[^\d]/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) return;

    startTransition(async () => {
      const result = await registerPaymentAction({
        debt_id: debt.id,
        amount,
        payment_method: "Transferencia",
      });
      if (result.ok) {
        toast({
          tone: "success",
          title: "Pago registrado",
          description: result.persisted
            ? "Recalculamos el saldo pendiente."
            : "Modo demo · cambio local.",
        });
        router.refresh();
      } else {
        toast({ tone: "warn", title: "Error", description: result.error });
      }
    });
  }

  function handleMarkAsSettled(debt: Debt) {
    if (!confirm(`¿Marcar la deuda con ${debt.acreedor} como saldada?`)) return;
    startTransition(async () => {
      const result = await markDebtAsSettledAction(debt.id);
      if (result.ok) {
        toast({
          tone: "success",
          title: "Deuda saldada",
          description: "La movimos al historial.",
        });
        setOpen(false);
        router.refresh();
      } else {
        toast({ tone: "warn", title: "Error", description: result.error });
      }
    });
  }

  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Operación · Deudas"
        title="Lo que el negocio le debe a alguien."
        description="Cuentas corrientes, préstamos y facturas vencidas. La IA cruza los vencimientos con tu caja estimada y prioriza qué pagar primero."
        actions={
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              {exporting ? "Generando…" : "Exportar deudas"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                router.refresh();
                toast({ tone: "info", title: "Actualizando deudas…" });
              }}
            >
              <RefreshCw className="h-4 w-4" />
              Actualizar
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={handleNewDebt}
              disabled={pending}
            >
              <Plus className="h-4 w-4" />
              Registrar deuda
            </Button>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Deuda total"
          value={formatARS(kpis.totalDeuda, { compact: true })}
          icon={<Banknote />}
          tone="brand"
          hint="Saldo pendiente"
        />
        <KpiCard
          label="Vencidas"
          value={formatARS(kpis.vencidas, { compact: true })}
          icon={<AlertTriangle />}
          tone="danger"
          hint="Requiere atención inmediata"
        />
        <KpiCard
          label="Próximo vencimiento"
          value={kpis.proximoVencimiento.split(" · ")[0]}
          icon={<CalendarClock />}
          tone="warn"
          hint={kpis.proximoVencimiento.split(" · ")[1] ?? "—"}
        />
        <KpiCard
          label="Impacto mensual en caja"
          value={formatARS(kpis.impactoMensual, { compact: true })}
          icon={<Wallet />}
          tone="ai"
          hint="Estimado pagando en cuotas"
        />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: "todas", label: "Todas", count: counts.todas },
            { value: "vencidas", label: "Vencidas", count: counts.vencidas },
            { value: "por_vencer", label: "Por vencer", count: counts.por_vencer },
            { value: "impuestos", label: "Impuestos", count: counts.impuestos },
            { value: "proveedores", label: "Proveedores", count: counts.proveedores },
            { value: "saldadas", label: "Saldadas", count: counts.saldadas },
          ]}
        />
        <span className="text-xs text-ink-muted">
          {items.length} {items.length === 1 ? "deuda registrada" : "deudas registradas"}
        </span>
      </div>

      {/* Tabla */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HandCoins className="h-4 w-4" />
            Deudas
          </CardTitle>
          <Badge tone="default">{filtered.length}</Badge>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-y border-line bg-bg-subtle/60 text-left text-[11px] uppercase tracking-wider text-ink-subtle">
              <tr>
                <th className="px-5 py-2.5 font-medium">Acreedor</th>
                <th className="px-5 py-2.5 font-medium">Categoría</th>
                <th className="px-5 py-2.5 font-medium">Período</th>
                <th className="px-5 py-2.5 text-right font-medium">Saldo pendiente</th>
                <th className="px-5 py-2.5 font-medium">Vencimiento</th>
                <th className="px-5 py-2.5 font-medium">Estado</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-sm text-ink-muted">
                    Sin deudas en esta vista.
                  </td>
                </tr>
              )}
              {filtered.map((d) => {
                const cfg = STATUS_STYLES[d.estado];
                const categoria = (d.categoria ?? "proveedor") as DebtCategory;
                const catCfg = CATEGORY_STYLES[categoria];
                const progress = d.montoInicial > 0
                  ? Math.min(100, ((d.montoInicial - d.saldoPendiente) / d.montoInicial) * 100)
                  : 0;
                const isTax = categoria === "impuesto" || categoria === "sueldo";
                return (
                  <tr
                    key={d.id}
                    className="border-b border-line/60 last:border-0 hover:bg-bg-subtle cursor-pointer"
                    onClick={() => {
                      setSelected(d);
                      setOpen(true);
                    }}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {isTax ? (
                          <Landmark className="h-3.5 w-3.5 text-danger-400" />
                        ) : categoria === "proveedor" ? (
                          <Truck className="h-3.5 w-3.5 text-ink-muted" />
                        ) : null}
                        <div>
                          <div className="font-medium text-ink">{d.acreedor}</div>
                          {d.organismo && d.organismo !== d.acreedor && (
                            <div className="text-[10px] text-ink-subtle">{d.organismo}</div>
                          )}
                        </div>
                      </div>
                      {d.interesMensual && (
                        <div className="mt-0.5 text-[10px] text-warn-400">+{d.interesMensual}% mensual</div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone={catCfg.tone}>{DEBT_CATEGORY_LABELS[categoria]}</Badge>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">{d.periodo ?? d.concepto ?? "—"}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="text-sm font-semibold tabular-nums text-ink">
                        {formatARS(d.saldoPendiente)}
                      </div>
                      <div className="mt-1 h-1 w-32 overflow-hidden rounded-full bg-bg-subtle">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            progress === 100 ? "bg-success-500" : "bg-gradient-to-r from-brand-400 to-brand-600",
                          )}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </td>
                    <td className="px-5 py-3 text-ink-muted">{d.vencimiento ?? "—"}</td>
                    <td className="px-5 py-3">
                      <Badge tone={cfg.tone}>{cfg.label}</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      {d.estado !== "saldada" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRegisterPayment(d);
                          }}
                          disabled={pending}
                        >
                          <Banknote className="h-3.5 w-3.5" />
                          Pagar
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={selected?.acreedor}
        description={selected?.concepto}
        width="max-w-xl"
      >
        {selected && (
          <DebtDetail
            debt={selected}
            pending={pending}
            onPay={() => handleRegisterPayment(selected)}
            onSettle={() => handleMarkAsSettled(selected)}
          />
        )}
      </Drawer>
    </div>
  );
}

function DebtDetail({
  debt,
  pending,
  onPay,
  onSettle,
}: {
  debt: Debt;
  pending: boolean;
  onPay: () => void;
  onSettle: () => void;
}) {
  const cfg = STATUS_STYLES[debt.estado];
  const progress = debt.montoInicial > 0
    ? ((debt.montoInicial - debt.saldoPendiente) / debt.montoInicial) * 100
    : 0;
  const totalPagado = debt.pagos.reduce((s, p) => s + p.monto, 0);

  return (
    <div className="space-y-6 p-6">
      <div className="card-quiet p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="eyebrow mb-1">Saldo pendiente</div>
            <div className="text-3xl font-semibold tracking-tight text-ink tabular-nums">
              {formatARS(debt.saldoPendiente)}
            </div>
            <div className="mt-0.5 text-xs text-ink-muted">
              De {formatARS(debt.montoInicial)} iniciales
            </div>
          </div>
          <Badge tone={cfg.tone}>{cfg.label}</Badge>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.5 }}
            className={cn(
              "h-full rounded-full",
              progress >= 100 ? "bg-success-500" : "bg-gradient-to-r from-brand-400 to-brand-600",
            )}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-ink-subtle">
          <span>Pagado {progress.toFixed(0)}%</span>
          <span>Total pagado · {formatARS(totalPagado)}</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Mini label="Tomada" value={debt.tomada} />
        <Mini label="Vencimiento" value={debt.vencimiento ?? "—"} />
        {debt.interesMensual && (
          <Mini label="Interés mensual" value={`${debt.interesMensual}%`} tone="warn" />
        )}
        {debt.saldadaEl && (
          <Mini label="Saldada el" value={debt.saldadaEl} tone="success" />
        )}
      </div>

      <section>
        <div className="mb-2 flex items-center gap-2">
          <History className="h-4 w-4 text-ink-muted" />
          <h3 className="text-sm font-semibold text-ink">Historial de pagos</h3>
          <Badge tone="default">{debt.pagos.length}</Badge>
        </div>
        {debt.pagos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-ink-muted">
            Sin pagos registrados todavía.
          </div>
        ) : (
          <div className="card-quiet divide-y divide-line/70 overflow-hidden">
            {debt.pagos.map((p) => (
              <div key={p.id} className="flex items-center justify-between p-3">
                <div>
                  <div className="text-sm font-medium text-ink">{p.fecha}</div>
                  <div className="text-[11px] text-ink-subtle">{p.metodo}</div>
                </div>
                <div className="text-sm font-semibold tabular-nums text-success-400">
                  -{formatARS(p.monto)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        {debt.estado !== "saldada" ? (
          <>
            <Button variant="primary" onClick={onPay} disabled={pending}>
              <Banknote className="h-4 w-4" />
              Registrar pago
            </Button>
            <Button variant="ghost" onClick={onSettle} disabled={pending}>
              <CheckCircle2 className="h-4 w-4" />
              Marcar como saldada
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2 text-xs text-success-400">
            <Check className="h-4 w-4" />
            Esta deuda ya está saldada
          </div>
        )}
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "success";
}) {
  return (
    <div className="card-quiet p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div
        className={cn(
          "mt-1 text-sm font-medium tabular-nums",
          tone === "warn" && "text-warn-400",
          tone === "success" && "text-success-400",
          !tone && "text-ink",
        )}
      >
        {value}
      </div>
    </div>
  );
}
