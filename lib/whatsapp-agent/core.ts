import { getMissingArguments } from "./interpreter";
import { getTool, toolsForActor } from "./registry";
import type { AgentDependencies, AgentReply, IncomingAgentMessage } from "./types";

const CANCELLATION = /^(no|cancelar|cancel[aá]|cancelo|no confirmar)[.!\s]*$/i;
const CONFIRMATION = /^(s[ií]|confirmo|dale|ok|confirmar)[.!\s]*$/i;
const labels: Record<string, string> = {
  paymentMethod: "medio de pago",
  from: "fecha inicial",
  to: "fecha final",
  creditor: "acreedor",
  amount: "monto",
  ingredient: "insumo",
  quantity: "cantidad",
  operation: "tipo de movimiento",
};

const money = (value: unknown) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 })
    .format(Number(value ?? 0));

function formatResult(toolName: string, result: unknown): string {
  const data = result as any;

  if (toolName === "sales.getToday" || toolName === "sales.getPeriod") {
    return `Ventas: ${money(data?.total)} en ${Number(data?.count ?? 0)} movimiento(s).`;
  }
  if (toolName === "sales.comparePeriods") {
    const current = Number(data?.current?.total ?? 0);
    const previous = Number(data?.previous?.total ?? 0);
    const difference = Number(data?.difference ?? current - previous);
    const pct = previous > 0 ? (difference / previous) * 100 : null;
    return `Período actual: ${money(current)}. Período anterior: ${money(previous)}. Diferencia: ${money(difference)}${pct === null ? "" : ` (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`}.`;
  }
  if (toolName === "purchases.list") {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return "Todavía no hay compras registradas.";
    const total = rows.reduce((sum: number, row: any) => sum + Number(row?.total ?? 0), 0);
    return `Encontré ${rows.length} compra(s) recientes por un total de ${money(total)}.`;
  }
  if (toolName === "debts.list") {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return "No hay deudas activas registradas.";
    const total = rows.reduce((sum: number, row: any) => sum + Number(row?.pending_amount ?? 0), 0);
    const preview = rows.slice(0, 5).map((row: any) => `${row.creditor}: ${money(row.pending_amount)}`).join("; ");
    return `Hay ${rows.length} deuda(s) activas por ${money(total)}. ${preview}`;
  }
  if (toolName === "stock.getLowStock") {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return "No hay insumos por debajo del mínimo.";
    const names = rows.slice(0, 8).map((row: any) => row?.ingredients?.name ?? row?.ingredient?.name ?? "Insumo").join(", ");
    return `Hay ${rows.length} insumo(s) en nivel bajo: ${names}.`;
  }
  if (toolName === "products.list") {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return "Todavía no hay productos registrados.";
    const names = rows.slice(0, 10).map((row: any) => row?.name).filter(Boolean).join(", ");
    return `Hay ${rows.length} producto(s) registrados: ${names}.`;
  }
  if (toolName === "invoices.listPending") {
    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) return "No hay facturas pendientes de revisión.";
    return `Hay ${rows.length} factura(s) pendientes de revisión.`;
  }

  return "Operación realizada correctamente.";
}

async function safeAudit(
  deps: AgentDependencies,
  event: Parameters<AgentDependencies["audit"]>[0],
): Promise<boolean> {
  try {
    await deps.audit(event);
    return true;
  } catch {
    return false;
  }
}

export async function runAgent(input: IncomingAgentMessage, deps: AgentDependencies): Promise<AgentReply> {
  const actor = await deps.resolveActor(input);
  if (!actor) return { status: "rejected", text: "Este número no está autorizado para operar en este negocio." };

  if (!(await deps.claimMessage(input, actor))) {
    return { status: "duplicate", text: "Mensaje ya procesado." };
  }

  const available = toolsForActor(actor);
  let pending = await deps.getPending(actor);
  if (pending && new Date(pending.expiresAt) <= deps.now()) {
    await deps.consumePending(pending.id, actor);
    pending = null;
  }

  if (pending && CANCELLATION.test(input.text)) {
    try {
      const consumed = await deps.consumePending(pending.id, actor, true);
      if (!consumed) {
        return { status: "rejected", text: "Ese pedido ya no está pendiente. No se canceló ninguna operación." };
      }
    } catch {
      return { status: "failed", text: "No pude cancelar el pedido. Intentá nuevamente." };
    }
    await safeAudit(deps, { actor, input, tool: pending.toolCall.name, error: "operation_cancelled" });
    return { status: "cancelled", text: "Pedido cancelado. No se realizó ningún cambio.", tool: pending.toolCall.name };
  }

  let confirmed = false;
  if (pending?.kind === "confirmation") {
    if (!CONFIRMATION.test(input.text)) {
      return {
        status: "needs_confirmation",
        text: "La operación sigue pendiente. Respondé “Sí” para confirmarla o “Cancelar” para descartarla.",
        tool: pending.toolCall.name,
      };
    }
    confirmed = true;
  }

  const call = confirmed && pending ? pending.toolCall : await deps.interpret(input.text, available, pending);
  if (!call) {
    await safeAudit(deps, { actor, input, error: "intent_not_recognized" });
    return {
      status: "needs_input",
      text: "No pude identificar una operación habilitada. Reformulá el pedido sin incluir datos sensibles.",
    };
  }

  const tool = getTool(call.name);
  if (!tool) return { status: "rejected", text: "Esa capacidad no existe." };
  if (!actor.enabledModules.includes(tool.module)) {
    return { status: "rejected", text: `No tenés habilitado el módulo de ${tool.module} para este negocio.` };
  }
  if (!available.some((item) => item.name === tool.name)) {
    return { status: "rejected", text: "No tenés permiso para realizar esa operación." };
  }

  const missing = getMissingArguments(call, available);
  if (missing.length) {
    await deps.savePending({
      actor,
      toolCall: call,
      kind: "clarification",
      expiresAt: new Date(deps.now().getTime() + 15 * 60_000).toISOString(),
    });
    await safeAudit(deps, {
      actor,
      input,
      tool: tool.name,
      module: tool.module,
      arguments: call.arguments,
      error: `missing:${missing.join(",")}`,
    });
    return {
      status: "needs_input",
      text: `Me falta ${labels[missing[0]] ?? missing[0]}. ¿Me lo indicás?`,
      tool: tool.name,
    };
  }

  if (tool.risk === "SENSITIVE" && !confirmed) {
    await deps.savePending({
      actor,
      toolCall: call,
      kind: "confirmation",
      expiresAt: new Date(deps.now().getTime() + 10 * 60_000).toISOString(),
    });
    await safeAudit(deps, {
      actor,
      input,
      tool: tool.name,
      module: tool.module,
      arguments: call.arguments,
      confirmationRequired: true,
    });
    return {
      status: "needs_confirmation",
      text: `Voy a ejecutar “${tool.description}”. Respondé “Sí” para confirmar o “Cancelar” para descartar.`,
      tool: tool.name,
    };
  }

  // Una confirmación se consume antes del write para que un fallo posterior
  // de auditoría o respuesta no pueda re-ejecutar la misma operación.
  if (confirmed && pending?.kind === "confirmation") {
    try {
      const consumed = await deps.consumePending(pending.id, actor, true);
      if (!consumed) {
        return { status: "rejected", text: "Ese pedido venció o ya fue atendido. No se ejecutó nuevamente.", tool: tool.name };
      }
      pending = null;
    } catch {
      return {
        status: "failed",
        text: "No pude confirmar la operación de forma segura. No se realizó ningún cambio.",
        tool: tool.name,
      };
    }
  }

  let result: unknown;
  try {
    result = await deps.execute(actor, call);
  } catch (error) {
    const message = error instanceof Error ? error.message : "tool_failed";
    await safeAudit(deps, {
      actor,
      input,
      tool: tool.name,
      module: tool.module,
      arguments: call.arguments,
      error: message,
      confirmed,
    });
    return {
      status: "failed",
      text: "No pude completar la operación. No se realizó ningún cambio.",
      tool: tool.name,
    };
  }

  // Las aclaraciones pueden limpiarse después del execute: si falla este paso
  // no debemos afirmar que el write se revirtió.
  let cleanupOk = true;
  if (pending) {
    try {
      await deps.consumePending(pending.id, actor);
    } catch {
      cleanupOk = false;
    }
  }

  const auditOk = await safeAudit(deps, {
    actor,
    input,
    tool: tool.name,
    module: tool.module,
    arguments: call.arguments,
    result,
    confirmed,
  });

  const suffix = cleanupOk && auditOk
    ? ""
    : " La operación se realizó, pero quedó una incidencia interna de seguimiento.";

  return {
    status: "completed",
    text: `${formatResult(tool.name, result)}${suffix}`,
    tool: tool.name,
    data: result,
  };
}
