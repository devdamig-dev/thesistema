"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { SEEDS } from "@/lib/onboarding/seeds";
import {
  SUGGESTED_MODULES_BY_INDUSTRY,
} from "@/lib/industries";
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
  // unambiguous, still-incomplete business may mutate setup state or seed data.
  // Never fall back to a completed tenant, and never accept non-owner members.
  return incomplete.length === 1 ? incomplete[0].id : null;
}

export async function saveBusinessStep(payload: {
  name: string;
  taxId?: string;
  industry: Industry;
  timezone?: string;
}): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const { data: authData, error: authError } = await db.auth.getUser();
  if (authError || !authData.user) {
    return { ok: false, persisted: false, error: "not_authenticated" };
  }

  const suggestedModules = SUGGESTED_MODULES_BY_INDUSTRY[payload.industry] ?? [];
  const { data: businessId, error } = await db.rpc("bootstrap_first_business", {
    p_name: payload.name.trim(),
    p_industry: payload.industry,
    p_tax_id: payload.taxId?.trim() || null,
    p_timezone: payload.timezone ?? "America/Argentina/Buenos_Aires",
    p_modules: suggestedModules,
  });
  if (error || !businessId) {
    console.error("bootstrap_first_business failed", error);
    return { ok: false, persisted: false, error: "first_business_failed" };
  }

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveBranchStep(payload: {
  branches: { name: string; address?: string; type: string; isMain: boolean }[];
}): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  for (const b of payload.branches) {
    const { error } = await db.from("branches").upsert(
      {
        business_id: businessId,
        name: b.name,
        address: b.address ?? null,
        branch_type: b.type,
        is_main: b.isMain,
      },
      { onConflict: "business_id,name" },
    );
    if (error) {
      console.error("saveBranchStep failed", error);
      return { ok: false, persisted: false, error: "branch_save_failed" };
    }
  }

  const { error: progressError } = await db
    .from("businesses")
    .update({ onboarding_step: 2 })
    .eq("id", businessId);
  if (progressError) return { ok: false, persisted: false, error: "onboarding_progress_failed" };

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveChannelsStep(channels: string[] = []): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  const { error } = await db
    .from("businesses")
    .update({ onboarding_step: 3, sales_channels: channels })
    .eq("id", businessId);
  if (error) return { ok: false, persisted: false, error: "channels_save_failed" };

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveTeamStep(): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
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
  const supabase = createSupabaseServerClient();
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
  industry: Industry,
): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: false, persisted: false, error: "database_unavailable" };
  const db = supabase as any;
  const businessId = await getOnboardingBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_unambiguous_business" };

  const seed = SEEDS[industry];
  if (!seed) return { ok: false, persisted: false, error: "unknown_industry" };

  for (const ing of seed.ingredients) {
    const { error } = await db.from("ingredients").upsert(
      { business_id: businessId, name: ing.name, unit: ing.unit, avg_unit_cost: ing.avg_unit_cost },
      { onConflict: "business_id,name" },
    );
    if (error) return { ok: false, persisted: false, error: "ingredient_seed_failed" };
  }

  for (const prod of seed.products) {
    const { error } = await db.from("products").upsert(
      {
        business_id: businessId,
        name: prod.name,
        category: prod.category,
        price: prod.price,
        cost: prod.cost,
        active: true,
      },
      { onConflict: "business_id,name" },
    );
    if (error) return { ok: false, persisted: false, error: "product_seed_failed" };
  }

  const { error: progressError } = await db
    .from("businesses")
    .update({ onboarding_step: 6 })
    .eq("id", businessId);
  if (progressError) return { ok: false, persisted: false, error: "onboarding_progress_failed" };

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function completeOnboarding(): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
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
