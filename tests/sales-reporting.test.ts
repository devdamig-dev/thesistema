import assert from "node:assert/strict";
import test from "node:test";
import { localDate, localDateTimeToIso, periodRange, readAllSales, summarizeSales, type ReportSale } from "../app/ventas/reporting";
import { lineTotal, readSaleOperation, retainSaleOperation, saleJournalKey, type PendingSaleOperation } from "../app/ventas/operation-journal";
const businessId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const pending: PendingSaleOperation = { kind: "save", input: { requestId: "10000000-0000-4000-8000-000000000003", businessId, userId, id: null, expectedVersion: null, branchId: "10000000-0000-4000-8000-000000000004", occurredAt: "2026-10-01T12:00:00Z", channel: "salon", paymentMethod: "Efectivo", customerId: null, notes: null, items: [{ id: null, productId: null, description: "Concepto QA", quantity: "2", unitPrice: "5.50" }] } };
test("sales reports exclude voids and count only known detailed tickets", () => {
  const sample = (amount: number, sale_kind: string, status = "active"): ReportSale => ({ occurred_at: "2026-10-01T01:00:00Z", channel: "salon", amount, sale_kind, status });
  const result = summarizeSales([sample(10, "detailed"), sample(30, "detailed"), sample(1000, "summary"), sample(500, "legacy"), sample(90000, "detailed", "voided")], "America/Argentina/Buenos_Aires");
  assert.equal(result.totalRecords, 4); assert.equal(result.totalTickets, 2); assert.equal(result.averageTicket, 20);
  assert.equal(result.salesByChannel[0].total, 1540); assert.equal(result.salesByChannel[0].ticket, 20);
  assert.equal(result.salesByDay[0].costo, null); assert.equal(result.salesByDay[0].day, new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(new Date("2026-09-30T12:00:00Z")));
});
test("legacy and summary revenue never imply ticket, origin or known cost", () => {
  const result = summarizeSales([{ occurred_at: "2026-10-02T12:00:00Z", channel: null, amount: "123.40", sale_kind: "legacy", status: "active" }], "UTC");
  assert.equal(result.totalTickets, 0); assert.equal(result.averageTicket, null); assert.equal(result.salesByChannel[0].ticket, null); assert.equal(result.salesByChannel[0].canal, "otro"); assert.equal(result.salesByDay[0].costo, null);
});
test("business timezone controls date grouping and monthly boundaries", () => {
  const now = new Date("2026-10-01T01:30:00Z");
  assert.equal(localDate(now, "America/Argentina/Buenos_Aires"), "2026-09-30");
  assert.equal(periodRange("current_month", "America/Argentina/Buenos_Aires", now).start, "2026-09-01T03:00:00.000Z");
  assert.equal(periodRange("previous_month", "Asia/Kolkata", now).start, "2026-08-31T18:30:00.000Z");
  assert.equal(periodRange("previous_month", "Asia/Kolkata", now).end, "2026-09-30T18:30:00.000Z");
  assert.equal(periodRange("last_30_days", "UTC", new Date("2026-03-01T12:00:00Z")).start, "2026-01-31T00:00:00.000Z");
});
test("explicit local times reject invalid civil dates and DST gaps or overlaps", () => {
  assert.equal(localDateTimeToIso("2026-10-01T15:30", "Asia/Kolkata"), "2026-10-01T10:00:00.000Z");
  assert.equal(localDateTimeToIso("2026-07-01T15:30:10", "America/New_York"), "2026-07-01T19:30:10.000Z");
  assert.throws(() => localDateTimeToIso("2026-02-30T12:00", "UTC"));
  assert.throws(() => localDateTimeToIso("2026-03-08T02:30", "America/New_York"));
  assert.throws(() => localDateTimeToIso("2026-11-01T01:30", "America/New_York"));
});
test("report pagination follows exact count even if backend returns less than requested", async () => {
  const rows = Array.from({ length: 1107 }, (_, id) => ({ id })); const starts: number[] = [];
  const result = await readAllSales(async (from) => { starts.push(from); return { data: rows.slice(from, from + 200), error: null, count: rows.length }; });
  assert.equal(result.length, 1107); assert.deepEqual(starts, [0, 200, 400, 600, 800, 1000]);
});
test("report errors and inconsistent/missing counts never become partial or zero reports", async () => {
  await assert.rejects(readAllSales(async () => ({ data: [{ id: 1 }], error: new Error("offline"), count: 1 })));
  await assert.rejects(readAllSales(async () => ({ data: [], error: null, count: 10 })));
  await assert.rejects(readAllSales(async () => ({ data: [], error: null })));
});
test("sale recovery keeps frozen attempt and refuses replacement until confirmation", () => {
  const original = structuredClone(pending); const frozen = retainSaleOperation(null, original);
  original.input.items[0].description = "Changed after freezing";
  assert.equal(frozen.kind === "save" && frozen.input.items[0].description, "Concepto QA");
  assert.deepEqual(retainSaleOperation(frozen, structuredClone(pending)), pending);
  assert.throws(() => retainSaleOperation(frozen, original));
  assert.deepEqual(readSaleOperation(JSON.stringify(frozen), businessId, userId), pending);
  assert.throws(() => readSaleOperation(JSON.stringify(frozen), "other-business", userId));
  assert.throws(() => readSaleOperation(JSON.stringify(frozen), businessId, "other-user"));
  assert.throws(() => readSaleOperation("{}", businessId, userId));
  assert.notEqual(saleJournalKey(businessId, userId), saleJournalKey(businessId, "other-user"));
});
test("UI totals reuse domain decimal rules and half-up per-line rounding", () => {
  assert.equal(lineTotal("0.5", "0.01"), 0.01); assert.equal(lineTotal("3", "0.10"), 0.30);
  assert.equal(lineTotal("0", "1"), null); assert.equal(lineTotal("1.0000001", "1"), null); assert.equal(lineTotal("1", "1.001"), null); assert.equal(lineTotal("-1", "1"), null);
});
test("report monetary sums preserve decimal cents and reject unsafe totals", () => {
  const sample = (amount: number): ReportSale => ({ occurred_at: "2026-10-01T12:00:00Z", amount, status: "active", sale_kind: "detailed", channel: "salon" });
  const result = summarizeSales([sample(0.1), sample(0.2)], "UTC");
  assert.equal(result.salesByChannel[0].total, 0.3); assert.equal(result.salesByDay[0].ventas, 0.3); assert.equal(result.averageTicket, 0.15);
  assert.throws(() => summarizeSales([sample(0.001)], "UTC")); assert.throws(() => summarizeSales([sample(Number.MAX_SAFE_INTEGER)], "UTC"));
});

test("paged report rejects duplicate IDs when a date move keeps count constant",async()=>{
 const first=Array.from({length:500},(_,i)=>({id:String(i)}));
 await assert.rejects(readAllSales(async from=>({data:from===0?first:[first[499]],error:null,count:501})),/cambiaron/);
});
