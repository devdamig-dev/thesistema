import { listNotifications } from "@/lib/data/notifications";
import { RealtimeRefresher } from "@/components/realtime/realtime-refresher";
import NotificacionesClient from "./notificaciones-client";

export default async function NotificacionesPage() {
  // Server-side initial load. El client filtra localmente y dispara
  // un refresh al server cuando cambia un filtro fuerte.
  const all = await listNotifications({ includeArchived: false }, 200);
  return (
    <>
      <RealtimeRefresher tables={["notifications"]} />
      <NotificacionesClient initial={all} />
    </>
  );
}
