"use client";

import Link from "next/link";
import { AlertTriangle, Bot, Check, CircleSlash2, LockKeyhole, MessageSquareText, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SettingsCard } from "@/components/ajustes/setting-row";
import type { WhatsAppCapability } from "@/lib/whatsapp-agent/registry";

export type WhatsAppConnectionState = "connected" | "disconnected" | "unknown" | "demo";

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
}: {
  mode: "demo" | "database";
  roleLabel?: string;
  connection: WhatsAppConnectionState;
  capabilities?: WhatsAppCapability[];
  unavailable?: boolean;
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
        title="Configuración de IA"
        description={mode === "database" ? "Preferencias que todavía no tienen persistencia real." : "Vista demostrativa de la futura configuración."}
      >
        <div className="flex items-start gap-3 rounded-xl border border-line bg-bg-subtle/40 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-ai-400" />
          <div>
            <p className="text-sm font-semibold text-ink">Sin controles ficticios</p>
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              Planes, créditos, tono y automatizaciones aparecerán cuando exista un modelo persistido. Esta pantalla no simula guardados ni activaciones.
            </p>
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
