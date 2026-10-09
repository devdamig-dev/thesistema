/**
 * Tab-local recovery data, scoped by the caller to authenticated actor + business.
 * It is never authorization or proof of persistence. Payloads live for 24 hours;
 * uncertain operation identities remain until an explicit, verified clear.
 */
import {
  parseCreatePlanRequest,
  parseEditPlanRequest,
  parsePaymentPlanRequest,
  parseVoidPlanRequest,
  requestUuid,
  type CreatePlanRequest,
  type EditPlanRequest,
  type PaymentPlanRequest,
  type VoidPlanRequest,
} from "./plan-contract";

type DebtOperationPayload =
  | { kind: "create"; request: CreatePlanRequest }
  | { kind: "pay" | "legacy"; request: PaymentPlanRequest }
  | { kind: "void"; request: VoidPlanRequest }
  | { kind: "edit"; request: EditPlanRequest };

/** recordedAt is absent only on a new, not-yet-retained operation. Epoch milliseconds. */
export type PendingDebtOperation = DebtOperationPayload & { recordedAt?: number };
export type DebtOperationReference = {
  kind: PendingDebtOperation["kind"];
  requestId: string;
  debtId: string | null;
  /** Selected installment, reversed payment, or edited installment; otherwise null. */
  targetId: string | null;
};
export type DebtOperationJournal = { active: PendingDebtOperation[]; expired: DebtOperationReference[] };
export const DEBT_OPERATION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_JOURNAL_LENGTH = 1_000_000;
const MAX_JOURNAL_ENTRIES = 100;
const MAX_TIMESTAMP = 8_640_000_000_000_000;

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("invalid_journal");
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key) || !("value" in Object.getOwnPropertyDescriptor(value, key)!)) throw new Error("invalid_journal");
  }
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > MAX_TIMESTAMP) throw new Error("invalid_journal_timestamp");
  return value;
}
function uuid(value: unknown): string { return requestUuid(value, "journal.id").toLowerCase(); }

function parseOperation(value: unknown): PendingDebtOperation {
  const raw = record(value, ["kind", "request", "recordedAt"]);
  let operation: PendingDebtOperation;
  if (raw.kind === "create") {
    const request = parseCreatePlanRequest(raw.request);
    operation = { kind: raw.kind, request: { ...request, requestId: uuid(request.requestId), branchId: uuid(request.branchId) } };
  } else if (raw.kind === "pay" || raw.kind === "legacy") {
    const request = parsePaymentPlanRequest(raw.request);
    const allocation = request.allocation.rule === "selected_installment" ? { rule: request.allocation.rule, installmentId: uuid(request.allocation.installmentId) } : request.allocation;
    operation = { kind: raw.kind, request: { ...request, requestId: uuid(request.requestId), debtId: uuid(request.debtId), allocation } };
  } else if (raw.kind === "void") {
    const request = parseVoidPlanRequest(raw.request);
    operation = { kind: raw.kind, request: { ...request, requestId: uuid(request.requestId), debtId: uuid(request.debtId), paymentId: uuid(request.paymentId) } };
  } else if (raw.kind === "edit") {
    const request = parseEditPlanRequest(raw.request);
    operation = { kind: raw.kind, request: { ...request, requestId: uuid(request.requestId), debtId: uuid(request.debtId), ...(request.kind === "installment" ? { installmentId: uuid(request.installmentId) } : {}) } };
  } else throw new Error("invalid_journal");
  return Object.hasOwn(raw, "recordedAt") ? { ...operation, recordedAt: timestamp(raw.recordedAt) } : operation;
}

function referenceFromOperation(operation: PendingDebtOperation): DebtOperationReference {
  const common = { kind: operation.kind, requestId: operation.request.requestId };
  if (operation.kind === "create") return { ...common, debtId: null, targetId: null };
  let targetId: string | null = null;
  if (operation.kind === "void") targetId = operation.request.paymentId;
  else if (operation.kind === "edit" && operation.request.kind === "installment") targetId = operation.request.installmentId;
  else if ((operation.kind === "pay" || operation.kind === "legacy") && operation.request.allocation.rule === "selected_installment") targetId = operation.request.allocation.installmentId;
  return { ...common, debtId: operation.request.debtId, targetId };
}

/** Produces only the identifiers needed for an authenticated recovery lookup. */
export function operationReference(operation: PendingDebtOperation): DebtOperationReference {
  return referenceFromOperation(parseOperation(operation));
}
function parseReference(value: unknown): DebtOperationReference {
  const raw = record(value, ["kind", "requestId", "debtId", "targetId"]);
  if (!["create", "pay", "legacy", "void", "edit"].includes(raw.kind as string)) throw new Error("invalid_journal");
  const reference: DebtOperationReference = { kind: raw.kind as DebtOperationReference["kind"], requestId: uuid(raw.requestId), debtId: raw.debtId === null ? null : uuid(raw.debtId), targetId: raw.targetId === null ? null : uuid(raw.targetId) };
  if ((reference.kind === "create" && (reference.debtId !== null || reference.targetId !== null)) || (reference.kind !== "create" && reference.debtId === null) || (reference.kind === "void" && reference.targetId === null)) throw new Error("invalid_journal");
  return reference;
}

function normalizeJournal(value: unknown, now: number): DebtOperationJournal {
  timestamp(now);
  // The previous array format did not record its creation time. Never assign it
  // a fresh clock: retain its identity, but remove all replayable payloads.
  const legacy = Array.isArray(value);
  const raw = legacy ? { active: value, expired: [] } : record(value, ["active", "expired"]);
  if (!Array.isArray(raw.active) || !Array.isArray(raw.expired) || raw.active.length + raw.expired.length > MAX_JOURNAL_ENTRIES) throw new Error("invalid_journal");
  const journal: DebtOperationJournal = { active: [], expired: [] };
  const ids = new Set<string>();
  function reserve(id: string) {
    if (ids.has(id)) throw new Error("duplicate_journal_request");
    ids.add(id);
  }
  for (const entry of raw.active) {
    const operation = parseOperation(entry);
    reserve(operation.request.requestId);
    // Clock rollback/future timestamps cannot extend the payload's lifetime.
    if (legacy || operation.recordedAt === undefined || operation.recordedAt > now || now - operation.recordedAt >= DEBT_OPERATION_TTL_MS) journal.expired.push(referenceFromOperation(operation));
    else journal.active.push(operation);
  }
  for (const entry of raw.expired) {
    const reference = parseReference(entry);
    reserve(reference.requestId);
    journal.expired.push(reference);
  }
  return journal;
}
function encode(journal: DebtOperationJournal): string {
  const raw = JSON.stringify(journal);
  if (raw.length > MAX_JOURNAL_LENGTH) throw new Error("invalid_journal");
  return raw;
}

/** All boundaries clone and validate. Inject now to make clock behavior deterministic. */
export function parseOperationJournal(raw: string | null, now = Date.now()): DebtOperationJournal {
  timestamp(now);
  if (raw === null) return { active: [], expired: [] };
  if (typeof raw !== "string" || raw.length > MAX_JOURNAL_LENGTH) throw new Error("invalid_journal");
  return normalizeJournal(JSON.parse(raw), now);
}
export function serializeOperationJournal(journal: DebtOperationJournal, now = Date.now()): string {
  return encode(normalizeJournal(journal, now));
}

// Request parsers canonicalize values; sorting nested keys also makes object
// insertion order irrelevant to a replay of the same validated request.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
export function retainDebtOperation(current: DebtOperationJournal, operation: PendingDebtOperation, now = Date.now()): DebtOperationJournal {
  const journal = normalizeJournal(current, now);
  const parsed = parseOperation(operation);
  const id = parsed.request.requestId;
  const existing = journal.active.find((entry) => entry.request.requestId === id);
  if (existing) {
    if (canonical({ kind: existing.kind, request: existing.request }) !== canonical({ kind: parsed.kind, request: parsed.request })) throw new Error("journal_identity_conflict");
    encode(journal);
    return journal; // Preserve the first timestamp, including on repeated clicks.
  }
  const expired = journal.expired.find((entry) => entry.requestId === id);
  if (expired) {
    if (canonical(expired) !== canonical(referenceFromOperation(parsed))) throw new Error("journal_identity_conflict");
    throw new Error("journal_operation_expired");
  }
  const retained = normalizeJournal({ ...journal, active: [...journal.active, { ...parsed, recordedAt: parsed.recordedAt ?? now }] }, now);
  encode(retained);
  return retained;
}

/** Caller must verify a definitive outcome before explicitly clearing an identity. */
export function clearDebtOperation(current: DebtOperationJournal, requestId: string, now = Date.now()): DebtOperationJournal {
  const id = uuid(requestId);
  const journal = normalizeJournal(current, now);
  const cleared = { active: journal.active.filter((entry) => entry.request.requestId !== id), expired: journal.expired.filter((entry) => entry.requestId !== id) };
  encode(cleared);
  return cleared;
}
