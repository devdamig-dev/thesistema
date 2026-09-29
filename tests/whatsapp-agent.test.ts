import assert from "node:assert/strict";
import test from "node:test";
import { runAgent } from "../lib/whatsapp-agent/core.js";
import { interpretHeuristically } from "../lib/whatsapp-agent/interpreter.js";
import { WHATSAPP_TOOLS } from "../lib/whatsapp-agent/registry.js";
import type { AgentActor, AgentDependencies, IncomingAgentMessage, PendingOperation, ToolCall } from "../lib/whatsapp-agent/types.js";

const actor: AgentActor = { userId: "user-a", memberId: "member-a", businessId: "business-a", phone: "5491112345678", name: "Ana", role: "owner", enabledModules: ["sales", "purchases", "debts", "stock", "products", "invoices_ocr"], branchIds: null };
const input = (text: string, id = "wamid.1"): IncomingAgentMessage => ({ messageId: id, senderPhone: actor.phone, recipientPhone: "5491188888888", text });

function harness(options: { actor?: AgentActor | null; pending?: PendingOperation | null; duplicate?: boolean; fail?: boolean } = {}) {
  let pending = options.pending ?? null; const audits: any[] = []; const executions: Array<{ actor: AgentActor; call: ToolCall }> = [];
  const deps: AgentDependencies = {
    resolveActor: async () => options.actor === undefined ? actor : options.actor,
    claimMessage: async () => !options.duplicate,
    interpret: interpretHeuristically,
    getPending: async () => pending,
    savePending: async (operation) => (pending = { ...operation, id: "pending-1" }),
    clearPending: async () => { pending = null; },
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
test("sensitive payment requires and then consumes confirmation", async () => { const h = harness(); const first = await runAgent(input("Marcá como pagada la deuda de Pablo"), h.deps); assert.equal(first.status, "needs_confirmation"); const second = await runAgent(input("Sí", "wamid.2"), h.deps); assert.equal(second.status, "completed"); assert.equal(h.executions.length, 1); assert.equal(h.audits.at(-1).confirmed, true); });
test("expired confirmation is never executed", async () => { const expired: PendingOperation = { id: "old", actor, kind: "confirmation", toolCall: { name: "debts.registerPayment", arguments: { creditor: "Pablo" } }, expiresAt: "2026-09-29T11:00:00.000Z" }; const h = harness({ pending: expired }); const reply = await runAgent(input("Sí"), h.deps); assert.equal(reply.status, "needs_input"); assert.equal(h.executions.length, 0); });
test("missing argument creates clarification context", async () => { const h = harness(); const reply = await runAgent(input("Registrá una compra de $180.000 a Don José"), h.deps); assert.equal(reply.status, "needs_input"); assert.match(reply.text, /medio de pago/); assert.equal(h.pending()?.kind, "clarification"); });
test("duplicate webhook is idempotent", async () => { const h = harness({ duplicate: true }); assert.equal((await runAgent(input("ventas de hoy"), h.deps)).status, "duplicate"); assert.equal(h.executions.length, 0); });
test("tool failure is audited without reporting success", async () => { const h = harness({ fail: true }); const reply = await runAgent(input("ventas de hoy"), h.deps); assert.equal(reply.status, "failed"); assert.equal(h.audits[0].error, "database down"); });
test("successful action is audited with tenant, tool and sanitized arguments", async () => { const h = harness(); await runAgent(input("ventas de hoy"), h.deps); assert.equal(h.audits[0].actor.businessId, "business-a"); assert.equal(h.audits[0].tool, "sales.getToday"); assert.deepEqual(h.audits[0].arguments, {}); });
