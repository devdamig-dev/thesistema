"use client";

import { useState, useTransition } from "react";
import {
  Beef,
  Beer,
  Check,
  Coffee,
  Cookie,
  IceCream,
  Pizza,
  Sparkles,
  Truck,
  UtensilsCrossed,
  Warehouse,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import { SettingsCard } from "@/components/ajustes/setting-row";
import {
  INDUSTRIES,
  MODULE_LABELS,
  SUGGESTED_MODULES_BY_INDUSTRY,
  type IndustryKey,
} from "@/lib/industries";
import { setIndustryAction } from "@/app/actions/industry";
import { cn } from "@/lib/utils";

const ICONS: Record<IndustryKey, any> = {
  hamburgueseria: Beef,
  foodtruck: Truck,
  cafeteria: Coffee,
  pizzeria: Pizza,
  bar: Beer,
  heladeria: IceCream,
  panaderia: Cookie,
  restaurante: UtensilsCrossed,
  dark_kitchen: Warehouse,
};

export default function AjustesRubroPage() {
  const [industry, setIndustry] = useState<IndustryKey>("hamburgueseria");
  const [pending, startTransition] = useTransition();
  const { toast } = useToast();

  const suggested = SUGGESTED_MODULES_BY_INDUSTRY[industry];
  const current = INDUSTRIES.find((i) => i.key === industry)!;

  function applyIndustry() {
    startTransition(async () => {
      const result = await setIndustryAction(industry);
      if (result.ok) {
        toast({
          tone: "success",
          title: `Rubro actualizado a ${current.label}`,
          description: result.persisted
            ? "Sincronizamos los módulos sugeridos en Supabase."
            : "Re-acomodamos el sidebar y las recomendaciones de la IA.",
        });
      } else {
        toast({
          tone: "warn",
          title: "No pudimos guardar el rubro",
          description: result.error,
        });
      }
    });
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Rubro gastronómico"
        description="GastroPilot adapta los módulos visibles, los reportes y los recomendadores según tu rubro."
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-3">
          {INDUSTRIES.map((i) => {
            const Icon = ICONS[i.key];
            const active = i.key === industry;
            return (
              <button
                key={i.key}
                onClick={() => setIndustry(i.key)}
                className={cn(
                  "group relative overflow-hidden rounded-xl border p-3 text-left transition-all",
                  active
                    ? "border-brand-500/40 bg-brand-500/[0.06]"
                    : "border-line bg-bg-subtle/40 hover:border-line-strong hover:bg-bg-subtle",
                )}
              >
                {active && (
                  <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-brand-500 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <div
                  className={cn(
                    "grid h-9 w-9 place-items-center rounded-lg border",
                    active
                      ? "border-brand-500/40 bg-brand-500/15 text-brand-300"
                      : "border-line bg-bg-elevated text-ink-muted",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="mt-2.5 text-sm font-semibold text-ink">{i.label}</div>
                <div className="text-[11px] text-ink-muted leading-snug">{i.tagline}</div>
              </button>
            );
          })}
        </div>
      </SettingsCard>

      <SettingsCard
        title={`Módulos sugeridos para ${current.label}`}
        description="Estos módulos se activan o se priorizan automáticamente según el rubro elegido."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                toast({
                  tone: "neutral",
                  title: "Vista previa restablecida",
                })
              }
              disabled={pending}
            >
              Restablecer
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={applyIndustry}
              disabled={pending}
            >
              <Check className="h-3.5 w-3.5" />
              {pending ? "Guardando…" : "Aplicar rubro"}
            </Button>
          </>
        }
      >
        <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-ai-400/30 bg-ai-500/10 px-2.5 py-1 text-[11px] text-ai-400">
          <Sparkles className="h-3 w-3" />
          La IA recomienda activar estos módulos en base a {current.label.toLowerCase()}
        </div>
        <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {suggested.map((key) => {
            const meta = MODULE_LABELS[key] ?? { label: key, desc: "" };
            return (
              <li
                key={key}
                className="flex items-start gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3"
              >
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-bg-elevated">
                  <Sparkles className="h-3.5 w-3.5 text-ai-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{meta.label}</span>
                    <Badge tone="ai">Sugerido</Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-ink-muted leading-relaxed">
                    {meta.desc}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </SettingsCard>
    </div>
  );
}
