import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { executePurchaseTool, interpretPurchaseCall, missingPurchaseArguments, preparePurchaseTool, validatePurchaseCall } from "../lib/purchases/agent";
import { runAgent } from "../lib/whatsapp-agent/core";
import { interpretHeuristically } from "../lib/whatsapp-agent/interpreter";
import { WHATSAPP_TOOLS } from "../lib/whatsapp-agent/registry";
import type { AgentActor, AgentDependencies, PendingOperation, ToolCall } from "../lib/whatsapp-agent/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: AgentActor = { userId: id(1), memberId: id(2), businessId: id(3), branchIds: [id(4)], enabledModules: ["purchases"], role: "owner", phone: "5491100000000", name: "Ana" };
const call = (): ToolCall => ({ name: "purchases.create", arguments: { kind: "summary", supplier: "Don José", amount: "180000.50", purchasedAt: "2026-10-09", paymentMethod: "Transferencia" } });
function fixture() {
  const rows: Record<string, any[]> = { branches: [{ id: id(4), business_id: actor.businessId, name: "Central" }], suppliers: [{ id: id(5), business_id: actor.businessId, name: "Don José", active: true }] };
  const calls: Array<{ name: string; args: any }> = [];
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]>; limit: number }> = [];
  const persisted = new Map<string, any>();
  let loseResponse = false;
  const db: any = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let limit = Infinity;
      const q: any = {
        select() { return q; }, eq(key: string, value: unknown) { filters.push(["eq", key, value]); return q; },
        ilike(key: string, value: unknown) { filters.push(["ilike", key, value]); return q; },
        in(key: string, value: unknown) { filters.push(["in", key, value]); return q; },
        limit(value: number) { limit = value; return q; },
        then(resolve: any, reject: any) {
          queries.push({ table, filters, limit });
          const data = (rows[table] ?? []).filter(row => filters.every(([op, key, value]) => op === "eq" ? row[key] === value : op === "in" ? (value as unknown[]).includes(row[key]) : String(row[key]).toLocaleLowerCase("es") === String(value).replace(/\\([\\%_])/g, "$1").toLocaleLowerCase("es"))).slice(0, limit);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name: string, args: any) {
      calls.push({ name, args: structuredClone(args) });
      const replayed = persisted.has(args.p_pending_id);
      if (!replayed) persisted.set(args.p_pending_id, { ok: true, id: id(10), kind: "summary", source: "whatsapp" });
      if (loseResponse) { loseResponse = false; throw new Error("connection lost after commit"); }
      return { data: { ...persisted.get(args.p_pending_id), replayed }, error: null };
    },
  };
  return { db, rows, calls, queries, persisted, lose: () => { loseResponse = true; } };
}
function harness(f = fixture()) {
  let pending: PendingOperation | null = null;
  let sequence = 80;
  const seen = new Set<string>();
  const executions: Array<{ call: ToolCall; pendingId?: string }> = [];
  const deps: AgentDependencies = {
    resolveActor: async () => actor,
    claimMessage: async input => { if (seen.has(input.messageId)) return false; seen.add(input.messageId); return true; },
    interpret: interpretHeuristically,
    getPending: async () => pending,
    savePending: async value => pending = { ...value, id: id(sequence++) },
    consumePending: async pendingId => { if (pending?.id !== pendingId) return false; pending = null; return true; },
    claimPurchasePending: async (pendingId, _actor, recovery) => { if (pending?.id !== pendingId || !!pending.resultUncertain !== recovery) return false; pending = { ...pending, resultUncertain: true }; return true; },
    cancelPurchasePending: async pendingId => { if (pending?.id !== pendingId) return { consumed: false, resultUncertain: false }; const resultUncertain = !!pending.resultUncertain; pending = null; return { consumed: true, resultUncertain }; },
    prepare: (a, c) => preparePurchaseTool(f.db, a, c),
    execute: (a, c, pendingId) => { executions.push({ call: c, pendingId }); return executePurchaseTool(f.db, a, c, pendingId); },
    audit: async () => {}, now: () => new Date("2026-10-09T20:00:00Z"),
  };
  let messages = 0;
  const send = (text: string, messageId = String(messages++)) => runAgent({ text, messageId, senderPhone: actor.phone, recipientPhone: "5491111111111" }, deps);
  const request = () => send(`compra: ${JSON.stringify(call().arguments)}`);
  return { f, deps, executions, send, request, pending: () => pending };
}

test("purchase summary asks for explicit date and method, never guesses detail, branch, dates or stock", async () => {
  const h = harness();
  const first = await h.send("Registrá una compra de $180.000 a Don José.");
  assert.equal(first.status, "needs_input"); assert.match(first.text, /medio de pago/);
  assert.equal(h.pending()?.toolCall.arguments.amount, "180000.00");
  assert.equal((await h.send("Sí")).status, "needs_input");
  const date = await h.send("Transferencia"); assert.equal(date.status, "needs_input"); assert.match(date.text, /fecha de compra/);
  assert.equal(h.pending()?.toolCall.arguments.purchasedAt, undefined);
  assert.equal((await h.send("hoy")).status, "needs_input");
  assert.equal((await h.send("2026-10-09")).status, "needs_confirmation");
  const args = h.pending()!.toolCall.arguments;
  assert.equal(args.kind, "summary"); assert.equal(args.branchId, id(4)); assert.equal(args.supplierId, id(5));
  for (const field of ["qty", "unit", "items", "source", "actorId", "supplier"]) assert.equal(args[field], undefined);
  assert.equal(h.f.calls.length, 0);
});

test("purchase confirmation previews complete persisted facts; only persisted pending ID reaches unified RPC", async () => {
  const h = harness(); const reply = await h.request();
  assert.equal(reply.status, "needs_confirmation");
  for (const text of ["Don José", "Central", id(4), id(5), "2026-10-09", "180.000,50", "Transferencia", "moneda no informada", "sin renglones", "stock"]) assert.ok(reply.text.includes(text), text);
  const pending = structuredClone(h.pending()!);
  assert.equal((await h.send("Sí")).status, "completed");
  assert.deepEqual(h.f.calls, [{ name: "commit_purchase_atomic", args: { p_business_id: actor.businessId, p_input: null, p_extraction_id: null, p_pending_id: pending.id } }]);
  assert.equal(h.executions[0].pendingId, pending.id);
  assert.equal(h.pending(), null);
});

test("two simultaneous confirmations execute a purchase once; duplicate delivery never repeats", async () => {
  const h = harness(); await h.request();
  const replies = await Promise.all([h.send("Sí", "one"), h.send("Sí", "two")]);
  assert.deepEqual(replies.map(r => r.status).sort(), ["completed", "rejected"]);
  assert.equal(h.f.calls.length, 1); assert.equal((await h.send("Sí", "one")).status, "duplicate");
});

test("lost response and process interruption retain exact purchase identity for recovery", async () => {
  const h = harness(); await h.request(); const original = structuredClone(h.pending()!);
  h.f.lose(); const failure = await h.send("Sí"); assert.equal(failure.status, "failed"); assert.match(failure.text, /podría haberse guardado/);
  assert.equal(h.pending()?.resultUncertain, true); assert.equal(h.pending()?.toolCall.arguments.requestId, original.toolCall.arguments.requestId);
  const recovered = await h.send("Sí"); assert.equal(recovered.status, "completed"); assert.equal((recovered.data as any).replayed, true);
  assert.deepEqual(h.f.calls[0], h.f.calls[1]); assert.equal(h.f.persisted.size, 1);
  const crash = harness(); await crash.request(); const before = crash.pending()!;
  await crash.deps.claimPurchasePending!(before.id, actor, false);
  assert.equal((await crash.send("Sí")).status, "completed"); assert.equal(crash.executions[0].call.arguments.requestId, before.toolCall.arguments.requestId);
});

test("uncertain cancellation and late timeout never resurrect or claim to roll back a purchase", async () => {
  const h = harness(); await h.request(); let entered!: () => void; let release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const gate = new Promise<void>(resolve => { release = resolve; });
  h.deps.execute = async () => { entered(); await gate; throw new Error("purchase_response_unknown"); };
  const execution = h.send("Sí"); await started; assert.equal(h.pending()?.resultUncertain, true);
  const cancelled = await h.send("Cancelar"); assert.equal(cancelled.status, "cancelled"); assert.match(cancelled.text, /podría haberse guardado/);
  release(); const result = await execution; assert.equal(result.status, "failed"); assert.match(result.text, /No reactivé/); assert.equal(h.pending(), null);
});

test("expired or malformed durable purchase is retained rather than converted to clarification", async () => {
  for (const mutation of [(p: PendingOperation) => { p.expiresAt = "2026-01-01T00:00:00Z"; }, ...["amount", "requestId", "supplierId", "branchId"].map(key => (p: PendingOperation) => { delete p.toolCall.arguments[key]; })]) {
    const h = harness(); await h.request(); mutation(h.pending()!); const before = structuredClone(h.pending());
    assert.equal((await h.send("Sí")).status, "needs_input"); assert.deepEqual(h.pending(), before); assert.equal(h.f.calls.length, 0);
    assert.equal((await h.send("Cancelar")).status, "cancelled");
  }
});

test("purchase interpreter cannot forge actor, source, operation identity, labels or stock rows", async () => {
  for (const extra of [{ businessId: id(30) }, { actorId: id(30) }, { source: "manual" }, { pendingId: id(30) }, { requestId: id(30) }, { __resultUncertain: true }, { expectedVersion: 1 }, { supplierLabel: "fake" }, { branchLabel: "fake" }, { items: [] }, { qty: 1 }, { unit: "unit" }]) {
    const h = harness(); const reply = await h.send(`compra: ${JSON.stringify({ ...call().arguments, ...extra })}`);
    assert.equal(reply.status, "rejected", JSON.stringify(extra)); assert.equal(h.pending(), null); assert.equal(h.f.calls.length, 0);
  }
});

test("purchase amounts are exact decimal strings; ambiguous money/date clarifications stay missing", async () => {
  for (const amount of [0.1, 100, "0", "-1", "1.005", "1e3", "10000000000", "Infinity", "1,00"]) assert.ok(validatePurchaseCall({ ...call(), arguments: { ...call().arguments, amount } }).issues.length);
  for (const purchasedAt of ["2026-02-30", "hoy", "10/09", "0000-01-01"]) assert.ok(validatePurchaseCall({ ...call(), arguments: { ...call().arguments, purchasedAt } }).issues.length);
  const pending: PendingOperation = { id: id(90), actor, kind: "clarification", toolCall: { name: "purchases.create", arguments: { kind: "summary", supplier: "Don José" } }, expiresAt: "2099-01-01T00:00:00Z" };
  for (const [text, expected] of [["$180.000,50", "180000.50"], ["180k", "180000.00"], ["0,01", "0.01"], ["2026-10-09", undefined], ["cuota 2", undefined], ["1.999,999", undefined]]) assert.equal(interpretPurchaseCall(text!, WHATSAPP_TOOLS, pending)?.arguments.amount, expected);
  assert.ok(missingPurchaseArguments({ name: "purchases.create", arguments: {} }).includes("purchasedAt"));
});

test("purchase preparation fails closed on ambiguous supplier/branch and prompts exact IDs", async () => {
  const f = fixture(); f.rows.branches.push({ id: id(6), business_id: actor.businessId, name: "Norte" });
  await assert.rejects(() => preparePurchaseTool(f.db, { ...actor, branchIds: null }, call()), /purchase_branch_ambiguous/);
  f.rows.suppliers.push({ id: id(7), business_id: actor.businessId, name: "Don José", active: true });
  const h = harness(f); assert.equal((await h.request()).status, "needs_input"); assert.equal(h.pending()?.clarificationKey, "supplierId");
  assert.equal((await h.send(id(7))).status, "needs_confirmation"); assert.equal(h.pending()?.toolCall.arguments.supplierId, id(7));
  assert.equal(f.calls.length, 0); assert.ok(f.queries.every(q => q.limit === 2));
});

test("purchase server resolution enforces tenant, scope, active supplier, role and enabled module", async () => {
  for (const bad of [{ ...actor, role: "viewer" as const }, { ...actor, enabledModules: [] }, { ...actor, businessId: id(77) }, { ...actor, branchIds: [] }, { ...actor, branchIds: [id(77)] }]) {
    const f = fixture(); await assert.rejects(() => preparePurchaseTool(f.db, bad, call())); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.rows.suppliers[0].active = false; await assert.rejects(() => preparePurchaseTool(f.db, actor, call()), /purchase_supplier_not_found/);
  const good = fixture(); const prepared = await preparePurchaseTool(good.db, actor, call());
  await assert.rejects(() => executePurchaseTool(good.db, { ...actor, branchIds: [] }, prepared, id(90)), /purchase_write_rejected/);
  await assert.rejects(() => executePurchaseTool(good.db, actor, prepared), /purchase_write_rejected/);
  assert.equal(good.calls.length, 0);
});

test("supplier wildcard input stays literal and server prep replaces caller request IDs", async () => {
  const f = fixture(); f.rows.suppliers[0].name = "100%_Proveedor";
  const prepared = await preparePurchaseTool(f.db, actor, { ...call(), arguments: { ...call().arguments, supplier: "100%_Proveedor", requestId: id(99) } });
  assert.notEqual(prepared.arguments.requestId, id(99));
  assert.ok(f.queries[1].filters.some(([op, key, value]) => op === "ilike" && key === "name" && value === "100\\%\\_Proveedor"));
});

test("malformed purchase success envelopes retain uncertain pending and stable request ID", async () => {
  const valid = { ok: true, id: id(10), replayed: false, kind: "summary", source: "whatsapp" };
  for (const data of [null, [], {}, { ...valid, ok: false }, { ...valid, id: "invalid" }, { ...valid, replayed: undefined }, { ...valid, kind: "detailed" }, { ...valid, source: "manual" }]) {
    const h = harness(); await h.request(); const before = h.pending()!.toolCall.arguments.requestId;
    h.f.db.rpc = async () => ({ data, error: null });
    assert.equal((await h.send("Sí")).status, "failed"); assert.equal(h.pending()?.resultUncertain, true); assert.equal(h.pending()?.toolCall.arguments.requestId, before);
  }
});

test("purchase rejection never clears a durable recovery marker or falls back to direct writes", async () => {
  const h = harness(); await h.request(); h.f.db.rpc = async () => ({ data: null, error: { message: "purchase_permission_denied" } });
  assert.equal((await h.send("Sí")).status, "needs_input"); assert.equal(h.pending()?.resultUncertain, true);
  const source = readFileSync("lib/whatsapp-agent/supabase-adapter.ts", "utf8");
  assert.doesNotMatch(source, /\.from\("purchases"\)[\s\S]{0,100}\.insert/);
  assert.match(source, /claim_purchase_pending_execution/); assert.match(source, /cancel_purchase_pending_execution/);
});

test("purchase claim failure and missing dependency never fall back to consume-before-write", async () => {
  for (const absent of [true, false]) {
    const h = harness(); await h.request(); const original = h.pending()!.id;
    h.deps.claimPurchasePending = absent ? undefined : async () => { throw new Error("lost claim response"); };
    assert.ok(["failed", "rejected"].includes((await h.send("Sí")).status));
    assert.equal(h.pending()?.id, original); assert.equal(h.f.calls.length, 0);
  }
});

test("purchase cancellation uses current durable uncertainty even when its snapshot was stale", async () => {
  const h = harness(); await h.request(); const stale = structuredClone(h.pending()!);
  await h.deps.claimPurchasePending!(stale.id, actor, false);
  h.deps.getPending = async () => stale;
  const reply = await h.send("Cancelar"); assert.equal(reply.status, "cancelled"); assert.match(reply.text, /podría haberse guardado/); assert.equal(h.pending(), null);
});

test("confirmed purchase success survives cleanup/audit failures and can replay without duplicate", async () => {
  const h = harness(); await h.request();
  h.deps.consumePending = async () => { throw new Error("cleanup unavailable"); };
  h.deps.audit = async () => { throw new Error("audit unavailable"); };
  const first = await h.send("Sí"); assert.equal(first.status, "completed"); assert.match(first.text, /incidencia interna/);
  assert.equal(h.pending()?.resultUncertain, true); assert.equal((await h.send("Sí")).status, "completed"); assert.equal(h.f.persisted.size, 1);
});

test("debt requests about purchases keep existing debt routing priority", async () => {
  const result = await interpretHeuristically("Registrá una deuda de Don José por $100 por la compra.", [...WHATSAPP_TOOLS]);
  assert.ok(result?.name.startsWith("debts."));
});


test("Supabase network error envelopes remain uncertain instead of claiming database rejection", async () => {
  const h = harness(); await h.request(); h.f.db.rpc = async () => ({ data: null, error: { message: "TypeError: fetch failed", code: "" } });
  const result = await h.send("Sí"); assert.equal(result.status, "failed"); assert.match(result.text, /Respondé Sí/); assert.equal(h.pending()?.resultUncertain, true);
});
