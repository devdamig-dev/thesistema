"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { assertPermission } from "@/lib/permissions/server-action";

export type BusinessFormPayload = {
  name?: string;
  taxId?: string;
};

/**
 * Actualiza datos básicos del business actual. En modo demo no
 * persiste; en database mode escribe en la tabla.
 */
export async function updateBusinessAction(payload: BusinessFormPayload) {
  const guard = await assertPermission("settings.business");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    return { ok: true as const, persisted: false };
  }
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId) {
    return { ok: false as const, persisted: false, error: "no_business" };
  }
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false as const, persisted: false, error: "connection_unavailable" };

  const patch: Record<string, unknown> = {};
  if (payload.name) patch.name = payload.name;
  if (payload.taxId) patch.tax_id = payload.taxId;
  if (Object.keys(patch).length === 0) {
    return { ok: true as const, persisted: false };
  }

  const { error } = await (supabase as any)
    .from("businesses")
    .update(patch)
    .eq("id", ctx.businessId);
  if (error) {
    return { ok: false as const, persisted: false, error: error.message };
  }

  revalidatePath("/ajustes/negocio");
  revalidatePath("/ajustes");
  return { ok: true as const, persisted: true };
}


export async function deleteCurrentBusinessAction(confirmationName: string) {
  const ctx = await getCurrentUserContext();
  if (!isDatabaseMode()) return { ok: false as const, persisted: false, error: "database_required" };
  if (!ctx.isAuthenticated || !ctx.userId || !ctx.businessId) {
    return { ok: false as const, persisted: false, error: "no_business" };
  }
  if (ctx.role !== "owner") {
    return { ok: false as const, persisted: false, error: "owner_required" };
  }
  const name = confirmationName.trim();
  if (!name || name.length > 200) {
    return { ok: false as const, persisted: false, error: "confirmation_required" };
  }

  const admin = createSupabaseAdminClient() as any;
  const rpc = await admin.rpc("delete_owned_business", {
    p_business_id: ctx.businessId,
    p_actor_id: ctx.userId,
    p_confirmation_name: name,
  });
  if (rpc.error) {
    console.error("[business] deletion failed", rpc.error.message);
    return { ok: false as const, persisted: false, error: "delete_failed" };
  }
  const result = rpc.data as { ok: true; business_id: string } | { ok: false; error: string } | null;
  if (!result?.ok) {
    return { ok: false as const, persisted: false, error: result?.error ?? "delete_failed" };
  }

  revalidatePath("/", "layout");
  return { ok: true as const, persisted: true, businessId: result.business_id };
}
