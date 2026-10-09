import assert from "node:assert/strict";
import test from "node:test";
import { validateToolCall } from "../lib/whatsapp-agent/validation";
import { runAgent } from "../lib/whatsapp-agent/core.js";
import { interpretHeuristically } from "../lib/whatsapp-agent/interpreter.js";
import { capabilityCatalogFor, WHATSAPP_TOOLS } from "../lib/whatsapp-agent/registry.js";
import type { AgentActor, AgentDependencies, IncomingAgentMessage, PendingOperation, ToolCall } from "../lib/whatsapp-agent/types.js";

const actor: AgentActor = { userId: "user-a", memberId: "member-a", businessId: "business-a", phone: "5491112345678", name: "Ana", role: "owner", enabledModules: ["sales", "purchases", "debts", "stock", "products", "invoices_ocr"], branchIds: null };
const preparedFields = { requestId: "00000000-0000-4000-8000-000000000001", debtId: "00000000-0000-4000-8000-000000000002", branchId: "00000000-0000-4000-8000-000000000003", currency: "ARS", expectedVersion: 0 };
const input = (text: string, id = "wamid.1"): IncomingAgentMessage => ({ messageId: id, senderPhone: actor.phone, recipientPhone: "5491188888888", text });

function harness(options: { actor?: AgentActor | null; pending?: PendingOperation | null; duplicate?: boolean; fail?: boolean } = {}) {
  let pending = options.pending ?? null; const audits: any[] = []; const executions: Array<{ actor: AgentActor; call: ToolCall }> = [];
  const deps: AgentDependencies = {
    resolveActor: async () => options.actor === undefined ? actor : options.actor,
    claimMessage: async () => !options.duplicate,
    interpret: interpretHeuristically,
    getPending: async () => pending,
    savePending: async (operation) => (pending = { ...operation, id: "pending-1" }),
    consumePending: async (id) => { if (!pending || pending.id !== id) return false; pending = null; return true; },
    claimDebtPending: async (id, _actor, recovery) => { if (!pending || pending.id !== id || !!pending.resultUncertain !== recovery) return false; pending = { ...pending, resultUncertain: true }; return true; },
    cancelDebtPending: async (id) => { if (!pending || pending.id !== id) return { consumed: false, resultUncertain: false }; const resultUncertain = !!pending.resultUncertain; pending = null; return { consumed: true, resultUncertain }; },
    prepare: async (_actor, call) => ({ ...call, arguments: { ...call.arguments, ...preparedFields, ...(call.arguments.allocationRule === "selected_installment" ? { installmentId: "00000000-0000-4000-8000-000000000004" } : {}) } }),
    execute: async (resolvedActor, call) => { executions.push({ actor: resolvedActor, call }); if (options.fail) throw new Error("database down"); return { businessId: resolvedActor.businessId, ok: true }; },
    audit: async (event) => { audits.push(event); },
    now: () => new Date("2026-09-29T12:00:00.000Z"),
  };
  return { deps, audits, executions, pending: () => pending };
}

test("intent/tool routing covers the requested examples", async () => {
  const examples: Array<[string, string]> = [
    ["¿Cuánto vendimos hoy?", "sales.getToday"], ["Comparame esta semana con la anterior.", "sales.comparePeriods"],
    ["Registrá una compra de $180.000 a Don José.", "purchases.create"], ["¿Qué le debemos a proveedores?", "debts.list"],
    ["Marcá como pagada la deuda de Pablo.", "debts.registerPayment"], ["¿Qué insumos están bajos?", "stock.getLowStock"],
    ["Sumá 20 kg de carne al stock.", "stock.addMovement"], ["Creá Hamburguesa Doble a $14.500.", "products.create"],
    ["¿Qué facturas están pendientes?", "invoices.listPending"],
  ];
  for (const [message, expected] of examples) assert.equal((await interpretHeuristically(message, [...WHATSAPP_TOOLS]))?.name, expected, message);
});

test("authorized user executes a read", async () => { const h = harness(); const reply = await runAgent(input("¿Cuánto vendimos hoy?"), h.deps); assert.equal(reply.status, "completed"); assert.equal(h.executions.length, 1); });
test("unauthorized phone is rejected", async () => { const h = harness({ actor: null }); assert.equal((await runAgent(input("ventas de hoy"), h.deps)).status, "rejected"); });
test("role restrictions do not expose write tools", async () => { const h = harness({ actor: { ...actor, role: "viewer" } }); const reply = await runAgent(input("Registrá una compra de $100 a José"), h.deps); assert.equal(reply.status, "needs_input"); assert.equal(h.executions.length, 0); });
test("disabled modules cannot execute", async () => { const h = harness({ actor: { ...actor, enabledModules: ["sales"] } }); const reply = await runAgent(input("¿Qué insumos están bajos?"), h.deps); assert.equal(reply.status, "needs_input"); assert.equal(h.executions.length, 0); });
test("business isolation uses the resolved actor and ignores no caller tenant", async () => { const h = harness(); await runAgent(input("ventas de hoy"), h.deps); assert.equal(h.executions[0].actor.businessId, "business-a"); assert.equal("businessId" in h.executions[0].call.arguments, false); });
test("sensitive payment previews creditor, amount and method before confirmation", async () => {
  const h = harness();
  assert.equal((await runAgent(input("Registrá el pago de la cuota 2 de Pablo"), h.deps)).status, "needs_input");
  assert.equal((await runAgent(input("$50.000", "wamid.2"), h.deps)).status, "needs_input");
  assert.equal((await runAgent(input("2026-10-09", "wamid.date"), h.deps)).status, "needs_input");
  const preview = await runAgent(input("Transferencia", "wamid.3"), h.deps);
  assert.equal(preview.status, "needs_confirmation");
  assert.match(preview.text, /Pablo/);
  assert.match(preview.text, /50\.000/);
  assert.match(preview.text, /Transferencia/);
  const result = await runAgent(input("Sí", "wamid.4"), h.deps);
  assert.equal(result.status, "completed");
  assert.equal(h.executions.length, 1);
  assert.equal(h.executions[0].call.arguments.creditor, "Pablo");
  assert.equal(h.executions[0].call.arguments.amountCents, 5000000);
  assert.equal(h.executions[0].call.arguments.paymentMethod, "Transferencia");
  assert.equal(h.audits.at(-1).confirmed, true);
});
test("expired confirmation is never executed", async () => { const expired: PendingOperation = { id: "old", actor, kind: "confirmation", toolCall: { name: "debts.registerPayment", arguments: { creditor: "Pablo" } }, expiresAt: "2026-09-29T11:00:00.000Z" }; const h = harness({ pending: expired }); const reply = await runAgent(input("Sí"), h.deps); assert.equal(reply.status, "needs_input"); assert.equal(h.executions.length, 0); });
test("missing argument creates clarification context", async () => { const h = harness(); const reply = await runAgent(input("Registrá una compra de $180.000 a Don José"), h.deps); assert.equal(reply.status, "needs_input"); assert.match(reply.text, /medio de pago/); assert.equal(h.pending()?.kind, "clarification"); });
test("duplicate webhook is idempotent", async () => { const h = harness({ duplicate: true }); assert.equal((await runAgent(input("ventas de hoy"), h.deps)).status, "duplicate"); assert.equal(h.executions.length, 0); });
test("tool failure is audited without reporting success", async () => { const h = harness({ fail: true }); const reply = await runAgent(input("ventas de hoy"), h.deps); assert.equal(reply.status, "failed"); assert.equal(h.audits[0].error, "database down"); });
test("ambiguous purchase branch requests an explicit destination before confirmation", async () => {
  const h = harness();
  h.deps.interpret = async () => ({ name: "purchases.create", arguments: { kind: "summary", supplier: "Don José", amount: "1000.00", paymentMethod: "Transferencia", purchasedAt: "2026-10-09" } });
  h.deps.prepare = async () => { throw new Error("purchase_branch_ambiguous"); };
  const reply = await runAgent(input("Registrá la compra"), h.deps);
  assert.equal(reply.status, "needs_input");
  assert.match(reply.text, /ID de la sucursal/);
  assert.equal(h.executions.length, 0);
  assert.equal(h.audits[0].error, "purchase_branch_ambiguous");
});
test("successful action is audited with tenant, tool and sanitized arguments", async () => { const h = harness(); await runAgent(input("ventas de hoy"), h.deps); assert.equal(h.audits[0].actor.businessId, "business-a"); assert.equal(h.audits[0].tool, "sales.getToday"); assert.deepEqual(h.audits[0].arguments, {}); });

test("two distinct simultaneous confirmations execute the sensitive operation once", async () => {
  const h = harness();
  h.deps.interpret = async () => ({ name: "debts.registerPlanPayment", arguments: { creditor: "Pablo", amountCents: 5000000, allocationRule: "oldest_due", paymentMethod: "Transferencia", paidAt: "2026-10-09" } });
  await runAgent(input("Marcá como pagada la deuda de Pablo"), h.deps);
  const replies = await Promise.all([
    runAgent(input("Sí", "confirmation-1"), h.deps),
    runAgent(input("Sí", "confirmation-2"), h.deps),
  ]);
  assert.equal(h.executions.length, 1);
  assert.deepEqual(replies.map(reply => reply.status).sort(), ["completed", "rejected"]);
});

test("No and Cancelar discard confirmation and clarification without executing", async () => {
  for (const [request, cancellation] of [
    ["Registrá el pago de la cuota 2 de Pablo", "No"],
    ["Registrá una compra de $180.000 a Don José", "Cancelar"],
  ]) {
    const h = harness();
    await runAgent(input(request), h.deps);
    assert.equal((await runAgent(input(cancellation, "cancel-1"), h.deps)).status, "cancelled");
    assert.equal(h.pending(), null);
    assert.equal(h.executions.length, 0);
    assert.equal(h.audits.at(-1).error, "operation_cancelled");
    await runAgent(input("Sí", "late-confirmation"), h.deps);
    assert.equal(h.executions.length, 0);
  }
});

test("failed consumption never executes and failed cancellation does not report cancellation", async () => {
  for (const answer of ["Sí", "Cancelar"]) {
    const h = harness();
    h.deps.interpret = async () => ({ name: "debts.registerPlanPayment", arguments: { creditor: "Pablo", amountCents: 5000000, allocationRule: "oldest_due", paymentMethod: "Transferencia", paidAt: "2026-10-09" } });
    await runAgent(input("Marcá como pagada la deuda de Pablo"), h.deps);
    h.deps.claimDebtPending = async () => { throw new Error("database unavailable"); };
    h.deps.cancelDebtPending = async () => { throw new Error("database unavailable"); };
    assert.equal((await runAgent(input(answer, "failed-consume"), h.deps)).status, "failed");
    assert.equal(h.executions.length, 0);
    assert.ok(h.pending());
  }
});

test("expired or concurrently consumed row cannot authorize a write", async () => {
  const h = harness();
  h.deps.interpret = async () => ({ name: "debts.registerPlanPayment", arguments: { creditor: "Pablo", amountCents: 5000000, allocationRule: "oldest_due", paymentMethod: "Transferencia", paidAt: "2026-10-09" } });
  await runAgent(input("Marcá como pagada la deuda de Pablo"), h.deps);
  h.deps.claimDebtPending = async (_id, scopedActor, recovery) => {
    assert.equal(scopedActor.businessId, actor.businessId);
    assert.equal(recovery, false);
    return false;
  };
  assert.equal((await runAgent(input("Sí", "lost-consume"), h.deps)).status, "rejected");
  assert.equal(h.executions.length, 0);
});

test("cancellation and confirmation racing on a pending operation have only one winner", async () => {
  const h = harness();
  h.deps.interpret = async () => ({ name: "debts.registerPlanPayment", arguments: { creditor: "Pablo", amountCents: 5000000, allocationRule: "oldest_due", paymentMethod: "Transferencia", paidAt: "2026-10-09" } });
  await runAgent(input("Marcá como pagada la deuda de Pablo"), h.deps);
  const replies = await Promise.all([
    runAgent(input("Cancelar", "cancel-race"), h.deps),
    runAgent(input("Sí", "confirm-race"), h.deps),
  ]);
  assert.equal(replies.filter(reply => reply.status === "rejected").length, 1);
  const cancelled = replies.some(reply => reply.status === "cancelled");
  assert.equal(h.executions.length, cancelled ? 0 : 1);
});

test("purchase examples extract the real supplier and Argentine money amounts", async () => {
  for (const text of ["Registrá una compra de $180.000 a Don José.", "Registrá una compra a Don José por $180.000.", "Registrá una compra de Don José por 180 mil."]) {
    const call = await interpretHeuristically(text, [...WHATSAPP_TOOLS]);
    assert.equal(call?.arguments.supplier, "Don José", text);
    assert.equal(call?.arguments.amount, "180000.00", text);
  }
});

test("stock quantities preserve kilos and decimal quantities without money scaling", async () => {
  for (const [text, quantity, ingredient] of [
    ["Sumá 20 kg de carne al stock.", 20, "carne"],
    ["Agregá 2,5 kilos de queso al stock.", 2.5, "queso"],
    ["Sumá 2.5 kg de carne al stock.", 2.5, "carne"],
    ["Sumá 20 unidades de pan al stock.", 20, "pan"],
  ] as const) {
    const call = await interpretHeuristically(text, [...WHATSAPP_TOOLS]);
    assert.equal(call?.arguments.quantity, quantity, text);
    assert.equal(call?.arguments.ingredient, ingredient, text);
  }
});

test("numeric clarifications parse Argentine amounts and leave invalid input missing", async () => {
  const pending: PendingOperation = { id: "clarify", actor, kind: "clarification", toolCall: { name: "purchases.create", arguments: { supplier: "Don José", paymentMethod: "Efectivo" } }, expiresAt: "2099-01-01T00:00:00Z" };
  assert.equal((await interpretHeuristically("$180.000,50", [...WHATSAPP_TOOLS], pending))?.arguments.amount, "180000.50");
  assert.equal((await interpretHeuristically("180k", [...WHATSAPP_TOOLS], pending))?.arguments.amount, "180000.00");
  assert.equal((await interpretHeuristically("No sé", [...WHATSAPP_TOOLS], pending))?.arguments.amount, undefined);
});

test("typed tool validation rejects unknown keys and never executes", async () => {
  const h = harness();
  h.deps.interpret = async () => ({ name: "purchases.create", arguments: { supplier: "Don José", amount: 1000, paymentMethod: "Efectivo", business_id: "other-business" } });
  const reply = await runAgent(input("registrar compra"), h.deps);
  assert.equal(reply.status, "rejected");
  assert.equal(h.executions.length, 0);
  assert.match(h.audits[0].error, /business_id/);
});

test("typed tool validation rejects invalid numbers, dates, periods and enums", async () => {
  const invalidCalls: ToolCall[] = [
    { name: "products.create", arguments: { name: "Producto", price: Number.POSITIVE_INFINITY } },
    { name: "sales.getPeriod", arguments: { from: "2026-02-30", to: "2026-03-01" } },
    { name: "sales.getPeriod", arguments: { from: "2026-10-02", to: "2026-10-01" } },
    { name: "stock.addMovement", arguments: { ingredient: "Carne", quantity: 2, operation: "delete" } },
  ];
  for (const [index, invalidCall] of invalidCalls.entries()) {
    const h = harness();
    h.deps.interpret = async () => invalidCall;
    const reply = await runAgent(input("pedido", `invalid-${index}`), h.deps);
    assert.equal(reply.status, "needs_input");
    assert.equal(h.executions.length, 0);
    assert.equal(h.pending()?.kind, "clarification");
  }
});

test("legacy validation still normalizes supported methods, but runtime requires manual historical review", async () => {
  const call: ToolCall = { name: "debts.registerPayment", arguments: { creditor: "Pablo", amount: 1000, paymentMethod: "debito", paidAt: "2026-10-09" } };
  assert.equal(validateToolCall(call).call.arguments.paymentMethod, "Débito");
  const h = harness(); h.deps.interpret = async () => call;
  const reply = await runAgent(input("pagar"), h.deps);
  assert.equal(reply.status, "needs_input"); assert.match(reply.text, /revisión manual/);
  assert.equal(h.executions.length, 0); assert.equal(h.pending(), null);
});

test("capabilities catalog is derived only from real tools, modules and role permissions", () => {
  const catalog = capabilityCatalogFor("viewer", ["sales", "purchases"]);
  assert.equal(catalog.length, WHATSAPP_TOOLS.length);
  assert.equal(catalog.find((tool) => tool.name === "sales.getToday")?.availability, "available");
  assert.equal(catalog.find((tool) => tool.name === "purchases.list")?.availability, "available");
  assert.equal(catalog.find((tool) => tool.name === "purchases.create")?.availability, "forbidden");
  assert.equal(catalog.find((tool) => tool.name === "stock.getLowStock")?.availability, "module_disabled");
  assert.equal(catalog.some((tool) => tool.name.includes("comingSoon") || tool.name.includes("stub")), false);
});
