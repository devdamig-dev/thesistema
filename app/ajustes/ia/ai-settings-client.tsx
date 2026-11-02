"use client";

import Link from "next/link";
import { AlertTriangle, Bot, Check, CircleSlash2, Coins, Gauge, LockKeyhole, MessageSquareText, Sparkles, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SettingsCard } from "@/components/ajustes/setting-row";
import type { WhatsAppCapability } from "@/lib/whatsapp-agent/registry";
import { AI_COMMERCIAL_PLANS, AI_CREDIT_PACKS, formatAiPlanPrice } from "@/lib/ai/commercial-plans";

export type WhatsAppConnectionState = "connected" | "disconnected" | "unknown" | "demo";

export type AiUsageOverview = {
  planCode: string;
  monthlyCredits: number;
  usedCredits: number;
  remainingCredits: number;
  requestCount: number;
  hardLimit: boolean;
  overageEnabled: boolean;
  latestCompletedAt: string | null;
};

const MODULE_LABELS: Record<string, string> = {
  sales: "Ventas",
  purchases: "Compras",
  debts: "Deudas",
  stock: "Stock",
  products: "Productos",
  invoices_ocr: "Facturas",
};

const AVAILABILITY = {
  available: { label: "Disponible", tone: "success" as const, icon: Check },
  module_disabled: { label: "Módulo desactivado", tone: "default" as const, icon: CircleSlash2 },
  forbidden: { label: "Sin permiso", tone: "warn" as const, icon: LockKeyhole },
};

export function AiSettingsClient({
  mode,
  roleLabel,
  connection,
  capabilities = [],
  unavailable = false,
  usage = null,
}: {
  mode: "demo" | "database";
  roleLabel?: string;
  connection: WhatsAppConnectionState;
  capabilities?: WhatsAppCapability[];
  unavailable?: boolean;
  usage?: AiUsageOverview | null;
}) {
  if (unavailable) {
    return (
      <SettingsCard title="Capacidades por WhatsApp" description="No pudimos confirmar el negocio activo ni sus permisos.">
        <div className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">
          El catálogo queda oculto para no mostrar capacidades que quizás no estén autorizadas. Reintentá en unos minutos.
        </div>
      </SettingsCard>
    );
  }

  const available = capabilities.filter((item) => item.availability === "available");
  const sensitive = available.filter((item) => item.risk === "SENSITIVE");
  const groups = capabilities.reduce<Record<string, WhatsAppCapability[]>>((all, capability) => {
    (all[capability.module] ??= []).push(capability);
    return all;
  }, {});

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Capacidades por WhatsApp"
        description="Catálogo derivado de las operaciones reales del sistema, los módulos activos y los permisos del rol."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Summary label="Disponibles para el rol" value={String(available.length)} detail={roleLabel ?? "Rol no disponible"} />
          <Summary label="Requieren confirmación" value={String(sensitive.length)} detail="Antes de ejecutar" />
          <Summary
            label="Canal oficial"
            value={connection === "connected" ? "Conectado" : connection === "demo" ? "Demo" : connection === "disconnected" ? "Sin conectar" : "Sin confirmar"}
            detail={connection === "connected" ? "Meta WhatsApp Business" : "No habilita ejecuciones reales"}
          />
        </div>

        {connection !== "connected" && mode === "database" && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-warn-500/25 bg-warn-500/[0.05] p-4">
            <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-warn-400" />
            <div className="text-sm text-ink-muted">
              <p className="font-semibold text-ink">Las capacidades están configuradas, pero el canal no está operativo.</p>
              <p className="mt-1 text-xs">Conectá un número oficial de Meta para recibir mensajes reales.</p>
              <Link href="/ajustes/whatsapp" className="mt-2 inline-flex text-xs font-semibold text-brand-400 hover:text-brand-300">Ir a conexión de WhatsApp</Link>
            </div>
          </div>
        )}

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {Object.entries(groups).map(([module, tools]) => {
            const moduleAvailable = tools.some((tool) => tool.availability === "available");
            return (
              <section key={module} className="rounded-xl border border-line bg-bg-subtle/40 p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                    <Bot className="h-4 w-4 text-ai-400" /> {MODULE_LABELS[module] ?? module.replaceAll("_", " ")}
                  </h3>
                  <Badge tone={moduleAvailable ? "ai" : "default"}>{moduleAvailable ? "Activo" : "No disponible"}</Badge>
                </div>
                <ul className="mt-3 space-y-2">
                  {tools.map((tool) => {
                    const status = AVAILABILITY[tool.availability];
                    const Icon = status.icon;
                    return (
                      <li key={tool.name} className="rounded-lg border border-line/70 bg-bg-elevated/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-2">
                            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ink-subtle" />
                            <div>
                              <p className="text-sm text-ink">{tool.description}</p>
                              <p className="mt-0.5 font-mono text-[10px] text-ink-subtle">{tool.name}</p>
                            </div>
                          </div>
                          <Badge tone={status.tone} className="shrink-0">{status.label}</Badge>
                        </div>
                        {tool.risk === "SENSITIVE" && (
                          <div className="mt-2 flex items-center gap-1.5 text-[11px] text-warn-400">
                            <AlertTriangle className="h-3.5 w-3.5" /> Requiere confirmación explícita
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title="Motor de IA administrado"
        description="GastroPilot elige el modelo según la tarea, mide el consumo por negocio y aplica el límite mensual antes de llamar al proveedor."
      >
        {mode === "database" && usage ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Summary label="Plan IA" value={planLabel(usage.planCode)} detail={usage.hardLimit ? "Límite mensual activo" : "Sin corte automático"} />
              <Summary label="Créditos usados" value={`${usage.usedCredits.toLocaleString("es-AR")} / ${usage.monthlyCredits.toLocaleString("es-AR")}`} detail={`${usage.remainingCredits.toLocaleString("es-AR")} disponibles`} />
              <Summary label="Operaciones IA" value={usage.requestCount.toLocaleString("es-AR")} detail="Mes calendario actual" />
              <Summary label="Última actividad" value={usage.latestCompletedAt ? new Date(usage.latestCompletedAt).toLocaleDateString("es-AR") : "—"} detail="Consumo administrado por GastroPilot" />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <EngineItem icon={Gauge} title="Motor automático" detail="GastroPilot selecciona el modelo más eficiente según cada tarea." />
              <EngineItem icon={Coins} title="Saldo compartido" detail="Los créditos pertenecen al negocio y se comparten entre sus usuarios autorizados." />
            </div>
            <UsageBar used={usage.usedCredits} total={usage.monthlyCredits} />
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-xl border border-line bg-bg-subtle/40 p-4">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-ai-400" />
            <div>
              <p className="text-sm font-semibold text-ink">{mode === "demo" ? "Vista demostrativa" : "Consumo todavía no disponible"}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {mode === "demo"
                  ? "La demo no consume modelos externos ni créditos reales."
                  : "No mostramos números estimados: el panel aparecerá cuando podamos leer el ledger real del negocio."}
              </p>
            </div>
          </div>
        )}
      </SettingsCard>

      <SettingsCard
        title="Planes de Inteligencia Artificial"
        description="Elegí capacidad para el negocio. La activación paga quedará vinculada al checkout; nunca se habilita un plan pago sin pago confirmado."
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {AI_COMMERCIAL_PLANS.map((plan) => (
            <div key={plan.code} className={`rounded-xl border p-4 ${usage?.planCode === plan.code ? "border-ai-500/50 bg-ai-500/[0.06]" : "border-line bg-bg-subtle/40"}`}>
              <div className="text-sm font-semibold text-ink">{plan.name}</div>
              <div className="mt-2 text-2xl font-semibold text-ink">{formatAiPlanPrice(plan.priceUsdCents)}</div>
              <div className="mt-1 text-xs text-ink-muted">{plan.monthlyCredits.toLocaleString("es-AR")} créditos / mes</div>
              <Badge tone={usage?.planCode === plan.code ? "ai" : "default"} className="mt-3">
                {usage?.planCode === plan.code ? "Plan actual" : plan.priceUsdCents === 0 ? "Sin IA" : "Activación con pago"}
              </Badge>
            </div>
          ))}
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold text-ink">Packs adicionales</div>
          <div className="grid gap-3 sm:grid-cols-3">
            {AI_CREDIT_PACKS.map((pack) => (
              <div key={pack.code} className="rounded-xl border border-line bg-bg-subtle/40 p-4">
                <div className="text-sm font-semibold text-ink">{pack.name}</div>
                <div className="mt-1 text-lg font-semibold text-ink">{formatAiPlanPrice(pack.priceUsdCents)}</div>
                <div className="mt-1 text-xs text-ink-muted">{pack.credits.toLocaleString("es-AR")} créditos · vigencia {pack.validityDays} días</div>
              </div>
            ))}
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}

function Summary({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg-subtle/40 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] text-ink-muted">{detail}</div>
    </div>
  );
}


function EngineItem({ icon: Icon, title, detail }: { icon: LucideIcon; title: string; detail: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-bg-subtle/40 p-4">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-ai-400" />
      <div>
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-ink-muted">{detail}</div>
      </div>
    </div>
  );
}

function planLabel(code: string) {
  return AI_COMMERCIAL_PLANS.find((plan) => plan.code === code)?.name ?? code;
}

function UsageBar({ used, total }: { used: number; total: number }) {
  const percentage = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="rounded-xl border border-line bg-bg-subtle/40 p-4">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-semibold text-ink">Consumo mensual</span>
        <span className="tabular-nums text-ink-muted">{percentage}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-elevated">
        <div className="h-full rounded-full bg-ai-500 transition-all" style={{ width: `${percentage}%` }} />
      </div>
      <div className="mt-2 text-[11px] text-ink-muted">
        {used.toLocaleString("es-AR")} usados · {Math.max(0, total - used).toLocaleString("es-AR")} disponibles
      </div>
    </div>
  );
}
