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
  return [...(missing(a.supplier) && missing(a.supplierId) ? ["supplier"] : []), ...[...(a.kind === "detailed" ? ["items"] : ["amount"]), "paymentMethod", "purchasedAt", "kind"].filter(key => missing(a[key]))];
}

/** The domain contract never rounds a JS number into a financial amount. */
function decimal(raw: unknown, allowZero = false): string {
  if (typeof raw !== "string" || !/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(raw)) throw new Error("debe ser un importe decimal explícito, sin miles y con hasta dos decimales");
  const [whole, fraction = ""] = raw.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if ((allowZero ? cents < 0n : cents <= 0n) || cents > MAX_CENTS) throw new Error("debe ser mayor a cero y menor a 10.000.000.000");
  return `${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}
function shortText(raw: unknown, max: number): string {
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > max || /[\x00-\x1f\x7f]/.test(raw)) throw new Error("debe ser un texto válido de una sola línea");
  return raw.trim();
}

export type PurchaseAgentLine = { ingredientId?: string; ingredient?: string; description?: string; qty: string; unit: string; unitPrice: string };
type PurchaseDraftLine = Omit<PurchaseAgentLine, "unitPrice"> & { unitPrice?: string };
const quantityMicros = (qty: string) => {
  const [whole, fraction = ""] = qty.split(".");
  return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, "0"));
};
const lineCents = (line: PurchaseAgentLine) => (quantityMicros(line.qty) * BigInt(line.unitPrice.replace(".", "")) + 500000n) / 1000000n;
function purchaseLines(raw: unknown): PurchaseAgentLine[];
function purchaseLines(raw: unknown, allowMissingPrice: true): PurchaseDraftLine[];
function purchaseLines(raw: unknown, allowMissingPrice = false): PurchaseDraftLine[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) throw new Error("indicá entre 1 y 100 renglones con insumo exacto, cantidad, unidad y precio unitario explícitos");
  const items = raw.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || ![Object.prototype, null].includes(Object.getPrototypeOf(entry)) || Reflect.ownKeys(entry).some(key => typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(entry, key)!) || !["ingredientId", "ingredient", "description", "qty", "unit", "unitPrice"].includes(key))) throw new Error(`renglón ${index + 1}: contiene campos no permitidos`);
    const line = entry as Record<string, unknown>;
    if (!line.ingredientId && !line.ingredient) throw new Error(`renglón ${index + 1}: indicá el ID o nombre exacto del insumo`);
    if (line.ingredientId !== undefined && (typeof line.ingredientId !== "string" || !UUID.test(line.ingredientId))) throw new Error(`renglón ${index + 1}: ID de insumo inválido`);
    if (typeof line.qty !== "string" || !/^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(line.qty) || Number(line.qty) <= 0) throw new Error(`renglón ${index + 1}: falta cantidad decimal explícita mayor a cero (hasta seis decimales)`);
    const unit = normalize(shortText(line.unit, 40));
    if (!["unit", "u", "unidad", "unidades", "kg", "g", "l", "ml"].includes(unit)) throw new Error(`renglón ${index + 1}: indicá unidad, kg, g, l o ml`);
    return { ...(line.ingredientId ? { ingredientId: String(line.ingredientId).toLowerCase() } : {}), ...(line.ingredient ? { ingredient: shortText(line.ingredient, 200) } : {}), ...(line.description ? { description: shortText(line.description, 1000) } : {}), qty: line.qty, unit: ["u", "unidad", "unidades"].includes(unit) ? "unit" : unit, ...(allowMissingPrice && missing(line.unitPrice) ? {} : { unitPrice: decimal(line.unitPrice, true) }) };
  });
  const total = items.reduce((sum, line) => sum + (line.unitPrice === undefined ? 0n : lineCents(line as PurchaseAgentLine)), 0n);
  if(total>MAX_CENTS)throw new Error("el total detallado excede el máximo permitido");
  return items;
}

export function validatePurchaseCall(call: ToolCall): { call: ToolCall; issues: Issue[] } {
  const raw = call.arguments;
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))
    || Reflect.ownKeys(raw).some(key => typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(raw, key)!))) {
    return { call: { name: call.name, arguments: {} }, issues: [{ key: "arguments", message: "deben ser datos de compra válidos", unexpected: true }] };
  }
  const allowed = ["kind", "supplier", "supplierId", "branchId", "purchasedAt", "paymentMethod", "amount", "requestId", "supplierLabel", "branchLabel", "items", "receiptReference", "suppliedTotal"];
  const clean: Record<string, unknown> = {};
  const issues: Issue[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (!allowed.includes(key)) { issues.push({ key, message: "no está permitido", unexpected: true }); continue; }
    if (missing(value)) {
      if (key === "suppliedTotal") issues.unshift({ key, message: "indicá el total informado como un importe decimal explícito" });
      continue;
    }
    try {
      if (["requestId", "supplierId", "branchId"].includes(key)) {
        if (typeof value !== "string" || !UUID.test(value)) throw new Error("debe ser un ID válido");
        clean[key] = value.toLowerCase();
      } else if (key === "amount" || key === "suppliedTotal") clean[key] = decimal(value);
      else if (key === "kind") {
        if (value !== "summary" && value !== "detailed") throw new Error("debe ser summary (resumida) o detailed (con insumos y cantidades)");
        clean[key] = value;
      } else if (key === "items") {
        // Keep valid physical facts while asking for an unprovided price. Strict
        // purchaseLines/checked still prevent a partial line from being executed.
        const items = purchaseLines(value, true);
        clean[key] = items;
        const unpriced = items.findIndex(line => line.unitPrice === undefined);
        if (unpriced !== -1) issues.push({ key, message: `renglón ${unpriced + 1}: indicá el precio unitario explícito; no se puede deducir un precio exacto en centavos del total informado sin redondear. Se conservan el insumo, la cantidad y la unidad` });
      }
      else if (key === "receiptReference") clean[key] = shortText(value, 200);
      else if (key === "purchasedAt") {
        if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000") || !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) throw new Error("debe ser una fecha válida completa, AAAA-MM-DD");
        clean[key] = value;
      } else if (key === "paymentMethod") {
        const method = methods[normalize(shortText(value, 100))];
        if (!method) throw new Error("debe ser Transferencia, Efectivo, Débito, Crédito, Tarjeta, Cuenta corriente u Otro");
        clean[key] = method;
      } else clean[key] = shortText(value, 200);
    } catch (error) {
      const issue = { key, message: error instanceof Error ? error.message : "es inválido" };
      if (key === "suppliedTotal") issues.unshift(issue); else issues.push(issue);
    }
  }
  if (clean.kind === "summary" && Object.hasOwn(raw, "items")) issues.push({ key: "items", message: "una compra resumida no tiene renglones", unexpected: true });
  if (clean.kind === "detailed" && Object.hasOwn(raw, "amount")) issues.push({ key: "amount", message: "el total detallado se calcula desde los renglones", unexpected: true });
  if (Object.hasOwn(raw, "suppliedTotal") && clean.kind !== "detailed") issues.push({ key: "suppliedTotal", message: "sólo corresponde a una compra detallada", unexpected: true });
  if (clean.suppliedTotal && Array.isArray(clean.items) && clean.items.every(line => line.unitPrice !== undefined)) {
    const cents = (clean.items as PurchaseAgentLine[]).reduce((sum, line) => sum + lineCents(line), 0n);
    if (cents !== BigInt(String(clean.suppliedTotal).replace(".", ""))) issues.push({ key: "items", message: `el detalle no coincide con el total informado (${clean.suppliedTotal}). Indicá los precios unitarios correctos o corregí explícitamente el total con un objeto JSON que contenga items y suppliedTotal` });
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
  const items: PurchaseAgentLine[] = [];
  if (a.kind === "detailed") for (const line of a.items as PurchaseAgentLine[]) {
    let query = db.from("ingredients").select("id,name,unit,business_id,active").eq("business_id", actor.businessId).eq("active", true);
    if (line.ingredientId) query = query.eq("id", line.ingredientId);
    if (line.ingredient) query = query.ilike("name", line.ingredient.replace(/[\\%_]/g, "\\$&"));
    const result = await query.limit(2);
    if (result?.error || !Array.isArray(result?.data)) throw new Error("purchase_prepare_failed");
    if (result.data.length !== 1) throw new Error(result.data.length ? "purchase_ingredient_ambiguous" : "purchase_ingredient_not_found");
    const ingredient = result.data[0];
    if (!UUID.test(ingredient.id) || ingredient.business_id !== actor.businessId || ingredient.active !== true || line.ingredientId && ingredient.id !== line.ingredientId || line.ingredient && ingredient.name.toLocaleLowerCase("es") !== line.ingredient.toLocaleLowerCase("es")) throw new Error("purchase_ingredient_not_found");
    const base = normalize(ingredient.unit); const unit = ["u", "unidad", "unidades"].includes(base) ? "unit" : base;
    if (line.unit !== unit && !(["kg", "g"].includes(line.unit) && ["kg", "g"].includes(unit)) && !(["l", "ml"].includes(line.unit) && ["l", "ml"].includes(unit))) throw new Error("purchase_ingredient_unit");
    items.push({ ingredientId: ingredient.id, description: line.description ?? shortText(ingredient.name, 200), qty: line.qty, unit: line.unit, unitPrice: line.unitPrice });
  }
  const prepared: ToolCall = { name: input.name, arguments: {
    requestId: randomUUID(), kind: a.kind, branchId: branch.id, supplierId: supplier.id,
    purchasedAt: a.purchasedAt, paymentMethod: a.paymentMethod, ...(a.kind === "detailed" ? { items } : { amount: a.amount }),
    ...(a.receiptReference ? { receiptReference: a.receiptReference } : {}),
    supplierLabel: shortText(supplier.name, 200), branchLabel: shortText(branch.name, 200),
  } };
  // Meta sends at most 4096 characters. Never ask to confirm an omitted line.
  if (purchaseConfirmationText(prepared).length > 4000) throw new Error("purchase_preview_requires_ui");
  return prepared;
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
  if (!data || typeof data !== "object" || Array.isArray(data) || data.ok !== true || typeof data.id !== "string" || !UUID.test(data.id) || typeof data.replayed !== "boolean" || data.kind !== a.kind || data.source !== "whatsapp") throw new Error("purchase_response_unknown");
  return data;
}

export function purchaseConfirmationText(call: ToolCall): string {
  const a = call.arguments;
  const header = `Proveedor: ${a.supplierLabel ?? a.supplierId} (${a.supplierId}). Sucursal: ${a.branchLabel ?? a.branchId} (${a.branchId}). Fecha: ${a.purchasedAt}. Medio de pago: ${a.paymentMethod}.`;
  const reference = a.receiptReference ? ` Referencia de comprobante: ${a.receiptReference}.` : "";
  if (a.kind === "detailed") {
    const items = purchaseLines(a.items); let cents = 0n;
    const lines = items.map(line => {
      const [q, fraction = ""] = line.qty.split("."); const quantity = BigInt(q) * 1000000n + BigInt(fraction.padEnd(6, "0"));
      const price = BigInt(line.unitPrice.replace(".", "")); cents += (quantity * price + 500000n) / 1000000n;
      return `${line.description ?? line.ingredient} (${line.ingredientId}): ${line.qty} ${line.unit} × ${line.unitPrice}.`;
    });
    if (cents > MAX_CENTS) throw new Error("purchase_total_overflow");
    return `Registrar compra detallada. ${header}\n${lines.join("\n")}\nTotal: ${cents / 100n}.${String(cents % 100n).padStart(2, "0")}; moneda no informada. Se registran estas cantidades en stock.${reference} Referencia del intento: ${a.requestId}.\nRespondé “Sí” para confirmar o “Cancelar” para descartar.`;
  }
  const [whole, fraction] = decimal(a.amount).split(".");
  const amount = `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${fraction}`;
  return `Registrar compra resumida. ${header} Total: ${amount}; moneda no informada.\nSólo se registra el importe: sin renglones de detalle ni movimiento de stock.${reference} Referencia: ${a.requestId}.\nRespondé “Sí” para confirmar o “Cancelar” para descartar.`;
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

const NATURAL_UNIT = "(?:kilogramos?|kilos?|kg|gramos?|g|mililitros?|ml|litros?|l|unidades?|unit|u)";
const NATURAL_QUANTITY = "(?:-?\\d+(?:[.,]\\d+)*)";
const physicalQuantity = new RegExp(`\\b${NATURAL_QUANTITY}\\s*${NATURAL_UNIT}\\b`, "i");

/** Human quantities follow Argentine grouping; tool JSON stays canonical decimal.
 * A nonzero 1–3 digit prefix plus complete dot-separated triplets is grouped
 * (1.234,5 = 1234.5). Otherwise a single dot or comma is a decimal separator.
 * Leading-zero fractions such as 0.125 cannot be thousands grouping.
 */
function humanQuantity(text: string): string | undefined {
  const input = text.trim();
  const grouped = /^[1-9]\d{0,2}(?:\.\d{3})+(?:,\d{1,6})?$/.test(input);
  const raw = (grouped ? input.replace(/\./g, "") : input).replace(",", ".");
  if (!/^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(raw)) return undefined;
  const [whole, fraction = ""] = raw.split(".");
  const canonicalFraction = fraction.replace(/0+$/, "");
  return canonicalFraction ? `${whole}.${canonicalFraction}` : whole;
}

function exactUnitPrice(qty: string, total: string | undefined): string | undefined {
  if (!total || !/^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(qty)) return undefined;
  const quantity = quantityMicros(qty);
  if (quantity <= 0n) return undefined;
  const scaled = BigInt(total.replace(".", "")) * 1000000n;
  // Even a rounded line total matching the input is not evidence of its price.
  if (scaled % quantity !== 0n) return undefined;
  const cents = scaled / quantity;
  try { return decimal(`${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`, true); } catch { return undefined; }
}

/** A bounded single-line grammar; unsupported physical detail never becomes a summary. */
function naturalPurchaseDetail(text: string): Record<string, unknown> | null {
  const body = text.match(/\bcompra(?:\s+detallad[ao]|\s+con (?:insumos|detalle))?\s+(.+)$/i)?.[1]?.trim().replace(/[.!]$/, "");
  if (!body) return physicalQuantity.test(text) ? { kind: "detailed" } : null;
  const prefix = new RegExp(`^(?:de\\s+)?(${NATURAL_QUANTITY})\\s*(${NATURAL_UNIT})\\b\\s+(?:de\\s+)?(.+)$`, "i");
  let detail = body.match(prefix);
  let supplier: string | undefined;
  // Also accept “compra a Don José de 10 kg de carne por $85.000”.
  if (!detail) {
    const supplierFirst = body.match(new RegExp(`^a\\s+(.+?)\\s+de\\s+(${NATURAL_QUANTITY}\\s*${NATURAL_UNIT}\\b.+)$`, "i"));
    if (supplierFirst) { supplier = supplierFirst[1].trim(); detail = supplierFirst[2].match(prefix); }
  }
  const unsupportedPhysical = /^(?:de\s+)?-?\d[\d.,]*\s+(?!(?:a|de|por|mil|k)\b)[\p{L}]+/iu.test(body);
  if (!detail) return physicalQuantity.test(body) || unsupportedPhysical || new RegExp(`^(?:de\\s+)?${NATURAL_UNIT}\\b`, "i").test(body) ? { kind: "detailed" } : null;
  const qty = humanQuantity(detail[1]) ?? detail[1];
  const suppliedUnit = normalize(detail[2]);
  const unit = /^(kg|kilo)/.test(suppliedUnit) ? "kg" : /^(g|gramo)/.test(suppliedUnit) ? "g"
    : /^(ml|mililitro)/.test(suppliedUnit) ? "ml" : /^(l|litro)/.test(suppliedUnit) ? "l" : "unit";
  let ingredient: string | undefined;
  let totalText: string | undefined;
  if (supplier) {
    const match = detail[3].match(/^(.+?)\s+por\s+(.+)$/i);
    ingredient = (match?.[1] ?? detail[3]).trim(); totalText = match?.[2];
  } else {
    const supplierBeforeTotal = detail[3].match(/^(.+?)\s+a\s+(.+?)(?:\s+por\s+(.+))?$/i);
    const supplierAfterTotal = detail[3].match(/^(.+?)\s+por\s+(.+?)\s+a\s+(.+)$/i);
    if (supplierAfterTotal) { ingredient = supplierAfterTotal[1].trim(); totalText = supplierAfterTotal[2]; supplier = supplierAfterTotal[3].trim(); }
    else if (supplierBeforeTotal) { ingredient = supplierBeforeTotal[1].trim(); supplier = supplierBeforeTotal[2].trim(); totalText = supplierBeforeTotal[3]; }
    else {
      const match = detail[3].match(/^(.+?)\s+por\s+(.+)$/i);
      ingredient = (match?.[1] ?? detail[3]).trim(); totalText = match?.[2];
    }
  }
  // Multiple lines, alternatives and quantities embedded in names need an explicit
  // list. Never price only one line from a combined total or choose one candidate.
  if (physicalQuantity.test(ingredient) || /\s(?:o|y)\s+-?\d/i.test(ingredient)) return { kind: "detailed", ...(supplier ? { supplier } : {}) };
  const suppliedTotal = humanAmount(totalText ?? "");
  const unitPrice = exactUnitPrice(qty, suppliedTotal);
  return { kind: "detailed", ...(supplier ? { supplier } : {}), items: [{ ingredient, qty, unit, ...(unitPrice ? { unitPrice } : {}) }], ...(suppliedTotal ? { suppliedTotal } : {}) };
}

export function interpretPurchaseCall(text: string, tools: readonly ToolDefinition[], pending?: PendingOperation | null): ToolCall | null {
  if (!tools.some(tool => isPurchaseWrite(tool.name))) return null;
  if (pending?.kind === "clarification" && isPurchaseWrite(pending.toolCall.name)) {
    const key = pending.clarificationKey ?? missingPurchaseArguments(pending.toolCall)[0];
    if (!key) return pending.toolCall;
    let value: unknown = key === "amount" ? humanAmount(text) : key === "kind" && /^(resumen|resumida|summary)$/i.test(text.trim()) ? "summary" : key === "kind" && /^(detalle|detallada|detailed)$/i.test(text.trim()) ? "detailed" : text.trim();
    let correctedTotal: unknown;
    if (key === "items") {
      const items = pending.toolCall.arguments.items as PurchaseDraftLine[] | undefined;
      const price = humanAmount(text);
      const needsPrice = Array.isArray(items) && items.length === 1 && (items[0].unitPrice === undefined || pending.toolCall.arguments.suppliedTotal && lineCents(items[0] as PurchaseAgentLine) !== BigInt(String(pending.toolCall.arguments.suppliedTotal).replace(".", "")));
      if (price && needsPrice) value = [{ ...items[0], unitPrice: price }];
      else if (needsPrice && !/^[\[{]|;/.test(text.trim())) value = items;
      else try {
        value = JSON.parse(text);
        if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => ["items", "suppliedTotal"].includes(key))) {
          const correction = value as Record<string, unknown>;
          correctedTotal = correction.suppliedTotal; value = correction.items;
        }
      } catch {
        value = text.split("\n").map(row=>{ const fields=row.split(";").map(v=>v.trim()); return fields.length===4 ? {ingredient:fields[0],qty:humanQuantity(fields[1]) ?? fields[1],unit:fields[2],unitPrice:humanAmount(fields[3])} : {}; });
      }
    }
    if (key === "suppliedTotal") value = humanAmount(text);
    const args: Record<string, unknown> = { ...pending.toolCall.arguments, [key]: value, ...(correctedTotal !== undefined ? { suppliedTotal: correctedTotal } : {}) };
    // A requested supplier disambiguation replaces the prior candidate, not a second filter.
    if (key === "supplierId") delete args.supplier;
    if (key === "supplier") delete args.supplierId;
    return { name: pending.toolCall.name, arguments: args };
  }
  const structured = text.match(/^(?:compra|purchases\.create)\s*:\s*(\{[\s\S]*\})$/i);
  if (structured) { try { return { name: "purchases.create", arguments: JSON.parse(structured[1]) }; } catch { return { name: "purchases.create", arguments: {} }; } }
  if (!/registr[aá].*compra|compra.*\$|(?:carg[aá]|nueva).*compra/i.test(text)) return null;
  const detail = naturalPurchaseDetail(text);
  if (detail) return { name: "purchases.create", arguments: detail };
  const afterAmount = text.match(/compra(?:\s+de)?\s+(\$?\s*\d[\d.,]*(?:\s*(?:mil|k)\b)?)\s+(?:a|de)\s+(.+?)[.!]?$/i);
  const beforeAmount = text.match(/compra\s+(?:a|de)\s+(.+?)\s+(?:por|de)\s+(\$?\s*\d[\d.,]*(?:\s*(?:mil|k)\b)?)[.!]?$/i);
  const kind = /detallad[ao]|con (?:insumos|detalle)/i.test(text) ? "detailed" : "summary";
  return { name: "purchases.create", arguments: { kind, supplier: afterAmount?.[2]?.trim() ?? beforeAmount?.[1]?.trim(), ...(kind === "summary" ? { amount: humanAmount(afterAmount?.[1] ?? beforeAmount?.[2] ?? "") } : {}) } };
}
