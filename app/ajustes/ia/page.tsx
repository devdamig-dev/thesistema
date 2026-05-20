"use client";

import { Bot, Check, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import {
  SettingsCard,
  SettingRow,
  Toggle,
} from "@/components/ajustes/setting-row";
import { cn } from "@/lib/utils";

const TONES = [
  { value: "cercano", label: "Cercano", desc: "Coloquial, charlado." },
  { value: "premium", label: "Premium", desc: "Cuidado y elegante." },
  { value: "divertido", label: "Divertido", desc: "Suelto, con humor." },
  { value: "urgente", label: "Urgente", desc: "Directo, con CTA fuerte." },
];

const MODULES = [
  { key: "inbox", label: "Inbox IA", desc: "Convierte mensajes en registros" },
  { key: "facturas", label: "Facturas OCR", desc: "Lee comprobantes y los imputa" },
  { key: "cierres", label: "Cierres diarios", desc: "Estructura los cierres por canal" },
  { key: "reportes", label: "Reportes IA", desc: "Responde preguntas del negocio" },
  { key: "marketing", label: "Marketing IA", desc: "Sugiere campañas y copies" },
  { key: "costeo", label: "Costeo dinámico", desc: "Recalcula costos por factura" },
];

export default function AjustesIAPage() {
  const { toast } = useToast();
  return (
    <div className="space-y-6">
      {/* Plan & créditos */}
      <SettingsCard
        title="Plan y créditos IA"
        description="Cada plan incluye una cuota mensual de procesamiento."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat label="Plan actual" value="Pro" badge="Activo" tone="ai" />
          <Stat label="Créditos usados" value="64%" hint="6.420 de 10.000 / mes" />
          <Stat label="Renovación" value="01/06" hint="Próximo ciclo" />
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-bg-subtle">
          <div className="h-full w-[64%] rounded-full bg-gradient-to-r from-ai-400 to-ai-600" />
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="ai"
            size="sm"
            onClick={() => toast(ToastPresets.comingSoon("Cambio de plan"))}
          >
            <Zap className="h-3.5 w-3.5" /> Subir a Enterprise
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toast(ToastPresets.comingSoon("Historial de uso"))}
          >
            Ver historial
          </Button>
        </div>
      </SettingsCard>

      {/* Tono */}
      <SettingsCard
        title="Tono y voz de marca"
        description="Cómo te responde la IA cuando habla con tu equipo y tus clientes."
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => toast(ToastPresets.settingsSaved())}
          >
            <Check className="h-3.5 w-3.5" /> Guardar
          </Button>
        }
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {TONES.map((t) => (
            <ToneOption key={t.value} value={t.value} label={t.label} desc={t.desc} />
          ))}
        </div>
      </SettingsCard>

      {/* Automatizaciones */}
      <SettingsCard
        title="Automatizaciones"
        description="Lo que la IA hace sin pedirte permiso."
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => toast(ToastPresets.settingsSaved())}
          >
            <Check className="h-3.5 w-3.5" /> Guardar
          </Button>
        }
      >
        <SettingRow
          label="Pedir aclaraciones por WhatsApp"
          hint="Cuando faltan datos para registrar"
        >
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow
          label="Sugerir campañas semanales"
          hint="En Marketing IA"
        >
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow
          label="Imputar facturas al contador automáticamente"
          hint="Cuando la confianza es ≥ 95%"
        >
          <Toggle />
        </SettingRow>
        <SettingRow
          label="Resúmenes diarios al socio"
          hint="20:30 hs por WhatsApp"
        >
          <Toggle defaultChecked />
        </SettingRow>
      </SettingsCard>

      {/* Módulos activos */}
      <SettingsCard
        title="Módulos activos"
        description="Cuáles capacidades de la IA están encendidas para tu negocio."
      >
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MODULES.map((m) => (
            <ModuleRow key={m.key} label={m.label} desc={m.desc} />
          ))}
        </ul>
      </SettingsCard>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  badge,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  badge?: string;
  tone?: "ai";
}) {
  return (
    <div className="rounded-xl border border-line bg-bg-subtle/40 p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <span
          className={cn(
            "text-xl font-semibold tabular-nums",
            tone === "ai" ? "text-ai-400" : "text-ink",
          )}
        >
          {value}
        </span>
        {badge && <Badge tone="ai">{badge}</Badge>}
      </div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-subtle">{hint}</div>}
    </div>
  );
}

function ToneOption({
  value,
  label,
  desc,
}: {
  value: string;
  label: string;
  desc: string;
}) {
  return (
    <label
      className={cn(
        "group block cursor-pointer rounded-xl border border-line bg-bg-subtle/40 p-3 transition-colors hover:border-line-strong has-[input:checked]:border-ai-400/50 has-[input:checked]:bg-ai-500/[0.06]",
      )}
    >
      <input
        type="radio"
        name="tone"
        value={value}
        defaultChecked={value === "cercano"}
        className="sr-only"
      />
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-ai-400" />
        <span className="text-sm font-semibold text-ink">{label}</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-muted leading-relaxed">{desc}</p>
    </label>
  );
}

function ModuleRow({ label, desc }: { label: string; desc: string }) {
  return (
    <li className="flex items-center justify-between rounded-lg border border-line bg-bg-subtle/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <Bot className="h-3.5 w-3.5 text-ai-400" />
        <div>
          <div className="text-sm text-ink">{label}</div>
          <div className="text-[11px] text-ink-subtle">{desc}</div>
        </div>
      </div>
      <Toggle defaultChecked />
    </li>
  );
}
