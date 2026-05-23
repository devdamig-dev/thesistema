"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";

type Result =
  | { ok: true; persisted: boolean; debt_id?: string; payment_id?: string }
  | { ok: false; persisted: false; error: string };

async function resolveBusinessId(db: any): Promise<string | null> {
  const res = await db
    .from("business_members")
    .select("business_id")
    .limit(1)
    .maybeSingle();
  return (res.data as { business_id: string } | null)?.business_id ?? null;
}

function refresh() {
  revalidatePath("/deudas");
  revalidatePath("/balances");
}

/* ============================================================================
   Registrar deuda
   ============================================================================ */

export async function registerDebtAction(payload: {
  creditor: string;
  concept?: string;
  original_amount: number;
  due_date?: string; // ISO yyyy-mm-dd
  interest_rate?: number;
  notes?: string;
}): Promise<Result> {
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;
  const businessId = await resolveBusinessId(db);
  if (!businessId) return { ok: false, persisted: false, error: "no_business" };

  const res = await db
    .from("debts")
    .insert({
      business_id: businessId,
      creditor: payload.creditor,
      concept: payload.concept,
      original_amount: payload.original_amount,
      pending_amount: payload.original_amount,
      due_date: payload.due_date,
      interest_rate: payload.interest_rate,
      notes: payload.notes,
    })
    .select("id")
    .maybeSingle();
  const row = res.data as { id: string } | null;
  if (!row) {
    return { ok: false, persisted: false, error: res.error?.message ?? "insert_failed" };
  }
  refresh();
  return { ok: true, persisted: true, debt_id: row.id };
}

/* ============================================================================
   Registrar pago
   ============================================================================ */

export async function registerPaymentAction(payload: {
  debt_id: string;
  amount: number;
  payment_method?: string;
  paid_at?: string;
  notes?: string;
}): Promise<Result> {
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;

  const res = await db
    .from("debt_payments")
    .insert({
      debt_id: payload.debt_id,
      amount: payload.amount,
      payment_method: payload.payment_method ?? "Transferencia",
      paid_at: payload.paid_at ?? new Date().toISOString().slice(0, 10),
      notes: payload.notes,
    })
    .select("id")
    .maybeSingle();
  const row = res.data as { id: string } | null;
  if (!row) {
    return { ok: false, persisted: false, error: res.error?.message ?? "insert_failed" };
  }
  refresh();
  return { ok: true, persisted: true, payment_id: row.id };
}

/* ============================================================================
   Marcar como saldada (manual)
   ============================================================================ */

export async function markDebtAsSettledAction(debtId: string): Promise<Result> {
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;

  const { error } = await db
    .from("debts")
    .update({
      status: "settled",
      pending_amount: 0,
      settled_at: new Date().toISOString().slice(0, 10),
    })
    .eq("id", debtId);
  if (error) {
    return { ok: false, persisted: false, error: error.message };
  }
  refresh();
  return { ok: true, persisted: true };
}
