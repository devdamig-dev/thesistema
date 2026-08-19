"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentUserContext } from "@/lib/data/auth";

export type SalesPeriod = "current_month" | "previous_month" | "last_30_days";

export type SalesChannelRow = {
  canal: string;
  total: number;
  ticket: number;
  share: number;
  delta: number;
};

export type SalesDayRow = { day: string; ventas: number; costo: number };
export type DailySalesRow = { fecha: string; salon: number; delivery: number; pya: number; wa: number; total: number };

export type SalesPageData = {
  salesByChannel: SalesChannelRow[];
  salesByDay: SalesDayRow[];
  dailySalesTable: DailySalesRow[];
  totalTickets: number;
  bestDay: { label: string; total: number } | null;
};

const channelLabel: Record<string, string> = {
  salon: "Salón",
  delivery: "Delivery propio",
  pedidos_ya: "PedidosYa",
  whatsapp: "WhatsApp",
  rappi: "Rappi",
  mp_qr: "Mercado Pago QR",
};

function localDateParts() {
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
  });
  const [year, month, day] = today.split("-").map(Number);
  return { today, year, month, day };
}

function formatUtcDate(year: number, monthIndex: number, day: number) {
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function getPeriodRange(period: SalesPeriod): { start: string; end?: string } {
  const { today, year, month } = localDateParts();

  if (period === "previous_month") {
    const currentMonthStart = formatUtcDate(year, month - 1, 1);
    const previousMonthStart = formatUtcDate(year, month - 2, 1);
    return {
      start: `${previousMonthStart}T00:00:00-03:00`,
      end: `${currentMonthStart}T00:00:00-03:00`,
    };
  }

  if (period === "last_30_days") {
    const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
    const startDate = formatUtcDate(todayYear, todayMonth - 1, todayDay - 29);
    return { start: `${startDate}T00:00:00-03:00` };
  }

  return { start: `${today.slice(0, 7)}-01T00:00:00-03:00` };
}

export async function getSalesPageDataAction(
  period: SalesPeriod = "current_month",
): Promise<{ ok: true; data: SalesPageData } | { ok: false; error: string }> {
  const supabase = createSupabaseServerClient() as any;
  if (!supabase) return { ok: false, error: "No pudimos conectar con los datos de ventas." };

  const ctx = await getCurrentUserContext();
  if (!ctx.businessId) return { ok: false, error: "No se pudo resolver el negocio activo." };

  const range = getPeriodRange(period);
  let query = supabase
    .from("sales")
    .select("occurred_at, channel, amount")
    .eq("business_id", ctx.businessId)
    .gte("occurred_at", range.start)
    .order("occurred_at", { ascending: true })
    .limit(5000);

  if (range.end) query = query.lt("occurred_at", range.end);

  const res = await query;

  if (res.error) {
    return { ok: false, error: `No se pudieron leer las ventas (${res.error.code ?? "query_error"}).` };
  }

  const rows = (res.data ?? []) as Array<{ occurred_at: string; channel: string | null; amount: number | string | null }>;
  const total = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);

  const byChannel = new Map<string, { total: number; count: number }>();
  const byDay = new Map<string, { salon: number; delivery: number; pya: number; wa: number; total: number }>();

  for (const row of rows) {
    const amount = Number(row.amount ?? 0);
    const channel = row.channel ?? "otro";
    const current = byChannel.get(channel) ?? { total: 0, count: 0 };
    current.total += amount;
    current.count += 1;
    byChannel.set(channel, current);

    const date = String(row.occurred_at).slice(0, 10);
    const day = byDay.get(date) ?? { salon: 0, delivery: 0, pya: 0, wa: 0, total: 0 };
    if (channel === "salon") day.salon += amount;
    else if (channel === "delivery") day.delivery += amount;
    else if (channel === "pedidos_ya") day.pya += amount;
    else if (channel === "whatsapp") day.wa += amount;
    day.total += amount;
    byDay.set(date, day);
  }

  const salesByChannel = [...byChannel.entries()]
    .map(([channel, value]) => ({
      canal: channelLabel[channel] ?? channel,
      total: value.total,
      ticket: value.count > 0 ? value.total / value.count : 0,
      share: total > 0 ? (value.total / total) * 100 : 0,
      delta: 0,
    }))
    .sort((a, b) => b.total - a.total);

  const dayEntries = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const salesByDay = dayEntries.slice(-11).map(([date, value]) => ({
    day: new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(`${date}T12:00:00-03:00`)),
    ventas: value.total,
    costo: 0,
  }));
  const dailySalesTable = dayEntries.slice(-7).reverse().map(([date, value]) => ({
    fecha: new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(`${date}T12:00:00-03:00`)),
    ...value,
  }));

  const best = dayEntries.reduce<{ date: string; total: number } | null>((acc, [date, value]) => {
    if (!acc || value.total > acc.total) return { date, total: value.total };
    return acc;
  }, null);

  return {
    ok: true,
    data: {
      salesByChannel,
      salesByDay,
      dailySalesTable,
      totalTickets: rows.length,
      bestDay: best
        ? {
            label: new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(`${best.date}T12:00:00-03:00`)),
            total: best.total,
          }
        : null,
    },
  };
}
