import { ActivityFeedReal } from "@/components/common/activity-feed-real";
import DashboardClient from "./dashboard-client";

/**
 * Server wrapper que inyecta el activity feed real (leído de
 * activity_logs) en el dashboard client. Cuando no hay logs, el
 * componente cae al feed mock de Inbox automáticamente.
 */
export default function DashboardPage() {
  return <DashboardClient activitySlot={<ActivityFeedReal limit={8} />} />;
}
