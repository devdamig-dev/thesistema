import { SettingsCard } from "@/components/ajustes/setting-row";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { INDUSTRIES, type IndustryKey } from "@/lib/industries";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { RubroClient } from "./rubro-client";

const VALID_INDUSTRIES = new Set(INDUSTRIES.map((item) => item.key));

export default async function AjustesRubroPage() {
  if (!isDatabaseMode()) {
    return <RubroClient initialIndustry="hamburgueseria" />;
  }

  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId) {
    return <IndustryLoadError message="No pudimos resolver el negocio asociado a tu sesión." />;
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return <IndustryLoadError message="Supabase no está disponible en este momento." />;
  }

  const { data, error } = await supabase
    .from("businesses")
    .select("industry")
    .eq("id", ctx.businessId)
    .maybeSingle();

  if (error) {
    return <IndustryLoadError message="No pudimos leer el rubro guardado. No mostramos un valor por defecto para evitar una configuración engañosa." />;
  }

  const rawIndustry = (data as { industry?: string | null } | null)?.industry ?? null;
  if (!rawIndustry || !VALID_INDUSTRIES.has(rawIndustry as IndustryKey)) {
    return <IndustryLoadError message="El negocio no tiene un rubro válido configurado. Volvé a completar el onboarding o corregí el valor persistido." />;
  }

  return <RubroClient initialIndustry={rawIndustry as IndustryKey} />;
}

function IndustryLoadError({ message }: { message: string }) {
  return (
    <SettingsCard
      title="Rubro gastronómico"
      description="La configuración real del negocio no está disponible."
    >
      <div className="rounded-xl border border-warn-500/30 bg-warn-500/10 p-4 text-sm text-warn-300">
        {message}
      </div>
    </SettingsCard>
  );
}
