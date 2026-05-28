"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { assertPermission } from "@/lib/permissions/server-action";
import { createNotification } from "@/lib/data/notifications";
import { logActivity } from "@/lib/data/activity";

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
  category?: "supplier" | "tax" | "loan" | "rent" | "utility" | "payroll" | "other";
  period?: string;
  organism?: string;
}): Promise<Result> {
  const guard = await assertPermission("debts.create");
  if (guard) return guard;
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
      category: payload.category ?? "supplier",
      period: payload.period,
      organism: payload.organism,
    })
    .select("id")
    .maybeSingle();
  const row = res.data as { id: string } | null;
  if (!row) {
    return { ok: false, persisted: false, error: res.error?.message ?? "insert_failed" };
  }
  await logActivity({
    businessId,
    action: "debt.created",
    targetType: "debts",
    targetId: row.id,
    summary: `Deuda nueva · ${payload.creditor} · $${payload.original_amount.toLocaleString("es-AR")}`,
    data: payload as any,
  });
  await createNotification({
    businessId,
    tone: "info",
    priority: "medium",
    category: "debt",
    title: `Nueva deuda · ${payload.creditor}`,
    detail: `$${payload.original_amount.toLocaleString("es-AR")}${payload.due_date ? ` · vence ${payload.due_date}` : ""}`,
    href: "/deudas",
    source: "debts",
  });
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
  const guard = await assertPermission("debts.pay");
  if (guard) return guard;
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

  // Re-leer deuda para ver si quedó saldada (trigger SQL recalcula)
  const debtRes = await db
    .from("debts")
    .select("business_id, creditor, pending_amount, status")
    .eq("id", payload.debt_id)
    .maybeSingle();
  const debt = debtRes.data as
    | { business_id: string; creditor: string; pending_amount: number; status: string }
    | null;
  if (debt) {
    const settled = debt.status === "settled" || Number(debt.pending_amount) <= 0;
    await logActivity({
      businessId: debt.business_id,
      action: settled ? "debt.settled" : "debt.payment.registered",
      targetType: "debt_payments",
      targetId: row.id,
      summary: settled
        ? `Deuda saldada · ${debt.creditor}`
        : `Pago parcial · ${debt.creditor} · $${payload.amount.toLocaleString("es-AR")}`,
      data: { debt_id: payload.debt_id, payment_id: row.id, amount: payload.amount },
    });
    await createNotification({
      businessId: debt.business_id,
      tone: settled ? "success" : "info",
      priority: settled ? "low" : "medium",
      category: "debt",
      title: settled ? `Deuda saldada · ${debt.creditor}` : `Pago registrado · ${debt.creditor}`,
      detail: settled
        ? "Felicitaciones · la deuda quedó cancelada."
        : `Pago parcial de $${payload.amount.toLocaleString("es-AR")}. Saldo pendiente: $${Number(debt.pending_amount).toLocaleString("es-AR")}.`,
      href: "/deudas",
      source: "debts",
    });
  }

  refresh();
  return { ok: true, persisted: true, payment_id: row.id };
}

/* ============================================================================
   Marcar como saldada (manual)
   ============================================================================ */

export async function markDebtAsSettledAction(debtId: string): Promise<Result> {
  const guard = await assertPermission("debts.pay");
  if (guard) return guard;
  if (!isDatabaseMode()) {
    refresh();
    return { ok: true, persisted: false };
  }
  const supabase = createSupabaseServerClient();
  if (!supabase) return { ok: true, persisted: false };
  const db = supabase as any;

  // Leer info antes para la notificación
  const debtRes = await db
    .from("debts")
    .select("business_id, creditor")
    .eq("id", debtId)
    .maybeSingle();
  const debt = debtRes.data as { business_id: string; creditor: string } | null;

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

  if (debt) {
    await logActivity({
      businessId: debt.business_id,
      action: "debt.settled.manual",
      targetType: "debts",
      targetId: debtId,
      summary: `Deuda marcada como saldada · ${debt.creditor}`,
    });
    await createNotification({
      businessId: debt.business_id,
      tone: "success",
      priority: "low",
      category: "debt",
      title: `Deuda saldada · ${debt.creditor}`,
      detail: "Marcada manualmente como saldada.",
      href: "/deudas",
      source: "debts",
    });
  }

  refresh();
  return { ok: true, persisted: true };
}
