import { ActivityFeedReal } from "@/components/common/activity-feed-real";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import { isDatabaseMode } from "@/lib/env";
import DashboardClient from "./dashboard-client";
import DatabaseDashboard from "./database-dashboard";

export default function DashboardPage() {
  if (isDatabaseMode()) {
    return (
      <ErrorBoundaryCard module="Dashboard">
        <DatabaseDashboard />
      </ErrorBoundaryCard>
    );
  }

  return (
    <ErrorBoundaryCard module="Dashboard">
      <DashboardClient
        activitySlot={
          <ErrorBoundaryCard module="Actividad reciente">
            <ActivityFeedReal limit={8} fallbackToMock />
          </ErrorBoundaryCard>
        }
      />
    </ErrorBoundaryCard>
  );
}
