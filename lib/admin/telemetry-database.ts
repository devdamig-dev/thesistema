import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { getCurrentUserContext } from "@/lib/data/auth";
import {
  getTelemetryDaily as getLegacyTelemetryDaily,
  getTelemetryEvents as getLegacyTelemetryEvents,
  getTelemetryMetrics as getLegacyTelemetryMetrics,
  type TelemetryDaily,
  type TelemetryEventRow,
  type TelemetryEventsFilters,
  type TelemetryMetrics,
  type TelemetryRange,
} from "./telemetry";

export type {
  TelemetryDaily,
  TelemetryEventRow,
  TelemetryEventsFilters,
  TelemetryMetrics,
  TelemetryRange,
} from "./telemetry";

function rangeStartDate(range: TelemetryRange): Date {
  const now = new Date();
  if (range === "24h") return new Date(now.getTime() - 24 * 3_600_000);
  if (range === "7d") return new Date(now.getTime() - 7 * 86_400_000);
  return new Date(now.getTime() - 30 * 86_400_000);
}

function emptyMetrics(): TelemetryMetrics {
  return {
    whatsappReceived: 0,
    aiProcessed: 0,
    aiApproved: 0,
    aiRejected: 0,
    aiLowConfidence: 0,
    invoicesUploaded: 0,
    invoicesOcrProcessed: 0,
    invoicesApproved: 0,
    ocrErrors: 0,
    aiErrors: 0,
    avgApprovalMinutes: null,
    activeUsers: 0,
    exportsDownloaded: 0,
    notificationsGenerated: 0,
    emailsSent: 0,
    webhookErrors: 0,
    rateLimitTriggered: 0,
  };
}

function emptyDaily(): TelemetryDaily {
  return {
    activityByDay: [],
    messagesByChannel: [],
    approvalsBreakdown: [
      { name: "Aprobadas", value: 0, tone: "success" },
      { name: "Baja confianza", value: 0, tone: "warn" },
      { name: "Rechazadas", value: 0, tone: "danger" },
    ],
    errorsByModule: [],
    usageByUser: [],
  };
}

function isErrorAction(action: string): boolean {
  return (
    action.endsWith(".error") ||
    action.endsWith(".failed") ||
    action === "permission.denied" ||
    action === "webhook.error" ||
    action === "email.failed"
  );
}

function isWarnAction(action: string): boolean {
  return (
    action.endsWith(".needs_review") ||
    action.endsWith(".rejected") ||
    action.endsWith(".low_confidence") ||
    action === "rate_limit.triggered"
  );
}

function statusForAction(action: string): "ok" | "error" | "warn" {
  if (isErrorAction(action)) return "error";
  if (isWarnAction(action)) return "warn";
  return "ok";
}

async function databaseContext(): Promise<{ db: any; businessId: string } | null> {
  const ctx = await getCurrentUserContext();
  if (!ctx.isAuthenticated || !ctx.businessId) return null;
  return { db: createSupabaseAdminClient() as any, businessId: ctx.businessId };
}

async function businessInvoiceIds(db: any, businessId: string, since: string): Promise<string[]> {
  const res = await db
    .from("invoices")
    .select("id")
    .eq("business_id", businessId)
    .gte("created_at", since)
    .limit(5000);
  if (res.error) return [];
  return ((res.data ?? []) as { id: string }[]).map((row) => row.id);
}

export async function getTelemetryMetrics(range: TelemetryRange): Promise<TelemetryMetrics> {
  if (!isDatabaseMode()) return getLegacyTelemetryMetrics(range);

  try {
    const context = await databaseContext();
    if (!context) return emptyMetrics();
    const { db, businessId } = context;
    const since = rangeStartDate(range).toISOString();

    const headCount = async (table: string, mutate?: (q: any) => any) => {
      let q = db
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gte("created_at", since);
      if (mutate) q = mutate(q);
      const res = await q;
      return res.error ? 0 : ((res.count as number | null) ?? 0);
    };

    const [
      whatsappReceived,
      aiProcessed,
      aiApproved,
      aiRejected,
      aiLowConfidence,
      invoicesUploaded,
      invoicesOcrProcessed,
      invoicesApproved,
      notificationsGenerated,
    ] = await Promise.all([
      headCount("whatsapp_messages"),
      headCount("ai_extractions"),
      headCount("ai_extractions", (q) => q.eq("status", "approved")),
      headCount("ai_extractions", (q) => q.eq("status", "rejected")),
      headCount("ai_extractions", (q) => q.lt("confidence", 0.7)),
      headCount("invoices"),
      headCount("invoices", (q) =>
        q.in("status", ["extracted", "needs_review", "approved", "rejected", "sent_to_accountant"]),
      ),
      headCount("invoices", (q) => q.in("status", ["approved", "sent_to_accountant"])),
      headCount("notifications"),
    ]);

    const invoiceIds = await businessInvoiceIds(db, businessId, since);
    let ocrErrors = 0;
    let aiErrors = 0;
    if (invoiceIds.length) {
      const [ocrRes, aiRes] = await Promise.all([
        db
          .from("invoice_processing_logs")
          .select("id", { count: "exact", head: true })
          .in("invoice_id", invoiceIds)
          .gte("created_at", since)
          .eq("stage", "ocr")
          .eq("ok", false),
        db
          .from("invoice_processing_logs")
          .select("id", { count: "exact", head: true })
          .in("invoice_id", invoiceIds)
          .gte("created_at", since)
          .eq("stage", "ai")
          .eq("ok", false),
      ]);
      ocrErrors = ocrRes.error ? 0 : ((ocrRes.count as number | null) ?? 0);
      aiErrors = aiRes.error ? 0 : ((aiRes.count as number | null) ?? 0);
    }

    const timeRes = await db
      .from("invoices")
      .select("processing_started_at, processing_completed_at")
      .eq("business_id", businessId)
      .gte("created_at", since)
      .not("processing_started_at", "is", null)
      .not("processing_completed_at", "is", null)
      .limit(500);
    const durations = ((timeRes.data ?? []) as {
      processing_started_at: string;
      processing_completed_at: string;
    }[])
      .map((row) =>
        (new Date(row.processing_completed_at).getTime() - new Date(row.processing_started_at).getTime()) /
        60_000,
      )
      .filter((minutes) => Number.isFinite(minutes) && minutes >= 0);
    const avgApprovalMinutes = durations.length
      ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10
      : null;

    const activityRes = await db
      .from("activity_logs")
      .select("actor_id, actor_name, action")
      .eq("business_id", businessId)
      .gte("created_at", since)
      .limit(5000);
    const activityRows = (activityRes.data ?? []) as {
      actor_id: string | null;
      actor_name: string | null;
      action: string;
    }[];

    const activeUsers = new Set(
      activityRows
        .filter((row) => row.actor_name !== "Sistema")
        .map((row) => row.actor_id ?? row.actor_name)
        .filter(Boolean),
    ).size;
    const countActions = (predicate: (action: string) => boolean) =>
      activityRows.filter((row) => predicate(row.action)).length;

    return {
      whatsappReceived,
      aiProcessed,
      aiApproved,
      aiRejected,
      aiLowConfidence,
      invoicesUploaded,
      invoicesOcrProcessed,
      invoicesApproved,
      ocrErrors,
      aiErrors,
      avgApprovalMinutes,
      activeUsers,
      exportsDownloaded: countActions((action) => action.endsWith(".exported")),
      notificationsGenerated,
      emailsSent: countActions((action) => action === "email.sent" || action === "digest.sent"),
      webhookErrors: countActions((action) => action === "webhook.error"),
      rateLimitTriggered: countActions((action) => action === "rate_limit.triggered"),
    };
  } catch {
    return emptyMetrics();
  }
}

export async function getTelemetryDaily(range: TelemetryRange): Promise<TelemetryDaily> {
  if (!isDatabaseMode()) return getLegacyTelemetryDaily(range);

  try {
    const context = await databaseContext();
    if (!context) return emptyDaily();
    const { db, businessId } = context;
    const since = rangeStartDate(range).toISOString();

    const [activityRes, messagesRes, extractionsRes] = await Promise.all([
      db
        .from("activity_logs")
        .select("created_at, actor_name, actor_role, action, target_type")
        .eq("business_id", businessId)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(5000),
      db
        .from("whatsapp_messages")
        .select("channel")
        .eq("business_id", businessId)
        .gte("created_at", since)
        .limit(5000),
      db
        .from("ai_extractions")
        .select("status, confidence")
        .eq("business_id", businessId)
        .gte("created_at", since)
        .limit(5000),
    ]);

    const activityRows = (activityRes.data ?? []) as {
      created_at: string;
      actor_name: string | null;
      actor_role: string | null;
      action: string;
      target_type: string | null;
    }[];
    const messages = (messagesRes.data ?? []) as { channel: string }[];
    const extractions = (extractionsRes.data ?? []) as { status: string; confidence: number | null }[];

    const byDay = new Map<string, number>();
    for (const row of activityRows) {
      const day = row.created_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }

    const byChannel = new Map<string, number>();
    for (const row of messages) byChannel.set(row.channel, (byChannel.get(row.channel) ?? 0) + 1);

    const approved = extractions.filter((row) => row.status === "approved").length;
    const rejected = extractions.filter((row) => row.status === "rejected").length;
    const lowConfidence = extractions.filter(
      (row) => row.status !== "rejected" && Number(row.confidence ?? 0) < 0.7,
    ).length;

    const errors = new Map<string, number>();
    for (const row of activityRows.filter((item) => isErrorAction(item.action))) {
      const moduleName = row.target_type ?? row.action.split(".")[0] ?? "system";
      errors.set(moduleName, (errors.get(moduleName) ?? 0) + 1);
    }

    const usage = new Map<string, { role: string; count: number }>();
    for (const row of activityRows) {
      const user = row.actor_name ?? "Sistema";
      const current = usage.get(user) ?? { role: row.actor_role ?? "system", count: 0 };
      current.count += 1;
      usage.set(user, current);
    }

    return {
      activityByDay: [...byDay.entries()].map(([day, count]) => ({ day: day.slice(5), count })),
      messagesByChannel: [...byChannel.entries()].map(([channel, count]) => ({ channel, count })),
      approvalsBreakdown: [
        { name: "Aprobadas", value: approved, tone: "success" },
        { name: "Baja confianza", value: lowConfidence, tone: "warn" },
        { name: "Rechazadas", value: rejected, tone: "danger" },
      ],
      errorsByModule: [...errors.entries()]
        .map(([moduleName, count]) => ({ module: moduleName, count }))
        .sort((a, b) => b.count - a.count),
      usageByUser: [...usage.entries()]
        .map(([user, value]) => ({ user, role: value.role, count: value.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  } catch {
    return emptyDaily();
  }
}

export async function getTelemetryEvents(
  filters: TelemetryEventsFilters,
): Promise<TelemetryEventRow[]> {
  if (!isDatabaseMode()) return getLegacyTelemetryEvents(filters);

  try {
    const context = await databaseContext();
    if (!context) return [];
    const { db, businessId } = context;
    const since = rangeStartDate(filters.range).toISOString();

    let query = db
      .from("activity_logs")
      .select("id, created_at, actor_name, actor_role, target_type, action, summary, data")
      .eq("business_id", businessId)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(Math.min(filters.limit ?? 200, 500));

    if (filters.module) query = query.eq("target_type", filters.module);
    if (filters.user) query = query.eq("actor_name", filters.user);

    const res = await query;
    if (res.error) return [];

    let rows = ((res.data ?? []) as {
      id: string;
      created_at: string;
      actor_name: string | null;
      actor_role: string | null;
      target_type: string | null;
      action: string;
      summary: string;
      data: Record<string, unknown> | null;
    }[]).map((row): TelemetryEventRow => {
      const errorValue = row.data?.error;
      return {
        id: row.id,
        createdAt: row.created_at,
        actorName: row.actor_name,
        actorRole: row.actor_role,
        module: row.target_type,
        action: row.action,
        summary: row.summary,
        status: statusForAction(row.action),
        error: typeof errorValue === "string" ? errorValue : null,
      };
    });

    if (filters.status) rows = rows.filter((row) => row.status === filters.status);
    if (filters.q) {
      const needle = filters.q.toLowerCase();
      rows = rows.filter((row) =>
        [row.summary, row.action, row.actorName, row.module]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle)),
      );
    }

    return rows;
  } catch {
    return [];
  }
}
