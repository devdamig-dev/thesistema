import { debts as debtsRepo } from "@/lib/data";
import { debtKpis as fallbackKpis, debts as fallbackDebts } from "@/lib/mock-data";
import { isDatabaseMode } from "@/lib/env";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import DeudasClient from "./deudas-client";

export default async function DeudasPage() {
  const [items, kpis] = await Promise.all([debtsRepo.list(), debtsRepo.kpis()]);
  const databaseMode = isDatabaseMode();
  return (
    <ErrorBoundaryCard module="Deudas">
      <DeudasClient
        items={databaseMode ? (items ?? []) : (items?.length ? items : fallbackDebts)}
        kpis={databaseMode ? kpis : (kpis ?? fallbackKpis)}
      />
    </ErrorBoundaryCard>
  );
}
