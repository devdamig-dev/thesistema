import { debtConfirmationText, isDebtPlanWrite } from "./debt-contract";
import { getMissingArguments } from "./interpreter";
import { getTool, toolsForActor } from "./registry";
import type { AgentDependencies, AgentReply, IncomingAgentMessage } from "./types";
import { validateToolCall } from "./validation";

const CANCELLATION = /^(no|cancelar|cancel[aá]|cancelo|no confirmar)[.!\s]*$/i;
const CONFIRMATION = /^(s[ií]|confirmo|dale|ok|confirmar)[.!\s]*$/i;
const labels: Record<string, string> = {
  paymentMethod: "medio de pago",
  paidAt: "fecha de pago completa (AAAA-MM-DD)", takenAt: "fecha de origen completa (AAAA-MM-DD)",
  creditorType: "tipo de acreedor (proveedor, banco, tarjeta, organismo, persona u otro)",
  currency: "moneda (por ejemplo ARS o USD)", mode: "modalidad (pago único o cuotas)",
  originalAmountCents: "capital original", totalFinancedCents: "total financiado confirmado, sin adivinar intereses",
  installmentCount: "cantidad de cuotas", periodicity: "periodicidad (semanal, quincenal, mensual o personalizada)",
  firstDueDate: "primer vencimiento con año (AAAA-MM-DD)", dueDate: "vencimiento completo",
  dueDates: "todas las fechas de vencimiento (AAAA-MM-DD, separadas por coma)",
  amountCents: "importe explícito del pago", allocationRule: "imputación (cuota seleccionada o cuotas pendientes más antiguas)",
  installmentNumber: "número de cuota", branchId: "ID de la sucursal", debtId: "ID de la deuda",
  from: "fecha inicial",
  to: "fecha final",
  creditor: "acreedor",
  amount: "monto",
  ingredient: "insumo",
  quantity: "cantidad",
  operation: "tipo de movimiento",
  reason: "motivo",
  unit: "unidad",
};

const money = (value: unknown) =>
  new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 })
    .format(Number(value ?? 0));

function confirmationText(toolName: string, argumentsValue: Record<string, unknown>, description: string): string {
  if (isDebtPlanWrite(toolName)) return debtConfirmationText({ name: toolName, arguments: argumentsValue });
  if (toolName === "debts.registerPayment") {
    return `Voy a registrar un pago a ${String(argumentsValue.creditor)} por ${money(argumentsValue.amount)} mediante ${String(argumentsValue.paymentMethod)} el ${String(argumentsValue.paidAt)}. Respondé “Sí” para confirmar o “Cancelar” para descartar.`;
  }
  return `Voy a ejecutar “${description}”. Respondé “Sí” para confirmar o “Cancelar” para descartar.`;
}

function formatResult(toolName: string, result: unknown): string {
  const data = result as any;
  const debtMoney = (cents: number, currency: string | null) => `${currency ?? "moneda no informada"} ${(cents / 100).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (toolName === "debts.getPlan") {
    const parts = data?.projection?.installments ?? [];
    return `${data.creditor}: saldo ${debtMoney(data.pendingCents, data.currency)}. ${parts.length ? `${data.projection.paidInstallmentCount}/${parts.length} cuotas pagadas.\n${parts.slice(0, 20).map((p: any) => `Cuota ${p.installmentNumber}: ${debtMoney(p.pendingAmountCents, data.currency)} pendientes; ${p.dueDate ?? "sin fecha informada"}; ${p.status}`).join("\n")}${parts.length > 20 ? "\nSe muestran las primeras 20 cuotas. El cronograma completo está en Deudas." : ""}` : "Deuda histórica sin plan de cuotas."}`;
  }
  if (toolName === "debts.listDue") {
    const rows = data?.debts ?? [];
    if (!rows.length) return `No encontré vencimientos pendientes entre ${data.from} y ${data.to}.`;
    const lines: string[] = rows.flatMap((d: any) => d.legacyDue ? [`${d.creditor}: ${debtMoney(d.legacyDue.pendingAmountCents, d.currency)}, ${d.legacyDue.dueDate}`] : d.installments.map((p: any) => `${d.creditor}, cuota ${p.installmentNumber}: ${debtMoney(p.pendingAmountCents, d.currency)}, ${p.dueDate}`));
    const shown: string[] = []; let length = 0;
    for (const line of lines) { if (length + line.length > 3000) break; shown.push(line); length += line.length + 1; }
    return `Vencimientos entre ${data.from} y ${data.to}:\n${shown.join("\n")}${shown.length < lines.length ? `\nSe muestran ${shown.length} de ${lines.length} vencimientos. Acotá las fechas o consultá Deudas para ver el detalle completo.` : ""}`;
  }
  if (isDebtPlanWrite(toolName)) return `Operación registrada y auditada en la deuda ${data?.debt_id}.`;

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
    const preview = rows.slice(0, 5).map((row: any) => `${row.creditor}: ${row.currency ?? "moneda no informada"} ${Number(row.pending_amount).toLocaleString("es-AR")}`).join("; ");
    return `Hay ${rows.length} deuda(s) activas. ${preview}${rows.length > 5 ? ". Se muestran las primeras 5; consultá una deuda para ver su cronograma." : ""}`;
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
  let pending;
  try { pending = await deps.getPending(actor); }
  catch (error) {
    const code = error instanceof Error ? error.message : "pending_read_failed";
    await safeAudit(deps, { actor, input, error: code });
    return { status: "failed", text: code === "pending_scope_ambiguous" ? "Hay más de una confirmación pendiente en esta conversación. No voy a elegir una ni ejecutar cambios; revisá las operaciones en el sistema." : "No pude verificar las confirmaciones pendientes. No ejecuté ninguna operación." };
  }
  if (pending?.resultUncertain && new Date(pending.expiresAt) <= deps.now() && !CANCELLATION.test(input.text)) return { status: "needs_input", tool: pending.toolCall.name, text: "El resultado del intento anterior sigue sin verificar. Revisá el historial en Deudas antes de iniciar otra operación." };
  if (pending && !pending.resultUncertain && new Date(pending.expiresAt) <= deps.now()) {
    await deps.consumePending(pending.id, actor);
    pending = null;
  }

  if (pending && CANCELLATION.test(input.text)) {
    try {
      const consumed = await deps.consumePending(pending.id, actor, !pending.resultUncertain);
      if (!consumed) {
        return { status: "rejected", text: "Ese pedido ya no está pendiente. No se canceló ninguna operación." };
      }
    } catch {
      return { status: "failed", text: "No pude cancelar el pedido. Intentá nuevamente." };
    }
    await safeAudit(deps, { actor, input, tool: pending.toolCall.name, error: "operation_cancelled" });
    return { status: "cancelled", text: pending.resultUncertain ? "Dejé de reintentar. El resultado original podría haberse guardado; revisá el historial antes de registrar otra operación." : "Pedido cancelado. No se realizó ningún cambio.", tool: pending.toolCall.name };
  }

  if (pending?.kind === "clarification" && CONFIRMATION.test(input.text)) {
    const key = pending.clarificationKey ?? getMissingArguments(pending.toolCall, available)[0];
    return { status: "needs_input", tool: pending.toolCall.name, text: `Todavía falta aclarar ${labels[key] ?? key ?? "el dato solicitado"}. Una confirmación no completa ese dato.` };
  }

  const recoveringUncertain = pending?.resultUncertain === true;
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

  const interpreted = confirmed && pending ? pending.toolCall : await deps.interpret(input.text, available, pending);
  if (!interpreted) {
    await safeAudit(deps, { actor, input, error: "intent_not_recognized" });
    return {
      status: "needs_input",
      text: "No pude identificar una operación habilitada. Reformulá el pedido sin incluir datos sensibles.",
    };
  }

  const tool = getTool(interpreted.name);
  if (!tool) return { status: "rejected", text: "Esa capacidad no existe." };
  if (!actor.enabledModules.includes(tool.module)) {
    return { status: "rejected", text: `No tenés habilitado el módulo de ${tool.module} para este negocio.` };
  }
  if (!available.some((item) => item.name === tool.name)) {
    return { status: "rejected", text: "No tenés permiso para realizar esa operación." };
  }

  if (tool.name === "debts.registerPayment") {
    if (pending?.toolCall.name === tool.name) { try { await deps.consumePending(pending.id, actor); } catch { /* The disabled command can never execute. */ } }
    await safeAudit(deps, { actor, input, tool: tool.name, module: tool.module, error: "legacy_payment_requires_review" });
    return { status: "needs_input", tool: tool.name, text: "Los pagos de deudas históricas requieren revisión manual en Deudas. Para una deuda con plan, indicá cuota o imputación, importe, fecha y método: voy a mostrar el destino y la moneda antes de confirmar." };
  }

  const validation = validateToolCall(interpreted);
  let call = validation.call;
  if (validation.issues.length) {
    const unexpected = validation.issues.some((issue) => issue.unexpected);
    await safeAudit(deps, {
      actor,
      input,
      tool: tool.name,
      module: tool.module,
      arguments: call.arguments,
      error: `invalid_arguments:${validation.issues.map((issue) => issue.key).join(",")}`,
    });
    if (unexpected) return { status: "rejected", text: "La operación incluye datos no permitidos y no fue ejecutada.", tool: tool.name };
    const issue = validation.issues[0];
    await deps.savePending({
      actor,
      toolCall: call,
      kind: "clarification",
      clarificationKey: issue.key,
      expiresAt: new Date(deps.now().getTime() + 15 * 60_000).toISOString(),
    });
    return {
      status: "needs_input",
      text: `${labels[issue.key] ?? issue.key}: ${issue.message}. ¿Me lo indicás nuevamente?`,
      tool: tool.name,
    };
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

  if ((isDebtPlanWrite(tool.name) || tool.name === "debts.getPlan") && !confirmed) {
    try {
      if (!deps.prepare) throw new Error("debt_prepare_unavailable");
      call = await deps.prepare(actor, call);
    } catch (error) {
      const code = error instanceof Error ? error.message : "debt_prepare_failed";
      const fields: Record<string, string> = { branch_ambiguous: "branchId", branch_not_found: "branchId", branch_not_allowed: "branchId", debt_not_unambiguous: "debtId", debt_not_found: "creditor", installment_not_found: "installmentNumber", payment_not_found: "paymentId" };
      const key = fields[code];
      await safeAudit(deps, { actor, input, tool: tool.name, arguments: call.arguments, error: code });
      if (key) {
        await deps.savePending({ actor, toolCall: call, kind: "clarification", clarificationKey: key, expiresAt: new Date(deps.now().getTime() + 15 * 60_000).toISOString() });
        return { status: "needs_input", tool: tool.name, text: `No pude identificar un destino único y autorizado. Indicá ${labels[key] ?? key}; todavía no se guardó nada.` };
      }
      return { status: "failed", tool: tool.name, text: code === "debt_preview_requires_ui" ? "El cronograma completo supera el espacio de un mensaje. Revisalo y confirmalo desde Deudas; no guardé la obligación." : "No pude preparar el detalle de esta deuda de forma segura. Revisá la deuda desde Deudas; no ejecuté la operación." };
    }
  }

  if ((tool.risk === "SENSITIVE" || isDebtPlanWrite(tool.name) || tool.name === "debts.create") && !confirmed) {
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
      text: confirmationText(tool.name, call.arguments, tool.description),
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

  // A completed stock clarification is a one-shot command too. Different
  // WhatsApp reply IDs can race on the same pending unit/quantity clarification.
  if (tool.name === "stock.addMovement" && pending?.kind === "clarification") {
    try {
      const consumed = await deps.consumePending(pending.id, actor, true);
      if (!consumed) return { status: "rejected", text: "Ese pedido de stock venció o ya fue atendido. No se ejecutó nuevamente.", tool: tool.name };
      pending = null;
    } catch {
      return { status: "failed", text: "No pude confirmar el pedido de stock de forma segura. No se ejecutó.", tool: tool.name };
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
    if ((message === "debt_response_unknown" || recoveringUncertain) && isDebtPlanWrite(tool.name)) {
      // Restore the SAME RPC operation ID after a lost response; never ask for a new payment.
      let retained = false;
      try { await deps.savePending({ actor, toolCall: call, kind: "confirmation", resultUncertain: true, expiresAt: new Date(deps.now().getTime() + 30 * 86400_000).toISOString() }); retained = true; } catch { /* Never claim rollback or a pending retry that was not saved. */ }
      return { status: "failed", tool: tool.name, text: retained ? "No pude confirmar el resultado; podría haberse guardado. Respondé Sí para reintentar exactamente el mismo intento sin duplicarlo, o revisá el historial antes de iniciar otro." : `No pude confirmar el resultado ni conservar el reintento; podría haberse guardado. Revisá el historial de Deudas con la referencia ${String(call.arguments.requestId)} antes de registrar otra operación.` };
    }
    if (["allocation_rule_required", "debt_missing_fields", "debt_not_unambiguous", "stale_version", "amount_exceeds_pending", "amount_exceeds_installment_pending"].includes(message)) return { status: "needs_input", tool: tool.name, text: message === "allocation_rule_required" ? "Esta deuda tiene un plan. Indicá cuota o imputación a las cuotas más antiguas, importe, fecha y método de pago para revisar el detalle antes de confirmar." : message === "stale_version" ? "El saldo cambió desde la confirmación. Consultá la deuda y prepará un nuevo detalle antes de pagar." : "La deuda, importe o datos del pago requieren revisión. No se registró este intento." };
    return {
      status: "failed",
      text: tool.name === "stock.addMovement"
        ? "No pude confirmar el resultado del movimiento de stock. Revisá el historial antes de repetirlo para evitar duplicarlo."
        : message === "purchase_branch_ambiguous"
        ? "Tenés más de una sucursal asignada. No registré la compra porque falta definir en cuál corresponde."
        : message === "purchase_branch_not_found"
          ? "No encontré una sucursal habilitada para registrar la compra. No se realizó ningún cambio."
          : "No pude completar la operación. No se realizó ningún cambio.",
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
