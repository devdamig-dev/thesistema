import assert from "node:assert/strict";
import test from "node:test";
import { executePurchaseTool, interpretPurchaseCall, preparePurchaseTool, validatePurchaseCall } from "../lib/purchases/agent";
import { runAgent } from "../lib/whatsapp-agent/core";
import { interpretHeuristically } from "../lib/whatsapp-agent/interpreter";
import { WHATSAPP_TOOLS } from "../lib/whatsapp-agent/registry";
import type { AgentActor, AgentDependencies, PendingOperation, ToolCall } from "../lib/whatsapp-agent/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: AgentActor = { userId: id(1), memberId: id(2), businessId: id(3), branchIds: null, enabledModules: ["purchases"], role: "owner", phone: "5491100000000", name: "Ana" };
const example = "Registrá una compra de 10 kg de carne a Don José por $85.000";
const parse = (text: string) => interpretPurchaseCall(text, WHATSAPP_TOOLS)!;
const line = (qty = "10", unitPrice?: string) => ({ ingredient: "carne", qty, unit: "kg", ...(unitPrice ? { unitPrice } : {}) });

function harness() {
  let pending: PendingOperation | null = null;
  let sequence = 80;
  let messages = 0;
  let loseResponse = false;
  const seen = new Set<string>();
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const queries: Array<{ table: string; filters: Array<[string, string, unknown]> }> = [];
  const committed = new Set<string>();
  const rows: Record<string, Array<Record<string, any>>> = {
    branches: [{ id: id(4), business_id: actor.businessId, name: "Central" }],
    suppliers: [{ id: id(5), business_id: actor.businessId, name: "Don José", active: true }],
    ingredients: [{ id: id(6), business_id: actor.businessId, name: "carne", unit: "kg", active: true }],
  };
  const db = {
    from(table: string) {
      const filters: Array<[string, string, unknown]> = [];
      let limit = 0;
      const query: any = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push(["eq", key, value]); return query; },
        ilike(key: string, value: unknown) { filters.push(["ilike", key, value]); return query; },
        in(key: string, value: unknown) { filters.push(["in", key, value]); return query; },
        limit(value: number) { limit = value; return query; },
        then(resolve: any, reject: any) {
          queries.push({ table, filters });
          assert.equal(limit, 2);
          const data = rows[table].filter(row => filters.every(([op, key, value]) => op === "eq" ? row[key] === value : op === "in" ? (value as unknown[]).includes(row[key]) : String(row[key]).toLocaleLowerCase("es") === String(value).replace(/\\([\\%_])/g, "$1").toLocaleLowerCase("es"))).slice(0, limit);
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, args: structuredClone(args) });
      const identity = String(args.p_pending_id);
      const replayed = committed.has(identity);
      committed.add(identity);
      if (loseResponse) { loseResponse = false; throw new Error("lost response after commit"); }
      return { data: { ok: true, id: id(10), kind: "detailed", source: "whatsapp", replayed }, error: null };
    },
  };
  const deps: AgentDependencies = {
    resolveActor: async () => actor,
    claimMessage: async input => { if (seen.has(input.messageId)) return false; seen.add(input.messageId); return true; },
    interpret: interpretHeuristically,
    getPending: async () => pending,
    savePending: async value => pending = { ...value, id: id(sequence++) },
    consumePending: async pendingId => { if (pending?.id !== pendingId) return false; pending = null; return true; },
    claimPurchasePending: async (pendingId, _actor, recovery) => { if (pending?.id !== pendingId || !!pending.resultUncertain !== recovery) return false; pending = { ...pending, resultUncertain: true }; return true; },
    prepare: (a, call) => preparePurchaseTool(db, a, call),
    execute: (a, call, pendingId) => executePurchaseTool(db, a, call, pendingId),
    audit: async () => {}, now: () => new Date("2026-10-09T20:00:00Z"),
  };
  const send = (text: string) => runAgent({ text, messageId: String(messages++), senderPhone: actor.phone, recipientPhone: "5491111111111" }, deps);
  return { send, pending: () => pending, rows, queries, calls, committed, db, lose: () => { loseResponse = true; } };
}

test("literal S1 example preserves one physical line, exact supplier and supplied total", () => {
  const call = parse(example);
  assert.deepEqual(call, { name: "purchases.create", arguments: { kind: "detailed", supplier: "Don José", items: [line("10", "8500.00")], suppliedTotal: "85000.00" } });
  assert.deepEqual(validatePurchaseCall(call).issues, []);
  assert.equal((call.arguments as Record<string, unknown>).amount, undefined);
  for (const field of ["purchasedAt", "paymentMethod", "branchId", "requestId"]) assert.equal((call.arguments as Record<string, unknown>)[field], undefined);
});

test("bounded natural variants preserve names, quantity, unit and exact monetary scale", () => {
  const variants = [
    ["Cargá una compra de 10kg de carne a Don José por 85k.", "10", "kg", "8500.00", "85000.00"],
    ["Registrá una compra a Don José de 10 kilos de carne por 85 mil", "10", "kg", "8500.00", "85000.00"],
    ["Registrá una compra detallada de 2,5 kilogramos de carne por $1.000,50 a Don José", "2.5", "kg", "400.20", "1000.50"],
    ["Registrá una compra de 500 gramos de carne a Don José por $625", "500", "g", "1.25", "625.00"],
    ["Registrá una compra de 2 litros de carne a Don José por $10,50", "2", "l", "5.25", "10.50"],
    ["Registrá una compra de 500 mililitros de carne a Don José por $625", "500", "ml", "1.25", "625.00"],
    ["Nueva compra de 2 unidades de carne a Don José por $1,02", "2", "unit", "0.51", "1.02"],
    ["Registrá una compra de 0,000001 kg de carne a Don José por $0,01", "0.000001", "kg", "10000.00", "0.01"],
  ];
  for (const [text, qty, unit, unitPrice, suppliedTotal] of variants) {
    const call = parse(text);
    assert.deepEqual(call.arguments, { kind: "detailed", supplier: "Don José", items: [{ ingredient: "carne", qty, unit, unitPrice }], suppliedTotal }, text);
    assert.deepEqual(validatePurchaseCall(call).issues, [], text);
  }
  for (const text of ["Registrá una compra de 85k a Don José", "Registrá una compra de 85 mil a Don José", "Registrá una compra a Don José por $85.000"]) {
    assert.equal(parse(text).arguments.kind, "summary", text);
    assert.equal(parse(text).arguments.amount, "85000.00", text);
  }
});

test("exact cents division never fabricates a price, including a rounded product that would match", () => {
  for (const [qty, total] of [["3", "10"], ["0,3", "1"], ["6", "0,01"], ["7", "85.000"], ["0,000001", "9999999999,99"]]) {
    const call = parse(`Registrá una compra de ${qty} kg de carne a Don José por $${total}`);
    assert.equal(call.arguments.kind, "detailed");
    assert.deepEqual(call.arguments.items, [line(qty.replace(",", "."))]);
    const validation = validatePurchaseCall(call);
    assert.equal(validation.issues[0].key, "items");
    assert.match(validation.issues[0].message, /precio unitario explícito/);
    assert.deepEqual(validation.call.arguments.items, call.arguments.items);
    assert.equal(validation.call.arguments.suppliedTotal, call.arguments.suppliedTotal);
  }
});

test("ambiguous money, absent totals and kg are never parsed as monetary k", () => {
  for (const suffix of ["", " por $85 o $90", " por 85kg", " por $1.999,999", " por $85.000 y envío de $500", " por $85k cada kg"]) {
    const call = parse(`Registrá una compra de 10 kg de carne a Don José${suffix}`);
    assert.equal(call.arguments.kind, "detailed");
    assert.deepEqual(call.arguments.items, [line()]);
    assert.equal(call.arguments.suppliedTotal, undefined);
    assert.equal(call.arguments.amount, undefined);
  }
});

test("unsupported physical lists, units, quantities or missing facts never degrade into summary", () => {
  for (const text of [
    "Registrá una compra de 10 kg de carne y 2 kg de pollo a Don José por $85.000",
    "Registrá una compra de 10 kg de carne\ny 2 kg de pollo a Don José por $85.000",
    "Registrá una compra de 2 cajas de carne a Don José por $85.000",
    "Registrá una compra de 2 o 3 kg de carne a Don José por $85.000",
    "Registrá una compra de kg de carne a Don José por $85.000",
  ]) {
    const call = parse(text);
    assert.equal(call.arguments.kind, "detailed", text);
    assert.equal(call.arguments.amount, undefined, text);
    assert.equal(call.arguments.items, undefined, text);
  }
  for (const qty of ["0", "-2", "1,0000001", "9999999999999"]) {
    const call = parse(`Registrá una compra de ${qty} kg de carne a Don José por $85.000`);
    assert.equal(call.arguments.kind, "detailed", qty);
    assert.notEqual((call.arguments.items as any[])[0].qty, "1", qty);
    assert.ok(validatePurchaseCall(call).issues.length, qty);
  }
});

test("natural detail survives date, method, branch clarification and waits for explicit confirmation", async () => {
  const h = harness(); h.rows.branches.push({ id: id(7), business_id: actor.businessId, name: "Norte" });
  assert.equal((await h.send(example)).status, "needs_input");
  assert.deepEqual(h.pending()?.toolCall.arguments.items, [line("10", "8500.00")]);
  assert.equal((await h.send("Sí")).status, "needs_input");
  assert.equal((await h.send("Transferencia")).status, "needs_input");
  assert.equal((await h.send("hoy")).status, "needs_input");
  assert.equal((await h.send("2026-10-09")).status, "needs_input");
  assert.equal(h.pending()?.clarificationKey, "branchId");
  assert.equal(h.pending()?.toolCall.arguments.branchId, undefined);
  const confirmation = await h.send(id(7));
  assert.equal(confirmation.status, "needs_confirmation");
  for (const fragment of ["Don José", "Norte", "10 kg × 8500.00", "Total: 85000.00", "2026-10-09", "Transferencia"]) assert.ok(confirmation.text.includes(fragment), fragment);
  assert.equal(h.calls.length, 0);
  const pending = structuredClone(h.pending()!);
  assert.deepEqual(pending.toolCall.arguments.items, [{ ingredientId: id(6), description: "carne", qty: "10", unit: "kg", unitPrice: "8500.00" }]);
  assert.equal(pending.toolCall.arguments.suppliedTotal, undefined);
  assert.equal((await h.send("Sí")).status, "completed");
  assert.deepEqual(h.calls, [{ name: "commit_purchase_atomic", args: { p_business_id: actor.businessId, p_input: null, p_extraction_id: null, p_pending_id: pending.id } }]);
  assert.equal(h.committed.size, 1);
});

test("nondivisible total retains every explicit fact across invalid and price clarification replies", async () => {
  const h = harness();
  const reply = await h.send("Registrá una compra de 3 kg de carne a Don José por $10");
  assert.equal(reply.status, "needs_input"); assert.match(reply.text, /precio unitario explícito/);
  const original = structuredClone(h.pending()!.toolCall.arguments);
  assert.deepEqual(original, { kind: "detailed", supplier: "Don José", items: [line("3")], suppliedTotal: "10.00" });
  for (const response of ["Sí", "3 o 4", "$3.3333", "precio desconocido"]) {
    assert.equal((await h.send(response)).status, "needs_input");
    assert.deepEqual(h.pending()?.toolCall.arguments, original, response);
  }
  const mismatch = await h.send("$3,33");
  assert.equal(mismatch.status, "needs_input"); assert.match(mismatch.text, /no coincide/);
  assert.deepEqual(h.pending()?.toolCall.arguments.items, [line("3", "3.33")]);
  assert.equal(h.pending()?.toolCall.arguments.suppliedTotal, "10.00");
  const corrected = await h.send(JSON.stringify({ items: [line("3", "3.33")], suppliedTotal: "9.99" }));
  assert.equal(corrected.status, "needs_input"); assert.match(corrected.text, /medio de pago/);
  assert.equal(h.pending()?.toolCall.arguments.suppliedTotal, "9.99");
  await h.send("Efectivo"); const confirmation = await h.send("2026-10-09");
  assert.equal(confirmation.status, "needs_confirmation"); assert.match(confirmation.text, /Total: 9.99/);
  assert.equal(h.calls.length, 0);
});

test("missing or ambiguous totals accept an explicit price while preserving physical facts", async () => {
  for (const suffix of ["", " por $85 o $90"]) {
    const h = harness(); await h.send(`Registrá una compra de 10 kg de carne a Don José${suffix}`);
    assert.deepEqual(h.pending()?.toolCall.arguments.items, [line()]);
    assert.equal((await h.send("$8.500")).status, "needs_input");
    assert.deepEqual(h.pending()?.toolCall.arguments.items, [line("10", "8500.00")]);
    assert.equal(h.pending()?.toolCall.arguments.supplier, "Don José");
    assert.equal(h.calls.length, 0);
  }
});

test("invalid explicit total corrections cannot clear the supplied total constraint and confirm", async () => {
  for (const suppliedTotal of [null, "", 9.99, "ambiguous"]) {
    const h = harness(); await h.send("Registrá una compra de 3 kg de carne a Don José por $10");
    const reply = await h.send(JSON.stringify({ items: [line("3", "3.33")], suppliedTotal }));
    assert.equal(reply.status, "needs_input"); assert.equal(h.pending()?.clarificationKey, "suppliedTotal");
    assert.equal((await h.send("Sí")).status, "needs_input");
    assert.equal(h.calls.length, 0);
  }
});

test("unknown, inactive, duplicate and foreign ingredients never fuzzy-map or become summary", async () => {
  for (const change of [
    (h: ReturnType<typeof harness>) => { h.rows.ingredients[0].name = "Carne vacuna"; },
    (h: ReturnType<typeof harness>) => { h.rows.ingredients[0].active = false; },
    (h: ReturnType<typeof harness>) => { h.rows.ingredients[0].business_id = id(99); },
    (h: ReturnType<typeof harness>) => { h.rows.ingredients.push({ ...h.rows.ingredients[0], id: id(8) }); },
  ]) {
    const h = harness(); change(h); await h.send(example); await h.send("Efectivo");
    assert.equal((await h.send("2026-10-09")).status, "needs_input");
    assert.equal(h.pending()?.clarificationKey, "items");
    assert.equal(h.pending()?.toolCall.arguments.kind, "detailed");
    assert.deepEqual(h.pending()?.toolCall.arguments.items, [line("10", "8500.00")]);
    assert.equal(h.pending()?.toolCall.arguments.suppliedTotal, "85000.00");
    assert.equal(h.calls.length, 0);
    assert.ok(h.queries.every(query => query.filters.some(([op, key, value]) => op === "eq" && key === "business_id" && value === actor.businessId)));
  }
});

test("unknown supplier requires exact correction without discarding detail or total", async () => {
  const h = harness(); h.rows.suppliers[0].name = "Don José e Hijos";
  await h.send(example); await h.send("Efectivo"); await h.send("2026-10-09");
  assert.equal(h.pending()?.clarificationKey, "supplier");
  assert.equal(h.pending()?.toolCall.arguments.supplier, "Don José");
  assert.deepEqual(h.pending()?.toolCall.arguments.items, [line("10", "8500.00")]);
  assert.equal((await h.send("Don José e Hijos")).status, "needs_confirmation");
  assert.equal(h.calls.length, 0);
});

test("natural detail keeps its durable purchase identity after a lost response", async () => {
  const h = harness(); await h.send(example); await h.send("Transferencia"); await h.send("2026-10-09");
  const original = structuredClone(h.pending()!); h.lose();
  assert.equal((await h.send("Sí")).status, "failed");
  assert.equal(h.pending()?.resultUncertain, true);
  assert.deepEqual(h.pending()?.toolCall, original.toolCall);
  assert.equal((await h.send("Sí")).status, "completed");
  assert.deepEqual(h.calls[0], h.calls[1]); assert.equal(h.committed.size, 1);
});

test("partial priced drafts cannot be prepared or executed directly", async () => {
  const h = harness(); const partial: ToolCall = { name: "purchases.create", arguments: { ...parse("Registrá una compra de 3 kg de carne a Don José por $10").arguments, paymentMethod: "Efectivo", purchasedAt: "2026-10-09", branchId: id(4), supplierId: id(5), requestId: id(99) } };
  await assert.rejects(() => preparePurchaseTool(h.db, actor, partial), /purchase_missing_fields/);
  await assert.rejects(() => executePurchaseTool(h.db, actor, partial, id(80)), /purchase_missing_fields/);
  assert.equal(h.calls.length, 0);
});


test("Argentine grouped quantities become unambiguous canonical quantities before price division", () => {
  const cases = [
    ["1.000", "$85.000", "1000", "85.00"],
    ["1.234", "$2.468", "1234", "2.00"],
    ["1.234,5", "$2.469", "1234.5", "2.00"],
    ["1.234.567", "$1.234.567", "1234567", "1.00"],
    ["1.000,000000", "$85.000", "1000", "85.00"],
    ["1.5", "$3", "1.5", "2.00"],
    ["1,5", "$3", "1.5", "2.00"],
    ["1.5000", "$3", "1.5", "2.00"],
    ["0.125", "$1", "0.125", "8.00"],
    ["0,125", "$1", "0.125", "8.00"],
    ["999.999.999.999", "$9.999.999.999,99", "999999999999", "0.01"],
  ];
  for (const [input, total, qty, unitPrice] of cases) {
    const call = parse(`Registrá una compra de ${input} kg de carne a Don José por ${total}`);
    assert.deepEqual(call.arguments.items, [line(qty, unitPrice)], input);
    assert.deepEqual(validatePurchaseCall(call).issues, [], input);
    const [whole, fraction = ""] = qty.split(".");
    const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
    const cents = BigInt(unitPrice.replace(".", ""));
    // No rounded cents can hide a mistaken quantity scale.
    assert.equal(micros * cents, BigInt(String(call.arguments.suppliedTotal).replace(".", "")) * 1000000n, input);
  }
});

test("invalid human quantity separators or precision cannot produce an invented unit price", () => {
  for (const qty of ["1.23.4", "1.23,4", "1,234.5", "1,234,5", "01.000", "1.000,0000001", "1.000.000.000.000"]) {
    const call = parse(`Registrá una compra de ${qty} kg de carne a Don José por $85.000`);
    assert.equal(call.arguments.kind, "detailed", qty);
    assert.equal(call.arguments.amount, undefined, qty);
    assert.equal((call.arguments.items as any[])[0].qty, qty, qty);
    assert.equal((call.arguments.items as any[])[0].unitPrice, undefined, qty);
    assert.ok(validatePurchaseCall(call).issues.some(issue => issue.key === "items"), qty);
  }
});

test("grouped quantities remain canonical through nondivisible-price clarification and confirmation", async () => {
  const h = harness();
  await h.send("Registrá una compra de 1.234 kg de carne a Don José por $85.000");
  assert.deepEqual(h.pending()?.toolCall.arguments.items, [line("1234")]);
  assert.equal(h.pending()?.toolCall.arguments.suppliedTotal, "85000.00");
  assert.equal((await h.send("$68,88")).status, "needs_input");
  assert.deepEqual(h.pending()?.toolCall.arguments.items, [line("1234", "68.88")]);
  assert.equal(h.calls.length, 0);

  const ready = harness(); await ready.send("Registrá una compra de 1.000 kg de carne a Don José por $85.000");
  await ready.send("Efectivo"); const confirmation = await ready.send("2026-10-09");
  assert.equal(confirmation.status, "needs_confirmation");
  assert.match(confirmation.text, /1000 kg × 85.00/);
  assert.doesNotMatch(confirmation.text, /1\.000 kg/);
  assert.match(confirmation.text, /Total: 85000.00/);
  assert.equal(ready.calls.length, 0);
});

test("human semicolon item clarification uses the same Argentine quantity grammar", async () => {
  const h = harness();
  await h.send("Registrá una compra de kg de carne a Don José por $85.000");
  await h.send("Don José");
  const response = await h.send("carne; 1.234,5; kg; $2");
  assert.equal(response.status, "needs_input");
  assert.deepEqual(h.pending()?.toolCall.arguments.items, [line("1234.5", "2.00")]);
  assert.equal(h.calls.length, 0);
});

test("canonical JSON quantities keep decimal semantics separately from human grouping", () => {
  const call = parse(`compra: ${JSON.stringify({ kind: "detailed", supplier: "Don José", items: [line("1.000", "85.00")], suppliedTotal: "85.00" })}`);
  const validated = validatePurchaseCall(call);
  assert.deepEqual(validated.issues, []);
  assert.deepEqual(validated.call.arguments.items, [line("1.000", "85.00")]);
  assert.equal(validated.call.arguments.suppliedTotal, "85.00");
});
