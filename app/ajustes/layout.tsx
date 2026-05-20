import { ReactNode } from "react";
import { SectionHeader } from "@/components/ui/section-header";
import { SettingsShell } from "@/components/ajustes/settings-shell";

export default function AjustesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-8">
      <SectionHeader
        eyebrow="Ajustes"
        title="Tu negocio, tu copiloto, tus reglas."
        description="Configurá los datos de tu negocio, la conexión con WhatsApp, las preferencias de la IA y los permisos del equipo."
      />
      <SettingsShell>{children}</SettingsShell>
    </div>
  );
}
