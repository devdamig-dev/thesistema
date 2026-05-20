"use client";

import { useState } from "react";
import { Building2, Check, MapPin, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToastPresets, useToast } from "@/components/ui/toast";
import {
  SettingsCard,
  SettingRow,
  TextField,
  Toggle,
} from "@/components/ajustes/setting-row";

const BRANCHES = [
  { name: "Local Palermo", address: "Av. Córdoba 4500, CABA", main: true },
  { name: "Foodtruck CARRO", address: "Itinerante · Buenos Aires", main: false },
];

const PAYMENT_METHODS = [
  { name: "Efectivo", enabled: true },
  { name: "Tarjeta de crédito", enabled: true },
  { name: "Tarjeta de débito", enabled: true },
  { name: "Mercado Pago QR", enabled: true },
  { name: "Transferencia", enabled: true },
  { name: "Cuenta corriente", enabled: false },
];

const CHANNELS = [
  { name: "Salón", enabled: true },
  { name: "Delivery propio", enabled: true },
  { name: "WhatsApp", enabled: true },
  { name: "PedidosYa", enabled: true },
  { name: "Rappi", enabled: false },
];

export default function AjustesNegocioPage() {
  const { toast } = useToast();
  return (
    <div className="space-y-6">
      <SettingsCard
        title="Datos del negocio"
        description="Información que aparece en reportes y exportaciones para el contador."
        footer={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toast({ tone: "neutral", title: "Cambios descartados" })}
            >
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => toast(ToastPresets.settingsSaved())}
            >
              <Check className="h-3.5 w-3.5" /> Guardar
            </Button>
          </>
        }
      >
        <SettingRow label="Nombre comercial">
          <TextField defaultValue="La Birra Burger" />
        </SettingRow>
        <SettingRow label="Razón social">
          <TextField defaultValue="Iglesias Hnos. S.R.L." />
        </SettingRow>
        <SettingRow label="CUIT">
          <TextField defaultValue="30-71234567-9" />
        </SettingRow>
        <SettingRow label="Condición IVA">
          <TextField defaultValue="Responsable Inscripto" />
        </SettingRow>
        <SettingRow label="Email facturación">
          <TextField defaultValue="contador@labirra.com" type="email" />
        </SettingRow>
        <SettingRow label="Zona horaria">
          <TextField defaultValue="America/Argentina/Buenos_Aires" />
        </SettingRow>
      </SettingsCard>

      <SettingsCard
        title="Sucursales y puntos de venta"
        description="Agregá locales, foodtrucks o dark kitchens. Cada punto puede tener su equipo y sus cierres."
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              toast(ToastPresets.comingSoon("Alta de sucursal"))
            }
          >
            <Plus className="h-3.5 w-3.5" /> Nueva sucursal
          </Button>
        }
      >
        <ul className="space-y-2">
          {BRANCHES.map((b) => (
            <li
              key={b.name}
              className="flex items-center gap-3 rounded-xl border border-line bg-bg-subtle/40 p-3"
            >
              <div className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-bg-elevated">
                <Building2 className="h-4 w-4 text-brand-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-ink">{b.name}</span>
                  {b.main && <Badge tone="brand">Principal</Badge>}
                </div>
                <div className="flex items-center gap-1 text-xs text-ink-muted">
                  <MapPin className="h-3 w-3" />
                  {b.address}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => toast(ToastPresets.comingSoon("Editar sucursal"))}
              >
                Editar
              </Button>
            </li>
          ))}
        </ul>
      </SettingsCard>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <SettingsCard
          title="Canales de venta"
          description="Lo que aparece en reportes y cierres."
        >
          <ul className="space-y-2">
            {CHANNELS.map((c) => (
              <ChannelRow key={c.name} name={c.name} enabled={c.enabled} />
            ))}
          </ul>
        </SettingsCard>

        <SettingsCard
          title="Medios de pago"
          description="Configurá qué medios acepta tu negocio."
        >
          <ul className="space-y-2">
            {PAYMENT_METHODS.map((m) => (
              <ChannelRow key={m.name} name={m.name} enabled={m.enabled} />
            ))}
          </ul>
        </SettingsCard>
      </div>
    </div>
  );
}

function ChannelRow({ name, enabled }: { name: string; enabled: boolean }) {
  const [on, setOn] = useState(enabled);
  const { toast } = useToast();
  return (
    <li className="flex items-center justify-between rounded-lg border border-line bg-bg-subtle/40 px-3 py-2">
      <div className="flex items-center gap-2">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            on ? "bg-success-500" : "bg-ink-subtle"
          }`}
        />
        <span className="text-sm text-ink">{name}</span>
      </div>
      <Toggle
        defaultChecked={on}
        onChange={(v) => {
          setOn(v);
          toast({
            tone: v ? "success" : "neutral",
            title: v ? `${name} activado` : `${name} desactivado`,
          });
        }}
      />
    </li>
  );
}
