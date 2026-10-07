import type { ReactNode } from "react";
import { MessageSquareText, Phone, ShieldCheck } from "lucide-react";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentUserContext } from "@/lib/data/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/ui/section-header";
import { WhatsAppConnectButton } from "./connect-button";
import { ConversationEditor, type MemberOption } from "./conversation-editor";

export default async function WhatsappSettingsLayout({ children }: { children: ReactNode }) {
  if (!isDatabaseMode()) return <>{children}</>;
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId || !ctx.userId || !["owner", "admin"].includes(ctx.role)) return <Unavailable />;
  const db = await createSupabaseServerClient() as any;
  if (!db) return <Unavailable />;
  const [business, conversationsResult, membersResult, branchesResult] = await Promise.all([
    db.from("businesses").select("whatsapp_connected,whatsapp_phone_number_id").eq("id", ctx.businessId).maybeSingle(),
    db.from("whatsapp_authorized_conversations").select("id,display_name,conversation_type,enabled,branch_id,branches(name)").eq("business_id", ctx.businessId).order("created_at", { ascending: true }),
    db.from("business_members").select("id,user_id").eq("business_id", ctx.businessId),
    db.from("branches").select("id,name").eq("business_id", ctx.businessId).order("name"),
  ]);
  if (business.error || conversationsResult.error || membersResult.error || branchesResult.error) return <Unavailable />;
  const userIds = (membersResult.data ?? []).map((member: { user_id: string }) => member.user_id);
  const profiles = userIds.length ? await db.from("profiles").select("id,full_name,phone,active").in("id", userIds) : { data: [], error: null };
  if (profiles.error) return <Unavailable />;
  const members: MemberOption[] = (membersResult.data ?? []).map((member: { id: string; user_id: string }) => {
    const profile = (profiles.data ?? []).find((profile: { id: string }) => profile.id === member.user_id);
    return { id: member.id, name: profile?.full_name || "Persona del equipo", phone: profile?.phone || null, active: profile?.active === true };
  });
  // Credentials stay in a server-owned table. Only non-secret status fields are read for this business.
  const admin = createSupabaseAdminClient() as any;
  const result = await admin.from("whatsapp_integrations").select("phone_number_id,display_phone_number,status,connected_at,token_expires_at").eq("business_id", ctx.businessId).maybeSingle();
  if (result.error) return <Unavailable />;
  const integration = result.data;
  const expired = Boolean(integration?.token_expires_at && Date.parse(integration.token_expires_at) <= Date.now());
  const connected = Boolean(integration?.status === "connected" && !expired && business.data?.whatsapp_connected && business.data?.whatsapp_phone_number_id === integration.phone_number_id);
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim() || null;
  const configId = process.env.NEXT_PUBLIC_META_WHATSAPP_CONFIG_ID?.trim() || null;
  const businessAppConfigId = process.env.NEXT_PUBLIC_META_WHATSAPP_BUSINESS_APP_CONFIG_ID?.trim() || configId;
  const apiVersion = process.env.NEXT_PUBLIC_META_GRAPH_VERSION?.trim() || "v25.0";
  const conversations = conversationsResult.data ?? [];
  return <div className="space-y-6">
    <SectionHeader eyebrow="Ajustes · WhatsApp" title="Tu WhatsApp, conectado a tu negocio" description="Autorizá tu cuenta en Meta, elegí el número y definí quiénes pueden operar por este canal." />
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" />Estado de la vinculación</CardTitle><Badge tone="default">{connected ? "Cuenta vinculada" : expired ? "Renovar autorización" : "Pendiente"}</Badge></CardHeader><CardContent>
      {connected ? <div className="space-y-3 rounded-xl border border-line p-5"><p className="flex items-center gap-2 text-sm font-semibold text-ink"><Phone className="h-4 w-4" />{integration.display_phone_number || "Número autorizado"}</p><p className="text-sm text-ink-muted">La vinculación está guardada. Para comprobar el recorrido completo, autorizá abajo una conversación y enviá un mensaje desde el WhatsApp de esa persona al número del negocio.</p><p className="text-xs text-ink-muted">La autorización de Meta no demuestra por sí sola que un mensaje ya haya llegado o recibido respuesta.</p><details className="pt-2"><summary className="cursor-pointer text-sm font-semibold text-ink">Renovar permisos de esta cuenta</summary><div className="mt-4"><WhatsAppConnectButton appId={appId} configId={configId} businessAppConfigId={businessAppConfigId} apiVersion={apiVersion} /></div></details></div> : <div className="space-y-4">
        <p className="text-sm text-ink-muted">{expired ? "La autorización de Meta venció. Volvé a autorizar el mismo número para recuperar la conexión." : "Elegí cómo usás WhatsApp. No necesitás copiar claves ni crear una aplicación de Meta para cada negocio."}</p>
        <WhatsAppConnectButton appId={appId} configId={configId} businessAppConfigId={businessAppConfigId} apiVersion={apiVersion} />
      </div>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />Conversaciones autorizadas</CardTitle></CardHeader><CardContent className="space-y-5">
      <p className="text-sm text-ink-muted">Sólo se procesan chats directos que autorices y mensajes de personas activas del equipo. Autorizar un chat no amplía sus permisos sobre los módulos o las sucursales.</p>
      {conversations.length ? <div className="space-y-2">{conversations.map((conversation: any) => <div key={conversation.id} className="flex items-center justify-between gap-3 rounded-xl border border-line p-4"><div><p className="text-sm font-semibold text-ink">{conversation.display_name || "Conversación autorizada"}</p><p className="text-xs text-ink-muted">{conversation.conversation_type === "group" ? "Grupo · no compatible con esta conexión" : "Chat directo"} · {conversation.branches?.name || "Según permisos del equipo"}</p></div><Badge tone={conversation.enabled && conversation.conversation_type === "direct" ? "success" : "default"}>{conversation.enabled ? "Autorizada" : "Pausada"}</Badge></div>)}</div> : <p className="rounded-xl border border-dashed border-line p-4 text-sm text-ink-muted">Todavía no autorizaste ninguna conversación. El agente no operará sobre otros chats.</p>}
      <ConversationEditor connected={connected} members={members} branches={branchesResult.data ?? []} />
      <p className="text-xs leading-relaxed text-ink-subtle">Esta conexión no importa grupos del celular ni convierte el historial sincronizado en órdenes nuevas. Por ahora el agente operativo recibe mensajes de texto.</p>
    </CardContent></Card>
    {children}
  </div>;
}
function Unavailable() {
  return <div className="space-y-6"><SectionHeader eyebrow="Ajustes · WhatsApp" title="No pudimos comprobar la conexión" description="Reintentá en unos minutos o ingresá con una persona administradora del negocio." /><Card><CardContent className="pt-6"><p className="text-sm text-ink-muted">No se muestra un estado de conexión sin verificar los datos del negocio.</p></CardContent></Card></div>;
}
