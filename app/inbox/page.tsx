import { inbox } from "@/lib/data";
import { inboxItems as fallbackItems } from "@/lib/mock-data";
import InboxClient from "./inbox-client";

/**
 * Server component que fetchea los items del Inbox vía el data layer
 * y los pasa al client. En modo demo, los items vienen del mock-data
 * (sin `extractionId`) y las acciones se quedan locales. En database
 * mode, vienen de Supabase con `extractionId` y las acciones disparan
 * server actions.
 */
export default async function InboxPage() {
  let items = await inbox.list();
  if (!items || items.length === 0) {
    items = fallbackItems;
  }
  return <InboxClient items={items} />;
}
