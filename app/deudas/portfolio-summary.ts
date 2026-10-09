import { MAX_DEBT_MONEY_CENTS } from "../../lib/debts/plans";
import type { DebtView } from "./plan-data";

export type CreditorBalance = { creditor: string; creditorType: string | null; currency: string; debtCount: number; plannedPendingCents: number; legacyPendingCents: number; pendingCents: number };
export type CurrencyBalance = { currency: string; debtCount: number; plannedPendingCents: number; legacyPendingCents: number; pendingCents: number };

/** Inputs are complete, authenticated read models, already scoped by the page.
 * Group only exact stored creditor name/type, never infer entity identity, FX,
 * a historical currency or installment schedule. Unknown currencies stay as
 * individual records because even two unknown values may be different units. */
export function summarizeDebtViews(views: DebtView[]): { currencies: CurrencyBalance[]; creditors: CreditorBalance[]; unknown: DebtView[]; cancelled: DebtView[] } {
  const currencies = new Map<string, CurrencyBalance>();
  const creditors = new Map<string, CreditorBalance>();
  const unknown: DebtView[] = [], cancelled: DebtView[] = [];
  const seen = new Set<string>();
  function add(a: number, b: number): number {
    const total = a + b;
    if (!Number.isSafeInteger(total)) throw new Error("debt_summary_overflow");
    return total;
  }
  for (const debt of views) {
    if (seen.has(debt.id)) throw new Error("duplicate_debt");
    seen.add(debt.id);
    if (!Number.isSafeInteger(debt.pendingCents) || debt.pendingCents < 0 || debt.pendingCents > MAX_DEBT_MONEY_CENTS) throw new Error("invalid_debt_balance");
    if (debt.status === "cancelled") { cancelled.push(debt); continue; }
    if (debt.currency === null) { unknown.push(debt); continue; }
    if (!/^[A-Z]{3}$/.test(debt.currency)) throw new Error("invalid_debt_currency");
    const currency = currencies.get(debt.currency) ?? { currency: debt.currency, debtCount: 0, plannedPendingCents: 0, legacyPendingCents: 0, pendingCents: 0 };
    const key = JSON.stringify([debt.currency, debt.creditor, debt.creditorType]);
    const creditor = creditors.get(key) ?? { ...currency, debtCount: 0, plannedPendingCents: 0, legacyPendingCents: 0, pendingCents: 0, creditor: debt.creditor, creditorType: debt.creditorType };
    for (const group of [currency, creditor]) {
      group.debtCount++;
      group.pendingCents = add(group.pendingCents, debt.pendingCents);
      if (debt.ledger) group.plannedPendingCents = add(group.plannedPendingCents, debt.pendingCents);
      else group.legacyPendingCents = add(group.legacyPendingCents, debt.pendingCents);
    }
    currencies.set(debt.currency, currency); creditors.set(key, creditor);
  }
  return { currencies: [...currencies.values()].sort((a, b) => a.currency.localeCompare(b.currency)), creditors: [...creditors.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.pendingCents - a.pendingCents || a.creditor.localeCompare(b.creditor)), unknown, cancelled };
}
