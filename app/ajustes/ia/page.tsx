import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type ModuleKey } from "@/lib/permissions";
import { capabilityCatalogFor, WHATSAPP_TOOLS } from "@/lib/whatsapp-agent/registry";
import { AiSettingsClient, type AiUsageOverview, type WhatsAppConnectionState } from "./ai-settings-client";

export default async function AjustesIAPage() {
  const ctx = await getCurrentUserContext();
  const demo = !isDatabaseMode();
  const allModules = [...new Set(WHATSAPP_TOOLS.map((tool) => tool.module))] as ModuleKey[];

  if (demo) {
    return (
      <AiSettingsClient
        mode="demo"
        roleLabel={ROLE_LABELS[ctx.role]}
        connection="demo"
        capabilities={capabilityCatalogFor(ctx.role, allModules)}
      />
    );
  }

  if (!ctx.isAuthenticated || !ctx.businessId) {
    return <AiSettingsClient mode="database" connection="unknown" unavailable />;
  }

  const supabase = await createSupabaseServerClient() as any;
  let connection: WhatsAppConnectionState = "unknown";
  let usage: AiUsageOverview | null = null;

  if (supabase) {
    const businessResult = await supabase
      .from("businesses")
      .select("whatsapp_connected,whatsapp_connection_status")
      .eq("id", ctx.businessId)
      .maybeSingle();
    if (!businessResult.error && businessResult.data) {
      connection = businessResult.data.whatsapp_connected || businessResult.data.whatsapp_connection_status === "connected"
        ? "connected"
        : "disconnected";
    }

    const [planResult, usageResult] = await Promise.all([
      supabase
        .from("ai_business_plans")
        .select("plan_code,monthly_credits,hard_limit,overage_enabled")
        .eq("business_id", ctx.businessId)
        .maybeSingle(),
      supabase.rpc("get_my_ai_usage_overview"),
    ]);

    if (!planResult.error && planResult.data && !usageResult.error) {
      const row = (usageResult.data ?? []).find(
        (item: { business_id?: string }) => item.business_id === ctx.businessId,
      ) as {
        used_credits?: number | string;
        request_count?: number | string;
        latest_completed_at?: string | null;
      } | undefined;
      const monthlyCredits = Number(planResult.data.monthly_credits ?? 0);
      const usedCredits = Number(row?.used_credits ?? 0);
      usage = {
        planCode: String(planResult.data.plan_code ?? "free"),
        monthlyCredits,
        usedCredits,
        remainingCredits: Math.max(0, monthlyCredits - usedCredits),
        requestCount: Number(row?.request_count ?? 0),
        hardLimit: Boolean(planResult.data.hard_limit),
        overageEnabled: Boolean(planResult.data.overage_enabled),
        latestCompletedAt: row?.latest_completed_at ?? null,
      };
    }
  }

  return (
    <AiSettingsClient
      mode="database"
      roleLabel={ROLE_LABELS[ctx.role]}
      connection={connection}
      capabilities={capabilityCatalogFor(ctx.role, ctx.enabledModules ?? [])}
      usage={usage}
    />
  );
}
