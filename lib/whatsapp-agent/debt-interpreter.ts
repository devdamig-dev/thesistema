import { decimalMoneyToCents } from "../debts/plans";
import { isDebtPlanTool, missingDebtArguments } from "./debt-contract";
import type { PendingOperation, ToolCall, ToolDefinition } from "./types";

const normalize = (v: string) => v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function debtMoneyCents(text: string): number | undefined {
  const match = text.match(/(?:\$|\bARS\s*|\bUSD\s*)\s*(-?\d+(?:[.,]\d+)*)\s*(mil|k)?\b/i)
    ?? text.trim().match(/^(-?\d+(?:[.,]\d+)*)\s*(mil|k)?(?:\s+(?:pesos|d[oó]lares))?[.!]?$/i);
  if (!match) return undefined;
  let decimal = match[1];
  if (/^-?\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(decimal)) decimal = decimal.replace(/\./g, "").replace(",", ".");
  else decimal = decimal.replace(",", ".");
  try { const cents = decimalMoneyToCents(decimal); return match[2] ? decimalMoneyToCents(String(cents * 10)) : cents; } catch { return undefined; }
}
function explicitDate(text: string): string | undefined {
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/); if (iso) return iso[1];
  const dmy = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/); return dmy ? `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}` : undefined;
}
const compact = (a: Record<string, unknown>) => Object.fromEntries(Object.entries(a).filter(([, value]) => value !== undefined));
const creditor = (text: string) => text.match(/(?:le debo (?:al?|a la)|deuda (?:con|de)|prestamo (?:del?|con)|cuota\s+\d+\s+(?:del?|al?))\s+(.+?)(?=\s+(?:\$|ARS\b|USD\b|por\b|y acord|en \d+ cuotas|el \d|mediante\b|con fecha\b)|[.,;!?]|$)/iu)?.[1]?.trim();
const method = (text: string) => text.match(/\b(transferencia|efectivo|d[eé]bito|cr[eé]dito|tarjeta|cuenta corriente|otro)\b/i)?.[1];
export function clarifyDebtCall(text: string, pending: PendingOperation, tools: ToolDefinition[]): ToolCall | null {
  if (!isDebtPlanTool(pending.toolCall.name)) return null;
  // An acknowledgement is never a missing financial fact (e.g. payment method or creditor).
  if (/^(si|confirmo|dale|ok|confirmar|no|cancelar|cancela|cancelo|no confirmar)[.!\s]*$/.test(normalize(text))) return pending.toolCall;
  const key = pending.clarificationKey ?? missingDebtArguments(pending.toolCall)[0];
  if (!key) return pending.toolCall;
  const value = text.trim(); const n = normalize(value); let parsed: unknown = value;
  const choices: Record<string, Record<string, string>> = {
    creditorType: { proveedor: "supplier", banco: "bank", tarjeta: "card", organismo: "government", persona: "person", otro: "other" },
    mode: { "pago unico": "single", "unico": "single", "cuotas": "installments" },
    periodicity: { semanal: "weekly", quincenal: "fortnightly", mensual: "monthly", personalizada: "custom" },
    allocationRule: { "cuota seleccionada": "selected_installment", "cuotas pendientes mas antiguas": "oldest_due", "mas antiguas": "oldest_due" },
    kind: { notas: "notes", cuota: "installment" },
  };
  if (key.endsWith("Cents")) parsed = debtMoneyCents(value);
  else if (["installmentCount", "installmentNumber"].includes(key)) parsed = /^\d+$/.test(value) ? Number(value) : undefined;
  else if (["from", "to", "takenAt", "paidAt", "firstDueDate", "dueDate"].includes(key)) parsed = key === "dueDate" && /^(sin fecha|sin vencimiento)$/.test(n) ? null : explicitDate(value);
  else if (key === "dueDates") parsed = value.split(/[,;]\s*/).map(explicitDate);
  else if (key === "notes" && /^(sin notas|borrar notas)$/.test(n)) parsed = null;
  else if (key === "currency") parsed = /^(pesos|ars)$/i.test(n) ? "ARS" : /^(dolares|usd)$/i.test(n) ? "USD" : value.toUpperCase();
  else if (choices[key]) parsed = choices[key][n] ?? value;
  const argumentsValue = { ...pending.toolCall.arguments, [key]: parsed };
  if (key === "debtId") { delete argumentsValue.creditor; delete argumentsValue.expectedVersion; }
  if (key === "installmentNumber") delete argumentsValue.installmentId;
  if (key === "creditor" && uuid.test(value)) { argumentsValue.debtId = value; delete argumentsValue.creditor; }
  return tools.some(tool => tool.name === pending.toolCall.name) ? { name: pending.toolCall.name, arguments: argumentsValue } : null;
}
export function interpretDebtCall(text: string, tools: ToolDefinition[], now = new Date()): ToolCall | null {
  const n = normalize(text); const allowed = (name: string) => tools.some(tool => tool.name === name);
  const call = (name: string, args: Record<string, unknown>) => allowed(name) ? { name, arguments: compact(args) } : null;
  const branchId = text.match(/sucursal\s+([0-9a-f-]{36})/i)?.[1];
  const creationIntent = /le debo|registra (?:una |nueva )?deuda|crea.*(?:deuda|obligacion)/.test(n);
  const debtId = text.match(/deuda\s+([0-9a-f-]{36})/i)?.[1];
  if (!creationIntent && !/(cambia|edita|modifica|registra.*pago)/.test(n) && /(venc|tengo que pagar)/.test(n) && /(deuda|cuota|mes|semana)/.test(n)) {
    const dates = text.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
    let from = dates[0]; let to = dates[1];
    const local = now.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }); const day = new Date(`${local}T00:00:00Z`);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    if (/este mes/.test(n)) { from = `${local.slice(0, 7)}-01`; to = iso(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0))); }
    if (/semana que viene|proxima semana/.test(n)) { day.setUTCDate(day.getUTCDate() + 8 - (day.getUTCDay() || 7)); from = iso(day); day.setUTCDate(day.getUTCDate() + 6); to = iso(day); }
    return call("debts.listDue", { from, to, branchId });
  }
  if (/(anula|reverti).*(pago)/.test(n)) return call("debts.voidPlanPayment", { creditor: creditor(text), debtId, branchId, paymentId: text.match(/pago\s+([0-9a-f-]{36})/i)?.[1] });
  if (/(cambia|edita|modifica).*(vencimiento|notas|cuota)/.test(n)) return call("debts.editPlan", { creditor: creditor(text), debtId, branchId, kind: /cuota|vencimiento/.test(n) ? "installment" : "notes", installmentNumber: text.match(/cuota\s+(\d+)/i) ? Number(text.match(/cuota\s+(\d+)/i)![1]) : undefined });
  if (!creationIntent && /(pago|paga|registr).*(cuota|pago global|imputa|mas antiguas)|pago global/.test(n)) {
    const part = text.match(/cuota\s+(\d+)/i); const explicitMoney = text.match(/(?:por\s+)?(?:\$|ARS\s*|USD\s*)\s*[\d.,]+(?:\s*(?:mil|k)\b)?/i)?.[0];
    return call("debts.registerPlanPayment", { creditor: creditor(text), debtId, branchId, installmentNumber: part ? Number(part[1]) : undefined, allocationRule: /mas antiguas/.test(n) ? "oldest_due" : part ? "selected_installment" : undefined, amountCents: explicitMoney ? debtMoneyCents(explicitMoney) : undefined, paidAt: explicitDate(text), paymentMethod: method(text) });
  }
  if (creationIntent) {
    const count = text.match(/\b(\d+)\s+cuotas/i); const name = creditor(text);
    const total = text.match(/total financiado\s*(?:de|:)??\s*((?:\$|ARS\s*|USD\s*)?\s*[\d.,]+(?:\s*(?:mil|k)\b)?)/i)?.[1];
    const installment = text.match(/cuotas?\s+de\s+((?:\$|ARS\s*|USD\s*)?\s*[\d.,]+(?:\s*(?:mil|k)\b)?)/i)?.[1];
    const explicitCapital = text.match(/(?:capital|monto original)\s*(?:de|:)?\s*((?:\$|ARS\s*|USD\s*)?\s*[\d.,]+(?:\s*(?:mil|k)\b)?)/i)?.[1];
    const beforeFinancing = text.split(/total financiado|cuotas? de|anticipo|recargo|inter[eé]s/i)[0];
    const original = explicitCapital ?? beforeFinancing.match(/(?:\$|ARS\s*|USD\s*)\s*[\d.,]+(?:\s*(?:mil|k)\b)?/i)?.[0];
    return call("debts.createPlan", { creditor: name, creditorType: name && /^banco\b/i.test(name) ? "bank" : undefined, branchId, originalAmountCents: original ? debtMoneyCents(original) : undefined, totalFinancedCents: total ? debtMoneyCents(total) : undefined, installmentAmountCents: installment ? debtMoneyCents(installment) : undefined, currency: /\bARS\b|\bpesos\b/i.test(text) ? "ARS" : /\bUSD\b|\bd[oó]lares\b/i.test(text) ? "USD" : undefined, mode: count || /en cuotas/.test(n) ? "installments" : /pago unico|sin cuotas/.test(n) ? "single" : undefined, installmentCount: count ? Number(count[1]) : undefined, periodicity: /mensual/.test(n) ? "monthly" : /quincenal/.test(n) ? "fortnightly" : /semanal/.test(n) ? "weekly" : undefined, dueDate: !count && /pago unico|sin cuotas/.test(n) ? explicitDate(text.match(/vencimiento\s+(.+)/i)?.[1] ?? "") : undefined, firstDueDate: count ? explicitDate(text.match(/(?:desde|primer vencimiento)\s+(.+)/i)?.[1] ?? "") : undefined, takenAt: explicitDate(text.match(/(?:origen|contraida)\s*(?:el)?\s+(.+)/i)?.[1] ?? "") });
  }
  if (/cuanto.*(?:queda|saldo)|saldo.*(?:deuda|prestamo)|cronograma|consult.*prestamo/.test(n)) return call("debts.getPlan", { creditor: creditor(text), debtId, branchId });
  return null;
}
