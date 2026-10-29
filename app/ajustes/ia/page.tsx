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

    const periodStart = new Date();
    periodStart.setUTCDate(1);
    periodStart.setUTCHours(0, 0, 0, 0);

    const [planResult, eventsResult] = await Promise.all([
      supabase
        .from("ai_business_plans")
        .select("plan_code,monthly_credits,hard_limit,overage_enabled,provider,routing_policy")
        .eq("business_id", ctx.businessId)
        .maybeSingle(),
      supabase
        .from("ai_usage_events")
        .select("credits,cost_usd_micros,model,status,reserved_at")
        .eq("business_id", ctx.businessId)
        .gte("reserved_at", periodStart.toISOString())
        .in("status", ["reserved", "completed"]),
    ]);

    if (!planResult.error && planResult.data && !eventsResult.error) {
      const rows = (eventsResult.data ?? []) as Array<{
        credits: number;
        cost_usd_micros: number | string;
        model: string;
        status: "reserved" | "completed";
        reserved_at: string;
      }>;
      const monthlyCredits = Number(planResult.data.monthly_credits ?? 0);
      const usedCredits = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
      const costUsdMicros = rows
        .filter((row) => row.status === "completed")
        .reduce((sum, row) => sum + Number(row.cost_usd_micros ?? 0), 0);
      const byModel = rows.reduce<Record<string, number>>((acc, row) => {
        acc[row.model] = (acc[row.model] ?? 0) + Number(row.credits ?? 0);
        return acc;
      }, {});

      const latestCompleted = rows.filter(row => row.status === "completed").sort((a, b) => Date.parse(b.reserved_at) - Date.parse(a.reserved_at))[0];
      usage = {
        planCode: String(planResult.data.plan_code ?? "pilot"),
        monthlyCredits,
        usedCredits,
        remainingCredits: Math.max(0, monthlyCredits - usedCredits),
        requestCount: rows.length,
        costUsdMicros,
        hardLimit: Boolean(planResult.data.hard_limit),
        overageEnabled: Boolean(planResult.data.overage_enabled),
        provider: String(planResult.data.provider ?? "openai"),
        routingPolicy: String(planResult.data.routing_policy ?? "managed_auto"),
        byModel,
        latestCompletedModel: latestCompleted?.model ?? null,
        latestCompletedAt: latestCompleted?.reserved_at ?? null,
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
