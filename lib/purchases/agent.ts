import { randomUUID } from "node:crypto";
import { hasPermission } from "../permissions";
import type { AgentActor, PendingOperation, ToolCall, ToolDefinition } from "../whatsapp-agent/types";

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_CENTS = 999_999_999_999n;
type Issue = { key: string; message: string; unexpected?: boolean };
type PurchaseDatabase = { from(table: string): any; rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
const methods: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", debito: "Débito", credito: "Crédito", tarjeta: "Tarjeta", "cuenta corriente": "Cuenta corriente", otro: "Otro" };
const normalize = (value: string) => value.trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
export const isPurchaseWrite = (name: string) => name === "purchases.create";
const missing = (value: unknown) => value === undefined || value === null || value === "";

export function missingPurchaseArguments(call: ToolCall): string[] {
  const a = call.arguments;
  return [...(missing(a.supplier) && missing(a.supplierId) ? ["supplier"] : []), ...["amount", "paymentMethod", "purchasedAt", "kind"].filter(key => missing(a[key]))];
}

/** The domain contract never rounds a JS number into a financial amount. */
function decimal(raw: unknown): string {
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) throw new Error("debe ser un importe decimal explícito, sin miles y con hasta dos decimales");
  const [whole, fraction = ""] = raw.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (cents <= 0n || cents > MAX_CENTS) throw new Error("debe ser mayor a cero y menor a 10.000.000.000");
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
function shortText(raw: unknown, max: number): string {
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > max || /[\x00-\x1f\x7f]/.test(raw)) throw new Error("debe ser un texto válido de una sola línea");
  return raw.trim();
}

export function validatePurchaseCall(call: ToolCall): { call: ToolCall; issues: Issue[] } {
  const raw = call.arguments;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
    || Reflect.ownKeys(raw).some(key => typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(raw, key)!))) {
    return { call: { name: call.name, arguments: {} }, issues: [{ key: "arguments", message: "deben ser datos de compra válidos", unexpected: true }] };
  }
  const allowed = ["kind", "supplier", "supplierId", "branchId", "purchasedAt", "paymentMethod", "amount", "requestId", "supplierLabel", "branchLabel"];
  const clean: Record<string, unknown> = {};
  const issues: Issue[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key)) { issues.push({ key, message: "no está permitido", unexpected: true }); continue; }
    if (missing(value)) continue;
    try {
      if (["requestId", "supplierId", "branchId"].includes(key)) {
        if (typeof value !== "string" || !UUID.test(value)) throw new Error("debe ser un ID válido");
        clean[key] = value.toLowerCase();
      } else if (key === "amount") clean[key] = decimal(value);
      else if (key === "kind") {
        if (value !== "summary") throw new Error("debe ser summary; para cargar cantidades, unidades e insumos usá Compras");
        clean[key] = value;
      } else if (key === "purchasedAt") {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("debe ser una fecha válida completa, AAAA-MM-DD");
        clean[key] = value;
      } else if (key === "paymentMethod") {
        const method = methods[normalize(shortText(value, 100))];
        if (!method) throw new Error("debe ser Transferencia, Efectivo, Débito, Crédito, Tarjeta, Cuenta corriente u Otro");
        clean[key] = method;
      } else clean[key] = shortText(value, 200);
    } catch (error) { issues.push({ key, message: error instanceof Error ? error.message : "es inválido" }); }
  }
  return { call: { name: call.name, arguments: clean }, issues };
}
function checked(actor: AgentActor, input: ToolCall): ToolCall {
  if (!isPurchaseWrite(input.name) || !actor.enabledModules.includes("purchases") || !hasPermission(actor.role, "purchases.create")) throw new Error("purchase_permission_denied");
  const validated = validatePurchaseCall(input);
  if (validated.issues.length || missingPurchaseArguments(validated.call).length) throw new Error("purchase_missing_fields");
  return validated.call;
}

/** Read-only resolution: no implicit main branch, wildcard matching or fabricated rows. */
export async function preparePurchaseTool(db: Pick<PurchaseDatabase, "from">, actor: AgentActor, input: ToolCall): Promise<ToolCall> {
  const a = checked(actor, input).arguments;
  if (actor.branchIds !== null && (actor.branchIds.length === 0 || a.branchId && !actor.branchIds.includes(String(a.branchId)))) throw new Error("purchase_branch_not_allowed");
  let branchQuery = db.from("branches").select("id,name,business_id").eq("business_id", actor.businessId);
  if (a.branchId) branchQuery = branchQuery.eq("id", a.branchId);
  if (actor.branchIds !== null) branchQuery = branchQuery.in("id", actor.branchIds);
  const branches = await branchQuery.limit(2);
  if (branches?.error || !Array.isArray(branches?.data)) throw new Error("purchase_prepare_failed");
  if (branches.data.length === 0) throw new Error("purchase_branch_not_found");
  if (branches.data.length !== 1) throw new Error("purchase_branch_ambiguous");
  const branch = branches.data[0];
  if (!branch || !UUID.test(branch.id) || branch.business_id !== actor.businessId || a.branchId && branch.id !== a.branchId || actor.branchIds !== null && !actor.branchIds.includes(branch.id)) throw new Error("purchase_branch_not_allowed");

  let supplierQuery = db.from("suppliers").select("id,name,business_id,active").eq("business_id", actor.businessId).eq("active", true);
  if (a.supplierId) supplierQuery = supplierQuery.eq("id", a.supplierId);
  if (a.supplier) supplierQuery = supplierQuery.ilike("name", String(a.supplier).replace(/[\\%_]/g, "\\$&"));
  const suppliers = await supplierQuery.limit(2);
  if (suppliers?.error || !Array.isArray(suppliers?.data)) throw new Error("purchase_prepare_failed");
  if (suppliers.data.length === 0) throw new Error("purchase_supplier_not_found");
  if (suppliers.data.length !== 1) throw new Error("purchase_supplier_ambiguous");
  const supplier = suppliers.data[0];
  if (!supplier || !UUID.test(supplier.id) || supplier.business_id !== actor.businessId || supplier.active !== true || a.supplierId && supplier.id !== a.supplierId
    || a.supplier && supplier.name.toLocaleLowerCase("es") !== String(a.supplier).toLocaleLowerCase("es")) throw new Error("purchase_supplier_not_found");
  return { name: input.name, arguments: {
    requestId: randomUUID(), kind: "summary", branchId: branch.id, supplierId: supplier.id,
    purchasedAt: a.purchasedAt, paymentMethod: a.paymentMethod, amount: a.amount,
    supplierLabel: shortText(supplier.name, 200), branchLabel: shortText(branch.name, 200),
  } };
}

/** Only the persisted pending UUID crosses the trust boundary. SQL reads its own input. */
export async function executePurchaseTool(db: Pick<PurchaseDatabase, "rpc">, actor: AgentActor, input: ToolCall, pendingId?: string) {
  const a = checked(actor, input).arguments;
  if (!pendingId || !UUID.test(pendingId) || !a.requestId || !a.supplierId || !a.branchId || actor.branchIds !== null && !actor.branchIds.includes(String(a.branchId))) throw new Error("purchase_write_rejected");
  let result;
  try { result = await db.rpc("commit_purchase_atomic", { p_business_id: actor.businessId, p_input: null, p_extraction_id: null, p_pending_id: pendingId }); }
  catch { throw new Error("purchase_response_unknown"); }
  if (result?.error) {
    const error = result.error as { code?: unknown; message?: unknown };
    const rejected = typeof error.code === "string" && ["22023", "42501", "23514", "23505", "22P02", "22003", "22007", "22008"].includes(error.code)
      || typeof error.message === "string" && /^purchase_[a-z_]+$/.test(error.message);
    throw new Error(rejected ? "purchase_write_rejected" : "purchase_response_unknown");
  }
  const data = result?.data as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data) || data.ok !== true || typeof data.id !== "string" || !UUID.test(data.id) || typeof data.replayed !== "boolean" || data.kind !== "summary" || data.source !== "whatsapp") throw new Error("purchase_response_unknown");
  return data;
}

export function purchaseConfirmationText(call: ToolCall): string {
  const a = call.arguments;
  const [whole, fraction] = decimal(a.amount).split(".");
  const amount = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
  return `Registrar compra resumida. Proveedor: ${a.supplierLabel ?? a.supplierId} (${a.supplierId}). Sucursal: ${a.branchLabel ?? a.branchId} (${a.branchId}). Fecha: ${a.purchasedAt}. Medio de pago: ${a.paymentMethod}. Total: ${amount}; moneda no informada.\nSólo se registra el importe: sin renglones de detalle ni movimiento de stock. Referencia: ${a.requestId}.\nRespondé “Sí” para confirmar o “Cancelar” para descartar.`;
}

/** Human currency text is parsed into exact cents, never through floating point. */
function humanAmount(text: string): string | undefined {
  const match = text.trim().match(/^\$?\s*(\d+(?:[.,]\d+)*)\s*(mil|k)?[.!]?$/i);
  if (!match) return undefined;
  const raw = /^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(match[1]) ? match[1].replace(/\./g, "").replace(",", ".") : match[1].replace(",", ".");
  if (!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) return undefined;
  const [whole, fraction = ""] = raw.split(".");
  const cents = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * (match[2] ? 1000n : 1n);
  try { return decimal(`${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`); } catch { return undefined; }
}

export function interpretPurchaseCall(text: string, tools: readonly ToolDefinition[], pending?: PendingOperation | null): ToolCall | null {
  if (!tools.some(tool => isPurchaseWrite(tool.name))) return null;
  if (pending?.kind === "clarification" && isPurchaseWrite(pending.toolCall.name)) {
    const key = pending.clarificationKey ?? missingPurchaseArguments(pending.toolCall)[0];
    if (!key) return pending.toolCall;
    const value = key === "amount" ? humanAmount(text) : key === "kind" && /^(resumen|resumida|summary)$/i.test(text.trim()) ? "summary" : text.trim();
    const args = { ...pending.toolCall.arguments, [key]: value };
    // A requested supplier disambiguation replaces the prior candidate, not a second filter.
    if (key === "supplierId") delete args.supplier;
    if (key === "supplier") delete args.supplierId;
    return { name: pending.toolCall.name, arguments: args };
  }
  const structured = text.match(/^(?:compra|purchases\.create)\s*:\s*(\{[\s\S]*\})$/i);
  if (structured) { try { return { name: "purchases.create", arguments: JSON.parse(structured[1]) }; } catch { return { name: "purchases.create", arguments: {} }; } }
  if (!/registr[aá].*compra|compra.*\$|(?:carg[aá]|nueva).*compra/i.test(text)) return null;
  const afterAmount = text.match(/compra(?:\s+de)?\s+(\$?\s*\d[\d.,]*(?:\s*(?:mil|k)\b)?)\s+(?:a|de)\s+(.+?)[.!]?$/i);
  const beforeAmount = text.match(/compra\s+(?:a|de)\s+(.+?)\s+(?:por|de)\s+(\$?\s*\d[\d.,]*(?:\s*(?:mil|k)\b)?)[.!]?$/i);
  return { name: "purchases.create", arguments: { kind: "summary", supplier: afterAmount?.[2]?.trim() ?? beforeAmount?.[1]?.trim(), amount: humanAmount(afterAmount?.[1] ?? beforeAmount?.[2] ?? "") } };
}
