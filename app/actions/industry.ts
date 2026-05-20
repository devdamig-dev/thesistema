"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import {
  SUGGESTED_MODULES_BY_INDUSTRY,
  type IndustryKey,
} from "@/lib/industries";

/**
 * Cambia el rubro del business del usuario actual y recalcula
 * `business_modules.suggested`. En modo demo no persiste nada, sólo
 * deja el client mostrar el toast — la UI sigue funcional para venta.
 */
export async function setIndustryAction(industry: IndustryKey) {
  if (!isDatabaseMode()) {
    return { ok: true as const, persisted: false };
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true as const, persisted: false };

  // Resolver business del usuario
  const memberRes = await supabase
    .from("business_members")
    .select("business_id")
    .limit(1)
    .maybeSingle();
  const member = memberRes.data as { business_id: string } | null;
  if (!member) {
    return { ok: false as const, persisted: false, error: "Sin business asignado" };
  }
  const businessId = member.business_id;

  const db = supabase as any;

  // 1) Actualizar industry
  const { error: bizErr } = await db
    .from("businesses")
    .update({ industry })
    .eq("id", businessId);
  if (bizErr) {
    return { ok: false as const, persisted: false, error: bizErr.message };
  }

  // 2) Resetear suggested = false en todo el set actual
  await db
    .from("business_modules")
    .update({ suggested: false })
    .eq("business_id", businessId);

  // 3) Marcar suggested = true a los del nuevo rubro
  const suggestedModules = SUGGESTED_MODULES_BY_INDUSTRY[industry];
  if (suggestedModules.length > 0) {
    const rows = suggestedModules.map((module_key) => ({
      business_id: businessId,
      module_key,
      enabled: true,
      suggested: true,
    }));
    await db
      .from("business_modules")
      .upsert(rows, { onConflict: "business_id,module_key" });
  }

  revalidatePath("/ajustes");
  revalidatePath("/ajustes/rubro");

  return { ok: true as const, persisted: true };
}
