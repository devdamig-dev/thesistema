import type { ReactNode } from "react";
import { MessageSquareText, Phone, Users } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";

export default async function WhatsappSettingsLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return <>{children}</>;

  const supabase = createSupabaseServerClient() as any;
  if (!supabase) {
    return <Unavailable message="Supabase no está configurado. No mostramos estado demo de WhatsApp." />;
  }

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) {
    return <Unavailable message="No se pudo resolver el negocio activo." />;
  }

  const result = await supabase
    .from("businesses")
    .select("whatsapp_connected,whatsapp_phone,whatsapp_connected_at")
    .eq("id", ctx.businessId)
    .maybeSingle();

  if (result.error) {
    return <Unavailable message={`No pudimos leer la conexión real de WhatsApp (${result.error.code ?? "query_error"}).`} />;
  }

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

  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Ajustes · WhatsApp"
        title="Conexión con WhatsApp Business"
        description="Estado persistido del negocio. En producción no mostramos números ni conexiones ficticias."
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
                <Phone className="h-4 w-4 text-success-400" /> {phone ?? "Número no informado"}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {connectedAt ? `Conexión registrada el ${connectedAt}.` : "La base indica una conexión activa."}
              </p>
              {!phone && (
                <p className="mt-2 text-xs text-warn-400">
                  La conexión figura activa pero no tiene whatsapp_phone persistido. Revisá la configuración antes de usar el webhook en producción.
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-warn-500/25 bg-warn-500/[0.05] p-5">
              <div className="text-sm font-semibold text-ink">Sin número conectado</div>
              <p className="mt-1 text-xs text-ink-muted">
                El negocio todavía no tiene una conexión real de WhatsApp Business registrada en Supabase.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Miembros autorizados</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border border-dashed border-line p-6 text-sm text-ink-muted">
            La base actual no modela una lista independiente de teléfonos autorizados por WhatsApp. No mostramos los miembros ficticios de la demo como si fueran reales.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Ajustes · WhatsApp"
        title="WhatsApp temporalmente no disponible"
        description="No podemos confirmar el estado real de la integración en este momento."
      />
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">
            {message}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
