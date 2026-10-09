/** Pure sales reporting: summaries and historical rows contribute revenue, never ticket counts. */
export type SalesPeriod = "current_month" | "previous_month" | "last_30_days";
export type ReportSale = { occurred_at: string; amount: number | string | null; channel: string | null; sale_kind?: string; status?: string };
export const channelLabels: Record<string, string> = { salon: "Salón", delivery: "Delivery propio", pedidos_ya: "PedidosYa", whatsapp: "WhatsApp", rappi: "Rappi", mp_qr: "Mercado Pago QR" };
export const sourceLabels: Record<string, string> = { manual: "Carga manual", whatsapp: "WhatsApp", inbox: "Inbox", api: "Integración", system: "Sistema" };
export function localDateTime(instant: string | Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant));
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}
/** Reject DST gaps/overlaps instead of silently choosing a different instant. */
export function localDateTimeToIso(value: string, timezone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) throw new Error("Ingresá una fecha y hora válidas.");
  const full = value.length === 16 ? `${value}:00` : value;
  const wall = Date.parse(`${full}Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 19) !== full) throw new Error("Ingresá una fecha y hora válidas.");
  const offsets = new Set<number>();
  for (const hours of [-36, -12, 0, 12, 36]) {
    const probe = wall + hours * 3600000;
    offsets.add(Date.parse(`${localDateTime(new Date(probe), timezone)}Z`) - probe);
  }
  const candidates = [...offsets].map((offset) => wall - offset).filter((instant) => localDateTime(new Date(instant), timezone) === full);
  if (candidates.length !== 1) throw new Error("La hora elegida es ambigua o no existe por el cambio horario. Elegí otra hora.");
  return new Date(candidates[0]).toISOString();
}
export function localDate(instant: string | Date, timezone: string) { return localDateTime(instant, timezone).slice(0, 10); }
export function shiftDate(date: string, days: number) { const instant = new Date(`${date}T12:00:00Z`); instant.setUTCDate(instant.getUTCDate() + days); return instant.toISOString().slice(0, 10); }
export function periodRange(period: SalesPeriod, timezone: string, now = new Date()) {
  const today = localDate(now, timezone);
  const [year, month] = today.split("-").map(Number);
  const currentMonth = `${today.slice(0, 7)}-01`;
  const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 10);
  return { start: localDateTimeToIso(`${period === "previous_month" ? previousMonth : period === "last_30_days" ? shiftDate(today, -29) : currentMonth}T00:00`, timezone), end: period === "previous_month" ? localDateTimeToIso(`${currentMonth}T00:00`, timezone) : now.toISOString() };
}
/** Parse stored monetary values as cents, avoiding floating-point aggregation. */
export function saleAmountCents(value: number | string | null): number {
  if (value === null || !/^-?\d+(\.\d{1,2})?$/.test(String(value))) throw new Error("Importe de venta inválido.");
  const negative = String(value).startsWith("-"); const [whole, fraction = ""] = String(value).replace("-", "").split(".");
  const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (negative ? -1n : 1n);
  const result = Number(cents); if (!Number.isSafeInteger(result)) throw new Error("El importe supera el límite seguro.");
  return result;
}
function addCents(left: number, right: number) { const value = left + right; if (!Number.isSafeInteger(value)) throw new Error("El total supera el límite seguro."); return value; }
export function sumSaleAmounts(rows: { amount: number | string | null }[]) { return rows.reduce((sum, row) => addCents(sum, saleAmountCents(row.amount)), 0) / 100; }
export function summarizeSales(rows: ReportSale[], timezone: string) {
  const active = rows.filter((row) => row.status === "active");
  const total = active.reduce((sum, row) => addCents(sum, saleAmountCents(row.amount)), 0);
  const detailed = active.filter((row) => row.sale_kind === "detailed");
  const detailedTotal = detailed.reduce((sum, row) => addCents(sum, saleAmountCents(row.amount)), 0);
  const channels = new Map<string, { total: number; count: number; detailedTotal: number }>();
  const days = new Map<string, { salon: number; delivery: number; pya: number; wa: number; total: number }>();
  for (const row of active) {
    const amount = saleAmountCents(row.amount); const channel = row.channel ?? "otro";
    const aggregate = channels.get(channel) ?? { total: 0, count: 0, detailedTotal: 0 };
    aggregate.total = addCents(aggregate.total, amount);
    if (row.sale_kind === "detailed") { aggregate.count++; aggregate.detailedTotal = addCents(aggregate.detailedTotal, amount); }
    channels.set(channel, aggregate);
    const date = localDate(row.occurred_at, timezone);
    const day = days.get(date) ?? { salon: 0, delivery: 0, pya: 0, wa: 0, total: 0 };
    if (channel === "salon") day.salon = addCents(day.salon, amount);
    if (channel === "delivery") day.delivery = addCents(day.delivery, amount);
    if (channel === "pedidos_ya") day.pya = addCents(day.pya, amount);
    if (channel === "whatsapp") day.wa = addCents(day.wa, amount);
    day.total = addCents(day.total, amount); days.set(date, day);
  }
  const label = (date: string, weekday = false) => new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", ...(weekday ? { weekday: "short" as const } : {}), timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  const dayEntries = [...days].sort(([a], [b]) => a.localeCompare(b));
  const best = dayEntries.reduce<{ date: string; total: number } | null>((best, [date, day]) => !best || day.total > best.total ? { date, total: day.total } : best, null);
  return {
    totalAmount: total / 100, totalRecords: active.length, totalTickets: detailed.length, averageTicket: detailed.length ? detailedTotal / detailed.length / 100 : null,
    salesByChannel: [...channels].map(([channel, data]) => ({ canal: channelLabels[channel] ?? channel, total: data.total / 100, ticket: data.count ? data.detailedTotal / data.count / 100 : null, share: total ? data.total / total * 100 : 0, delta: 0 })).sort((a, b) => b.total - a.total),
    salesByDay: dayEntries.slice(-11).map(([date, data]) => ({ day: label(date), ventas: data.total / 100, costo: null })),
    dailySalesTable: dayEntries.slice(-7).reverse().map(([date, data]) => ({ fecha: label(date, true), salon: data.salon / 100, delivery: data.delivery / 100, pya: data.pya / 100, wa: data.wa / 100, total: data.total / 100 })),
    bestDay: best ? { label: label(best.date, true), total: best.total / 100 } : null,
  };
}
/** A report is either complete or an error; PostgREST's default row cap is not a total. */
export async function readAllSales<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count?: number | null }>): Promise<T[]> {
  const rows: T[] = []; const ids=new Set<string>(); const size = 500; let expectedCount: number | null = null;
  for (let start = 0; start < 100000;) {
    const result = await query(start, start + size - 1);
    if (result.error || !Array.isArray(result.data) || typeof result.count !== "number" || result.count < 0) throw new Error("No se pudieron leer todos los registros de ventas.");
    if (expectedCount !== null && expectedCount !== result.count) throw new Error("Las ventas cambiaron durante la lectura. Volvé a intentar.");
    expectedCount = result.count;
    if (expectedCount > 100000) throw new Error("Demasiados registros para un informe completo. Elegí un período más corto.");
    for(const row of result.data){const id=(row as {id?:unknown})?.id;if(typeof id === "string"){if(ids.has(id))throw new Error("Las ventas cambiaron durante la lectura. Volvé a intentar.");ids.add(id);}}
    rows.push(...result.data); start += result.data.length;
    if (rows.length > result.count) throw new Error("La lectura de ventas quedó inconsistente.");
    if (rows.length === result.count) return rows;
    if (!result.data.length) throw new Error("La lectura de ventas quedó incompleta.");
  }
  throw new Error("El período supera el límite de lectura segura. Seleccioná un período más corto.");
}
