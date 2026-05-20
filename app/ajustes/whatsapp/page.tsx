"use client";

import {
  Check,
  MessageSquareText,
  Phone,
  QrCode,
  RefreshCw,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import {
  SettingsCard,
  SettingRow,
  TextField,
  Toggle,
} from "@/components/ajustes/setting-row";

const AUTHORIZED = [
  { name: "Mateo Iglesias", role: "Socio", phone: "+54 9 11 4455-2211", active: true },
  { name: "Lucía Romero", role: "Encargada", phone: "+54 9 11 5566-1100", active: true },
  { name: "Diego Sosa", role: "Cocina", phone: "+54 9 11 5678-9933", active: true },
  { name: "Bruno Méndez", role: "Delivery", phone: "+54 9 11 6611-2244", active: false },
];

export default function AjustesWhatsappPage() {
  const { toast } = useToast();
  return (
    <div className="space-y-6">
      {/* Estado de la conexión */}
      <SettingsCard
        title="Conexión con WhatsApp Business"
        description="El número desde el cual la IA recibe mensajes y envía respuestas."
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_auto]">
          <div className="flex items-start gap-3 rounded-xl border border-success-500/25 bg-success-500/[0.06] p-4">
            <div className="grid h-10 w-10 place-items-center rounded-lg border border-success-500/30 bg-success-500/15">
              <MessageSquareText className="h-5 w-5 text-success-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-ink">+54 9 11 5556-7700</span>
                <Badge tone="success">
                  <span className="h-1.5 w-1.5 animate-pulseDot rounded-full bg-success-500" />
                  Conectado
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-ink-muted">
                Última sincronización hace 2 min · 8 mensajes hoy
              </p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    toast({
                      tone: "ai",
                      title: "Resincronizando…",
                      description: "Buscamos mensajes nuevos en WhatsApp Business.",
                    })
                  }
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Resincronizar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    toast({ tone: "warn", title: "Conexión pausada", description: "Reactivala cuando quieras." })
                  }
                >
                  Pausar conexión
                </Button>
              </div>
            </div>
          </div>
          <div className="grid h-full place-items-center rounded-xl border border-line bg-bg-subtle/40 p-4">
            <div className="text-center">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-xl border border-line bg-bg-elevated">
                <QrCode className="h-10 w-10 text-ink-muted" />
              </div>
              <Button
                variant="primary"
                size="sm"
                className="mt-3"
                onClick={() => toast(ToastPresets.comingSoon("Reescanear QR"))}
              >
                Reescanear QR
              </Button>
            </div>
          </div>
        </div>
      </SettingsCard>

      {/* Miembros autorizados */}
      <SettingsCard
        title="Miembros autorizados"
        description="Quiénes pueden cargar movimientos desde WhatsApp."
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => toast(ToastPresets.comingSoon("Invitar miembro"))}
          >
            <Users className="h-3.5 w-3.5" /> Invitar miembro
          </Button>
        }
      >
        <ul className="space-y-2">
          {AUTHORIZED.map((p) => (
            <li
              key={p.phone}
              className="flex items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3"
            >
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400/20 to-brand-600/20 text-[11px] font-semibold text-brand-300">
                {p.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{p.name}</span>
                  <Badge tone="default">{p.role}</Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-ink-muted">
                  <Phone className="h-3 w-3" />
                  {p.phone}
                </div>
              </div>
              <Badge tone={p.active ? "success" : "default"}>
                {p.active ? "Activo" : "Pausado"}
              </Badge>
              <button
                onClick={() =>
                  toast({ tone: "neutral", title: `${p.name} fue removido` })
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

      {/* Plantillas */}
      <SettingsCard
        title="Plantillas y respuestas automáticas"
        description="La IA usa estas plantillas cuando responde por vos."
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
        <SettingRow label="Saludo automático" hint="Cuando arranca una conversación">
          <TextField defaultValue="¡Hola! Soy el copiloto de La Birra. ¿Qué movimiento querés cargar?" />
        </SettingRow>
        <SettingRow label="Pedido de dato faltante">
          <TextField defaultValue="¿Cómo lo pagaron? Es el dato que me falta para registrarlo." />
        </SettingRow>
        <SettingRow label="Pedir aclaración automáticamente" hint="Si la confianza es < 70%">
          <Toggle defaultChecked />
        </SettingRow>
        <SettingRow label="Notificar al socio si la IA duda" hint="Por WhatsApp y dashboard">
          <Toggle defaultChecked />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
