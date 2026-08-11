import OnboardingClient, { type OnboardingInitialState } from "./onboarding-client";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import type { Industry } from "@/lib/entities";
import type { BranchType } from "@/lib/onboarding/types";

const LAST_STEP_INDEX = 6;
const DEFAULT_INITIAL_STATE: OnboardingInitialState = {
  currentStep: 0,
  businessName: "",
  industry: "hamburgueseria",
  branchName: "Local principal",
  branchType: "local",
  selectedChannels: ["salon", "whatsapp"],
};

async function getInitialState(): Promise<OnboardingInitialState> {
  if (!isDatabaseMode()) return DEFAULT_INITIAL_STATE;

  const supabase = createSupabaseServerClient();
  if (!supabase) return DEFAULT_INITIAL_STATE;
  const db = supabase as any;

  const { data: authData, error: authError } = await db.auth.getUser();
  const userId = authData?.user?.id as string | undefined;
  if (authError || !userId) return DEFAULT_INITIAL_STATE;

  const membershipsRes = await db
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", userId);
  if (membershipsRes.error) return DEFAULT_INITIAL_STATE;

  const ownerBusinessIds = ((membershipsRes.data ?? []) as { business_id: string; role: string }[])
    .filter((row) => row.role === "owner")
    .map((row) => row.business_id)
    .filter(Boolean);

  if (ownerBusinessIds.length === 0) return DEFAULT_INITIAL_STATE;

  const businessesRes = await db
    .from("businesses")
    .select("id, name, industry, onboarding_step, onboarding_completed, sales_channels")
    .in("id", ownerBusinessIds);
  if (businessesRes.error) return DEFAULT_INITIAL_STATE;

  const incomplete = ((businessesRes.data ?? []) as {
    id: string;
    name: string;
    industry: Industry;
    onboarding_step: number | null;
    onboarding_completed: boolean | null;
    sales_channels: string[] | null;
  }[]).filter((business) => !business.onboarding_completed);

  // Igual que las server actions: nunca elegir un tenant arbitrariamente.
  if (incomplete.length !== 1) return DEFAULT_INITIAL_STATE;

  const business = incomplete[0];
  const branchRes = await db
    .from("branches")
    .select("name, branch_type")
    .eq("business_id", business.id)
    .eq("is_main", true)
    .maybeSingle();

  const branch = branchRes.error
    ? null
    : (branchRes.data as { name: string; branch_type: BranchType | null } | null);
  const persistedStep = Number(business.onboarding_step ?? 0);

  return {
    currentStep: Math.min(Math.max(persistedStep, 0), LAST_STEP_INDEX),
    businessName: business.name ?? "",
    industry: business.industry ?? "hamburgueseria",
    branchName: branch?.name ?? "Local principal",
    branchType: branch?.branch_type ?? "local",
    // Un array vacío puede ser una elección válida; no reponer canales demo.
    selectedChannels: Array.isArray(business.sales_channels) ? business.sales_channels : [],
  };
}

export default async function OnboardingPage() {
  const initialState = await getInitialState();
  return <OnboardingClient initialState={initialState} />;
}
