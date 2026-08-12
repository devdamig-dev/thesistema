import { inbox } from "@/lib/data";
import { inboxItems as fallbackItems } from "@/lib/mock-data";
import { getCurrentUserContext } from "@/lib/data/auth";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { mapInboxItem } from "@/lib/data/mappers";
import { RealtimeRefresher } from "@/components/realtime/realtime-refresher";
import { EmptyState } from "@/components/ui/empty-state";
import { EMPTY_STATES } from "@/lib/empty-states";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent } from "@/components/ui/card";
import InboxClient from "./inbox-client";

export default async function InboxPage() {
  const ctx = await getCurrentUserContext();
  let items: Awaited<ReturnType<typeof inbox.list>> = [];

  if (isDatabaseMode()) {
    const supabase = createSupabaseServerClient() as any;
    if (!supabase) {
      return <InboxUnavailable message="Supabase no está configurado. No mostramos mensajes demo como fallback." />;
    }

    if (ctx.assignedBranchIds !== null && ctx.assignedBranchIds.length === 0) {
      items = [];
    } else {
      let msgQuery = supabase
        .from("whatsapp_messages")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(50);

      if (ctx.assignedBranchIds !== null) {
        msgQuery = msgQuery.or(
          `branch_id.in.(${ctx.assignedBranchIds.join(",")}),branch_id.is.null`,
        );
      }

      const msgRes = await msgQuery;
      if (msgRes.error) {
        return (
          <InboxUnavailable
            message={`No pudimos leer los mensajes reales (${msgRes.error.code ?? "query_error"}).`}
          />
        );
      }

      const messages = (msgRes.data ?? []) as any[];
      if (messages.length > 0) {
        const extRes = await supabase
          .from("ai_extractions")
          .select("*")
          .in("message_id", messages.map((message) => message.id));

        if (extRes.error) {
          return (
            <InboxUnavailable
              message={`No pudimos leer las extracciones IA reales (${extRes.error.code ?? "query_error"}).`}
            />
          );
        }

        const byMessage = new Map(
          ((extRes.data ?? []) as any[]).map((extraction) => [extraction.message_id, extraction]),
        );
        items = messages.map((message) => mapInboxItem(message, byMessage.get(message.id) ?? null));
      }
    }
  } else {
    items = await inbox.list();
    if (!items || items.length === 0) items = fallbackItems;
  }

  const presenceMe = ctx.userId
    ? { id: ctx.userId, name: ctx.fullName }
    : { id: "demo-user", name: ctx.fullName };

  if (items.length === 0) {
    const es = EMPTY_STATES.inbox;
    return (
      <div className="py-20">
        <EmptyState
          icon={es.icon}
          title={es.title}
          description={es.description}
          whatsappExample={es.whatsappExample}
          ctaLabel={es.ctaLabel}
          ctaHref={es.ctaHref}
        />
      </div>
    );
  }

  return (
    <>
      <RealtimeRefresher tables={["whatsapp_messages", "ai_extractions"]} />
      <InboxClient items={items} presenceMe={presenceMe} />
    </>
  );
}

function InboxUnavailable({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Inbox IA"
        title="Inbox temporalmente no disponible."
        description="No podemos confirmar los mensajes reales del negocio en este momento."
      />
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">
            {message} No reemplazamos una falla por conversaciones de la demo.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
