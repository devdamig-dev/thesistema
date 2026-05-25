import { inbox } from "@/lib/data";
import { inboxItems as fallbackItems } from "@/lib/mock-data";
import { getCurrentUserContext } from "@/lib/data/auth";
import { RealtimeRefresher } from "@/components/realtime/realtime-refresher";
import { EmptyState } from "@/components/ui/empty-state";
import { EMPTY_STATES } from "@/lib/empty-states";
import InboxClient from "./inbox-client";

export default async function InboxPage() {
  let items = await inbox.list();
  if (!items || items.length === 0) {
    items = fallbackItems;
  }
  const ctx = await getCurrentUserContext();
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
