import test from "node:test";
import assert from "node:assert/strict";
import { clearInboxPurchaseJournal, inboxPurchaseJournalKey, parseInboxPurchaseApproval, parsePurchaseExpectedFields, recoverInboxPurchase, saveInboxPurchaseJournal } from "../lib/purchases/inbox";
import { purchaseCommitResult } from "../lib/purchases/service";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = () => ({ branchId: id(3), supplierId: id(4), purchasedAt: "2026-10-09", paymentMethod: "Transferencia declarada" });
const line = () => ({ ingredientId: null as string | null, description: "Tomate", qty: "2.125000", unit: "kg", unitPrice: "150.00" });
const input = () => ({ extractionId: id(10), businessId: id(2), userId: id(1), expectedFields: { supplier: "Proveedor", total_amount: 123.45, nested: { raw: [null, true, "1", 1] } }, review: { ...base(), kind: "summary", amount: "123.45" } });
const detailed = () => ({ ...input(), review: { ...base(), kind: "detailed", items: [line(), { ...line(), ingredientId: id(5), description: "Cebolla", qty: "1", unitPrice: "0" }] } });

test("purchase review requires an explicit kind and summary has only declared amount, no invented items or stock", () => {
  const parsed = parseInboxPurchaseApproval(input());
  assert.deepEqual(parsed.review, input().review);
  for (const key of ["items", "stock", "requestId", "source", "createdBy", "replacesPurchaseId", "correctionReason"]) assert.throws(() => parseInboxPurchaseApproval({ ...input(), review: { ...input().review, [key]: [] } }));
  for (const kind of [undefined, null, "", "invoice", true]) assert.throws(() => parseInboxPurchaseApproval({ ...input(), review: { ...input().review, kind } }));
  for (const key of Object.keys(input().review)) { const review: any = input().review; delete review[key]; assert.throws(() => parseInboxPurchaseApproval({ ...input(), review })); }
  for (const key of Object.keys(input())) { const request: any = input(); delete request[key]; assert.throws(() => parseInboxPurchaseApproval(request)); }
});

test("detailed purchase preserves exact line order, references, precision and zero prices without deriving lines", () => {
  const request = detailed(); const parsed = parseInboxPurchaseApproval(request);
  assert.deepEqual(parsed.review, request.review); assert.equal(Object.hasOwn(parsed.review, "amount"), false);
  request.review.items[0].description = "changed";
  assert.equal(parsed.review.kind === "detailed" && parsed.review.items[0].description, "Tomate");
  assert.throws(() => parseInboxPurchaseApproval({ ...detailed(), review: { ...detailed().review, amount: "1" } }));
  for (const items of [[], new Array(1), Array.from({ length: 101 }, line), null]) assert.throws(() => parseInboxPurchaseApproval({ ...detailed(), review: { ...detailed().review, items } }));
  for (const key of Object.keys(line())) { const item: any = line(); delete item[key]; assert.throws(() => parseInboxPurchaseApproval({ ...detailed(), review: { ...detailed().review, items: [item] } })); }
  for (const patch of [{ qty: "0" }, { qty: "1.0000001" }, { qty: "1000000000000" }, { unitPrice: "-1" }, { unitPrice: "1.001" }, { ingredientId: "" }, { ingredientId: id(5), source: "manual" }, { description: "" }, { description: "x".repeat(1001) }, { unit: "x".repeat(41) }, { unit: "kg\n" }]) assert.throws(() => parseInboxPurchaseApproval({ ...detailed(), review: { ...detailed().review, items: [{ ...line(), ...patch }] } }));
});

test("purchase amounts and summed rounded line totals match SQL bounds without floating-point rounding", () => {
  for (const amount of ["0", "0.00", "-1", "1,50", "1e2", "Infinity", "NaN", "1.001", "10000000000", " 1", "+1", "1.", ".5", 1, null]) assert.throws(() => parseInboxPurchaseApproval({ ...input(), review: { ...input().review, amount } }));
  assert.equal(parseInboxPurchaseApproval({ ...input(), review: { ...input().review, amount: "9999999999.99" } }).review.kind, "summary");
  const withItems = (items: ReturnType<typeof line>[]) => ({ ...detailed(), review: { ...detailed().review, items } });
  assert.doesNotThrow(() => parseInboxPurchaseApproval(withItems([{ ...line(), qty: "1", unitPrice: "9999999999.99" }])));
  assert.throws(() => parseInboxPurchaseApproval(withItems([{ ...line(), qty: "1", unitPrice: "9999999999.99" }, { ...line(), qty: "0.5", unitPrice: "0.01" }])));
  assert.doesNotThrow(() => parseInboxPurchaseApproval(withItems([{ ...line(), qty: "999999999999.999999", unitPrice: "0" }])));
  assert.throws(() => parseInboxPurchaseApproval(withItems([{ ...line(), qty: "999999999999.999999", unitPrice: "0.01" }])));
});

test("purchase date, actor, tenant and references reject malformed or implicit values", () => {
  for (const purchasedAt of ["", "2026-02-29", "2026-02-30", "2026-13-01", "0000-01-01", "2026-1-01", "2026-10-09T00:00:00Z", 20261009]) assert.throws(() => parseInboxPurchaseApproval({ ...input(), review: { ...input().review, purchasedAt } }));
  assert.doesNotThrow(() => parseInboxPurchaseApproval({ ...input(), review: { ...input().review, purchasedAt: "2024-02-29" } }));
  for (const key of ["extractionId", "businessId", "userId"]) for (const value of ["", "00000000-0000-0000-0000-000000000000", null, 1]) assert.throws(() => parseInboxPurchaseApproval({ ...input(), [key]: value }));
  for (const patch of [{ branchId: "" }, { supplierId: null }, { paymentMethod: "" }, { paymentMethod: "\tEfectivo" }, { paymentMethod: "x".repeat(101) }]) assert.throws(() => parseInboxPurchaseApproval({ ...input(), review: { ...input().review, ...patch } }));
});

test("expectedFields is an independent exact JSON snapshot, including unknown extraction fields", () => {
  const request = input(); const parsed = parseInboxPurchaseApproval(request);
  assert.deepEqual(parsed.expectedFields, request.expectedFields);
  request.expectedFields.nested.raw[2] = "changed";
  assert.deepEqual((parsed.expectedFields.nested as any).raw, [null, true, "1", 1]);
  const special = JSON.parse('{"__proto__":{"kept":true},"constructor":"original","toString":null}');
  assert.deepEqual(parsePurchaseExpectedFields(special), special);
  const nullPrototype = Object.assign(Object.create(null), { value: 1 });
  assert.deepEqual(parsePurchaseExpectedFields(nullPrototype), { value: 1 });
});

test("expectedFields cannot silently drop, normalize, execute or cycle non-JSON values", () => {
  let invoked = false;
  const getter = Object.defineProperty({}, "value", { enumerable: true, get() { invoked = true; return 1; } });
  const method = { toJSON() { invoked = true; return {}; } };
  const cycle: any = {}; cycle.self = cycle;
  const hidden = Object.defineProperty({}, "value", { enumerable: false, value: 1 });
  const sparse = new Array(1); const extraArray: any = [1]; extraArray.extra = 2;
  for (const value of [undefined, () => 1, Symbol("value"), 1n, NaN, Infinity, -Infinity, -0, new Date(), new Map(), getter, method, cycle, hidden, sparse, extraArray, { [Symbol("value")]: 1 }]) assert.throws(() => parsePurchaseExpectedFields({ nested: value }));
  assert.equal(invoked, false);
  for (const value of [null, [], "{}", Object.create({ value: 1 })]) assert.throws(() => parsePurchaseExpectedFields(value));
  assert.throws(() => parsePurchaseExpectedFields({ oversized: "x".repeat(50000) }));
  let deep: unknown = null; for (let i = 0; i < 102; i++) deep = { next: deep };
  assert.throws(() => parsePurchaseExpectedFields({ deep }));
  const rootHidden = Object.defineProperty(input(), "extra", { value: 1 });
  assert.throws(() => parseInboxPurchaseApproval(rootHidden));
});

test("journal roundtrip freezes the original snapshot and scopes actor, tenant and extraction", () => {
  const parsed = parseInboxPurchaseApproval(detailed()); const serialized = JSON.stringify(parsed);
  assert.equal(recoverInboxPurchase(null, parsed), null);
  assert.deepEqual(recoverInboxPurchase(serialized, parsed), parsed);
  for (const key of ["businessId", "userId", "extractionId"] as const) {
    const changed = { ...parsed, [key]: id(99) };
    assert.throws(() => recoverInboxPurchase(serialized, changed));
    assert.notEqual(inboxPurchaseJournalKey(parsed), inboxPurchaseJournalKey(changed));
  }
  for (const raw of ["", "null", "{}", "{broken", "x".repeat(250001), JSON.stringify({ ...parsed, review: { ...parsed.review, qty: 1 } })]) assert.throws(() => recoverInboxPurchase(raw, parsed));
  const newSnapshot = { ...parsed, expectedFields: { supplier: "changed" } };
  assert.deepEqual(recoverInboxPurchase(serialized, newSnapshot)?.expectedFields, parsed.expectedFields);
});

test("journal persistence and cleanup verify readback and fail closed on throws or silent failures", () => {
  const parsed = parseInboxPurchaseApproval(input()); const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  saveInboxPurchaseJournal(storage, parsed);
  assert.deepEqual(recoverInboxPurchase(storage.getItem(inboxPurchaseJournalKey(parsed)), parsed), parsed);
  const different = parseInboxPurchaseApproval({ ...input(), review: { ...input().review, amount: "99" } });
  assert.throws(() => saveInboxPurchaseJournal(storage, different));
  assert.throws(() => clearInboxPurchaseJournal(storage, different));
  assert.equal(storage.getItem(inboxPurchaseJournalKey(parsed)), JSON.stringify(parsed));
  clearInboxPurchaseJournal(storage, parsed); assert.equal(values.size, 0);
  for (const setItem of [() => { throw new Error("quota"); }, () => {}]) assert.throws(() => saveInboxPurchaseJournal({ ...storage, setItem }, parsed));
  assert.throws(() => saveInboxPurchaseJournal({ ...storage, getItem() { throw new Error("denied"); } }, parsed));
  for (const removeItem of [() => { throw new Error("denied"); }, () => {}]) { saveInboxPurchaseJournal(storage, parsed); assert.throws(() => clearInboxPurchaseJournal({ ...storage, removeItem }, parsed)); }
});

const receipt = () => ({ data: { ok: true, id: id(20), replayed: false, kind: "summary", source: "inbox" }, error: null });
test("purchase receipt requires a complete typed success matching submitted transport and kind", () => {
  const expected = { source: "inbox", kind: "summary" } as const;
  assert.deepEqual(purchaseCommitResult(receipt(), expected), { ...receipt().data, ok: true, persisted: true });
  assert.equal(purchaseCommitResult({ data: { ...receipt().data, replayed: true } }, expected).ok, true);
  for (const response of [null, {}, { data: null }, { data: [] }, { data: { ...receipt().data, ok: "true" } }, { data: { ...receipt().data, ok: 1 } }, { data: { ...receipt().data, id: "invalid" } }, { data: { ...receipt().data, replayed: "false" } }, { data: { ...receipt().data, source: "manual" } }, { data: { ...receipt().data, kind: "detailed" } }, { data: { ok: false, error: "rejected" } }]) assert.equal(purchaseCommitResult(response, expected).persisted, "unknown");
  for (const key of Object.keys(receipt().data)) { const data: any = receipt().data; delete data[key]; assert.equal(purchaseCommitResult({ data }, expected).persisted, "unknown"); }
});

test("only complete known SQLSTATE rejections prove rollback; disconnects and malformed codes remain uncertain", () => {
  for (const code of ["22023", "22003", "23505", "23514", "42501", "42P01", "P0001"]) assert.equal(purchaseCommitResult({ error: { code } }).persisted, false, code);
  for (const code of ["22", "23garbage", "P0001-extra", "timeout", "08006", "57014", "PGRST301", undefined, 23514]) assert.equal(purchaseCommitResult({ error: { code } }).persisted, "unknown", String(code));
  assert.equal(purchaseCommitResult({ ...receipt(), error: { code: "08006" } }).persisted, "unknown");
});
