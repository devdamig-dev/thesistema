import assert from "node:assert/strict";
import test from "node:test";
import {
  DEBT_OPERATION_TTL_MS,
  clearDebtOperation,
  operationReference,
  parseOperationJournal,
  retainDebtOperation,
  serializeOperationJournal,
  type DebtOperationJournal,
  type PendingDebtOperation,
} from "../app/deudas/operation-journal";

const NOW = Date.parse("2026-10-09T12:00:00.000Z");
const requestId = "aaaaaaaa-0000-4000-8000-000000000001";
const branchId = "bbbbbbbb-0000-4000-8000-000000000001";
const debtId = "cccccccc-0000-4000-8000-000000000001";
const paymentId = "dddddddd-0000-4000-8000-000000000001";
const installmentId = "eeeeeeee-0000-4000-8000-000000000001";
const empty = (): DebtOperationJournal => ({ active: [], expired: [] });
const payment = (): Extract<PendingDebtOperation, { kind: "pay" | "legacy" }> => ({ kind: "pay", request: { requestId, debtId, expectedVersion: 1, amountCents: 5000, paidAt: "2026-10-09", paymentMethod: "Transferencia privada", allocation: { rule: "oldest_due" }, notes: "Nota confidencial" } });
const create = (): Extract<PendingDebtOperation, { kind: "create" }> => ({ kind: "create", request: { requestId, branchId, creditor: "Acreedor privado", creditorType: "bank", takenAt: "2026-10-09", planInput: { mode: "single", currency: "ARS", originalAmountCents: 10000, financing: { totalFinancedCents: 10000 }, dueDate: "2026-11-10" }, scheduleConfirmed: true } });
const variants: PendingDebtOperation[] = [
  { kind: "cancel", request: { requestId, debtId, expectedVersion: 2, reason: "Registro duplicado", administrativeOnlyConfirmed: true } },
  create(),
  payment(),
  { ...payment(), kind: "legacy" },
  { ...payment(), request: { ...payment().request, allocation: { rule: "selected_installment", installmentId } } },
  { kind: "void", request: { requestId, debtId, paymentId, expectedVersion: 2, reason: "Motivo privado" } },
  { kind: "edit", request: { kind: "notes", requestId, debtId, expectedVersion: 2, notes: "Nota privada" } },
  { kind: "edit", request: { kind: "installment", requestId, debtId, expectedVersion: 2, installmentId, dueDate: "2026-11-15", notes: null } },
];

function parse(value: unknown, now = NOW): DebtOperationJournal { return parseOperationJournal(JSON.stringify(value), now); }
function distinct(operation: PendingDebtOperation, index: number): PendingDebtOperation {
  return { ...operation, request: { ...operation.request, requestId: `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}` } } as PendingDebtOperation;
}

test("missing storage produces an empty journal and new retention stamps the supplied clock", () => {
  assert.deepEqual(parseOperationJournal(null, NOW), empty());
  const operation = payment();
  const journal = retainDebtOperation(empty(), operation, NOW);
  assert.deepEqual(journal, { active: [{ ...operation, recordedAt: NOW }], expired: [] });
  assert.equal(operation.recordedAt, undefined);
  assert.notEqual(journal.active[0].request, operation.request);
});

test("every operation kind round-trips while active and produces a minimal recovery reference", () => {
  const expectedTargets = [null, null, null, null, installmentId, paymentId, null, installmentId];
  variants.forEach((operation, index) => {
    const journal = retainDebtOperation(empty(), operation, NOW);
    assert.deepEqual(parseOperationJournal(serializeOperationJournal(journal, NOW + 1), NOW + 1), journal);
    assert.deepEqual(operationReference(operation), { kind: operation.kind, requestId, debtId: operation.kind === "create" ? null : debtId, targetId: expectedTargets[index] });
  });
});

test("payload expires at exactly 24 hours, with no expiry grace or identity deletion", () => {
  const journal = retainDebtOperation(empty(), payment(), NOW);
  assert.equal(parse(journal, NOW + DEBT_OPERATION_TTL_MS - 1).active.length, 1);
  const expired = parse(journal, NOW + DEBT_OPERATION_TTL_MS);
  assert.deepEqual(expired, { active: [], expired: [operationReference(payment())] });
  assert.deepEqual(parse(expired, NOW + DEBT_OPERATION_TTL_MS * 3650), expired);
});

test("serialization prunes payloads for every kind while preserving every uncertain identity", () => {
  let journal = empty();
  variants.forEach((operation, index) => { journal = retainDebtOperation(journal, distinct(operation, index), NOW); });
  const serialized = serializeOperationJournal(journal, NOW + DEBT_OPERATION_TTL_MS);
  const recovered = parseOperationJournal(serialized, NOW + DEBT_OPERATION_TTL_MS);
  assert.equal(recovered.active.length, 0);
  assert.equal(recovered.expired.length, variants.length);
  assert.deepEqual(recovered.expired, variants.map((operation, index) => operationReference(distinct(operation, index))));
  assert.doesNotMatch(serialized, /request"|recordedAt|privad|confidencial|amountCents|paidAt|dueDate|paymentMethod|planInput/);
  assert.equal(journal.active.length, variants.length, "serialization never mutates React state in place");
});

test("old array journals never receive a fresh timestamp, even if an entry has a timestamp", () => {
  for (const operation of variants) {
    for (const previous of [operation, { ...operation, recordedAt: NOW }]) {
      assert.deepEqual(parse([previous]), { active: [], expired: [operationReference(operation)] });
    }
  }
  assert.deepEqual(parse([]), empty());
});

test("missing or future timestamps retain only a reference, and cannot resurrect after clock rollback", () => {
  for (const operation of [payment(), { ...payment(), recordedAt: NOW + 1 }]) {
    assert.deepEqual(parse({ active: [operation], expired: [] }), { active: [], expired: [operationReference(payment())] });
  }
  const journal = retainDebtOperation(empty(), payment(), NOW);
  const rolledBack = parse(journal, NOW - 1);
  assert.equal(rolledBack.expired.length, 1);
  assert.deepEqual(parse(rolledBack, NOW), rolledBack);
});

test("retaining an already timestamped operation cannot replace its original time", () => {
  const previous = { ...payment(), recordedAt: NOW - DEBT_OPERATION_TTL_MS };
  assert.deepEqual(retainDebtOperation(empty(), previous, NOW), { active: [], expired: [operationReference(previous)] });
});

test("same request replay preserves timestamp and semantic identity despite key order and UUID case", () => {
  const journal = retainDebtOperation(empty(), payment(), NOW);
  const original = structuredClone(journal);
  const reordered = { kind: "pay" as const, request: { ...Object.fromEntries(Object.entries(payment().request).reverse()), requestId: requestId.toUpperCase(), debtId: debtId.toUpperCase() }, recordedAt: NOW + 1000 } as PendingDebtOperation;
  assert.deepEqual(retainDebtOperation(journal, reordered, NOW + 1000), journal);
  assert.deepEqual(journal, original);
  const creation = create();
  const created = retainDebtOperation(empty(), creation, NOW);
  const reversedPlan = Object.fromEntries(Object.entries(creation.request.planInput).reverse()) as typeof creation.request.planInput;
  assert.deepEqual(retainDebtOperation(created, { ...creation, request: { ...creation.request, planInput: reversedPlan } }, NOW + 2), created);
});

test("same requestId with a changed payload, kind, or target is rejected", () => {
  const journal = retainDebtOperation(empty(), payment(), NOW);
  const conflicts: PendingDebtOperation[] = [
    { ...payment(), request: { ...payment().request, amountCents: 4000 } },
    { ...payment(), kind: "legacy" },
    { ...payment(), request: { ...payment().request, debtId: branchId } },
    { ...payment(), request: { ...payment().request, allocation: { rule: "selected_installment", installmentId } } },
  ];
  for (const operation of conflicts) assert.throws(() => retainDebtOperation(journal, operation, NOW + 1), /journal_identity_conflict/);
});

test("expired identities cannot be replayed or replaced with the same requestId", () => {
  const journal = retainDebtOperation(empty(), payment(), NOW);
  const later = NOW + DEBT_OPERATION_TTL_MS;
  assert.throws(() => retainDebtOperation(journal, payment(), later), /journal_operation_expired/);
  assert.throws(() => retainDebtOperation(parse(journal, later), payment(), later + 1000), /journal_operation_expired/);
  assert.throws(() => retainDebtOperation(journal, { ...payment(), request: { ...payment().request, amountCents: 2000 } }, later), /journal_operation_expired/);
  assert.throws(() => retainDebtOperation(journal, { ...payment(), kind: "legacy" }, later), /journal_identity_conflict/);
});

test("duplicate requestIds fail closed within and across active, expired, and legacy entries", () => {
  const active = { ...payment(), recordedAt: NOW };
  const other = { ...active, request: { ...active.request, requestId: requestId.toUpperCase(), amountCents: 6000 } };
  const ref = operationReference(payment());
  const duplicateCases = [
    [payment(), payment()],
    { active: [active, active], expired: [] },
    { active: [active, other], expired: [] },
    { active: [active], expired: [ref] },
    { active: [], expired: [ref, { ...ref, requestId: requestId.toUpperCase() }] },
    { active: [{ ...active, recordedAt: NOW - DEBT_OPERATION_TTL_MS }], expired: [ref] },
  ];
  for (const value of duplicateCases) assert.throws(() => parse(value), /duplicate_journal_request/);
});

test("UUID casing is canonical for every operation and recovery target", () => {
  for (const operation of variants) {
    const uppercase = JSON.parse(JSON.stringify(operation).replaceAll(requestId, requestId.toUpperCase()).replaceAll(branchId, branchId.toUpperCase()).replaceAll(debtId, debtId.toUpperCase()).replaceAll(paymentId, paymentId.toUpperCase()).replaceAll(installmentId, installmentId.toUpperCase()));
    assert.deepEqual(operationReference(uppercase), operationReference(operation));
    assert.deepEqual(retainDebtOperation(empty(), uppercase, NOW), retainDebtOperation(empty(), operation, NOW));
  }
});

test("clear removes only the explicit confirmed identity and ages any remaining payloads", () => {
  let journal = retainDebtOperation(empty(), payment(), NOW);
  journal = retainDebtOperation(journal, distinct(create(), 2), NOW + 1000);
  const original = structuredClone(journal);
  assert.deepEqual(clearDebtOperation(journal, requestId.toUpperCase(), NOW + DEBT_OPERATION_TTL_MS + 1000), { active: [], expired: [operationReference(distinct(create(), 2))] });
  assert.deepEqual(journal, original);
  assert.deepEqual(clearDebtOperation(journal, paymentId, NOW + 1000), journal);
  const expired = parse(journal, NOW + DEBT_OPERATION_TTL_MS + 1000);
  assert.equal(clearDebtOperation(expired, requestId, NOW + DEBT_OPERATION_TTL_MS + 1000).expired.length, 1);
  assert.throws(() => clearDebtOperation(journal, "not-a-uuid", NOW));
});

test("malformed JSON, unsupported shapes, unknown fields, and sparse entries are rejected", () => {
  for (const raw of ["", "not json", "{", "null", "42", '"text"']) assert.throws(() => parseOperationJournal(raw, NOW));
  const corruptions: unknown[] = [
    {}, { active: [] }, { active: null, expired: [] }, { active: [], expired: {} }, { active: [], expired: [], actorId: "forged" },
    [null], [42], [{ kind: "unknown", request: payment().request }], [{ ...payment(), actorId: "forged" }],
    { active: [null], expired: [] }, { active: [], expired: [null] },
  ];
  for (const value of corruptions) assert.throws(() => parse(value));
  assert.throws(() => serializeOperationJournal({ active: Array(1), expired: [] }, NOW));
});

test("forged or invalid request payloads fail closed even after expiration", () => {
  const invalid = [
    { ...payment(), request: { ...payment().request, actorId: "forged" } },
    { ...payment(), request: { ...payment().request, businessId: branchId } },
    { ...payment(), request: { ...payment().request, amountCents: -1 } },
    { ...payment(), request: { ...payment().request, paidAt: "2026-02-30" } },
    { ...create(), request: { ...create().request, scheduleConfirmed: false } },
  ];
  for (const operation of invalid) {
    assert.throws(() => parse([operation]));
    assert.throws(() => parse({ active: [{ ...operation, recordedAt: NOW - DEBT_OPERATION_TTL_MS }], expired: [] }));
    assert.throws(() => retainDebtOperation(empty(), operation as PendingDebtOperation, NOW));
  }
});

test("expired references contain only valid identity fields", () => {
  const ref = operationReference(payment());
  const corruptions = [
    { ...ref, requestId: "invalid" }, { ...ref, debtId: null }, { ...ref, targetId: "invalid" }, { ...ref, kind: "other" },
    { ...ref, notes: "Leaked payload" }, { ...ref, request: payment().request }, { ...ref, recordedAt: NOW },
    { kind: "create", requestId, debtId, targetId: null }, { kind: "create", requestId, debtId: null, targetId: paymentId },
    { kind: "void", requestId, debtId, targetId: null }, { kind: "edit", requestId, debtId },
  ];
  for (const reference of corruptions) assert.throws(() => parse({ active: [], expired: [reference] }));
});

test("invalid timestamps and clocks are rejected without guessing a new creation date", () => {
  const invalid = [null, -1, 1.5, "2026-10-09T12:00:00Z", "2026-02-30", NaN, Infinity, 8_640_000_000_000_001];
  for (const recordedAt of invalid) assert.throws(() => parse({ active: [{ ...payment(), recordedAt }], expired: [] }), /invalid_journal_timestamp/);
  for (const now of [-1, 0.5, NaN, Infinity, 8_640_000_000_000_001]) {
    assert.throws(() => parseOperationJournal(null, now), /invalid_journal_timestamp/);
    assert.throws(() => serializeOperationJournal(empty(), now), /invalid_journal_timestamp/);
    assert.throws(() => retainDebtOperation(empty(), payment(), now), /invalid_journal_timestamp/);
  }
  assert.equal(retainDebtOperation(empty(), payment(), 0).active[0].recordedAt, 0);
});

test("journal size and entry limits reject writes rather than evicting uncertain identities", () => {
  assert.throws(() => parseOperationJournal(" ".repeat(1_000_001), NOW), /invalid_journal/);
  const references = Array.from({ length: 100 }, (_, index) => operationReference(distinct(payment(), index + 1)));
  const journal = { active: [], expired: references };
  assert.equal(parse(journal).expired.length, 100);
  assert.throws(() => parse({ active: [], expired: [...references, operationReference(distinct(payment(), 101))] }), /invalid_journal/);
  assert.throws(() => retainDebtOperation(journal, distinct(payment(), 101), NOW), /invalid_journal/);
  assert.equal(journal.expired.length, 100);
});

test("serializer rejects an oversized valid payload set without discarding reference identities", () => {
  const dates = Array.from({ length: 1200 }, (_, index) => new Date(NOW + index * DEBT_OPERATION_TTL_MS).toISOString().slice(0, 10));
  const operation: PendingDebtOperation = { ...create(), request: { ...create().request, planInput: { mode: "installments", currency: "ARS", originalAmountCents: 120000, financing: { totalFinancedCents: 120000 }, installmentCount: 1200, schedule: { periodicity: "custom", dueDates: dates } } }, recordedAt: NOW };
  const journal: DebtOperationJournal = { active: Array.from({ length: 80 }, (_, index) => distinct(operation, index + 1)), expired: [operationReference(distinct(payment(), 81))] };
  assert.throws(() => serializeOperationJournal(journal, NOW), /invalid_journal/);
  assert.equal(journal.active.length, 80);
  assert.equal(journal.expired.length, 1);
  const pruned = parseOperationJournal(serializeOperationJournal(journal, NOW + DEBT_OPERATION_TTL_MS), NOW + DEBT_OPERATION_TTL_MS);
  assert.equal(pruned.expired.length, 81);
});

test("in-memory boundaries reject accessors and prototypes instead of serializing untrusted objects", () => {
  let getterCalls = 0;
  const operation = Object.defineProperty({ kind: "pay" }, "request", { enumerable: true, get() { getterCalls++; return payment().request; } });
  assert.throws(() => retainDebtOperation(empty(), operation as PendingDebtOperation, NOW), /invalid_journal/);
  assert.equal(getterCalls, 0);
  assert.throws(() => retainDebtOperation(empty(), Object.assign(Object.create({ forged: true }), payment()), NOW), /invalid_journal/);
  assert.throws(() => retainDebtOperation(empty(), { ...payment(), [Symbol("hidden")]: true }, NOW), /invalid_journal/);
});
