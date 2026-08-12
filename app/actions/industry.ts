"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { assertPermission } from "@/lib/permissions/server-action";
import { getCurrentUserContext } from "@/lib/data/auth";
import {
  SUGGESTED_MODULES_BY_INDUSTRY,
  type IndustryKey,
} from "@/lib/industries";

/**
 * Cambia el rubro del business del usuario actual y recalcula
 * `business_modules.suggested`.
 */
export async function setIndustryAction(industry: IndustryKey) {
  const guard = await assertPermission("settings.industry");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    return { ok: true as const, persisted: false };
  }

  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId) {
    return { ok: false as const, persisted: false, error: "Sin business asignado" };
  }

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return { ok: false as const, persisted: false, error: "Supabase no disponible" };
  }

  const businessId = ctx.businessId;
  const db = supabase as any;

  const { error: resetErr } = await db
    .from("business_modules")
    .update({ suggested: false })
    .eq("business_id", businessId);
  if (resetErr) {
    return { ok: false as const, persisted: false, error: `No pudimos actualizar módulos: ${resetErr.message}` };
  }

  const suggestedModules = SUGGESTED_MODULES_BY_INDUSTRY[industry];
  if (suggestedModules.length > 0) {
    const rows = suggestedModules.map((module_key) => ({
      business_id: businessId,
      module_key,
      enabled: true,
      suggested: true,
    }));
    const { error: modulesErr } = await db
      .from("business_modules")
      .upsert(rows, { onConflict: "business_id,module_key" });
    if (modulesErr) {
      return { ok: false as const, persisted: false, error: `No pudimos aplicar módulos sugeridos: ${modulesErr.message}` };
    }
  }

  const { error: bizErr } = await db
    .from("businesses")
    .update({ industry })
    .eq("id", businessId);
  if (bizErr) {
    return { ok: false as const, persisted: false, error: `No pudimos guardar el rubro: ${bizErr.message}` };
  }

  revalidatePath("/ajustes");
  revalidatePath("/ajustes/rubro");

  return { ok: true as const, persisted: true };
}
