import type { ReactNode } from "react";
import { MessageSquareText, Phone, Users } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { WhatsAppConnectButton } from "./connect-button";

export default async function WhatsappSettingsLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return <>{children}</>;

  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return <Unavailable />;

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return <Unavailable />;

  const result = await supabase
    .from("businesses")
    .select("whatsapp_connected,whatsapp_phone,whatsapp_connected_at")
    .eq("id", ctx.businessId)
    .maybeSingle();

  if (result.error) return <Unavailable />;

  const row = result.data as {
    whatsapp_connected: boolean | null;
    whatsapp_phone: string | null;
    whatsapp_connected_at: string | null;
  } | null;

  const connected = Boolean(row?.whatsapp_connected);
  const phone = row?.whatsapp_phone?.trim() || null;
  const connectedAt = row?.whatsapp_connected_at
    ? new Intl.DateTimeFormat("es-AR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Argentina/Buenos_Aires",
      }).format(new Date(row.whatsapp_connected_at))
    : null;

  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim() || null;
  const configId = process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID?.trim() || null;
  const apiVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION?.trim() || "v25.0";

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Ajustes · WhatsApp"
        title="Conexión con WhatsApp Business"
        description="Vinculá el número del negocio para recibir mensajes y procesarlos desde Thesistema."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquareText className="h-4 w-4" /> Estado de conexión
          </CardTitle>
          <Badge tone={connected ? "success" : "default"}>{connected ? "Conectado" : "Pendiente"}</Badge>
        </CardHeader>
        <CardContent>
          {connected ? (
            <div className="rounded-xl border border-success-500/25 bg-success-500/[0.06] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Phone className="h-4 w-4 text-success-400" /> {phone ?? "Número conectado"}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {connectedAt ? `Conectado el ${connectedAt}.` : "La conexión está activa."}
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-warn-500/25 bg-warn-500/[0.05] p-5">
              <div className="text-sm font-semibold text-ink">Todavía no conectaste un número</div>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-muted">
                La conexión se realiza con el flujo oficial de Meta. Thesistema sólo marcará este estado como conectado cuando Meta confirme el número y la integración quede registrada.
              </p>
              <div className="mt-4">
                <WhatsAppConnectButton appId={appId} configId={configId} apiVersion={apiVersion} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Acceso del equipo</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed border-line p-6 text-sm text-ink-muted">
            {connected
              ? "La administración de personas autorizadas se habilitará sobre el número conectado."
              : "Primero conectá WhatsApp Business. Después vas a poder definir quiénes del equipo pueden operar por este canal."}
          </div>
        </CardContent>
      </Card>

      {children}
    </div>
  );
}

function Unavailable() {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Ajustes · WhatsApp"
        title="WhatsApp temporalmente no disponible"
        description="No pudimos confirmar el estado de la conexión en este momento."
      />
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">
            Reintentá en unos minutos. Si el problema continúa, revisaremos la conexión del negocio.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
