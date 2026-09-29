import type { PendingOperation, ToolCall, ToolDefinition } from "./types";

const amount = (text: string) => {
  const match = text.replace(/\./g, "").match(/\$?\s*(\d+(?:,\d+)?)\s*(mil|k)?/i);
  if (!match) return undefined;
  return Number(match[1].replace(",", ".")) * (match[2] ? 1000 : 1);
};

export async function interpretHeuristically(
  text: string,
  tools: ToolDefinition[],
  pending?: PendingOperation | null,
): Promise<ToolCall | null> {
  const normalized = text.trim().toLocaleLowerCase("es");
  if (pending?.kind === "clarification") {
    const missing = getMissingArguments(pending.toolCall, tools);
    return { ...pending.toolCall, arguments: { ...pending.toolCall.arguments, [missing[0]]: text.trim() } };
  }
  const allowed = (name: string) => tools.some((tool) => tool.name === name);
  if (/facturas?.*pendiente|pendientes?.*facturas?/.test(normalized) && allowed("invoices.listPending")) return { name: "invoices.listPending", arguments: {} };
  if (/stock|insumos?/.test(normalized) && /(bajo|faltan|cr[ií]tic)/.test(normalized) && allowed("stock.getLowStock")) return { name: "stock.getLowStock", arguments: {} };
  if (/(sum[aá]|agreg[aá]|ingres[aá]).*(stock|kg|unidad)/.test(normalized) && allowed("stock.addMovement")) return { name: "stock.addMovement", arguments: { ingredient: normalized.match(/(?:de\s+)?([a-záéíóúñ ]+)\s+al stock/)?.[1]?.trim(), quantity: amount(normalized), operation: "in" } };
  if (/cre[aá].*(producto|hamburguesa)|producto.*\$/.test(normalized) && allowed("products.create")) return { name: "products.create", arguments: { name: text.match(/cre[aá]\s+(.+?)\s+(?:a|por)\s+\$/i)?.[1], price: amount(normalized) } };
  if (/productos?/.test(normalized) && allowed("products.list")) return { name: "products.list", arguments: {} };
  if (/(pagad[ao]|pago).*(deuda|debemos)|deuda.*pagad[ao]/.test(normalized) && allowed("debts.registerPayment")) return { name: "debts.registerPayment", arguments: { creditor: text.match(/de(?:uda de)?\s+([\p{L} ]+)/iu)?.[1]?.trim() ?? text.match(/de\s+([\p{L} ]+)\.?$/iu)?.[1]?.trim() } };
  if (/registr[aá].*deuda/.test(normalized) && allowed("debts.create")) return { name: "debts.create", arguments: { creditor: text.match(/(?:a|de)\s+([\p{L} ]+?)\s+(?:por|de)\s+\$?/iu)?.[1]?.trim(), amount: amount(normalized) } };
  if (/deudas?|debemos/.test(normalized) && allowed("debts.list")) return { name: "debts.list", arguments: {} };
  if (/registr[aá].*compra|compra.*\$/.test(normalized)) return allowed("purchases.create") ? { name: "purchases.create", arguments: { supplier: text.match(/(?:a|de)\s+([\p{L} ]+?)\s+(?:por|de)\s+\$?/iu)?.[1]?.trim(), amount: amount(normalized) } } : null;
  if (/compras?/.test(normalized) && allowed("purchases.list")) return { name: "purchases.list", arguments: {} };
  if (/compar/.test(normalized) && /semana/.test(normalized) && allowed("sales.comparePeriods")) {
    const now = new Date(); const day = now.getUTCDay() || 7; const start = new Date(now); start.setUTCDate(now.getUTCDate() - day + 1);
    const previousTo = new Date(start); previousTo.setUTCDate(start.getUTCDate() - 1); const previousFrom = new Date(previousTo); previousFrom.setUTCDate(previousTo.getUTCDate() - 6);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { name: "sales.comparePeriods", arguments: { from: iso(start), to: iso(now), previousFrom: iso(previousFrom), previousTo: iso(previousTo) } };
  }
  if (/vendimos hoy|ventas? de hoy/.test(normalized) && allowed("sales.getToday")) return { name: "sales.getToday", arguments: {} };
  return null;
}

export function getMissingArguments(call: ToolCall, tools: readonly ToolDefinition[]): string[] {
  const tool = tools.find((item) => item.name === call.name);
  return tool?.required.filter((key) => call.arguments[key] === undefined || call.arguments[key] === null || call.arguments[key] === "") ?? [];
}
