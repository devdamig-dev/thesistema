import test from "node:test";
import assert from "node:assert/strict";
import { buildReplenishmentReport, validateReplenishmentInput } from "../lib/replenishment/domain";
import { readReplenishment, readReplenishmentRows } from "../lib/replenishment/read";
import { formatReplenishmentReport } from "../lib/replenishment/agent";
import { interpretHeuristically, getMissingArguments } from "../lib/whatsapp-agent/interpreter";
import { toolsForActor, WHATSAPP_TOOLS } from "../lib/whatsapp-agent/registry";
import { validateToolCall } from "../lib/whatsapp-agent/validation";
import type { ReplenishmentData } from "../lib/replenishment/types";
import type { AgentActor, PendingOperation } from "../lib/whatsapp-agent/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: AgentActor = { userId: id(1), memberId: id(2), businessId: id(3), phone: "0000", name: "QA", role: "owner", enabledModules: ["stock", "sales", "products", "purchases"], branchIds: null };
const input = { branchId: id(4), from: "2026-10-01", to: "2026-10-09" };
const context = { branchName: "Central", timezone: "America/Argentina/Buenos_Aires", today: "2026-10-09", readAt: "2026-10-09T12:00:00.000Z" };
const data = (): ReplenishmentData => ({
  ingredients: [{ id: id(5), name: "Harina", unit: "kg", active: true }, { id: id(6), name: "Aceite", unit: "l", active: true }],
  stock: [{ id: id(7), ingredient_id: id(5), current: "2", min: "5", updated_at: context.readAt }],
  movements: [
    { id: id(10), ingredient_id: id(5), qty: "-1", operation: "out", reason: "manual_adjust", ref_type: null, base_unit: "kg", balance_before: "5", balance_after: "4", created_at: context.readAt },
    { id: id(11), ingredient_id: id(5), qty: "-0.5", operation: "waste", reason: "manual_adjust", ref_type: null, base_unit: "kg", balance_before: "4", balance_after: "3.5", created_at: context.readAt },
    { id: id(12), ingredient_id: id(5), qty: "-1.5", operation: "set", reason: "manual_adjust", ref_type: null, base_unit: "kg", balance_before: "3.5", balance_after: "2", created_at: context.readAt },
    { id: id(13), ingredient_id: id(5), qty: "99", operation: null, reason: "sale", ref_type: null, base_unit: null, balance_before: null, balance_after: null, created_at: context.readAt },
  ],
  sales: [{ id: id(20), sale_kind: "detailed" }, { id: id(21), sale_kind: "summary" }],
  saleLines: [{ id: id(22), sale_id: id(20), product_id: id(23), description: "Pizza", quantity: "4", recipe_snapshot: { state: "complete", ingredients: [{ ingredientId: id(5), baseUnit: "g", theoreticalQuantity: "800" }] } }],
  purchases: [{ id: id(30), purchased_at: "2026-10-01" }, { id: id(31), purchased_at: "2026-10-02" }],
  purchaseLines: [{ id: id(32), purchase_id: id(30), ingredient_id: id(5), description: "Harina", qty: "1000", unit: "g" }],
});

test("replenishment separates physical outflow, waste, corrections and historical theoretical recipes without multiplying twice", () => {
  const result = buildReplenishmentReport(input, context, data()); const row = result.rows[0];
  assert.equal(row.current, 2); assert.equal(row.minimumShortfall, 3); assert.equal(row.recordedOutflow, 1);
  assert.equal(row.recordedWaste, 0.5); assert.equal(row.recordedAdjustment, -1.5); assert.equal(row.theoreticalUsage, 0.8);
  assert.equal(row.contributors[0].soldQuantity, 4); assert.equal(row.contributors[0].theoreticalQuantity, 0.8);
  assert.equal(row.unverifiedMovementCount, 1); assert.equal(row.recentReceipts[0].quantity, 1);
  assert.equal(row.attention, "below_minimum"); assert.equal(result.rows[1].attention, "no_basis");
  assert.equal(result.evidence.salesWithoutDetail, 1); assert.equal(result.evidence.purchasesWithoutLinkedDetail, 1);
  assert.equal(result.coverageDays, null); assert.equal(result.historyCoverage, "not_verified"); assert.equal(result.partialCurrentDay, true);
  assert.equal("today" in result, false);
});
test("missing/incomplete recipes, invalid legacy movements and incompatible receipts remain explicit gaps", () => {
  const source = data(); source.saleLines!.push({ ...source.saleLines![0], id: id(25), recipe_snapshot: { state: "none", ingredients: [] } });
  source.saleLines!.push({ ...source.saleLines![0], id: id(26), recipe_snapshot: { state: "incomplete", ingredients: [{ ingredientId: id(5), theoreticalQuantity: 10, baseUnit: "l" }, { ingredientId: id(6), theoreticalQuantity: 0.2, baseUnit: "l" }] } });
  source.purchaseLines!.push({ ...source.purchaseLines![0], id: id(33), unit: "box" });
  source.movements.push({ ...source.movements[0], id: id(14), balance_before: -3, balance_after: -4 });
  const result = buildReplenishmentReport(input, context, source);
  assert.equal(result.evidence.missingRecipeLines, 1); assert.equal(result.evidence.incompleteRecipeLines, 1);
  assert.equal(result.rows[0].theoreticalUsage, 0.8); assert.equal(result.rows[1].theoreticalUsage, 0.2);
  assert.equal(result.rows[0].unverifiedMovementCount, 2); assert.equal(result.rows[0].unverifiedReceiptCount, 1);
});
test("read-only roles and disabled modules never fabricate zero hidden sales or purchases", () => {
  const source = data(); source.sales = null; source.saleLines = null; source.purchases = null; source.purchaseLines = null;
  const report = buildReplenishmentReport(input, context, source);
  assert.equal(report.rows[0].theoreticalUsage, null); assert.equal(report.evidence.activeSales, null); assert.deepEqual(report.visibility, { sales: false, purchases: false });
  assert.match(formatReplenishmentReport(report), /sin acceso/); assert.match(formatReplenishmentReport(report), /no se suman/);
});
test("period validations reject tenant injection, malformed dates, reversed and overlong intervals", () => {
  for (const value of [{ ...input, businessId: id(90) }, { ...input, branchId: "Central" }, { ...input, from: "2026-02-30" }, { ...input, to: "2025-10-01" }, { ...input, from: "2025-01-01" }]) assert.throws(() => validateReplenishmentInput(value));
  assert.deepEqual(validateReplenishmentInput(input), input);
});
test("pagination exhausts short server pages and rejects duplicates, drift, missing count and stalled pages", async () => {
  const all = Array.from({ length: 9 }, (_, i) => ({ id: id(i) }));
  assert.deepEqual(await readReplenishmentRows(async (offset) => ({ data: all.slice(offset, offset + 2), count: 9, error: null })), all);
  await assert.rejects(readReplenishmentRows(async () => ({ data: [all[0]], count: 2, error: null })), /inconsistente/);
  await assert.rejects(readReplenishmentRows(async () => ({ data: [], count: 2, error: null })), /incompleta/);
  await assert.rejects(readReplenishmentRows(async () => ({ data: [], count: null, error: null })), /completo/);
  await assert.rejects(readReplenishmentRows(async (offset) => ({ data: [all[offset]], count: offset ? 3 : 2, error: null })), /cambiaron/);
});

function dbFixture(options: { moduleKeys?: string[]; role?: string; active?: boolean; assigned?: boolean; changed?: boolean; zone?: string } = {}) {
  const queries: { table: string; fields: string; filters: Record<string, unknown> }[] = []; let revisions = 0;
  const fixture = data();
  const tables: Record<string, any[]> = { ingredients: fixture.ingredients, stock_items: fixture.stock, stock_movements: fixture.movements, sales: fixture.sales!, sale_items: fixture.saleLines!, purchases: fixture.purchases!, purchase_items: fixture.purchaseLines! };
  const db: any = {
    rpc: async (name: string, args: any) => { assert.equal(name, "get_replenishment_revision"); assert.deepEqual(args, { p_business_id: actor.businessId, p_actor_id: actor.userId }); return { data: String(options.changed ? ++revisions : 1), error: null }; },
    from(table: string) {
      const log = { table, fields: "", filters: {} as Record<string, unknown> }; queries.push(log); let offset = 0;
      const q: any = {
        select(fields: string) { log.fields = fields; return q; }, eq(k: string, v: unknown) { log.filters[k] = v; return q; },
        gte(k: string, v: unknown) { log.filters[`gte:${k}`] = v; return q; }, lt(k: string, v: unknown) { log.filters[`lt:${k}`] = v; return q; }, lte(k: string, v: unknown) { log.filters[`lte:${k}`] = v; return q; },
        order() { return q; }, range(start: number) { offset = start; return q; },
        async maybeSingle() {
          const rows: Record<string, unknown> = { profiles: { id: actor.userId, active: options.active !== false }, business_members: { id: actor.memberId, role: options.role ?? actor.role }, branches: log.filters.id === input.branchId && log.filters.business_id === actor.businessId ? { id: input.branchId, name: "Central" } : null, businesses: { id: actor.businessId, timezone: options.zone ?? context.timezone }, branch_assignments: options.assigned === false ? null : { branch_id: input.branchId } };
          return { data: rows[table], error: null };
        },
        then(resolve: any) { const rows = table === "business_modules" ? (options.moduleKeys ?? actor.enabledModules).map((module_key, i) => ({ id: id(80 + i), module_key })) : tables[table] ?? [];
          return Promise.resolve({ data: rows.slice(offset, offset + 2), count: rows.length, error: null }).then(resolve); },
      }; return q;
    },
  };
  return { db, queries };
}
test("shared read scopes every dataset to tenant and branch, uses local midnight and excludes future timestamps", async () => {
  const h = dbFixture(); const report = await readReplenishment(h.db, actor, input, new Date(context.readAt));
  assert.equal(report.rows[0].minimumShortfall, 3);
  for (const table of ["ingredients", "sales", "sale_items", "purchases"]) assert.ok(h.queries.filter(q => q.table === table).every(q => q.filters.business_id === actor.businessId), table);
  const moves = h.queries.find(q => q.table === "stock_movements")!;
  assert.equal(moves.filters["ingredients.business_id"], actor.businessId); assert.equal(moves.filters["branches.business_id"], actor.businessId); assert.equal(moves.filters.branch_id, input.branchId);
  assert.equal(moves.filters["gte:created_at"], "2026-10-01T03:00:00.000Z"); assert.equal(moves.filters["lt:created_at"], context.readAt);
  const lines = h.queries.find(q => q.table === "sale_items")!; assert.equal(lines.filters["sales.status"], "active"); assert.equal(lines.filters["sales.branch_id"], input.branchId);
  const receipts = h.queries.find(q => q.table === "purchase_items")!; assert.equal(receipts.filters["purchases.record_status"], "active"); assert.equal(receipts.filters["purchases.business_id"], actor.businessId); assert.equal(receipts.filters["purchases.branch_id"], input.branchId);
});
test("read blocks scope escalation, inactive actors, role drift, revoked branch, future dates and revision drift", async () => {
  for (const [who, options, value] of [
    [{ ...actor, branchIds: [id(99)] }, {}, input], [{ ...actor, role: "accountant" }, {}, input],
    [actor, { active: false }, input], [actor, { role: "viewer" }, input], [actor, { changed: true }, input],
    [actor, { moduleKeys: ["sales"] }, input], [{ ...actor, role: "kitchen", branchIds: [input.branchId] }, { role: "kitchen", assigned: false }, input],
    [actor, {}, { ...input, to: "2026-10-10" }],
  ] as any[]) await assert.rejects(readReplenishment(dbFixture(options).db, who, value, new Date(context.readAt)));
});
test("roles without purchases and disabled recipe module never query restricted source tables", async () => {
  const h = dbFixture({ role: "kitchen", moduleKeys: ["stock", "sales"] });
  const report = await readReplenishment(h.db, { ...actor, role: "kitchen", branchIds: [input.branchId] }, input, new Date(context.readAt));
  assert.deepEqual(report.visibility, { sales: false, purchases: false }); assert.equal(report.rows[0].theoreticalUsage, null);
  assert.equal(h.queries.some(q => ["sales", "sale_items", "purchases", "purchase_items"].includes(q.table)), false);
});
test("WhatsApp replenishment intent and clarification never invent a tomorrow forecast or implicit period", async () => {
  const tools = [...WHATSAPP_TOOLS]; const call = await interpretHeuristically("¿Qué tengo que comprar mañana?", tools);
  assert.equal(call?.name, "stock.getReplenishment"); assert.deepEqual(getMissingArguments(call!, tools), ["branchId", "from", "to"]);
  const pending: PendingOperation = { id: id(99), actor, kind: "clarification", toolCall: call!, expiresAt: context.readAt };
  const clarified = await interpretHeuristically(`${input.branchId} del 2026-10-01 al 2026-10-09`, tools, pending);
  assert.deepEqual(clarified?.arguments, input); assert.deepEqual(validateToolCall(clarified!).issues, []);
  const today = await interpretHeuristically(`reposicion hoy ${input.branchId}`, tools, null, { timezone: "America/Los_Angeles", now: new Date("2026-10-09T01:00:00Z") });
  assert.equal(today?.arguments.from, "2026-10-08");
  assert.equal(toolsForActor({ ...actor, role: "accountant" }).some(t => t.name === "stock.getReplenishment"), false);
  assert.ok(validateToolCall({ name: "stock.getReplenishment", arguments: { ...input, actorId: id(99) } }).issues.some(i => i.unexpected));
  assert.ok(validateToolCall({ name: "stock.getReplenishment", arguments: { ...input, branchId: "Central" } }).issues.length);
});

test("manual server action and actual WhatsApp adapter return the same guarded read projection", async () => {
  const Module = (await import("node:module")).default as any;
  const permissions = await import("../lib/permissions");
  const loader = Module._load; const h = dbFixture();
  Module._load = function(name: string, ...args: any[]) {
    const mocks: Record<string, unknown> = {
      "next/cache": { revalidatePath() { throw new Error("read_must_not_revalidate"); } },
      "@/lib/data/auth": { getCurrentUserContext: async () => ({ isAuthenticated: true, businessId: actor.businessId, userId: actor.userId, role: actor.role, enabledModules: actor.enabledModules, assignedBranchIds: actor.branchIds }) },
      "@/lib/supabase/server": { createSupabaseServerClient: async () => h.db },
      "@/lib/env": { isDatabaseMode: () => true },
      "@/lib/permissions": permissions,
      "@/lib/permissions/server-action": { withPermission: (_permission: unknown, action: unknown) => action },
      "@/lib/catalog/pagination": {},
      "@/lib/recipes/quantities": {},
    };
    return name in mocks ? mocks[name] : loader.call(this, name, ...args);
  };
  try {
    const { getStockReplenishmentAction } = require("../app/actions/stock-page");
    const { executeTool } = require("../lib/whatsapp-agent/supabase-adapter");
    const historical = { ...input, from: "2020-01-01", to: "2020-01-05" };
    const manual = await getStockReplenishmentAction(historical);
    assert.equal(manual.ok, true, manual.error);
    const whatsapp = await executeTool(h.db, actor, { name: "stock.getReplenishment", arguments: historical });
    assert.deepEqual({ ...manual.data, readAt: "" }, { ...whatsapp, readAt: "" });
    assert.equal((await getStockReplenishmentAction({ ...historical, businessId: id(99) })).ok, false);
    await assert.rejects(executeTool(h.db, actor, { name: "stock.getReplenishment", arguments: { ...historical, userId: id(99) } }));
  } finally { Module._load = loader; }
});

test("WhatsApp core executes a complete replenishment query once as READ and describes limitations", async () => {
  const { runAgent } = await import("../lib/whatsapp-agent/core");
  let calls = 0;
  const result = await runAgent({ messageId: id(99), senderPhone: actor.phone, recipientPhone: "0001", text: `stock.getReplenishment: ${JSON.stringify(input)}` }, {
    resolveActor: async () => actor, claimMessage: async () => true, interpret: interpretHeuristically,
    getPending: async () => null, savePending: async () => { throw new Error("unexpected_pending"); }, consumePending: async () => false,
    execute: async (_actor, call) => { calls++; assert.deepEqual(call.arguments, input); return buildReplenishmentReport(input, context, data()); },
    audit: async () => {}, now: () => new Date(context.readAt),
  });
  assert.equal(calls, 1); assert.equal(result.status, "completed");
  for (const text of ["actual 2 kg", "mínimo 5", "mínimo 3", "Salidas registradas 1", "Teórico de recetas 0,8", "Pizza", "Compras vinculadas", "no se suman", "No es pronóstico", "Historial completo sin verificar"]) assert.ok(result.text.includes(text), text);
});

test("duplicate recipe components are excluded and flagged instead of inflating usage", () => {
  const source = data(); const line = source.saleLines![0]; const snapshot = line.recipe_snapshot as any;
  snapshot.ingredients.push({ ...snapshot.ingredients[0] });
  const report = buildReplenishmentReport(input, context, source);
  assert.equal(report.evidence.incompleteRecipeLines, 1); assert.equal(report.rows[0].theoreticalUsage, 0);
  assert.deepEqual(report.rows[0].contributors, []);
});
test("receipt void/correction outflow is a reversal, never physical consumption or a depletion signal", () => {
  const source = data(); source.stock[0].min = 1;
  source.movements = [
    { ...source.movements[0], id: id(101), qty: 100, operation: "in", ref_type: "purchase_item", balance_before: 2, balance_after: 102 },
    { ...source.movements[0], id: id(102), qty: -100, operation: "out", ref_type: "purchase_item_void", balance_before: 102, balance_after: 2 },
  ];
  const report = buildReplenishmentReport(input, context, source); const row = report.rows[0];
  assert.equal(row.recordedOutflow, 0); assert.equal(row.recordedPurchaseReversal, 100);
  assert.equal(row.current, 2); assert.equal(row.attention, "none"); assert.equal(row.minimumShortfall, 0);
  assert.match(formatReplenishmentReport(report), /reversas de compras 100 \(no consumo\)/);
});
test("archived ingredients retain historical usage but suppress buying, negative stock stays unknown", () => {
  const source = data(); source.ingredients[0].active = false;
  const archived = buildReplenishmentReport(input, context, source).rows[0];
  assert.equal(archived.minimumShortfall, null); assert.equal(archived.attention, "archived"); assert.equal(archived.theoreticalUsage, 0.8); assert.equal(archived.recordedOutflow, 1);
  source.ingredients[0].active = true; source.stock[0].current = -3;
  const report = buildReplenishmentReport(input, context, source); const invalid = report.rows[0];
  assert.equal(invalid.current, null); assert.equal(invalid.minimumShortfall, null); assert.equal(invalid.attention, "no_basis");
  assert.match(formatReplenishmentReport(report), /Stock negativo o inválido requiere revisión/);
});


test("natural product-consumption questions route to the replenishment report before product listing", async () => {
  for (const text of ["¿Qué productos vendidos consumieron ese stock?", "¿Cuánto se consumió de insumos?", "Consumo de ingredientes hoy"]) {
    assert.equal((await interpretHeuristically(text, [...WHATSAPP_TOOLS]))?.name, "stock.getReplenishment");
  }
});


test("unsupported legacy units retain balances but never produce a purchase quantity", () => {
  const source = data(); source.ingredients[0].unit = "bolsa";
  const row = buildReplenishmentReport(input, context, source).rows[0];
  assert.equal(row.current, 2); assert.equal(row.minimum, 5); assert.equal(row.minimumShortfall, null); assert.equal(row.attention, "no_basis");
});
