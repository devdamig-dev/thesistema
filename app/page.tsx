import { ActivityFeedReal } from "@/components/common/activity-feed-real";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import { isDatabaseMode } from "@/lib/env";
import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  const databaseMode = isDatabaseMode();

  return (
    <ErrorBoundaryCard module="Dashboard">
      <DashboardClient
        activitySlot={
          <ErrorBoundaryCard module="Actividad reciente">
            <ActivityFeedReal limit={8} fallbackToMock={!databaseMode} />
          </ErrorBoundaryCard>
        }
      />
    </ErrorBoundaryCard>
  );
}
