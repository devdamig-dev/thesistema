export type ExpenseStatus = "pending" | "scheduled" | "paid";
export type ExpensePeriodicity = "daily" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "semiannual" | "yearly";
export type ExpenseOperatingFields = { expenseDate: string | null; paymentMethod: string | null; supplierId: string | null; isRecurring: boolean | null; periodicity: ExpensePeriodicity | null };
// Optional as a group only: old durable attempts must retain their exact payload.
export type SaveExpenseInput = Partial<ExpenseOperatingFields> & {
  requestId: string; businessId: string; userId: string; id: string | null; expectedVersion: number | null;
  branchId: string; name: string; category: string; amount: string; dueDate: string | null; status: ExpenseStatus;
};
export type ChangeExpenseStateInput = { requestId: string; businessId: string; userId: string; id: string; expectedVersion: number; reason: string };
export type ExpenseResult = { ok: true; persisted: true; expenseId: string; version: number } | { ok: false; persisted: false | "unknown"; error: string };
export type ExpenseOperation = { kind: "save"; input: SaveExpenseInput } | { kind: "void" | "restore"; input: ChangeExpenseStateInput };
export type ExpenseSnapshot = { name: string; category: string; amount: string | number; status: string; branch_id: string; due_date: string | null; record_status: string; version: number; void_reason: string | null; expense_date?: string | null; payment_method?: string | null; supplier_id?: string | null; is_recurring?: boolean | null; periodicity?: ExpensePeriodicity | null };
export type ExpenseMutation = { request_id: string; source: string; operation: string; actor_role: string; created_at: string; before_snapshot: ExpenseSnapshot | null; after_snapshot: ExpenseSnapshot; payload: { input: { reason?: string } } };
