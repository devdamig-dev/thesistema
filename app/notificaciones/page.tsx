import { listNotifications } from "@/lib/data/notifications";
import { RealtimeRefresher } from "@/components/realtime/realtime-refresher";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import NotificacionesClient from "./notificaciones-client";

export default async function NotificacionesPage() {
  const all = await listNotifications({ includeArchived: false }, 200);
  return (
    <ErrorBoundaryCard module="Notificaciones">
      <RealtimeRefresher tables={["notifications"]} />
      <NotificacionesClient initial={all} />
    </ErrorBoundaryCard>
  );
}
