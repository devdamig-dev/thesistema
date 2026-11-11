import Link from "next/link";
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
    return <AiSettingsClient mode="demo" roleLabel={ROLE_LABELS[ctx.role]} connection="demo" capabilities={capabilityCatalogFor(ctx.role, allModules)} />;
  }
  if (!ctx.isAuthenticated || !ctx.businessId) {
    return <AiSettingsClient mode="database" connection="unknown" unavailable />;
  }
  const supabase = await createSupabaseServerClient() as any;
  let connection: WhatsAppConnectionState = "unknown";
  let usage: AiUsageOverview | null = null;
  if (supabase) {
    const businessResult = await supabase.from("businesses").select("whatsapp_connected,whatsapp_connection_status").eq("id", ctx.businessId).maybeSingle();
    if (!businessResult.error && businessResult.data) {
      connection = businessResult.data.whatsapp_connected || businessResult.data.whatsapp_connection_status === "connected" ? "connected" : "disconnected";
    }
    const [planResult, usageResult, balanceResult] = await Promise.all([
      supabase.from("ai_business_plans").select("plan_code,monthly_credits,hard_limit,overage_enabled").eq("business_id", ctx.businessId).maybeSingle(),
      supabase.rpc("get_my_ai_usage_overview"),
      supabase.rpc("get_my_ai_credit_balance"),
    ]);
    const balance = !balanceResult.error && Array.isArray(balanceResult.data)
      ? balanceResult.data.find((item: { business_id?: string }) => item.business_id === ctx.businessId) as { available_credits?: number | string } | undefined : undefined;
    const available = Number(balance?.available_credits);
    // Missing migration/unknown balance is unavailable, never a fabricated zero or monthly-only total.
    if (!planResult.error && planResult.data && !usageResult.error && balance && Number.isSafeInteger(available) && available >= 0) {
      const row = (usageResult.data ?? []).find((item: { business_id?: string }) => item.business_id === ctx.businessId) as {
        used_credits?: number | string; request_count?: number | string; latest_completed_at?: string | null;
      } | undefined;
      usage = {
        planCode: String(planResult.data.plan_code ?? "free"), monthlyCredits: Number(planResult.data.monthly_credits ?? 0),
        usedCredits: Number(row?.used_credits ?? 0), remainingCredits: available, requestCount: Number(row?.request_count ?? 0),
        hardLimit: Boolean(planResult.data.hard_limit), overageEnabled: Boolean(planResult.data.overage_enabled), latestCompletedAt: row?.latest_completed_at ?? null,
      };
    }
  }
  return <>
    {["owner", "admin"].includes(ctx.role) && <div className="px-4 pt-4 md:px-8"><Link href="/ajustes/ia/pagos" className="text-sm underline">Planes y pagos · pruebas sandbox</Link></div>}
    <AiSettingsClient mode="database" roleLabel={ROLE_LABELS[ctx.role]} connection={connection} capabilities={capabilityCatalogFor(ctx.role, ctx.enabledModules ?? [])} usage={usage} />
  </>;
}
