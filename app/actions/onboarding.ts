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

/* ============================================================================
   STEP 1: Business basics
   ============================================================================ */

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
  const businessId = await getBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

  await db.from("businesses").update({
    name: payload.name,
    tax_id: payload.taxId ?? null,
    industry: payload.industry,
    timezone: payload.timezone ?? "America/Argentina/Buenos_Aires",
    onboarding_step: 1,
  }).eq("id", businessId);

  // Set modules by industry
  const suggestedModules = SUGGESTED_MODULES_BY_INDUSTRY[payload.industry] ?? [];
  for (const mk of suggestedModules) {
    await db.from("business_modules").upsert(
      { business_id: businessId, module_key: mk, enabled: true, suggested: true },
      { onConflict: "business_id,module_key" },
    );
  }

  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

/* ============================================================================
   STEP 2: Branches
   ============================================================================ */

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
    await db.from("branches").upsert(
      {
        business_id: businessId,
        name: b.name,
        address: b.address ?? null,
        is_main: b.isMain,
      },
      { onConflict: "business_id,name" },
    );
  }

  await db.from("businesses").update({ onboarding_step: 2 }).eq("id", businessId);
  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

/* ============================================================================
   STEP 3: Channels — just mark step, channels are toggles in /ajustes
   ============================================================================ */

export async function saveChannelsStep(): Promise<Result> {
  if (!isDatabaseMode()) return { ok: true, persisted: false };
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await getBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

  await db.from("businesses").update({ onboarding_step: 3 }).eq("id", businessId);
  revalidatePath("/onboarding");
  return { ok: true, persisted: true };
}

/* ============================================================================
   STEP 4: Team — invites handled by existing inviteUserAction
   ============================================================================ */

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

/* ============================================================================
   STEP 5: WhatsApp — mock setup, mark step
   ============================================================================ */

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

/* ============================================================================
   STEP 6: Seed ingredientes + productos por rubro
   ============================================================================ */

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

  // Ingredients upsert
  for (const ing of seed.ingredients) {
    await db.from("ingredients").upsert(
      { business_id: businessId, name: ing.name, unit: ing.unit, avg_unit_cost: ing.avg_unit_cost },
      { onConflict: "business_id,name" },
    );
  }

  // Products upsert
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

/* ============================================================================
   STEP 7: Mark onboarding as completed
   ============================================================================ */

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
