import { redirect } from "next/navigation";
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

type InitialStateResult =
  | { ok: true; state: OnboardingInitialState }
  | { ok: false; error: string };

async function getInitialState(): Promise<InitialStateResult> {
  if (!isDatabaseMode()) return { ok: true, state: DEFAULT_INITIAL_STATE };

  const supabase = createSupabaseServerClient();
  if (!supabase) {
    return { ok: false, error: "Supabase no está disponible. No iniciamos un onboarding nuevo con datos por defecto." };
  }
  const db = supabase as any;

  const { data: authData, error: authError } = await db.auth.getUser();
  const userId = authData?.user?.id as string | undefined;
  if (authError || !userId) {
    return { ok: false, error: "No pudimos validar tu sesión. Recargá la página o volvé a iniciar sesión." };
  }

  const membershipsRes = await db
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", userId);
  if (membershipsRes.error) {
    return {
      ok: false,
      error: `No pudimos leer tus negocios (${membershipsRes.error.code ?? "query_error"}). No mostramos un wizard vacío para evitar crear o sobrescribir datos por error.`,
    };
  }

  const memberships = (membershipsRes.data ?? []) as { business_id: string; role: string }[];
  const ownerBusinessIds = memberships
    .filter((row) => row.role === "owner")
    .map((row) => row.business_id)
    .filter(Boolean);

  // A genuinely new user (zero memberships) is the only case that should start
  // a fresh wizard. Assigned non-owners already belong to a tenant and should
  // never be offered the owner/bootstrap flow.
  if (ownerBusinessIds.length === 0) {
    if (memberships.length > 0) redirect("/");
    return { ok: true, state: DEFAULT_INITIAL_STATE };
  }

  const businessesRes = await db
    .from("businesses")
    .select("id, name, industry, onboarding_step, onboarding_completed, sales_channels")
    .in("id", ownerBusinessIds);
  if (businessesRes.error) {
    return {
      ok: false,
      error: `No pudimos leer el estado real del onboarding (${businessesRes.error.code ?? "query_error"}). No usamos valores demo como fallback.`,
    };
  }

  const incomplete = ((businessesRes.data ?? []) as {
    id: string;
    name: string;
    industry: Industry;
    onboarding_step: number | null;
    onboarding_completed: boolean | null;
    sales_channels: string[] | null;
  }[]).filter((business) => !business.onboarding_completed);

  // Completed owners should use the application, not reopen setup. Multiple
  // incomplete owner tenants remain ambiguous until an explicit selector exists.
  if (incomplete.length === 0) redirect("/");
  if (incomplete.length > 1) redirect("/sin-permisos?reason=multiple_businesses&from=/onboarding");

  const business = incomplete[0];
  const branchRes = await db
    .from("branches")
    .select("name, branch_type")
    .eq("business_id", business.id)
    .eq("is_main", true)
    .maybeSingle();

  if (branchRes.error) {
    return {
      ok: false,
      error: `No pudimos leer el punto de venta principal (${branchRes.error.code ?? "query_error"}). No reemplazamos esa falla por una sucursal ficticia.`,
    };
  }

  const branch = branchRes.data as { name: string; branch_type: BranchType | null } | null;
  const persistedStep = Number(business.onboarding_step ?? 0);

  return {
    ok: true,
    state: {
      currentStep: Math.min(Math.max(persistedStep, 0), LAST_STEP_INDEX),
      businessName: business.name ?? "",
      industry: business.industry ?? "hamburgueseria",
      branchName: branch?.name ?? "Local principal",
      branchType: branch?.branch_type ?? "local",
      // Un array vacío puede ser una elección válida; no reponer canales demo.
      selectedChannels: Array.isArray(business.sales_channels) ? business.sales_channels : [],
    },
  };
}

export default async function OnboardingPage() {
  const result = await getInitialState();
  if (!result.ok) return <OnboardingUnavailable message={result.error} />;
  return <OnboardingClient initialState={result.state} />;
}

function OnboardingUnavailable({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-bg px-4 py-16">
      <div className="mx-auto max-w-2xl rounded-2xl border border-danger-500/30 bg-bg-elevated p-6 md:p-8">
        <div className="text-xs font-semibold uppercase tracking-wider text-danger-300">Configuración inicial</div>
        <h1 className="mt-2 text-2xl font-semibold text-ink">No pudimos cargar tu onboarding.</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-muted">{message}</p>
        <p className="mt-3 text-xs leading-relaxed text-ink-subtle">
          Por seguridad no mostramos datos por defecto ni iniciamos un negocio nuevo cuando no podemos confirmar el estado persistido.
        </p>
      </div>
    </main>
  );
}
