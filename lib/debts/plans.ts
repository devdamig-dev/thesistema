/**
 * Shared, side-effect-free debt planning and ledger arithmetic for manual/WA callers.
 * Every public boundary validates unknown input, rejects unknown keys and clones data.
 * Amounts are integer hundredths, capped to existing numeric(12,2) storage; decimal
 * strings convert exactly. Currency is mandatory; no exchange rates are inferred.
 *
 * IMPORTANT: access must come from authenticated server context, never request JSON.
 * expectedVersion only detects a stale snapshot here. Persistence MUST lock the
 * parent debt, recheck access/version/balances and atomically write payment,
 * allocations, new version and audit. These functions do not provide DB locking.
 */
export const MAX_DEBT_MONEY_CENTS = 999_999_999_999;
export const MAX_DEBT_INSTALLMENTS = 1200;
export const MAX_DEBT_LEDGER_PAYMENTS = 100_000;
export type DebtMode = "single" | "installments";
export type DebtPeriodicity = "weekly" | "fortnightly" | "monthly" | "custom";
export type DebtOrigin = "manual" | "whatsapp" | "purchase" | "invoice" | "api" | "system";
export type DebtPermission = "debts.view" | "debts.create" | "debts.pay";
export type InstallmentStatus = "pending" | "partial" | "paid" | "overdue";
export type PlanDebtStatus = "pending" | "in_plan" | "partially_paid" | "paid" | "overdue" | "cancelled";
export type DebtCancellation = { cancelledAt: string; actorId: string; reason: string };
export type DebtScope = { debtId: string; businessId: string; branchId: string | null };
export type DebtAccess = { actorId: string; businessId: string; branchIds: string[] | null; permissions: DebtPermission[] };
export type DebtComponents = { capitalAmountCents?: number; interestAmountCents?: number; feesAmountCents?: number };
export type ConfirmedDebtBalance = { confirmed: true; downPaymentCents: number; interestCents: number; feesCents: number };
export type DebtFinancing = {
  totalFinancedCents?: number;
  installmentAmountCents?: number;
  /** Caller confirms the historical down payment is already paid and all three
   * amounts are known, including explicit zero charges. This records no payment. */
  confirmedBalance?: ConfirmedDebtBalance;
};
export type DebtInterestRate = {
  /** Metadata only: no rate-to-money conversion or assumed amortization. */
  value: string;
  period: "weekly" | "fortnightly" | "monthly" | "annual" | "one_time" | "unspecified";
};
export type DebtSchedule =
  | { periodicity: "weekly" | "fortnightly" | "monthly"; firstDueDate: string }
  | { periodicity: "custom"; dueDates: string[] };
export type DebtPlanInput = {
  currency: string;
  originalAmountCents: number;
  financing: DebtFinancing;
  components?: DebtComponents[];
  interestRate?: DebtInterestRate;
} & (
  | { mode: "single"; dueDate?: string | null }
  | { mode: "installments"; installmentCount: number; schedule: DebtSchedule }
);
export type PlannedDebtInstallment = {
  installmentNumber: number;
  dueDate: string | null;
  totalAmountCents: number;
  capitalAmountCents: number | null;
  interestAmountCents: number | null;
  feesAmountCents: number | null;
};
export type DebtPlan = {
  mode: DebtMode;
  currency: string;
  originalAmountCents: number;
  totalFinancedCents: number;
  /** Null means historical down-payment information was not supplied. */
  downPaymentCents: number | null;
  totalObligationCents: number | null;
  regularInstallmentAmountCents: number;
  installmentCount: number;
  periodicity: DebtPeriodicity | null;
  monthlyAnchorDay: number | null;
  amountSource: "explicit_total" | "explicit_installment" | "confirmed_balance";
  confirmedBalance: ConfirmedDebtBalance | null;
  interestRate: DebtInterestRate | null;
  installments: PlannedDebtInstallment[];
};
export type LedgerDebtInstallment = DebtScope & {
  id: string;
  installmentNumber: number;
  dueDate: string | null;
  totalAmountCents: number;
};
export type DebtPaymentAllocation = { installmentId: string; amountCents: number };
export type DebtAllocationChoice =
  | { rule: "selected_installment"; installmentId: string }
  | { rule: "oldest_due" };
export type DebtPaymentRecord = DebtScope & {
  id: string;
  currency: string;
  amountCents: number;
  paidAt: string;
  paymentMethod: string;
  actorId: string;
  origin: DebtOrigin;
  reference?: string;
  notes?: string;
  allocation: DebtAllocationChoice;
  allocations: DebtPaymentAllocation[];
  voided?: { voidedAt: string; actorId: string; reason: string };
};
export type DebtLedgerSnapshot = DebtScope & {
  /** Administrative record cancellation, not debt forgiveness or a payment. */
  cancelled?: DebtCancellation;
  currency: string;
  mode: DebtMode;
  totalFinancedCents: number;
  version: number;
  installments: LedgerDebtInstallment[];
  /** Complete installment-payment ledger including voids, EXCLUDING historical
   * down payments already deducted to calculate totalFinancedCents. Never import
   * an upfront payment here or subtract it again. No mutable paid_amount input. */
  payments: DebtPaymentRecord[];
};
export type DebtPaymentInput = DebtScope & {
  paymentId: string;
  currency: string;
  expectedVersion: number;
  amountCents: number;
  paidAt: string;
  paymentMethod: string;
  origin: DebtOrigin;
  allocation: DebtAllocationChoice;
  reference?: string;
  notes?: string;
};
export type VoidDebtPaymentInput = DebtScope & {
  paymentId: string;
  currency: string;
  expectedVersion: number;
  voidedAt: string;
  reason: string;
};
export type InstallmentProjection = LedgerDebtInstallment & { paidAmountCents: number; pendingAmountCents: number; status: InstallmentStatus };
export type DebtProjection = DebtScope & {
  currency: string;
  totalFinancedCents: number;
  paidAmountCents: number;
  pendingAmountCents: number;
  overdueAmountCents: number;
  unscheduledAmountCents: number;
  dueTodayCents: number;
  next7DaysCents: number;
  next30DaysCents: number;
  next60DaysCents: number;
  dueThisMonthCents: number;
  paidInstallmentCount: number;
  installmentCount: number;
  status: PlanDebtStatus;
  nextDueDate: string | null;
  installments: InstallmentProjection[];
};
export class DebtPlanError extends Error {
  constructor(public readonly code: string, public readonly path: string) {
    super(`${code}: ${path}`);
    this.name = "DebtPlanError";
  }
}

const scopeKeys = ["debtId", "businessId", "branchId"];
const origins = ["manual", "whatsapp", "purchase", "invoice", "api", "system"] as const;
const componentKeys = ["capitalAmountCents", "interestAmountCents", "feesAmountCents"] as const;
const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function fail(code: string, path: string): never { throw new DebtPlanError(code, path); }
function object(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalid_object", path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("invalid_object", path);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key)) fail("unknown_field", `${path}.${String(key)}`);
    if (!own(Object.getOwnPropertyDescriptor(value, key)!, "value")) fail("invalid_object", `${path}.${key}`);
  }
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, max = 200): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) fail("invalid_text", path);
  return value.trim();
}
function identifier(value: unknown, path: string): string {
  const parsed = text(value, path);
  if (parsed !== value) fail("invalid_identifier", path);
  return parsed;
}
function enumeration<T extends string>(value: unknown, options: readonly T[], path: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) fail("invalid_choice", path);
  return value as T;
}
function integer(value: unknown, path: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("invalid_integer", path);
  return value;
}
function money(value: unknown, path: string, min = 0): number { return integer(value, path, min, MAX_DEBT_MONEY_CENTS); }
function sum(values: readonly number[], path: string): number {
  let result = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - result) fail("money_overflow", path);
    result += value;
  }
  return result;
}
function multiply(value: number, count: number, path: string): number {
  if (value > Math.floor(MAX_DEBT_MONEY_CENTS / count)) fail("money_overflow", path);
  return value * count;
}
function currency(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) fail("invalid_currency", path);
  return value;
}
function list(value: unknown, path: string, max = MAX_DEBT_INSTALLMENTS): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > max) fail("invalid_array", path);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) fail("unknown_field", `${path}.${String(key)}`);
    if (!own(Object.getOwnPropertyDescriptor(value, key)!, "value")) fail("invalid_array", `${path}[${key}]`);
  }
  for (let i = 0; i < value.length; i++) if (!own(value, String(i))) fail("invalid_array", path);
  return value;
}
function civilDate(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("invalid_date", path);
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > monthDays(year, month)) fail("invalid_date", path);
  return value;
}
function monthDays(year: number, month: number): number {
  return [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function dateAt(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}
function plusDays(value: string, days: number): string {
  const date = dateAt(value);
  date.setUTCDate(date.getUTCDate() + days);
  return civilDate(date.toISOString().slice(0, 10), "schedule.dueDate");
}
function plusAnchoredMonths(value: string, months: number): string {
  const [initialYear, initialMonth, anchor] = value.split("-").map(Number);
  const monthIndex = initialYear * 12 + initialMonth - 1 + months;
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12 + 1;
  if (year > 9999) fail("invalid_date", "schedule.dueDate");
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(Math.min(anchor, monthDays(year, month))).padStart(2, "0")}`;
}
function readScope(record: Record<string, unknown>, path: string): DebtScope {
  return {
    debtId: identifier(record.debtId, `${path}.debtId`),
    businessId: identifier(record.businessId, `${path}.businessId`),
    branchId: record.branchId === null ? null : identifier(record.branchId, `${path}.branchId`),
  };
}
function sameScope(actual: DebtScope, expected: DebtScope, path: string): void {
  if (actual.businessId !== expected.businessId) fail("business_mismatch", path);
  if (actual.debtId !== expected.debtId) fail("debt_mismatch", path);
  if (actual.branchId !== expected.branchId) fail("branch_mismatch", path);
}
function parseAccess(value: unknown): DebtAccess {
  const input = object(value, ["actorId", "businessId", "branchIds", "permissions"], "access");
  return {
    actorId: identifier(input.actorId, "access.actorId"),
    businessId: identifier(input.businessId, "access.businessId"),
    branchIds: input.branchIds === null ? null : list(input.branchIds, "access.branchIds").map((id, i) => identifier(id, `access.branchIds[${i}]`)),
    permissions: list(input.permissions, "access.permissions", 3).map((permission, i) => enumeration(permission, ["debts.view", "debts.create", "debts.pay"], `access.permissions[${i}]`)),
  };
}
function checkAccess(scope: DebtScope, access: DebtAccess, permission: DebtPermission): void {
  if (scope.businessId !== access.businessId) fail("business_mismatch", "access.businessId");
  if (!access.permissions.includes(permission)) fail("permission_denied", permission);
  if (access.branchIds !== null && (scope.branchId === null || !access.branchIds.includes(scope.branchId))) fail("branch_forbidden", "access.branchIds");
}

/** Accepts canonical nonnegative decimal text, never floats, symbols or locale separators. */
export function decimalMoneyToCents(value: unknown): number {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(value) || value.length > 13) fail("invalid_decimal_money", "amount");
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return money(result, "amount");
}
export function centsToDecimalMoney(value: unknown): string {
  const cents = money(value, "amountCents");
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/**
 * Equal installments: floor(total / count); the last absorbs all remaining cents.
 * If BOTH total and an equal installment amount are supplied they must multiply
 * exactly; rounding adjustment is available when supplying the total alone.
 * Fortnightly means exactly 15 calendar days, not twice monthly. Custom dates are
 * explicit and strictly increasing. Monthly schedules always reuse the first day
 * number (Jan 31 -> Feb 28 -> Mar 31), not the previous shortened installment.
 * A single payment may omit its date; installments may not omit any date.
 * Confirmed down payment is historical/outside the schedule: the schedule covers
 * original - confirmed down payment + confirmed interest + confirmed fees only.
 */
export function generateDebtPlan(value: unknown): DebtPlan {
  const shared = ["mode", "currency", "originalAmountCents", "financing", "components", "interestRate"];
  const raw = object(value, [...shared, "dueDate", "installmentCount", "schedule"], "plan");
  const mode = enumeration(raw.mode, ["single", "installments"], "plan.mode");
  object(value, mode === "single" ? [...shared, "dueDate"] : [...shared, "installmentCount", "schedule"], "plan");
  const parsedCurrency = currency(raw.currency, "plan.currency");
  const originalAmountCents = money(raw.originalAmountCents, "plan.originalAmountCents", 1);
  const count = mode === "single" ? 1 : integer(raw.installmentCount, "plan.installmentCount", 1, MAX_DEBT_INSTALLMENTS);
  const financing = object(raw.financing, ["totalFinancedCents", "installmentAmountCents", "confirmedBalance"], "plan.financing");
  const explicitTotal = own(financing, "totalFinancedCents") ? money(financing.totalFinancedCents, "plan.financing.totalFinancedCents", 1) : undefined;
  const explicitInstallment = own(financing, "installmentAmountCents") ? money(financing.installmentAmountCents, "plan.financing.installmentAmountCents", 1) : undefined;
  const installmentTotal = explicitInstallment === undefined ? undefined : multiply(explicitInstallment, count, "plan.financing.installmentAmountCents");
  let confirmedBalance: ConfirmedDebtBalance | null = null;
  let confirmedTotal: number | undefined;
  if (own(financing, "confirmedBalance")) {
    const confirmed = object(financing.confirmedBalance, ["confirmed", "downPaymentCents", "interestCents", "feesCents"], "plan.financing.confirmedBalance");
    if (confirmed.confirmed !== true) fail("balance_not_confirmed", "plan.financing.confirmedBalance.confirmed");
    confirmedBalance = {
      confirmed: true,
      downPaymentCents: money(confirmed.downPaymentCents, "plan.financing.confirmedBalance.downPaymentCents"),
      interestCents: money(confirmed.interestCents, "plan.financing.confirmedBalance.interestCents"),
      feesCents: money(confirmed.feesCents, "plan.financing.confirmedBalance.feesCents"),
    };
    if (confirmedBalance.downPaymentCents > originalAmountCents) fail("down_payment_exceeds_original", "plan.financing.confirmedBalance.downPaymentCents");
    confirmedTotal = money(sum([originalAmountCents - confirmedBalance.downPaymentCents, confirmedBalance.interestCents, confirmedBalance.feesCents], "plan.financing"), "plan.financing", 1);
  }
  const total = explicitTotal ?? installmentTotal ?? confirmedTotal;
  if (total === undefined) fail("financed_amount_required", "plan.financing");
  if ([explicitTotal, installmentTotal, confirmedTotal].some((amount) => amount !== undefined && amount !== total)) fail("inconsistent_financing", "plan.financing");
  if (total < count) fail("installment_below_one_cent", "plan.financing");
  let interestRate: DebtInterestRate | null = null;
  if (own(raw, "interestRate")) {
    const rate = object(raw.interestRate, ["value", "period"], "plan.interestRate");
    if (typeof rate.value !== "string" || !/^(0|[1-9]\d{0,5})(\.\d{1,6})?$/.test(rate.value)) fail("invalid_interest_rate", "plan.interestRate.value");
    interestRate = { value: rate.value, period: enumeration(rate.period, ["weekly", "fortnightly", "monthly", "annual", "one_time", "unspecified"], "plan.interestRate.period") };
  }
  let periodicity: DebtPeriodicity | null = null;
  let monthlyAnchorDay: number | null = null;
  let dates: (string | null)[];
  if (mode === "single") {
    dates = [!own(raw, "dueDate") || raw.dueDate === null ? null : civilDate(raw.dueDate, "plan.dueDate")];
  } else {
    const schedule = object(raw.schedule, ["periodicity", "firstDueDate", "dueDates"], "plan.schedule");
    periodicity = enumeration<DebtPeriodicity>(schedule.periodicity, ["weekly", "fortnightly", "monthly", "custom"], "plan.schedule.periodicity");
    if (periodicity === "custom") {
      object(raw.schedule, ["periodicity", "dueDates"], "plan.schedule");
      dates = list(schedule.dueDates, "plan.schedule.dueDates").map((date, i) => civilDate(date, `plan.schedule.dueDates[${i}]`));
      if (dates.length !== count) fail("installment_count_mismatch", "plan.schedule.dueDates");
      for (let i = 1; i < dates.length; i++) if (dates[i]! <= dates[i - 1]!) fail("dates_not_increasing", "plan.schedule.dueDates");
    } else {
      object(raw.schedule, ["periodicity", "firstDueDate"], "plan.schedule");
      const first = civilDate(schedule.firstDueDate, "plan.schedule.firstDueDate");
      monthlyAnchorDay = periodicity === "monthly" ? Number(first.slice(8)) : null;
      dates = Array.from({ length: count }, (_, i) => periodicity === "monthly" ? plusAnchoredMonths(first, i) : plusDays(first, i * (periodicity === "weekly" ? 7 : 15)));
    }
  }
  const components = own(raw, "components") ? list(raw.components, "plan.components").map((part, i) => {
    const input = object(part, componentKeys, `plan.components[${i}]`);
    const result: DebtComponents = {};
    for (const key of componentKeys) if (own(input, key)) result[key] = money(input[key], `plan.components[${i}].${key}`);
    return result;
  }) : undefined;
  if (components && components.length !== count) fail("installment_count_mismatch", "plan.components");
  const regularInstallmentAmountCents = Math.floor(total / count);
  const installments = dates.map((dueDate, i): PlannedDebtInstallment => {
    const totalAmountCents = i === count - 1 ? total - regularInstallmentAmountCents * (count - 1) : regularInstallmentAmountCents;
    const part = components?.[i] ?? {};
    const known = componentKeys.filter((key) => own(part, key));
    const knownTotal = sum(known.map((key) => part[key]!), `plan.components[${i}]`);
    if (knownTotal > totalAmountCents || (known.length === 3 && knownTotal !== totalAmountCents)) fail("inconsistent_components", `plan.components[${i}]`);
    return { installmentNumber: i + 1, dueDate, totalAmountCents, capitalAmountCents: part.capitalAmountCents ?? null, interestAmountCents: part.interestAmountCents ?? null, feesAmountCents: part.feesAmountCents ?? null };
  });
  if (confirmedBalance && components) {
    const totals = { capitalAmountCents: originalAmountCents - confirmedBalance.downPaymentCents, interestAmountCents: confirmedBalance.interestCents, feesAmountCents: confirmedBalance.feesCents };
    const remaining = { ...totals };
    for (const key of componentKeys) {
      const known = components.filter((part) => own(part, key));
      const knownTotal = sum(known.map((part) => part[key]!), `plan.components.${key}`);
      if (knownTotal > totals[key] || (known.length === count && knownTotal !== totals[key])) fail("inconsistent_components", `plan.components.${key}`);
      remaining[key] -= knownTotal;
    }
    // Feasibility only, never assumed amortization: any subset of the three
    // component totals must fit in the installments where those components are
    // still unknown. These seven capacity checks cover the transportation
    // problem, including pairs competing for the same remaining row capacity.
    for (let mask = 1; mask < 8; mask++) {
      const keys = componentKeys.filter((_, index) => mask & (1 << index));
      const demand = sum(keys.map((key) => remaining[key]), "plan.components");
      const capacity = sum(components.map((part, index) => keys.some((key) => !own(part, key))
        ? installments[index].totalAmountCents - sum(componentKeys.map((key) => part[key] ?? 0), "plan.components")
        : 0), "plan.components");
      if (demand > capacity) fail("inconsistent_components", "plan.components");
    }
  }
  const totalObligationCents = confirmedBalance ? money(sum([total, confirmedBalance.downPaymentCents], "plan.totalObligationCents"), "plan.totalObligationCents", 1) : null;
  return { mode, currency: parsedCurrency, originalAmountCents, totalFinancedCents: total, downPaymentCents: confirmedBalance?.downPaymentCents ?? null, totalObligationCents, regularInstallmentAmountCents, installmentCount: count, periodicity, monthlyAnchorDay, amountSource: explicitTotal !== undefined ? "explicit_total" : installmentTotal !== undefined ? "explicit_installment" : "confirmed_balance", confirmedBalance, interestRate, installments };
}

function readChoice(value: unknown, path: string): DebtAllocationChoice {
  const input = object(value, ["rule", "installmentId"], path);
  const rule = enumeration(input.rule, ["selected_installment", "oldest_due"], `${path}.rule`);
  if (rule === "oldest_due") { object(value, ["rule"], path); return { rule }; }
  return { rule, installmentId: identifier(input.installmentId, `${path}.installmentId`) };
}
function paymentOptionalText(raw: Record<string, unknown>, path: string): { reference?: string; notes?: string } {
  return {
    ...(own(raw, "reference") ? { reference: text(raw.reference, `${path}.reference`, 200) } : {}),
    ...(own(raw, "notes") ? { notes: text(raw.notes, `${path}.notes`, 1000) } : {}),
  };
}
function readPaymentRecord(value: unknown, path: string): DebtPaymentRecord {
  const raw = object(value, [...scopeKeys, "id", "currency", "amountCents", "paidAt", "paymentMethod", "actorId", "origin", "reference", "notes", "allocation", "allocations", "voided"], path);
  const record: DebtPaymentRecord = {
    ...readScope(raw, path), id: identifier(raw.id, `${path}.id`), currency: currency(raw.currency, `${path}.currency`), amountCents: money(raw.amountCents, `${path}.amountCents`, 1), paidAt: civilDate(raw.paidAt, `${path}.paidAt`), paymentMethod: text(raw.paymentMethod, `${path}.paymentMethod`, 80), actorId: identifier(raw.actorId, `${path}.actorId`), origin: enumeration(raw.origin, origins, `${path}.origin`), ...paymentOptionalText(raw, path), allocation: readChoice(raw.allocation, `${path}.allocation`),
    allocations: list(raw.allocations, `${path}.allocations`).map((allocation, i) => {
      const part = object(allocation, ["installmentId", "amountCents"], `${path}.allocations[${i}]`);
      return { installmentId: identifier(part.installmentId, `${path}.allocations[${i}].installmentId`), amountCents: money(part.amountCents, `${path}.allocations[${i}].amountCents`, 1) };
    }),
  };
  if (sum(record.allocations.map((part) => part.amountCents), `${path}.allocations`) !== record.amountCents) fail("allocation_total_mismatch", path);
  if (new Set(record.allocations.map((part) => part.installmentId)).size !== record.allocations.length) fail("duplicate_allocation", path);
  if (record.allocation.rule === "selected_installment" && (record.allocations.length !== 1 || record.allocations[0].installmentId !== record.allocation.installmentId)) fail("allocation_choice_mismatch", path);
  if (own(raw, "voided")) {
    const voided = object(raw.voided, ["voidedAt", "actorId", "reason"], `${path}.voided`);
    record.voided = { voidedAt: civilDate(voided.voidedAt, `${path}.voided.voidedAt`), actorId: identifier(voided.actorId, `${path}.voided.actorId`), reason: text(voided.reason, `${path}.voided.reason`, 1000) };
    if (record.voided.voidedAt < record.paidAt) fail("void_before_payment", `${path}.voided.voidedAt`);
  }
  return record;
}

/** Validates the full snapshot; paid balances derive solely from non-voided allocations. */
export function validateDebtLedger(value: unknown): DebtLedgerSnapshot {
  const raw = object(value, [...scopeKeys, "currency", "mode", "totalFinancedCents", "version", "installments", "payments", "cancelled"], "ledger");
  const scope = readScope(raw, "ledger");
  const ledger: DebtLedgerSnapshot = {
    ...scope, currency: currency(raw.currency, "ledger.currency"), mode: enumeration(raw.mode, ["single", "installments"], "ledger.mode"), totalFinancedCents: money(raw.totalFinancedCents, "ledger.totalFinancedCents", 1), version: integer(raw.version, "ledger.version", 0),
    installments: list(raw.installments, "ledger.installments").map((value, i) => {
      const path = `ledger.installments[${i}]`;
      const installment = object(value, [...scopeKeys, "id", "installmentNumber", "dueDate", "totalAmountCents"], path);
      const parsed = { ...readScope(installment, path), id: identifier(installment.id, `${path}.id`), installmentNumber: integer(installment.installmentNumber, `${path}.installmentNumber`, 1, MAX_DEBT_INSTALLMENTS), dueDate: installment.dueDate === null ? null : civilDate(installment.dueDate, `${path}.dueDate`), totalAmountCents: money(installment.totalAmountCents, `${path}.totalAmountCents`, 1) };
      sameScope(parsed, scope, path);
      return parsed;
    }),
    payments: list(raw.payments, "ledger.payments", MAX_DEBT_LEDGER_PAYMENTS).map((value, i) => readPaymentRecord(value, `ledger.payments[${i}]`)),
  };
  if (own(raw, "cancelled")) {
    const cancelled = object(raw.cancelled, ["cancelledAt", "actorId", "reason"], "ledger.cancelled");
    ledger.cancelled = { cancelledAt: civilDate(cancelled.cancelledAt, "ledger.cancelled.cancelledAt"), actorId: identifier(cancelled.actorId, "ledger.cancelled.actorId"), reason: text(cancelled.reason, "ledger.cancelled.reason", 1000) };
  }
  if (!ledger.installments.length || (ledger.mode === "single" && ledger.installments.length !== 1)) fail("installment_count_mismatch", "ledger.installments");
  if (ledger.mode === "installments" && ledger.installments.some((part) => part.dueDate === null)) fail("installment_date_required", "ledger.installments");
  if (new Set(ledger.installments.map((part) => part.id)).size !== ledger.installments.length) fail("duplicate_installment", "ledger.installments");
  const numbers = ledger.installments.map((part) => part.installmentNumber).sort((a, b) => a - b);
  if (numbers.some((number, i) => number !== i + 1)) fail("invalid_installment_numbers", "ledger.installments");
  if (sum(ledger.installments.map((part) => part.totalAmountCents), "ledger.installments") !== ledger.totalFinancedCents) fail("installment_total_mismatch", "ledger.installments");
  if (new Set(ledger.payments.map((payment) => payment.id)).size !== ledger.payments.length) fail("duplicate_payment", "ledger.payments");
  const installmentTotals = new Map(ledger.installments.map((part) => [part.id, part.totalAmountCents]));
  for (const payment of ledger.payments) {
    sameScope(payment, scope, "ledger.payments");
    if (payment.currency !== ledger.currency) fail("currency_mismatch", "ledger.payments");
    if (payment.amountCents > ledger.totalFinancedCents) fail("amount_exceeds_pending", "ledger.payments.amountCents");
    for (const allocation of payment.allocations) {
      const total = installmentTotals.get(allocation.installmentId);
      if (total === undefined) fail("installment_not_found", "ledger.payments.allocations");
      if (allocation.amountCents > total) fail("amount_exceeds_installment_pending", "ledger.payments.allocations");
    }
  }
  const paid = paidByInstallment(ledger);
  for (const installment of ledger.installments) if ((paid.get(installment.id) ?? 0) > installment.totalAmountCents) fail("amount_exceeds_pending", "ledger.payments.allocations");
  return ledger;
}
function paidByInstallment(ledger: DebtLedgerSnapshot): Map<string, number> {
  const amounts = new Map<string, number>();
  for (const payment of ledger.payments) if (!payment.voided) for (const part of payment.allocations) amounts.set(part.installmentId, sum([amounts.get(part.installmentId) ?? 0, part.amountCents], "ledger.payments.allocations"));
  return amounts;
}
function checkOperation(raw: Record<string, unknown>, ledger: DebtLedgerSnapshot, access: DebtAccess): void {
  checkAccess(ledger, access, "debts.pay");
  if (ledger.cancelled) fail("debt_cancelled", "ledger.cancelled");
  sameScope(readScope(raw, "operation"), ledger, "operation");
  if (currency(raw.currency, "operation.currency") !== ledger.currency) fail("currency_mismatch", "operation.currency");
  if (integer(raw.expectedVersion, "operation.expectedVersion", 0) !== ledger.version) fail("stale_version", "operation.expectedVersion");
  if (ledger.version === Number.MAX_SAFE_INTEGER) fail("version_overflow", "ledger.version");
}

/** Explicit selected-installment payments never spill into another installment. */
export function allocateDebtPayment(snapshot: unknown, value: unknown, accessValue: unknown): { snapshot: DebtLedgerSnapshot; payment: DebtPaymentRecord; pendingAmountCents: number } {
  const ledger = validateDebtLedger(snapshot);
  const access = parseAccess(accessValue);
  const raw = object(value, [...scopeKeys, "paymentId", "currency", "expectedVersion", "amountCents", "paidAt", "paymentMethod", "origin", "allocation", "reference", "notes"], "payment");
  checkOperation(raw, ledger, access);
  if (ledger.payments.length >= MAX_DEBT_LEDGER_PAYMENTS) fail("payment_history_limit", "ledger.payments");
  const paymentId = identifier(raw.paymentId, "payment.paymentId");
  if (ledger.payments.some((payment) => payment.id === paymentId)) fail("duplicate_payment", "payment.paymentId");
  const amountCents = money(raw.amountCents, "payment.amountCents", 1);
  const choice = readChoice(raw.allocation, "payment.allocation");
  const paid = paidByInstallment(ledger);
  const pending = ledger.totalFinancedCents - sum([...paid.values()], "ledger.paidAmountCents");
  if (amountCents > pending) fail("amount_exceeds_pending", "payment.amountCents");
  const candidates = choice.rule === "selected_installment"
    ? ledger.installments.filter((part) => part.id === choice.installmentId)
    : [...ledger.installments].sort((a, b) => (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99") || a.installmentNumber - b.installmentNumber);
  if (!candidates.length) fail("installment_not_found", "payment.allocation.installmentId");
  const allocations: DebtPaymentAllocation[] = [];
  let remaining = amountCents;
  for (const installment of candidates) {
    const allocated = Math.min(remaining, installment.totalAmountCents - (paid.get(installment.id) ?? 0));
    if (allocated > 0) allocations.push({ installmentId: installment.id, amountCents: allocated });
    remaining -= allocated;
    if (!remaining) break;
  }
  if (remaining) fail("amount_exceeds_installment_pending", "payment.amountCents");
  const payment: DebtPaymentRecord = {
    ...readScope(raw, "payment"), id: paymentId, currency: ledger.currency, amountCents, paidAt: civilDate(raw.paidAt, "payment.paidAt"), paymentMethod: text(raw.paymentMethod, "payment.paymentMethod", 80), actorId: access.actorId, origin: enumeration(raw.origin, origins, "payment.origin"), ...paymentOptionalText(raw, "payment"), allocation: choice, allocations,
  };
  return { snapshot: { ...ledger, version: ledger.version + 1, payments: [...ledger.payments, payment] }, payment, pendingAmountCents: pending - amountCents };
}

/** Reversal preserves original allocations/audit identity and reopens balances.
 * Caller must also enforce the business reversal policy; debts.pay is a minimum
 * capability check, not authorization for arbitrary deletion in persistence. */
export function voidDebtPayment(snapshot: unknown, value: unknown, accessValue: unknown): DebtLedgerSnapshot {
  const ledger = validateDebtLedger(snapshot);
  const access = parseAccess(accessValue);
  const raw = object(value, [...scopeKeys, "paymentId", "currency", "expectedVersion", "voidedAt", "reason"], "voidPayment");
  checkOperation(raw, ledger, access);
  const id = identifier(raw.paymentId, "voidPayment.paymentId");
  const payment = ledger.payments.find((record) => record.id === id);
  if (!payment) fail("payment_not_found", "voidPayment.paymentId");
  if (payment.voided) fail("payment_already_voided", "voidPayment.paymentId");
  const voided = { voidedAt: civilDate(raw.voidedAt, "voidPayment.voidedAt"), actorId: access.actorId, reason: text(raw.reason, "voidPayment.reason", 1000) };
  if (voided.voidedAt < payment.paidAt) fail("void_before_payment", "voidPayment.voidedAt");
  return { ...ledger, version: ledger.version + 1, payments: ledger.payments.map((record) => record.id === id ? { ...record, voided } : record) };
}

/** Administrative closure preserves every amount, allocation and payment.
 * The original unpaid balance remains historical; no money is paid or forgiven. */
export function cancelDebtRecord(snapshot: unknown, value: unknown, accessValue: unknown): DebtLedgerSnapshot {
  const ledger = validateDebtLedger(snapshot);
  const access = parseAccess(accessValue);
  checkAccess(ledger, access, "debts.create");
  const raw = object(value, [...scopeKeys, "expectedVersion", "cancelledAt", "reason"], "cancellation");
  sameScope(readScope(raw, "cancellation"), ledger, "cancellation");
  if (integer(raw.expectedVersion, "cancellation.expectedVersion", 0) !== ledger.version) fail("stale_version", "cancellation.expectedVersion");
  if (ledger.cancelled) fail("debt_cancelled", "ledger.cancelled");
  if (ledger.version === Number.MAX_SAFE_INTEGER) fail("version_overflow", "ledger.version");
  return { ...ledger, version: ledger.version + 1, cancelled: { cancelledAt: civilDate(raw.cancelledAt, "cancellation.cancelledAt"), actorId: access.actorId, reason: text(raw.reason, "cancellation.reason", 1000) } };
}

function project(ledger: DebtLedgerSnapshot, asOfDate: string): DebtProjection {
  const paid = paidByInstallment(ledger);
  const start = dateAt(asOfDate).getTime();
  const installments: InstallmentProjection[] = ledger.installments.map((part) => {
    const paidAmountCents = paid.get(part.id) ?? 0;
    const pendingAmountCents = part.totalAmountCents - paidAmountCents;
    const status: InstallmentStatus = pendingAmountCents === 0 ? "paid" : part.dueDate !== null && part.dueDate < asOfDate ? "overdue" : paidAmountCents > 0 ? "partial" : "pending";
    return { ...part, paidAmountCents, pendingAmountCents, status };
  }).sort((a, b) => a.installmentNumber - b.installmentNumber);
  const owing = installments.filter((part) => part.pendingAmountCents > 0);
  const amount = (predicate: (part: InstallmentProjection) => boolean) => sum(owing.filter(predicate).map((part) => part.pendingAmountCents), "projection");
  const upcoming = (days: number) => amount((part) => part.dueDate !== null && part.dueDate >= asOfDate && dateAt(part.dueDate).getTime() < start + days * 86_400_000);
  const paidAmountCents = sum([...paid.values()], "projection.paidAmountCents");
  const overdueAmountCents = amount((part) => part.dueDate !== null && part.dueDate < asOfDate);
  const pendingAmountCents = ledger.totalFinancedCents - paidAmountCents;
  const activeAmount = (value: number) => ledger.cancelled ? 0 : value;
  return {
    debtId: ledger.debtId, businessId: ledger.businessId, branchId: ledger.branchId, currency: ledger.currency, totalFinancedCents: ledger.totalFinancedCents, paidAmountCents, pendingAmountCents, overdueAmountCents: activeAmount(overdueAmountCents), unscheduledAmountCents: activeAmount(amount((part) => part.dueDate === null)), dueTodayCents: activeAmount(amount((part) => part.dueDate === asOfDate)), next7DaysCents: activeAmount(upcoming(7)), next30DaysCents: activeAmount(upcoming(30)), next60DaysCents: activeAmount(upcoming(60)), dueThisMonthCents: activeAmount(amount((part) => part.dueDate !== null && part.dueDate.slice(0, 7) === asOfDate.slice(0, 7))), paidInstallmentCount: installments.filter((part) => part.status === "paid").length, installmentCount: installments.length,
    status: ledger.cancelled ? "cancelled" : pendingAmountCents === 0 ? "paid" : overdueAmountCents > 0 ? "overdue" : paidAmountCents > 0 ? "partially_paid" : ledger.mode === "installments" ? "in_plan" : "pending",
    nextDueDate: ledger.cancelled ? null : owing.map((part) => part.dueDate).filter((date): date is string => date !== null).sort()[0] ?? null,
    installments,
  };
}

/**
 * Current balances projected against caller-supplied civil date in business timezone.
 * This is NOT historical accounting: payments are not filtered by their paidAt date.
 * Windows are [asOfDate, asOfDate + N days), include today, exclude overdue. Monthly
 * commitments include all unpaid dates in that month. Next due is earliest unpaid
 * dated installment (including overdue). Undated balances are reported separately.
 */
export function projectDebtCommitments(snapshot: unknown, asOfValue: unknown, accessValue: unknown): DebtProjection {
  const ledger = validateDebtLedger(snapshot);
  checkAccess(ledger, parseAccess(accessValue), "debts.view");
  return project(ledger, civilDate(asOfValue, "asOfDate"));
}

/** One business and explicitly selected currency only; optional branch filtering. */
export function projectDebtPortfolio(snapshots: unknown, optionsValue: unknown, accessValue: unknown): {
  currency: string; asOfDate: string; debtCount: number; pendingAmountCents: number; paidAmountCents: number; overdueAmountCents: number; unscheduledAmountCents: number; dueTodayCents: number; next7DaysCents: number; next30DaysCents: number; next60DaysCents: number; dueThisMonthCents: number; debts: DebtProjection[];
} {
  const options = object(optionsValue, ["currency", "asOfDate", "branchId"], "options");
  const selectedCurrency = currency(options.currency, "options.currency");
  const asOfDate = civilDate(options.asOfDate, "options.asOfDate");
  const branchId = own(options, "branchId") ? options.branchId === null ? null : identifier(options.branchId, "options.branchId") : undefined;
  const access = parseAccess(accessValue);
  if (!access.permissions.includes("debts.view")) fail("permission_denied", "debts.view");
  if (branchId !== undefined && access.branchIds !== null && (branchId === null || !access.branchIds.includes(branchId))) fail("branch_forbidden", "options.branchId");
  const ledgers = list(snapshots, "ledgers", 100_000).map(validateDebtLedger);
  const ids = new Set<string>();
  for (const ledger of ledgers) {
    if (ledger.businessId !== access.businessId) fail("business_mismatch", "ledgers");
    if (ids.has(ledger.debtId)) fail("duplicate_debt", "ledgers");
    ids.add(ledger.debtId);
  }
  const debts = ledgers.filter((ledger) => !ledger.cancelled && ledger.currency === selectedCurrency && (branchId === undefined || ledger.branchId === branchId) && (access.branchIds === null || ledger.branchId !== null && access.branchIds.includes(ledger.branchId))).map((ledger) => project(ledger, asOfDate));
  const aggregate = (key: "pendingAmountCents" | "paidAmountCents" | "overdueAmountCents" | "unscheduledAmountCents" | "dueTodayCents" | "next7DaysCents" | "next30DaysCents" | "next60DaysCents" | "dueThisMonthCents") => sum(debts.map((debt) => debt[key]), `portfolio.${key}`);
  return { currency: selectedCurrency, asOfDate, debtCount: debts.length, pendingAmountCents: aggregate("pendingAmountCents"), paidAmountCents: aggregate("paidAmountCents"), overdueAmountCents: aggregate("overdueAmountCents"), unscheduledAmountCents: aggregate("unscheduledAmountCents"), dueTodayCents: aggregate("dueTodayCents"), next7DaysCents: aggregate("next7DaysCents"), next30DaysCents: aggregate("next30DaysCents"), next60DaysCents: aggregate("next60DaysCents"), dueThisMonthCents: aggregate("dueThisMonthCents"), debts };
}
