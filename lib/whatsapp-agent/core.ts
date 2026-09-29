import { getMissingArguments } from "./interpreter";
import { getTool, toolsForActor } from "./registry";
import type { AgentDependencies, AgentReply, IncomingAgentMessage } from "./types";

const CONFIRMATION = /^(s[ií]|confirmo|dale|ok|confirmar)[.!\s]*$/i;
const labels: Record<string, string> = { paymentMethod: "medio de pago", from: "fecha inicial", to: "fecha final", creditor: "acreedor", amount: "monto", ingredient: "insumo", quantity: "cantidad", operation: "tipo de movimiento" };

export async function runAgent(input: IncomingAgentMessage, deps: AgentDependencies): Promise<AgentReply> {
  const actor = await deps.resolveActor(input);
  if (!actor) return { status: "rejected", text: "Este número no está autorizado para operar en este negocio." };
  if (!(await deps.claimMessage(input, actor))) return { status: "duplicate", text: "Mensaje ya procesado." };
  const available = toolsForActor(actor);
  let pending = await deps.getPending(actor);
  if (pending && new Date(pending.expiresAt) <= deps.now()) { await deps.clearPending(pending.id); pending = null; }
  let confirmed = false;
  if (pending?.kind === "confirmation") {
    if (!CONFIRMATION.test(input.text)) return { status: "needs_confirmation", text: "La operación sigue pendiente. Respondé “Sí” para confirmarla.", tool: pending.toolCall.name };
    confirmed = true;
  }
  const call = confirmed && pending ? pending.toolCall : await deps.interpret(input.text, available, pending);
  if (!call) { await deps.audit({ actor, input, error: "intent_not_recognized" }); return { status: "needs_input", text: "No pude identificar una operación habilitada. Reformulá el pedido sin incluir datos sensibles." }; }
  const tool = getTool(call.name);
  if (!tool) return { status: "rejected", text: "Esa capacidad no existe." };
  if (!actor.enabledModules.includes(tool.module)) return { status: "rejected", text: `No tenés habilitado el módulo de ${tool.module} para este negocio.` };
  if (!available.some((item) => item.name === tool.name)) return { status: "rejected", text: "No tenés permiso para realizar esa operación." };
  const missing = getMissingArguments(call, available);
  if (missing.length) {
    await deps.savePending({ actor, toolCall: call, kind: "clarification", expiresAt: new Date(deps.now().getTime() + 15 * 60_000).toISOString() });
    await deps.audit({ actor, input, tool: tool.name, module: tool.module, arguments: call.arguments, error: `missing:${missing.join(",")}` });
    return { status: "needs_input", text: `Me falta ${labels[missing[0]] ?? missing[0]}. ¿Me lo indicás?`, tool: tool.name };
  }
  if (tool.risk === "SENSITIVE" && !confirmed) {
    await deps.savePending({ actor, toolCall: call, kind: "confirmation", expiresAt: new Date(deps.now().getTime() + 10 * 60_000).toISOString() });
    await deps.audit({ actor, input, tool: tool.name, module: tool.module, arguments: call.arguments, confirmationRequired: true });
    return { status: "needs_confirmation", text: `Voy a ejecutar “${tool.description}”. ¿Confirmás?`, tool: tool.name };
  }
  try {
    const result = await deps.execute(actor, call);
    if (pending) await deps.clearPending(pending.id);
    await deps.audit({ actor, input, tool: tool.name, module: tool.module, arguments: call.arguments, result, confirmed });
    return { status: "completed", text: "Operación realizada correctamente.", tool: tool.name, data: result };
  } catch (error) {
    const message = error instanceof Error ? error.message : "tool_failed";
    await deps.audit({ actor, input, tool: tool.name, module: tool.module, arguments: call.arguments, error: message, confirmed });
    return { status: "failed", text: "No pude completar la operación. No se realizó ningún cambio.", tool: tool.name };
  }
}
