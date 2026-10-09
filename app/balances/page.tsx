import { getCurrentUserContext } from "@/lib/data/auth";
import { localDate } from "@/app/ventas/reporting";
import { balances as balancesRepo } from "@/lib/data";
import {
  balanceMonthly as fallbackMonthly,
  balanceRecommendations as fallbackRecs,
  balanceSnapshot as fallbackSnapshot,
} from "@/lib/mock-data";
import { isDatabaseMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ErrorBoundaryCard } from "@/components/ui/error-boundary";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent } from "@/components/ui/card";
import BalancesClient from "./balances-client";

const EMPTY_BALANCE = {
  ventasMes: 0,
  comprasMes: 0,
  gastosMes: 0,
  sueldosMes: 0,
  retirosMes: 0,
  deudasPendientes: 0,
  pagosDeudaMes: 0,
  stockValorizado: 0,
  cajaEstimada: 0,
  margenBrutoPct: 0,
  resultadoOperativo: 0,
  resultadoNeto: 0,
};

export default async function BalancesPage() {
  const databaseMode = isDatabaseMode();

  if (databaseMode) {
    const supabase = await createSupabaseServerClient() as any;
    if (!supabase) {
      return <BalancesUnavailable message="Supabase no está configurado. No mostramos ceros ni balances demo como fallback." />;
    }

    const ctx=await getCurrentUserContext();
    if (!ctx.isAuthenticated || !ctx.businessId) return <BalancesUnavailable message="No se pudo resolver el negocio activo." />;
    const business=await supabase.from("businesses").select("timezone").eq("id",ctx.businessId).maybeSingle();
    if (business.error || !business.data?.timezone) return <BalancesUnavailable message="No se pudo verificar la zona horaria del negocio." />;
    const today = localDate(new Date(),business.data.timezone);
    const periodMonth = `${today.slice(0, 7)}-01`;
    const result = await supabase
      .from("balance_snapshots")
      .select("sales_data_stale,expenses_data_stale,payroll_data_stale,purchases_data_stale,sales_total,purchases_total,expenses_total,payroll_total,withdrawals_total,debts_pending,debt_payments_total,stock_valued,cash_estimated,gross_margin_pct,operating_result,net_result")
      .eq("business_id",ctx.businessId)
      .eq("period_month", periodMonth)
      .maybeSingle();

    if (result.error) {
      return (
        <BalancesUnavailable
          message={`No pudimos leer el balance real (${result.error.code ?? "query_error"}). La pantalla no reemplaza una falla de Supabase por valores $0.`}
        />
      );
    }

    const row = result.data as Record<string, number | string | boolean | null> | null;
    if (row?.sales_data_stale || row?.expenses_data_stale || row?.payroll_data_stale || row?.purchases_data_stale) return <BalancesUnavailable message="Los datos operativos cambiaron desde la generación del balance. El snapshot se conserva para auditoría y necesita regenerarse antes de mostrar sus indicadores. Consultá los módulos operativos para ver los registros vigentes." />;
    const snapshot = row
      ? {
          ventasMes: Number(row.sales_total ?? 0),
          comprasMes: Number(row.purchases_total ?? 0),
          gastosMes: Number(row.expenses_total ?? 0),
          sueldosMes: Number(row.payroll_total ?? 0),
          retirosMes: Number(row.withdrawals_total ?? 0),
          deudasPendientes: Number(row.debts_pending ?? 0),
          pagosDeudaMes: Number(row.debt_payments_total ?? 0),
          stockValorizado: Number(row.stock_valued ?? 0),
          cajaEstimada: Number(row.cash_estimated ?? 0),
          margenBrutoPct: Number(row.gross_margin_pct ?? 0),
          resultadoOperativo: Number(row.operating_result ?? 0),
          resultadoNeto: Number(row.net_result ?? 0),
        }
      : EMPTY_BALANCE;

    return (
      <ErrorBoundaryCard module="Balances">
        <BalancesClient snapshot={snapshot} monthly={[]} recommendations={[]} />
      </ErrorBoundaryCard>
    );
  }

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

function BalancesUnavailable({ message }: { message: string }) {
  return (
    <div className="space-y-6">
      <SectionHeader
        eyebrow="Operación · Balances"
        title="Balance temporalmente no disponible."
        description="No podemos confirmar el estado real del negocio en este momento."
      />
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">
            {message}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
