import test from "node:test";
import assert from "node:assert/strict";
import { closureAmount, closureJournalKey, parseClosureOperation, readClosureOperation, mutateClosure } from "../lib/closures/domain";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = () => ({ requestId: id(1), businessId: id(2), userId: id(3), id: null, expectedVersion: null, branchId: id(4), closureDate: "2026-01-01", grossTotal: "100.10", netTotal: "-0.10", note: "Cierre real", reason: null });
test("closure validation preserves exact decimals and signed net without inferred transactions", () => {
 const operation = parseClosureOperation("save", input()); assert.equal(operation.kind, "save"); assert.deepEqual(operation.input, input());
 assert.equal(closureAmount("9999999999.99"), "9999999999.99"); assert.equal(closureAmount("-9999999999.99", true), "-9999999999.99");
 for (const value of ["", "1e3", "1,00", "1.001", "-1", "10000000000", "NaN", 1, null]) assert.throws(() => closureAmount(value));
});
test("closure commands reject unknown metadata, invalid dates, stale versions and missing correction/archive reasons", () => {
 for (const patch of [{ source: "whatsapp" }, { parsed: {} }, { closureDate: "2026-02-30" }, { closureDate: "2026-13-01" }, { closureDate: "2025-02-29" }, { closureDate: "2099" }, { branchId: null }, { expectedVersion: 0 }, { id: id(5) }, { id: id(5), expectedVersion: -1 }, { id: id(5), expectedVersion: 0 }, { note: "x\0" }]) assert.throws(() => parseClosureOperation("save", { ...input(), ...patch }));
 assert.doesNotThrow(() => parseClosureOperation("save", { ...input(), closureDate: "2024-02-29" }));
 assert.doesNotThrow(() => parseClosureOperation("save", { ...input(), id: id(5), expectedVersion: 0, branchId: null, reason: "Correction" }));
 assert.throws(() => parseClosureOperation("archive", { requestId: id(1), businessId: id(2), userId: id(3), id: id(5), expectedVersion: 0, reason: " " }));
});
test("pending closure journal retains exact operation across reload and rejects corruption or identity changes", () => {
 const operation = parseClosureOperation("save", input()); assert.deepEqual(readClosureOperation(JSON.stringify(operation), id(2), id(3)), operation);
 assert.equal(readClosureOperation(null, id(2), id(3)), null);
 for (const raw of ["{", "{}", JSON.stringify({ ...operation, kind: "delete" }), JSON.stringify({ ...operation, extra: true })]) assert.throws(() => readClosureOperation(raw, id(2), id(3)));
 assert.throws(() => readClosureOperation(JSON.stringify(operation), id(2), id(7))); assert.notEqual(closureJournalKey(id(2), id(3)), closureJournalKey(id(2), id(7)));
});
test("closure RPC boundary distinguishes rejected, committed, and lost responses", async () => {
 const context = { businessId: id(2), userId: id(3) }; const calls: unknown[] = [];
 const db = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: { ok: true, id: id(8), version: 1 }, error: null }; } };
 assert.equal((await mutateClosure(db, context, "save", input())).ok, true); assert.equal(calls.length, 1);
 assert.equal((await mutateClosure(db, { ...context, userId: id(7) }, "save", input())).ok, false); assert.equal(calls.length, 1);
 for (const response of [{ data: null, error: { code: "timeout" } }, { data: { ok: true, id: id(8), version: "1" }, error: null }]) { const result = await mutateClosure({ rpc: async () => response }, context, "save", input()); assert.equal(result.ok ? true : result.persisted, "unknown"); }
 const rejected = await mutateClosure({ rpc: async () => ({ data: { ok: false, error: "closure_conflict" }, error: null }) }, context, "save", input()); assert.equal(rejected.ok ? true : rejected.persisted, false);
 const thrown = await mutateClosure({ rpc: async () => { throw new Error("lost"); } }, context, "save", input()); assert.equal(thrown.ok ? true : thrown.persisted, "unknown");
});
