import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ROLE_LABELS, type ModuleKey } from "@/lib/permissions";
import { capabilityCatalogFor, WHATSAPP_TOOLS } from "@/lib/whatsapp-agent/registry";
import { AiSettingsClient, type WhatsAppConnectionState } from "./ai-settings-client";

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
  if (supabase) {
    const result = await supabase
      .from("businesses")
      .select("whatsapp_connected,whatsapp_connection_status")
      .eq("id", ctx.businessId)
      .maybeSingle();
    if (!result.error && result.data) {
      connection = result.data.whatsapp_connected || result.data.whatsapp_connection_status === "connected"
        ? "connected"
        : "disconnected";
    }
  }

  return (
    <AiSettingsClient
      mode="database"
      roleLabel={ROLE_LABELS[ctx.role]}
      connection={connection}
      capabilities={capabilityCatalogFor(ctx.role, ctx.enabledModules ?? [])}
    />
  );
}
