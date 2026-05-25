import { ActivityFeedReal } from "@/components/common/activity-feed-real";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  return (
    <ErrorBoundaryCard module="Dashboard">
      <DashboardClient
        activitySlot={
          <ErrorBoundaryCard module="Actividad reciente">
            <ActivityFeedReal limit={8} />
          </ErrorBoundaryCard>
        }
      />
    </ErrorBoundaryCard>
  );
}
