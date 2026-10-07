"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { assertPermission } from "@/lib/permissions/server-action";
import { createNotification } from "@/lib/data/notifications";
import { logActivity } from "@/lib/data/activity";
import { getCurrentUserContext } from "@/lib/data/auth";

type Result =
  | { ok: true; persisted: boolean; debt_id?: string; payment_id?: string }
  | { ok: false; persisted: false; error: string };

function refresh() {
  revalidatePath("/deudas");
  revalidatePath("/balances");
}

/* ============================================================================
   Registrar deuda
   ============================================================================ */

export async function registerDebtAction(payload: {
  branch_id: string;
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
  if (!supabase) {
    return {
      ok: false,
      persisted: false,
      error: "No pudimos conectar con la información financiera del negocio.",
    };
  }
  const db = supabase as any;
  const ctx = await getCurrentUserContext();
  const businessId = ctx.businessId;
  if (!businessId) return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };
  if (!payload.branch_id) return { ok: false, persisted: false, error: "Elegí una sucursal." };
  if (ctx.assignedBranchIds !== null && !ctx.assignedBranchIds.includes(payload.branch_id)) {
    return { ok: false, persisted: false, error: "La sucursal seleccionada no está asignada a tu usuario." };
  }
  const branchRes = await db.from("branches").select("id").eq("id", payload.branch_id).eq("business_id", businessId).maybeSingle();
  if (branchRes.error || !branchRes.data?.id) {
    return { ok: false, persisted: false, error: "La sucursal seleccionada no está disponible." };
  }

  const creditor = payload.creditor.trim();
  const originalAmount = Number(payload.original_amount);
  const interestRate = payload.interest_rate == null ? undefined : Number(payload.interest_rate);
  if (!creditor) return { ok: false, persisted: false, error: "Ingresá el acreedor." };
  if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
    return { ok: false, persisted: false, error: "Ingresá un monto mayor a cero." };
  }
  if (interestRate != null && (!Number.isFinite(interestRate) || interestRate < 0)) {
    return { ok: false, persisted: false, error: "El interés no puede ser negativo." };
  }

  const res = await db
    .from("debts")
    .insert({
      business_id: businessId,
      branch_id: payload.branch_id,
      creditor,
      concept: payload.concept?.trim() || undefined,
      original_amount: originalAmount,
      pending_amount: originalAmount,
      due_date: payload.due_date || undefined,
      interest_rate: interestRate,
      notes: payload.notes?.trim() || undefined,
      category: payload.category ?? "supplier",
      period: payload.period?.trim() || undefined,
      organism: payload.organism?.trim() || undefined,
      created_by: ctx.userId,
    })
    .select("id")
    .maybeSingle();
  const row = res.data as { id: string } | null;
  if (!row) {
    return { ok: false, persisted: false, error: res.error?.message ?? "No pudimos registrar la deuda." };
  }
  await logActivity({
    businessId,
    action: "debt.created",
    targetType: "debts",
    targetId: row.id,
    summary: `Deuda nueva · ${creditor} · $${originalAmount.toLocaleString("es-AR")}`,
    data: payload as any,
  });
  await createNotification({
    businessId,
    tone: "info",
    priority: "medium",
    category: "debt",
    title: `Nueva deuda · ${creditor}`,
    detail: `$${originalAmount.toLocaleString("es-AR")}${payload.due_date ? ` · vence ${payload.due_date}` : ""}`,
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
  if (!supabase) {
    return {
      ok: false,
      persisted: false,
      error: "No pudimos conectar con la información financiera del negocio.",
    };
  }
  const db = supabase as any;

  const amount = Number(payload.amount);
  if (!payload.debt_id) return { ok: false, persisted: false, error: "No pudimos identificar la deuda." };
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, persisted: false, error: "Ingresá un monto de pago mayor a cero." };
  }

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId || !ctx.userId) {
    return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };
  }
  const paymentRes = await db.rpc("register_debt_payment_atomic", {
    p_debt_id: payload.debt_id,
    p_business_id: ctx.businessId,
    p_actor_id: ctx.userId,
    p_amount: amount,
    p_payment_method: payload.payment_method?.trim() || "Transferencia",
    p_paid_at: payload.paid_at ?? new Date().toISOString().slice(0, 10),
    p_notes: payload.notes?.trim() || null,
  });
  const payment = paymentRes.data as {
    ok: boolean;
    error?: string;
    payment_id?: string;
    creditor?: string;
    pending_amount?: number;
    status?: string;
  } | null;
  if (paymentRes.error || !payment?.ok || !payment.payment_id) {
    const messages: Record<string, string> = {
      debt_not_found: "No encontramos la deuda seleccionada.",
      debt_already_settled: "La deuda ya está saldada.",
      amount_exceeds_pending: "El pago no puede superar el saldo pendiente.",
      invalid_paid_at: "La fecha del pago no es válida.",
      permission_denied: "No tenés permiso para registrar este pago.",
    };
    return { ok: false, persisted: false, error: messages[payment?.error ?? ""] ?? "No pudimos registrar el pago." };
  }

  const settled = payment.status === "settled" || Number(payment.pending_amount) <= 0;
  const creditor = payment.creditor ?? "Acreedor";
  await logActivity({
    businessId: ctx.businessId,
    action: settled ? "debt.settled" : "debt.payment.registered",
    targetType: "debt_payments",
    targetId: payment.payment_id,
    summary: settled
      ? `Deuda saldada · ${creditor}`
      : `Pago parcial · ${creditor} · $${amount.toLocaleString("es-AR")}`,
    data: { debt_id: payload.debt_id, payment_id: payment.payment_id, amount },
  });
  await createNotification({
    businessId: ctx.businessId,
    tone: settled ? "success" : "info",
    priority: settled ? "low" : "medium",
    category: "debt",
    title: settled ? `Deuda saldada · ${creditor}` : `Pago registrado · ${creditor}`,
    detail: settled
      ? "Felicitaciones · la deuda quedó cancelada."
      : `Pago parcial de $${amount.toLocaleString("es-AR")}. Saldo pendiente: $${Number(payment.pending_amount).toLocaleString("es-AR")}.`,
    href: "/deudas",
    source: "debts",
  });

  refresh();
  return { ok: true, persisted: true, payment_id: payment.payment_id };
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
  if (!supabase) {
    return {
      ok: false,
      persisted: false,
      error: "No pudimos conectar con la información financiera del negocio.",
    };
  }
  const db = supabase as any;
  const ctx = await getCurrentUserContext();
  if (!ctx.businessId || !ctx.userId) {
    return { ok: false, persisted: false, error: "No pudimos identificar el negocio activo." };
  }

  const settlementRes = await db.rpc("settle_debt_atomic", {
    p_debt_id: debtId,
    p_business_id: ctx.businessId,
    p_actor_id: ctx.userId,
    p_paid_at: new Date().toISOString().slice(0, 10),
    p_notes: "Cancelación manual confirmada desde Deudas",
  });
  const settlement = settlementRes.data as {
    ok: boolean;
    error?: string;
    payment_id?: string;
    creditor?: string;
    amount?: number;
  } | null;
  if (settlementRes.error || !settlement?.ok || !settlement.payment_id) {
    const messages: Record<string, string> = {
      debt_not_found: "No encontramos la deuda seleccionada.",
      debt_already_settled: "La deuda ya está saldada.",
      concurrent_payment: "El saldo cambió mientras confirmabas. Revisalo e intentá nuevamente.",
      invalid_paid_at: "La fecha de cancelación no es válida.",
      permission_denied: "No tenés permiso para cancelar esta deuda.",
    };
    return { ok: false, persisted: false, error: messages[settlement?.error ?? ""] ?? "No pudimos cancelar la deuda." };
  }

  const creditor = settlement.creditor ?? "Acreedor";
  const amount = Number(settlement.amount ?? 0);
  await logActivity({
    businessId: ctx.businessId,
    action: "debt.settled.manual",
    targetType: "debt_payments",
    targetId: settlement.payment_id,
    summary: `Deuda saldada con ajuste manual · ${creditor} · $${amount.toLocaleString("es-AR")}`,
    data: { debt_id: debtId, payment_id: settlement.payment_id, amount, payment_method: "Ajuste manual" },
  });
  await createNotification({
    businessId: ctx.businessId,
    tone: "success",
    priority: "low",
    category: "debt",
    title: `Deuda saldada · ${creditor}`,
    detail: `Ajuste manual de $${amount.toLocaleString("es-AR")} registrado en el historial.`,
    href: "/deudas",
    source: "debts",
  });

  refresh();
  return { ok: true, persisted: true, payment_id: settlement.payment_id };
}
