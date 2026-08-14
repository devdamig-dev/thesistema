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
 * `business_modules.suggested` en una única transacción de PostgreSQL.
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

  const suggestedModules = SUGGESTED_MODULES_BY_INDUSTRY[industry];
  const { error } = await (supabase as any).rpc("set_business_industry", {
    p_business_id: ctx.businessId,
    p_industry: industry,
    p_suggested_modules: suggestedModules,
  });

  if (error) {
    return {
      ok: false as const,
      persisted: false,
      error: `No pudimos guardar el rubro y sus módulos: ${error.message}`,
    };
  }

  revalidatePath("/ajustes");
  revalidatePath("/ajustes/rubro");

  return { ok: true as const, persisted: true };
}
