import { localDate, shiftDate } from "../../app/ventas/reporting";
import type { PendingOperation, ToolCall, ToolDefinition } from "../whatsapp-agent/types";
import type { ReplenishmentReport } from "./types";

/** Dates are an explicit observed period. Tomorrow is never treated as forecast. */
export function interpretReplenishmentCall(text: string, tools: readonly ToolDefinition[], pending?: PendingOperation | null, context?: { timezone?: string; now?: Date }): ToolCall | null {
  if (!tools.some((tool) => tool.name === "stock.getReplenishment")) return null;
  const structured = text.match(/^stock\.getReplenishment\s*:\s*([\s\S]+)$/i);
  if (structured) {
    try {
      const value: unknown = JSON.parse(structured[1]);
      return { name: "stock.getReplenishment", arguments: value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {} };
    } catch { return { name: "stock.getReplenishment", arguments: {} }; }
  }
  const isPending = pending?.kind === "clarification" && pending.toolCall.name === "stock.getReplenishment";
  if (!isPending && !/reposici[oó]n|reabastec|qu[eé].*(?:comprar|reponer)|consum\S*.*(?:stock|insumos|ingredientes)|(?:stock|insumos|ingredientes).*consum|stock\.getReplenishment/i.test(text)) return null;
  const args: Record<string, unknown> = isPending ? { ...pending.toolCall.arguments } : {};
  const dates = text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  const branch = text.match(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/i)?.[0];
  if (branch) args.branchId = branch;
  if (dates.length >= 2) { args.from = dates[0]; args.to = dates[1]; }
  else if (dates.length === 1) {
    if (isPending) args[!args.from ? "from" : "to"] = dates[0];
    else { args.from = dates[0]; args.to = dates[0]; }
  } else if (context?.timezone && /\b(?:hoy|ayer|[uú]ltimos?\s+\d+\s+d[ií]as?)\b/i.test(text)) {
    const today = localDate(context.now ?? new Date(), context.timezone);
    const days = Number(text.match(/[uú]ltimos?\s+(\d+)\s+d[ií]as?/i)?.[1] ?? 1);
    if (days >= 1 && days <= 366) {
      args.to = /\bayer\b/i.test(text) ? shiftDate(today, -1) : today;
      args.from = shiftDate(String(args.to), -(days - 1));
    }
  }
  return { name: "stock.getReplenishment", arguments: args };
}
const number = (value: number | null) => value === null ? "sin verificar" : value.toLocaleString("es-AR", { maximumFractionDigits: 6 });
export function formatReplenishmentReport(report: ReplenishmentReport): string {
  const lines = report.rows.map((row) => {
    const products = row.contributors.map((item) => `${item.productName} (${number(item.soldQuantity)} vendidos: ${number(item.theoreticalQuantity)} ${row.unit})`).join(", ");
    const receipts = row.recentReceipts.map((item) => `${item.purchasedAt}: ${number(item.quantity)} ${item.unit}, compra ${item.purchaseId}`).join("; ");
    return `${row.name}${row.active ? "" : " (archivado; sin recomendación de compra)"}: actual ${number(row.current)} ${row.unit}; mínimo ${number(row.minimum)}; ${row.active ? `reponer para alcanzar el mínimo ${number(row.minimumShortfall)}.` : "Sin reposición sugerida."} Salidas registradas ${number(row.recordedOutflow)}; reversas de compras ${number(row.recordedPurchaseReversal)} (no consumo); mermas ${number(row.recordedWaste)}; ajustes netos ${number(row.recordedAdjustment)}. Teórico de recetas ${number(row.theoreticalUsage)}.${products ? ` Productos: ${products}.` : ""}${report.visibility.purchases ? ` Compras vinculadas del período: ${receipts || "ninguna"}.` : ""}${row.unverifiedMovementCount ? ` ${row.unverifiedMovementCount} movimientos sin verificar excluidos.` : ""}${row.unverifiedReceiptCount ? ` ${row.unverifiedReceiptCount} compras con unidades sin verificar excluidas.` : ""}`;
  });
  const header = `Reposición en ${report.branchName}, ${report.from} a ${report.to} (${report.timezone}${report.partialCurrentDay ? "; hoy parcial" : ""}). Stock actual al consultar; consumo del período. Salidas físicas y teórico son independientes: no se suman ni se descuentan otra vez. No es pronóstico de agotamiento. Historial completo sin verificar. Stock negativo o inválido requiere revisión; no se trata como cero.\n`;
  const foot = `\nVentas sin detalle: ${report.evidence.salesWithoutDetail ?? "sin acceso"}; líneas sin receta: ${report.evidence.missingRecipeLines ?? "sin acceso"}; recetas incompletas: ${report.evidence.incompleteRecipeLines ?? "sin acceso"}; compras sin detalle vinculado: ${report.evidence.purchasesWithoutLinkedDetail ?? "sin acceso"}.${!report.visibility.sales ? " Detalle de ventas/recetas no disponible para tus permisos o módulos." : ""}${!report.visibility.purchases ? " Compras no disponibles para tus permisos o módulos." : ""}`;
  const shown: string[] = []; let length = header.length + foot.length;
  for (const line of lines) { if (length + line.length > 3300) break; shown.push(line); length += line.length + 1; }
  return `${header}${shown.join("\n") || (lines.length ? "El detalle supera el espacio de este mensaje." : "No hay insumos registrados.")}${foot}${shown.length < lines.length ? `\nSe muestran ${shown.length} de ${lines.length} insumos. Abrí Stock → Reposición para el detalle completo.` : ""}`;
}
