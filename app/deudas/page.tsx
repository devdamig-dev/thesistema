import { debts as debtsRepo } from "@/lib/data";
import { debtKpis as fallbackKpis, debts as fallbackDebts } from "@/lib/mock-data";
import { isDatabaseMode } from "@/lib/env";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import DeudasClient from "./deudas-client";
import DatabaseDebtsPage from "./database-debts-page";

export default async function DeudasPage() {
  if (isDatabaseMode()) return <ErrorBoundaryCard module="Deudas"><DatabaseDebtsPage /></ErrorBoundaryCard>;
  const [items, kpis] = await Promise.all([debtsRepo.list(), debtsRepo.kpis()]);
  return <ErrorBoundaryCard module="Deudas"><DeudasClient items={items?.length ? items : fallbackDebts} kpis={kpis ?? fallbackKpis} branches={[{ id: "demo", name: "Principal" }]} /></ErrorBoundaryCard>;
}
