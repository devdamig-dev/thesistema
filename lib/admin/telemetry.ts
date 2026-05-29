/**
 * Telemetría del piloto.
 *
 * Lee de `activity_logs`, `notifications`, `whatsapp_messages`,
 * `ai_extractions`, `invoices` e `invoice_processing_logs` para armar
 * tres bloques:
 *
 *   - `getTelemetryMetrics`  → 17 KPIs numéricos del rango.
 *   - `getTelemetryDaily`    → series para los 5 gráficos.
 *   - `getTelemetryEvents`   → tabla cruda con filtros + paginación.
 *
 * En demo mode todo devuelve datos plausibles a partir de los mocks
 * y del módulo de auditoría, para que el módulo `/admin/telemetria`
 * se pueda mostrar sin Supabase y sin romper la demo pública.
 */

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";

export type TelemetryRange = "24h" | "7d" | "30d";

export const RANGE_LABELS: Record<TelemetryRange, string> = {
  "24h": "Últimas 24 horas",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
};

function rangeStartDate(range: TelemetryRange): Date {
  const now = new Date();
  if (range === "24h") return new Date(now.getTime() - 24 * 3_600_000);
  if (range === "7d") return new Date(now.getTime() - 7 * 86_400_000);
  return new Date(now.getTime() - 30 * 86_400_000);
}

export type TelemetryMetrics = {
  // WhatsApp / IA
  whatsappReceived: number;
  aiProcessed: number;
  aiApproved: number;
  aiRejected: number;
  aiLowConfidence: number;
  // Facturas
  invoicesUploaded: number;
  invoicesOcrProcessed: number;
  invoicesApproved: number;
  ocrErrors: number;
  aiErrors: number;
  // Tiempos / usuarios
  avgApprovalMinutes: number | null;
  activeUsers: number;
  // Outputs
  exportsDownloaded: number;
  notificationsGenerated: number;
  emailsSent: number;
  webhookErrors: number;
  rateLimitTriggered: number;
};

export type TelemetryDaily = {
  /** Actividad agregada por día (UTC date string yyyy-mm-dd). */
  activityByDay: { day: string; count: number }[];
  /** Mensajes WA por canal. */
  messagesByChannel: { channel: string; count: number }[];
  /** Extracciones aprobadas vs rechazadas vs bajas. */
  approvalsBreakdown: { name: string; value: number; tone: "success" | "warn" | "danger" }[];
  /** Errores agrupados por módulo (target_type o stage). */
  errorsByModule: { module: string; count: number }[];
  /** Top usuarios por acciones registradas. */
  usageByUser: { user: string; role: string; count: number }[];
};

export type TelemetryEventRow = {
  id: string;
  createdAt: string;
  actorName: string | null;
  actorRole: string | null;
  module: string | null;
  action: string;
  summary: string;
  status: "ok" | "error" | "warn";
  error: string | null;
};

export type TelemetryEventsFilters = {
  range: TelemetryRange;
  module?: string | null;
  user?: string | null;
  status?: "ok" | "error" | "warn" | null;
  q?: string | null;
  limit?: number;
};

/* ============================================================================
   Helpers comunes
   ============================================================================ */

/** Acciones que consideramos "error" en el feed de auditoría. */
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

/* ============================================================================
   DEMO DATA — plausible y consistente con los KPIs de la demo
   ============================================================================ */

function demoMetrics(range: TelemetryRange): TelemetryMetrics {
  // Escalado lineal por rango.
  const k = range === "24h" ? 1 : range === "7d" ? 5 : 18;
  return {
    whatsappReceived: 24 * k,
    aiProcessed: 22 * k,
    aiApproved: 17 * k,
    aiRejected: 2 * k,
    aiLowConfidence: 3 * k,
    invoicesUploaded: 6 * k,
    invoicesOcrProcessed: 6 * k,
    invoicesApproved: 5 * k,
    ocrErrors: Math.max(0, Math.round(0.4 * k)),
    aiErrors: Math.max(0, Math.round(0.3 * k)),
    avgApprovalMinutes: 11,
    activeUsers: range === "24h" ? 3 : range === "7d" ? 5 : 6,
    exportsDownloaded: range === "24h" ? 1 : range === "7d" ? 4 : 12,
    notificationsGenerated: 9 * k,
    emailsSent: range === "24h" ? 1 : range === "7d" ? 6 : 24,
    webhookErrors: Math.max(0, Math.round(0.2 * k)),
    rateLimitTriggered: Math.max(0, Math.round(0.1 * k)),
  };
}

function demoDaily(range: TelemetryRange): TelemetryDaily {
  const days = range === "24h" ? 1 : range === "7d" ? 7 : 30;
  const activityByDay: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    // Curva con pico mid-week.
    const base = 14 + Math.round(Math.sin((i / days) * Math.PI * 2) * 7);
    const noise = ((i * 31) % 9) - 4;
    activityByDay.push({ day: iso.slice(5), count: Math.max(2, base + noise) });
  }
  return {
    activityByDay,
    messagesByChannel: [
      { channel: "text", count: 64 },
      { channel: "image", count: 18 },
      { channel: "audio", count: 11 },
      { channel: "document", count: 5 },
    ],
    approvalsBreakdown: [
      { name: "Aprobadas", value: 76, tone: "success" },
      { name: "Baja confianza", value: 14, tone: "warn" },
      { name: "Rechazadas", value: 8, tone: "danger" },
    ],
    errorsByModule: [
      { module: "ocr", count: 3 },
      { module: "ai", count: 2 },
      { module: "webhook", count: 1 },
      { module: "rate_limit", count: 1 },
    ],
    usageByUser: [
      { user: "Mateo Iglesias", role: "owner", count: 48 },
      { user: "Lucía Romero", role: "manager", count: 31 },
      { user: "Estudio Pérez", role: "accountant", count: 14 },
      { user: "Florencia Gil", role: "employee", count: 9 },
      { user: "Sistema", role: "system", count: 6 },
    ],
  };
}

const DEMO_EVENTS: TelemetryEventRow[] = [
  {
    id: "tdemo-1",
    createdAt: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    actorName: "Mateo Iglesias",
    actorRole: "owner",
    module: "invoices",
    action: "invoice.approved",
    summary: "Factura A-0004-00012845 aprobada · 1 ítem · purchase creada",
    status: "ok",
    error: null,
  },
  {
    id: "tdemo-2",
    createdAt: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
    actorName: "Lucía Romero",
    actorRole: "manager",
    module: "inbox",
    action: "inbox.purchase.approved",
    summary: "Compra 20kg carne · Don José · $180.000 aprobada desde Inbox",
    status: "ok",
    error: null,
  },
  {
    id: "tdemo-3",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 1.2).toISOString(),
    actorName: "Sistema",
    actorRole: "system",
    module: "ocr",
    action: "invoice.ocr.failed",
    summary: "OCR no devolvió texto · proveedor desconocido",
    status: "error",
    error: "ocr.empty_text",
  },
  {
    id: "tdemo-4",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2.4).toISOString(),
    actorName: "Sistema",
    actorRole: "system",
    module: "ai",
    action: "ai.extraction.low_confidence",
    summary: "Extracción IA con 41% confianza — necesita revisión",
    status: "warn",
    error: null,
  },
  {
    id: "tdemo-5",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 3.1).toISOString(),
    actorName: "Estudio Pérez",
    actorRole: "accountant",
    module: "exports",
    action: "purchases.exported",
    summary: "Exporte CSV compras · 18 filas",
    status: "ok",
    error: null,
  },
  {
    id: "tdemo-6",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5.7).toISOString(),
    actorName: "Sistema",
    actorRole: "system",
    module: "webhook",
    action: "webhook.error",
    summary: "Webhook WhatsApp falló · invalid_json",
    status: "error",
    error: "invalid_json",
  },
  {
    id: "tdemo-7",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(),
    actorName: "Mateo Iglesias",
    actorRole: "owner",
    module: "permission",
    action: "permission.denied",
    summary: "Acceso denegado a /marketing para rol accountant",
    status: "error",
    error: "forbidden",
  },
  {
    id: "tdemo-8",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 11).toISOString(),
    actorName: "Sistema",
    actorRole: "system",
    module: "email",
    action: "email.sent",
    summary: "Digest diario enviado a 2 destinatarios",
    status: "ok",
    error: null,
  },
  {
    id: "tdemo-9",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 13).toISOString(),
    actorName: "Sistema",
    actorRole: "system",
    module: "rate_limit",
    action: "rate_limit.triggered",
    summary: "Rate limit · webhook IP 200.x.x.x · 60/min",
    status: "warn",
    error: "rate_limited",
  },
  {
    id: "tdemo-10",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
    actorName: "Lucía Romero",
    actorRole: "manager",
    module: "debts",
    action: "debt.payment.registered",
    summary: "Pago parcial · Panadería La Espiga · $80.000",
    status: "ok",
    error: null,
  },
];

/* ============================================================================
   Real queries
   ============================================================================ */

export async function getTelemetryMetrics(range: TelemetryRange): Promise<TelemetryMetrics> {
  if (!isDatabaseMode()) return demoMetrics(range);

  try {
    const db = createSupabaseAdminClient() as any;
    const since = rangeStartDate(range).toISOString();

    // Conteos baratos vía head:true + count exact.
    const headCount = async (table: string, mut?: (q: any) => any) => {
      let q = db.from(table).select("id", { count: "exact", head: true }).gte("created_at", since);
      if (mut) q = mut(q);
      const res = await q;
      return (res.count as number) ?? 0;
    };

    const whatsappReceived = await headCount("whatsapp_messages");
    const aiProcessed = await headCount("ai_extractions");
    const aiApproved = await headCount("ai_extractions", (q) => q.eq("status", "approved"));
    const aiRejected = await headCount("ai_extractions", (q) => q.eq("status", "rejected"));
    const aiLowConfidence = await headCount("ai_extractions", (q) =>
      q.lt("confidence", 0.7),
    );

    const invoicesUploaded = await headCount("invoices");
    const invoicesOcrProcessed = await headCount("invoices", (q) =>
      q.in("status", ["extracted", "needs_review", "approved", "rejected", "sent_to_accountant"]),
    );
    const invoicesApproved = await headCount("invoices", (q) =>
      q.in("status", ["approved", "sent_to_accountant"]),
    );

    // Errores OCR / IA desde invoice_processing_logs (no tienen business RLS bypass acá; usamos admin).
    const ocrErrorsRes = await db
      .from("invoice_processing_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .eq("stage", "ocr")
      .eq("ok", false);
    const ocrErrors = (ocrErrorsRes.count as number) ?? 0;
    const aiErrorsRes = await db
      .from("invoice_processing_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since)
      .eq("stage", "ai")
      .eq("ok", false);
    const aiErrors = (aiErrorsRes.count as number) ?? 0;

    // Tiempo promedio de aprobación de factura — diff entre processing_completed_at y processing_started_at
    let avgApprovalMinutes: number | null = null;
    try {
      const timeRes = await db
        .from("invoices")
        .select("processing_started_at, processing_completed_at")
        .gte("created_at", since)
        .not("processing_started_at", "is", null)
        .not("processing_completed_at", "is", null)
        .limit(500);
      const rows = (timeRes.data as { processing_started_at: string; processing_completed_at: string }[]) ?? [];
      if (rows.length) {
        const diffs = rows.map(
          (r) =>
            (new Date(r.processing_completed_at).getTime() -
              new Date(r.processing_started_at).getTime()) /
            60_000,
        );
        avgApprovalMinutes = Math.round(diffs.reduce((s, n) => s + n, 0) / diffs.length);
      }
    } catch {}

    // Usuarios activos (distinct actor_id en activity_logs).
    let activeUsers = 0;
    try {
      const actRes = await db
        .from("activity_logs")
        .select("actor_id")
        .gte("created_at", since)
        .not("actor_id", "is", null)
        .limit(2000);
      const actors = new Set<string>();
      for (const r of (actRes.data as { actor_id: string }[]) ?? []) {
        if (r.actor_id) actors.add(r.actor_id);
      }
      activeUsers = actors.size;
    } catch {}

    // Activity-derived counters (exports, emails, webhook errors, rate limit).
    const actCount = async (mut: (q: any) => any) => {
      const res = await mut(
        db.from("activity_logs").select("id", { count: "exact", head: true }).gte("created_at", since),
      );
      return (res.count as number) ?? 0;
    };
    const exportsDownloaded = await actCount((q) => q.like("action", "%.exported"));
    const emailsSent = await actCount((q) => q.in("action", ["email.sent", "digest.sent"]));
    const webhookErrors = await actCount((q) => q.eq("action", "webhook.error"));
    const rateLimitTriggered = await actCount((q) => q.eq("action", "rate_limit.triggered"));

    const notificationsGeneratedRes = await db
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    const notificationsGenerated = (notificationsGeneratedRes.count as number) ?? 0;

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
      exportsDownloaded,
      notificationsGenerated,
      emailsSent,
      webhookErrors,
      rateLimitTriggered,
    };
  } catch (error: any) {
    console.error("[telemetry.metrics] failed:", error?.message);
    return demoMetrics(range);
  }
}

export async function getTelemetryDaily(range: TelemetryRange): Promise<TelemetryDaily> {
  if (!isDatabaseMode()) return demoDaily(range);
  try {
    const db = createSupabaseAdminClient() as any;
    const since = rangeStartDate(range).toISOString();

    // 1) Actividad por día — agrupamos en memoria.
    const actRes = await db
      .from("activity_logs")
      .select("created_at, actor_name, actor_role, action, target_type")
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(5000);
    const acts = (actRes.data as any[]) ?? [];

    const dayMap = new Map<string, number>();
    const userMap = new Map<string, { count: number; role: string }>();
    const errorByMod = new Map<string, number>();
    for (const a of acts) {
      const day = String(a.created_at).slice(5, 10); // mm-dd
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
      const u = a.actor_name ?? "—";
      const prev = userMap.get(u) ?? { count: 0, role: a.actor_role ?? "—" };
      userMap.set(u, { count: prev.count + 1, role: prev.role });
      if (isErrorAction(a.action)) {
        const mod = a.target_type ?? a.action.split(".")[0] ?? "otros";
        errorByMod.set(mod, (errorByMod.get(mod) ?? 0) + 1);
      }
    }

    const activityByDay = Array.from(dayMap, ([day, count]) => ({ day, count })).sort((a, b) =>
      a.day.localeCompare(b.day),
    );

    const usageByUser = Array.from(userMap, ([user, v]) => ({ user, role: v.role, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const errorsByModule = Array.from(errorByMod, ([module, count]) => ({ module, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // 2) Mensajes WA por canal.
    const chRes = await db
      .from("whatsapp_messages")
      .select("channel")
      .gte("created_at", since)
      .limit(5000);
    const chMap = new Map<string, number>();
    for (const r of (chRes.data as { channel: string }[]) ?? []) {
      chMap.set(r.channel, (chMap.get(r.channel) ?? 0) + 1);
    }
    const messagesByChannel = Array.from(chMap, ([channel, count]) => ({ channel, count }));

    // 3) Aprobados / rechazados / baja confianza.
    const apRes = await db
      .from("ai_extractions")
      .select("status, confidence")
      .gte("created_at", since)
      .limit(5000);
    const rows = (apRes.data as { status: string; confidence: number }[]) ?? [];
    let approved = 0;
    let rejected = 0;
    let low = 0;
    for (const r of rows) {
      if (r.status === "approved") approved++;
      else if (r.status === "rejected") rejected++;
      else if (Number(r.confidence) < 0.7) low++;
    }
    const approvalsBreakdown: TelemetryDaily["approvalsBreakdown"] = [
      { name: "Aprobadas", value: approved, tone: "success" },
      { name: "Baja confianza", value: low, tone: "warn" },
      { name: "Rechazadas", value: rejected, tone: "danger" },
    ];

    // Fallback a demo si las series están todas vacías.
    if (
      activityByDay.length === 0 &&
      messagesByChannel.length === 0 &&
      approved + rejected + low === 0
    ) {
      return demoDaily(range);
    }

    return {
      activityByDay: activityByDay.length ? activityByDay : demoDaily(range).activityByDay,
      messagesByChannel: messagesByChannel.length
        ? messagesByChannel
        : demoDaily(range).messagesByChannel,
      approvalsBreakdown,
      errorsByModule: errorsByModule.length ? errorsByModule : demoDaily(range).errorsByModule,
      usageByUser: usageByUser.length ? usageByUser : demoDaily(range).usageByUser,
    };
  } catch (error: any) {
    console.error("[telemetry.daily] failed:", error?.message);
    return demoDaily(range);
  }
}

export async function getTelemetryEvents(
  filters: TelemetryEventsFilters,
): Promise<TelemetryEventRow[]> {
  const limit = filters.limit ?? 200;
  const since = rangeStartDate(filters.range).toISOString();

  if (!isDatabaseMode()) {
    return DEMO_EVENTS.filter((e) => {
      if (filters.module && (e.module ?? "") !== filters.module) return false;
      if (filters.user && (e.actorName ?? "") !== filters.user) return false;
      if (filters.status && e.status !== filters.status) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (
          !e.summary.toLowerCase().includes(q) &&
          !e.action.toLowerCase().includes(q) &&
          !(e.actorName ?? "").toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return new Date(e.createdAt).toISOString() >= since;
    }).slice(0, limit);
  }

  try {
    const db = createSupabaseAdminClient() as any;
    let query = db
      .from("activity_logs")
      .select("id, created_at, actor_name, actor_role, action, target_type, summary, data")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (filters.module) query = query.eq("target_type", filters.module);
    if (filters.user) query = query.eq("actor_name", filters.user);
    if (filters.q) query = query.ilike("summary", `%${filters.q}%`);

    const res = await query;
    const rows = (res.data as any[]) ?? [];
    const mapped: TelemetryEventRow[] = rows.map((r) => {
      const status = statusForAction(r.action);
      const error =
        (r.data && (r.data.error || r.data.reason || r.data.code)) ||
        (status === "error" ? r.action.split(".").slice(-1)[0] : null);
      return {
        id: r.id,
        createdAt: r.created_at,
        actorName: r.actor_name,
        actorRole: r.actor_role,
        module: r.target_type,
        action: r.action,
        summary: r.summary,
        status,
        error,
      };
    });
    const filtered = filters.status
      ? mapped.filter((e) => e.status === filters.status)
      : mapped;
    if (filtered.length === 0) {
      // Fallback a demo si no hay nada todavía en database mode.
      return DEMO_EVENTS.slice(0, Math.min(5, limit));
    }
    return filtered;
  } catch (error: any) {
    console.error("[telemetry.events] failed:", error?.message);
    return DEMO_EVENTS.slice(0, Math.min(5, limit));
  }
}

/** Lista de módulos disponibles para el filtro (deriva del feed). */
export function moduleOptions(): string[] {
  return [
    "inbox",
    "invoices",
    "purchases",
    "debts",
    "exports",
    "ocr",
    "ai",
    "webhook",
    "email",
    "permission",
    "rate_limit",
    "team",
  ];
}
