"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";

export type BusinessFormPayload = {
  name?: string;
  taxId?: string;
};

/**
 * Actualiza datos básicos del business actual. En modo demo no
 * persiste; en database mode escribe en la tabla.
 */
export async function updateBusinessAction(payload: BusinessFormPayload) {
  if (!isDatabaseMode()) {
    return { ok: true as const, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true as const, persisted: false };

  const memberRes = await supabase
    .from("business_members")
    .select("business_id")
    .limit(1)
    .maybeSingle();
  const member = memberRes.data as { business_id: string } | null;
  if (!member) {
    return { ok: false as const, persisted: false, error: "Sin business asignado" };
  }

  const patch: Record<string, unknown> = {};
  if (payload.name) patch.name = payload.name;
  if (payload.taxId) patch.tax_id = payload.taxId;
  if (Object.keys(patch).length === 0) {
    return { ok: true as const, persisted: false };
  }

  const { error } = await (supabase as any)
    .from("businesses")
    .update(patch)
    .eq("id", member.business_id);
  if (error) {
    return { ok: false as const, persisted: false, error: error.message };
  }

  revalidatePath("/ajustes/negocio");
  revalidatePath("/ajustes");
  return { ok: true as const, persisted: true };
}
