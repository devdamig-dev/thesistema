export type ExpenseStatus = "pending" | "scheduled" | "paid";
export type SaveExpenseInput = {
  requestId: string; businessId: string; userId: string; id: string | null; expectedVersion: number | null;
  branchId: string; name: string; category: string; amount: string; dueDate: string | null; status: ExpenseStatus;
};
export type ChangeExpenseStateInput = { requestId: string; businessId: string; userId: string; id: string; expectedVersion: number; reason: string };
export type ExpenseResult = { ok: true; persisted: true; expenseId: string; version: number } | { ok: false; persisted: false | "unknown"; error: string };
export type ExpenseOperation = { kind: "save"; input: SaveExpenseInput } | { kind: "void" | "restore"; input: ChangeExpenseStateInput };
export type ExpenseSnapshot = { name: string; category: string; amount: string | number; status: string; branch_id: string; due_date: string | null; record_status: string; version: number; void_reason: string | null };
export type ExpenseMutation = { request_id: string; source: string; operation: string; actor_role: string; created_at: string; before_snapshot: ExpenseSnapshot | null; after_snapshot: ExpenseSnapshot; payload: { input: { reason?: string } } };
