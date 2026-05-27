import { getCurrentUserContext } from "@/lib/data/auth";
import { listActivityWithFilters } from "@/lib/data/activity";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import AuditoriaClient from "./auditoria-client";

export default async function AuditoriaPage() {
  const ctx = await getCurrentUserContext();
  const initialRows = await listActivityWithFilters(ctx.businessId, { limit: 100 });
  return (
    <ErrorBoundaryCard module="Auditoría">
      <AuditoriaClient initialRows={initialRows} />
    </ErrorBoundaryCard>
  );
}
