import { debts as debtsRepo } from "@/lib/data";
import { debtKpis as fallbackKpis, debts as fallbackDebts } from "@/lib/mock-data";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { mapDebt } from "@/lib/data/mappers";
import DeudasClient from "./deudas-client";

const EMPTY_KPIS = { totalDeuda: 0, vencidas: 0, proximoVencimiento: "—", impactoMensual: 0 };

export default async function DeudasPage() {
  if (isDatabaseMode()) {
    const supabase = createSupabaseServerClient() as any;
    if (!supabase) return <DebtsUnavailable message="Supabase no está configurado. No mostramos deudas demo como fallback." />;

    const debtsRes = await supabase
      .from("debts")
      .select("*")
      .order("status")
      .order("due_date", { ascending: true, nullsFirst: false });

    if (debtsRes.error) {
      return <DebtsUnavailable message={`No pudimos leer las deudas reales (${debtsRes.error.code ?? "query_error"}).`} />;
    }

    const rows = (debtsRes.data ?? []) as any[];
    let payments: any[] = [];
    if (rows.length > 0) {
      const paymentsRes = await supabase
        .from("debt_payments")
        .select("*")
        .in("debt_id", rows.map((row) => row.id))
        .order("paid_at", { ascending: false });
      if (paymentsRes.error) {
        return <DebtsUnavailable message={`No pudimos leer los pagos de deuda (${paymentsRes.error.code ?? "query_error"}).`} />;
      }
      payments = paymentsRes.data ?? [];
    }

    const byDebt = new Map<string, any[]>();
    for (const payment of payments) {
      const current = byDebt.get(payment.debt_id) ?? [];
      current.push(payment);
      byDebt.set(payment.debt_id, current);
    }
    const items = rows.map((row) => mapDebt(row, byDebt.get(row.id) ?? []));
    const active = rows.filter((row) => row.status !== "settled");
    const totalDeuda = active.reduce((sum, row) => sum + Number(row.pending_amount ?? 0), 0);
    const vencidas = active.filter((row) => row.status === "overdue").reduce((sum, row) => sum + Number(row.pending_amount ?? 0), 0);
    const next = active.filter((row) => row.due_date).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
    const kpis = active.length ? {
      totalDeuda,
      vencidas,
      proximoVencimiento: next ? `${new Date(`${next.due_date}T12:00:00-03:00`).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" })} · ${next.creditor}` : "—",
      impactoMensual: Math.round(totalDeuda / 6),
    } : EMPTY_KPIS;

    return <ErrorBoundaryCard module="Deudas"><DeudasClient items={items} kpis={kpis} /></ErrorBoundaryCard>;
  }

  const [items, kpis] = await Promise.all([debtsRepo.list(), debtsRepo.kpis()]);
  return (
    <ErrorBoundaryCard module="Deudas">
      <DeudasClient items={items?.length ? items : fallbackDebts} kpis={kpis ?? fallbackKpis} />
    </ErrorBoundaryCard>
  );
}

function DebtsUnavailable({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <SectionHeader eyebrow="Finanzas · Deudas" title="Deudas temporalmente no disponibles." description="No podemos confirmar el estado real del negocio en este momento." />
      <Card><CardContent className="pt-6"><div className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">{message} No reemplazamos una falla por valores $0.</div></CardContent></Card>
    </div>
  );
}
