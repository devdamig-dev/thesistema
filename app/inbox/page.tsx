import { inbox } from "@/lib/data";
import { inboxItems as fallbackItems } from "@/lib/mock-data";
import { getCurrentUserContext } from "@/lib/data/auth";
import { RealtimeRefresher } from "@/components/realtime/realtime-refresher";
import InboxClient from "./inbox-client";

/**
 * Server component que fetchea los items del Inbox vía el data layer
 * y los pasa al client. En modo demo, los items vienen del mock-data
 * (sin `extractionId`) y las acciones se quedan locales. En database
 * mode, vienen de Supabase con `extractionId` y las acciones disparan
 * server actions.
 *
 * Realtime: subscribe a whatsapp_messages y ai_extractions para que
 * el Inbox se actualice solo cuando entran mensajes nuevos.
 */
export default async function InboxPage() {
  let items = await inbox.list();
  if (!items || items.length === 0) {
    items = fallbackItems;
  }
  const ctx = await getCurrentUserContext();
  const presenceMe = ctx.userId
    ? { id: ctx.userId, name: ctx.fullName }
    : { id: "demo-user", name: ctx.fullName };
  return (
    <>
      <RealtimeRefresher tables={["whatsapp_messages", "ai_extractions"]} />
      <InboxClient items={items} presenceMe={presenceMe} />
    </>
  );
}
