import test from "node:test";
import assert from "node:assert/strict";
import { parseInboxClosureApproval, recoverInboxClosure } from "../lib/closures/inbox";
import { closureRpcResult } from "../lib/closures/domain";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const input = () => ({ extractionId: id(10), businessId: id(2), userId: id(1), expectedFields: { total: 100, cash: 100, date: "16/05" }, review: { branchId: id(3), closureDate: "2026-01-02", grossTotal: "100.00", netTotal: "80.00", note: "Resumen revisado" } });
test("Inbox closure demands explicit full date and both totals without fabricating accounting", () => {
  const parsed = parseInboxClosureApproval(input()); assert.deepEqual(parsed.expectedFields, input().expectedFields); assert.equal(parsed.review.netTotal, "80.00");
  for (const patch of [{ closureDate: "16/05" }, { closureDate: "" }, { closureDate: "2026-02-30" }, { netTotal: "" }, { netTotal: 80 }, { grossTotal: "0.001" }, { source: "manual" }, { branchId: null }]) assert.throws(() => parseInboxClosureApproval({ ...input(), review: { ...input().review, ...patch } }));
  const incomplete: any = input(); delete incomplete.review.netTotal; assert.throws(() => parseInboxClosureApproval(incomplete));
  assert.equal(parseInboxClosureApproval({ ...input(), review: { ...input().review, netTotal: "-20.50" } }).review.netTotal, "-20.50");
});
test("Inbox closure frozen recovery is bound to extraction, tenant and actor", () => {
  const original = input(); const parsed = parseInboxClosureApproval(original); original.expectedFields.total = 999;
  assert.equal(parsed.expectedFields.total, 100); assert.deepEqual(recoverInboxClosure(JSON.stringify(parsed), parsed), parsed);
  for (const patch of [{ businessId: id(99) }, { userId: id(99) }, { extractionId: id(99) }]) assert.throws(() => recoverInboxClosure(JSON.stringify(parsed), { ...parsed, ...patch }));
  assert.equal(closureRpcResult({ data: { ok: false }, error: null }).persisted, "unknown");
});
