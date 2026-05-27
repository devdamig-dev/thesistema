import { debts as debtsRepo } from "@/lib/data";
import { debtKpis as fallbackKpis, debts as fallbackDebts } from "@/lib/mock-data";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import DeudasClient from "./deudas-client";

export default async function DeudasPage() {
  const [items, kpis] = await Promise.all([debtsRepo.list(), debtsRepo.kpis()]);
  return (
    <ErrorBoundaryCard module="Deudas">
      <DeudasClient
        items={items?.length ? items : fallbackDebts}
        kpis={kpis ?? fallbackKpis}
      />
    </ErrorBoundaryCard>
  );
}
