import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";
import { canSeeModule, hasPermission } from "@/lib/permissions";
import { SectionHeader } from "@/components/ui/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { mapDebtView, type DebtRow, type InstallmentRow, type PaymentRow, type AllocationRow, type DebtAuditRow, type DebtView } from "./plan-data";
import DatabaseDebtsClient from "./database-debts-client";
import type { DebtAccess } from "@/lib/debts/plans";

// Supabase returns at most 1000 rows by default; incomplete ledgers must never
// masquerade as complete totals. Keyset paging covers every row in stable order.
async function allRows<T>(build: () => any): Promise<T[]> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    let query = build().order("id").limit(500);
    if (after) query = query.gt("id", after);
    const result = await query;
    if (result.error || !Array.isArray(result.data)) throw new Error("read_failed");
    rows.push(...result.data);
    if (result.data.length < 500) return rows;
    if (rows.length > 100_000) throw new Error("read_limit");
    after = result.data[result.data.length - 1].id;
  }
}
export default async function DatabaseDebtsPage() {
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId || !ctx.userId) return <DebtsUnavailable message="No pudimos identificar tu sesión y negocio activo." />;
  if (!hasPermission(ctx.role, "debts.view") || !canSeeModule(ctx.role, "debts", ctx.enabledModules)) return <DebtsUnavailable message="Tu rol no tiene acceso al módulo Deudas." />;
  const db = await createSupabaseServerClient() as any;
  if (!db) return <DebtsUnavailable message="No pudimos conectar con la información financiera del negocio." />;
  const scoped = (table: string, columns = "*") => {
    let query = db.from(table).select(columns).eq("business_id", ctx.businessId);
    if (ctx.assignedBranchIds !== null) query = query.in(table === "branches" ? "id" : "branch_id", ctx.assignedBranchIds.length ? ctx.assignedBranchIds : ["00000000-0000-0000-0000-000000000000"]);
    return query;
  };
  let content: { debts: DebtView[]; branches: { id: string; name: string }[]; access: DebtAccess; asOfDate: string; timeZone: string } | null = null;
  try {
    const [rows, branches, installments, payments, allocations, businessResult] = await Promise.all([
      allRows<DebtRow>(() => scoped("debts")),
      allRows<{ id: string; name: string }>(() => scoped("branches", "id,name")),
      allRows<InstallmentRow>(() => scoped("debt_installments")),
      allRows<PaymentRow>(() => scoped("debt_payments")),
      allRows<AllocationRow>(() => scoped("debt_payment_allocations")),
      db.from("businesses").select("timezone").eq("id", ctx.businessId).maybeSingle(),
    ]);
    // Activity is restricted to already-authorized debt/payment targets, never
    // expose unrelated business-wide log rows to a branch-restricted reader.
    const targets = [...rows.map((row) => row.id), ...payments.map((payment) => payment.id)];
    const audit: DebtAuditRow[] = [];
    for (let index = 0; index < targets.length; index += 100) audit.push(...await allRows<DebtAuditRow>(() => db.from("activity_logs").select("id,target_id,actor_id,action,summary,created_at").eq("business_id", ctx.businessId).in("target_id", targets.slice(index, index + 100))));
    const access: DebtAccess = { actorId: ctx.userId, businessId: ctx.businessId, branchIds: ctx.assignedBranchIds, permissions: ["debts.view", ...(hasPermission(ctx.role, "debts.create") ? ["debts.create" as const] : []), ...(hasPermission(ctx.role, "debts.pay") ? ["debts.pay" as const] : [])] };
    if (businessResult.error || typeof businessResult.data?.timezone !== "string") throw new Error("timezone_unavailable");
    const timeZone = businessResult.data.timezone;
    const asOfDate = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const debts = rows.map((row) => mapDebtView(row, installments, payments, allocations, audit, asOfDate, access));
    content = { debts, branches, access, asOfDate, timeZone };
  } catch { /* Fail closed: never display a partial ledger or fabricated balances. */ }
  if (!content) return <DebtsUnavailable message="No pudimos verificar el cronograma y el historial completo. Comprobá que la migración de planes esté aplicada y volvé a cargar la página." />;
  return <DatabaseDebtsClient key={`${content.access.businessId}:${content.access.actorId}`} {...content} />;
}
export function DebtsUnavailable({ message }: { message: string }) {
  return <div className="space-y-6"><SectionHeader eyebrow="Finanzas · Deudas" title="Deudas temporalmente no disponibles" description="No podemos confirmar el estado real del negocio en este momento." /><Card><CardContent className="pt-6"><div role="alert" className="rounded-xl border border-danger-500/30 bg-danger-500/[0.06] p-4 text-sm text-danger-300">{message} Tus datos no fueron reemplazados por valores estimados.</div></CardContent></Card></div>;
}
