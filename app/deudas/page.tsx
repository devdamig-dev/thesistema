import { debts as debtsRepo } from "@/lib/data";
import { debtKpis as fallbackKpis, debts as fallbackDebts } from "@/lib/mock-data";
import DeudasClient from "./deudas-client";

export default async function DeudasPage() {
  const [items, kpis] = await Promise.all([debtsRepo.list(), debtsRepo.kpis()]);
  return (
    <DeudasClient
      items={items?.length ? items : fallbackDebts}
      kpis={kpis ?? fallbackKpis}
    />
  );
}
