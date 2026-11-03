import { FudoSettingsClient } from "./fudo-settings-client";
import { getFudoConnectionView } from "@/lib/integrations/fudo/service";
import { SectionHeader } from "@/components/ui/section-header";

export const maxDuration = 60;

export default async function FudoSettingsPage() {
  const status = await getFudoConnectionView().catch(() => null);
  return <div className="space-y-6">
    <SectionHeader eyebrow="Integraciones · Fudo" title="Conectá Fudo sin interrumpir tu negocio"
      description="Primero importamos y contrastamos datos. El objetivo es reemplazar Fudo una vez que GastroPilot pueda cubrir toda la operación." />
    {status ? <FudoSettingsClient status={status} />
      : <div className="rounded-xl border border-line p-5 text-sm text-ink-muted">
        No pudimos comprobar la configuración o tus permisos. Esta sección requiere un owner/admin
        autenticado y la migración Fudo instalada en Supabase.
      </div>}
  </div>;
}
