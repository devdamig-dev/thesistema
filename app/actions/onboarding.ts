"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import {
  SUGGESTED_MODULES_BY_INDUSTRY,
} from "@/lib/industries";
import {
  validateBranchesPayload,
  validateBusinessPayload,
  validateChannelsPayload,
} from "@/lib/onboarding/validation";
import type { Industry } from "@/lib/entities";

type Result =
  | { ok: true; persisted: boolean }
  | { ok: false; persisted: false; error: string };

async function getOnboardingBusinessId(db: any): Promise<string | null> {
  const { data: authData, error: authError } = await db.auth.getUser();
  const userId = authData?.user?.id as string | undefined;
  if (authError || !userId) return null;

  const membershipsRes = await db
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", userId)
    .eq("role", "owner");
  if (membershipsRes.error) return null;

  const ownerBusinessIds = [
    ...new Set(
      ((membershipsRes.data ?? []) as { business_id: string; role: string }[])
        .map((row) => row.business_id)
        .filter(Boolean),
    ),
  ];
  if (ownerBusinessIds.length === 0) return null;

  const businessesRes = await db
    .from("businesses")
    .select("id, onboarding_completed")
    .in("id", ownerBusinessIds);
  if (businessesRes.error) return null;

  const incomplete = ((businessesRes.data ?? []) as {
    id: string;
    onboarding_completed: boolean | null;
  }[]).filter((business) => !business.onboarding_completed);

  // Onboarding actions are a privileged setup boundary: only the owner of one
  // unambiguous, still-incomplete business may mutate setup state.
  // Never fall back to a completed tenant, and never accept non-owner members.
  return incomplete.length === 1 ? incomplete[0].id : null;
}

export async function saveBusinessStep(payload: unknown): Promise<Result> {
  const validated = validateBusinessPayload(payload);
  if (!validated.ok) return { ok: false, persisted: false, error: validated.error };
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData.user) {
    return { ok: false, persisted: false, error: "not_authenticated" };
  }

  const suggestedModules = SUGGESTED_MODULES_BY_INDUSTRY[validated.value.industry];
  const { data: businessId, error } = await db.rpc("bootstrap_first_business", {
    p_name: validated.value.name,
    p_industry: validated.value.industry,
    p_tax_id: validated.value.taxId,
    p_timezone: validated.value.timezone,
    p_modules: suggestedModules,
  });
  if (error || !businessId) {
    console.error("bootstrap_first_business failed", error);
    return { ok: false, persisted: false, error: "first_business_failed" };
  }

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveBranchStep(payload: unknown): Promise<Result> {
  const validated = validateBranchesPayload(payload);
  if (!validated.ok) return { ok: false, persisted: false, error: validated.error };
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  // bootstrap_first_business creates the initial main branch. During onboarding
  // we edit that row instead of inserting a second main branch.
  const mainLookup = await db
    .from("branches")
    .select("id")
    .eq("business_id", businessId)
    .eq("is_main", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (mainLookup.error || !mainLookup.data?.id) {
    console.error("saveBranchStep main lookup failed", mainLookup.error);
    return { ok: false, persisted: false, error: "branch_save_failed" };
  }

  const writeResult = await db.from("branches").update({
    business_id: businessId,
    name: validated.value.name,
    address: validated.value.address,
    branch_type: validated.value.type,
    is_main: true,
  }).eq("id", mainLookup.data.id);

  if (writeResult.error) {
    console.error("saveBranchStep failed", writeResult.error);
    return { ok: false, persisted: false, error: "branch_save_failed" };
  }

  const { error: progressError } = await db
    .from("businesses")
    .update({ onboarding_step: 2 })
    .eq("id", businessId);
  if (progressError) return { ok: false, persisted: false, error: "onboarding_progress_failed" };

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveChannelsStep(channels: unknown = []): Promise<Result> {
  const validated = validateChannelsPayload(channels);
  if (!validated.ok) return { ok: false, persisted: false, error: validated.error };
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  const { error } = await db
    .from("businesses")
    .update({ onboarding_step: 3, sales_channels: validated.value })
    .eq("id", businessId);
  if (error) return { ok: false, persisted: false, error: "channels_save_failed" };

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveTeamStep(): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  const { error } = await db.from("businesses").update({ onboarding_step: 4 }).eq("id", businessId);
  if (error) return { ok: false, persisted: false, error: "team_step_save_failed" };

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveWhatsappStep(): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  const { error } = await db.from("businesses").update({ onboarding_step: 5 }).eq("id", businessId);
  if (error) return { ok: false, persisted: false, error: "whatsapp_step_save_failed" };

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function seedIngredientsAndProducts(
  _industry: Industry,
): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  // Product/ingredient suggestions are intentionally deferred until the business
  // has loaded its real products and recipes. Onboarding must never inject
  // estimated costs or demo-like catalog data into a real tenant.
  const { error } = await db
    .from("businesses")
    .update({ onboarding_step: 6 })
    .eq("id", businessId);
  if (error) return { ok: false, persisted: false, error: "onboarding_progress_failed" };

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function completeOnboarding(): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  const { error } = await db.from("businesses").update({
    onboarding_completed: true,
    onboarding_step: 7,
    onboarding_completed_at: new Date().toISOString(),
  }).eq("id", businessId);
  if (error) return { ok: false, persisted: false, error: "complete_onboarding_failed" };

  revalidatePath("/");
  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}
