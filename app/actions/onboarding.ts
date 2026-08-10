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

async function getBusinessId(db: any): Promise<string | null> {
  const res = await db
    .from("business_members")
    .select("business_id")
    .limit(1)
    .maybeSingle();
  return (res.data as { business_id: string } | null)?.business_id ?? null;
}

export async function saveBusinessStep(payload: {
  name: string;
  taxId?: string;
  industry: Industry;
  timezone?: string;
}): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
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
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await getBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

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

  await db.from("businesses").update({ onboarding_step: 2 }).eq("id", businessId);
  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveChannelsStep(channels: string[] = []): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await getBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

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
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await getBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

  await db.from("businesses").update({ onboarding_step: 4 }).eq("id", businessId);
  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function saveWhatsappStep(): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await getBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

  await db.from("businesses").update({ onboarding_step: 5 }).eq("id", businessId);
  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function seedIngredientsAndProducts(
  industry: Industry,
): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await getBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

  const seed = SEEDS[industry];
  if (!seed) return { ok: false, persisted: false, error: "unknown_industry" };

  for (const ing of seed.ingredients) {
    await db.from("ingredients").upsert(
      { business_id: businessId, name: ing.name, unit: ing.unit, avg_unit_cost: ing.avg_unit_cost },
      { onConflict: "business_id,name" },
    );
  }

  for (const prod of seed.products) {
    await db.from("products").upsert(
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
  }

  await db.from("businesses").update({ onboarding_step: 6 }).eq("id", businessId);
  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

export async function completeOnboarding(): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await getBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

  await db.from("businesses").update({
    onboarding_completed: true,
    onboarding_step: 7,
    onboarding_completed_at: new Date().toISOString(),
  }).eq("id", businessId);

  revalidatePath("/");
  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}
