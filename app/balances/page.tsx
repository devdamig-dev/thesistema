import { balances as balancesRepo } from "@/lib/data";
import {
  balanceMonthly as fallbackMonthly,
  balanceRecommendations as fallbackRecs,
  balanceSnapshot as fallbackSnapshot,
} from "@/lib/mock-data";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import BalancesClient from "./balances-client";

export default async function BalancesPage() {
  const [snapshot, monthly, recommendations] = await Promise.all([
    balancesRepo.snapshot(),
    balancesRepo.monthly(),
    balancesRepo.recommendations(),
  ]);
  return (
    <ErrorBoundaryCard module="Balances">
      <BalancesClient
        snapshot={snapshot ?? fallbackSnapshot}
        monthly={monthly?.length ? monthly : fallbackMonthly}
        recommendations={recommendations?.length ? recommendations : fallbackRecs}
      />
    </ErrorBoundaryCard>
  );
}
