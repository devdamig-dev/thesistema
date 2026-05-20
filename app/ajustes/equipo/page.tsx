"use client";

import { Check, Mail, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import {
  SettingsCard,
  SettingRow,
  Toggle,
} from "@/components/ajustes/setting-row";

const USERS = [
  { name: "Mateo Iglesias", email: "mateo@labirra.com", role: "Socio", canApprove: true },
  { name: "Lucía Romero", email: "lucia@labirra.com", role: "Encargada", canApprove: true },
  { name: "Juan Pérez", email: "juan@labirra.com", role: "Cocina", canApprove: false },
  { name: "Mariana López", email: "mariana@labirra.com", role: "Caja", canApprove: false },
  { name: "Diego Sosa", email: "diego@labirra.com", role: "Cocina", canApprove: false },
  { name: "Bruno Méndez", email: "bruno@labirra.com", role: "Delivery", canApprove: false },
];

const ROLE_TONE: Record<string, "brand" | "warn" | "info" | "ai" | "success" | "default"> = {
  Socio: "brand",
  Encargada: "ai",
  Cocina: "warn",
  Caja: "info",
  Delivery: "success",
};

export default function AjustesEquipoPage() {
  const { toast } = useToast();
  return (
    <div className="space-y-6">
      <SettingsCard
        title="Usuarios"
        description="Quiénes pueden entrar a GastroPilot y con qué permisos."
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => toast(ToastPresets.comingSoon("Invitar usuario"))}
          >
            <Plus className="h-3.5 w-3.5" /> Invitar usuario
          </Button>
        }
      >
        <ul className="space-y-2">
          {USERS.map((u) => (
            <li
              key={u.email}
              className="flex items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3"
            >
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-[11px] font-semibold text-brand-300">
                {u.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{u.name}</span>
                  <Badge tone={ROLE_TONE[u.role] ?? "default"}>{u.role}</Badge>
                  {u.canApprove && (
                    <Badge tone="success">
                      <ShieldCheck className="h-3 w-3" /> Aprobador
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-ink-muted">
                  <Mail className="h-3 w-3" />
                  {u.email}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toast(ToastPresets.comingSoon("Editar usuario"))}
              >
                Permisos
              </Button>
              <button
                onClick={() =>
                  toast({ tone: "neutral", title: `${u.name} fue removido` })
                }
                className="rounded-md p-1.5 text-ink-subtle hover:text-danger-400"
                aria-label="Quitar"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <SettingsCard
        title="Acceso del contador"
        description="Tu estudio recibe facturas, cierres y reportes directo en su panel."
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
        <SettingRow label="Estudio contable" hint="Email principal">
          <input
            type="email"
            defaultValue="contador@estudiopiazza.com.ar"
            className="w-full rounded-lg border border-line bg-bg-subtle px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </SettingRow>
        <SettingRow
          label="Envío automático de facturas"
          hint="Cuando se aprueban en /facturas"
        >
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow
          label="Resumen semanal por email"
          hint="Lunes 9:00 hs"
        >
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow
          label="Compartir cierres diarios"
          hint="Como CSV adjunto"
        >
          <Toggle />
        </SettingRow>
      </SettingsCard>

      <SettingsCard
        title="Notificaciones"
        description="Qué le avisa GastroPilot a cada rol."
      >
        <SettingRow label="Movimientos pendientes de aprobación">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Alertas de stock crítico">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Recomendaciones de la IA">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Resumen diario al socio">
          <Toggle defaultChecked />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
