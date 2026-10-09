export type PurchaseReviewLine = { ingredientId: string | null; description: string; qty: string; unit: string; unitPrice: string };
type PurchaseReviewBase = { branchId: string; supplierId: string; purchasedAt: string; paymentMethod: string };
export type InboxPurchaseProposal = PurchaseReviewBase & ({ kind: "summary"; amount: string } | { kind: "detailed"; items: PurchaseReviewLine[] });
export type InboxPurchaseApproval = { extractionId: string; businessId: string; userId: string; expectedFields: Record<string, unknown>; review: InboxPurchaseProposal };
export type InboxPurchaseReview = { alreadyApproved: boolean; extractionId: string; businessId: string; userId: string; branchId: string | null; branches: { id: string; name: string }[]; suppliers: { id: string; name: string }[]; ingredients: { id: string; name: string; unit: string }[]; expectedFields: Record<string, unknown>; supplierId: string; purchasedAt: string; paymentMethod: string; amount: string; items: PurchaseReviewLine[] };
export const PURCHASE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_AMOUNT = 999999999999n;
const MAX_JOURNAL_LENGTH = 250000;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return typeof key !== "string" || !descriptor.enumerable || !("value" in descriptor);
  })) throw new Error("Revisión de compra inválida.");
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(key => !keys.includes(key))) throw new Error("La revisión tiene campos faltantes o no permitidos.");
}
function id(value: unknown) {
  if (typeof value !== "string" || !PURCHASE_UUID.test(value)) throw new Error("Elegí una referencia válida de tu negocio.");
  return value;
}
function text(value: unknown, max: number) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || /[\x00-\x1f\x7f]/.test(value)) throw new Error("Revisá descripción, unidad y medio de pago.");
  return value.trim();
}
function scaledDecimal(value: string, scale: number) {
  const [whole, frac = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(frac.padEnd(scale, "0"));
}
function decimal(value: unknown, scale: number, positive: boolean, max: bigint): string {
  if (typeof value !== "string" || !new RegExp(`^\\d+(?:\\.\\d{1,${scale}})?$`).test(value) || value.length > 24) throw new Error(`Usá un número con hasta ${scale} decimales.`);
  const scaled = scaledDecimal(value, scale);
  if (scaled > max || (positive && scaled === 0n)) throw new Error("El importe o la cantidad está fuera del rango permitido.");
  return value;
}

// JSON.stringify alone can drop undefined/functions, invoke getters/toJSON and
// normalize nonfinite numbers. The optimistic snapshot must remain exact.
export function parsePurchaseExpectedFields(raw: unknown): Record<string, unknown> {
  object(raw);
  const ancestors = new Set<object>();
  let nodes = 0;
  function validate(value: unknown, depth: number): void {
    if (++nodes > 50000 || depth > 100) throw new Error("La extracción supera el tamaño permitido.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) return;
    if (!value || typeof value !== "object" || ancestors.has(value)) throw new Error("La extracción contiene datos no válidos.");
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) throw new Error("La extracción contiene datos no válidos.");
      for (let i = 0; i < value.length; i++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
        if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("La extracción contiene datos no válidos.");
        validate(descriptor.value, depth + 1);
      }
    } else {
      for (const child of Object.values(object(value))) validate(child, depth + 1);
    }
    ancestors.delete(value);
  }
  validate(raw, 0);
  const serialized = JSON.stringify(raw);
  if (serialized.length > 50000) throw new Error("La extracción supera el tamaño permitido.");
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function parseInboxPurchaseApproval(raw: unknown): InboxPurchaseApproval {
  const r = object(raw); exact(r, ["extractionId", "businessId", "userId", "expectedFields", "review"]);
  const p = object(r.review); const kind = p.kind;
  if (kind !== "summary" && kind !== "detailed") throw new Error("Elegí si es un resumen sin stock o una compra detallada.");
  exact(p, ["kind", "branchId", "supplierId", "purchasedAt", "paymentMethod", kind === "summary" ? "amount" : "items"]);
  if (typeof p.purchasedAt !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(p.purchasedAt) || Number.isNaN(Date.parse(`${p.purchasedAt}T12:00:00Z`)) || new Date(`${p.purchasedAt}T12:00:00Z`).toISOString().slice(0, 10) !== p.purchasedAt) throw new Error("Ingresá la fecha real de la compra.");
  const base = { branchId: id(p.branchId), supplierId: id(p.supplierId), purchasedAt: p.purchasedAt, paymentMethod: text(p.paymentMethod, 100) };
  let review: InboxPurchaseProposal;
  if (kind === "summary") review = { ...base, kind, amount: decimal(p.amount, 2, true, MAX_AMOUNT) };
  else {
    if (!Array.isArray(p.items) || p.items.length < 1 || p.items.length > 100 || Reflect.ownKeys(p.items).length !== p.items.length + 1) throw new Error("Agregá entre 1 y 100 líneas reales.");
    let total = 0n;
    const items: PurchaseReviewLine[] = [];
    for (let i = 0; i < p.items.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(p.items, String(i));
      if (!descriptor?.enumerable || !("value" in descriptor)) throw new Error("Revisión de compra inválida.");
      const line = object(descriptor.value); exact(line, ["ingredientId", "description", "qty", "unit", "unitPrice"]);
      const qty = decimal(line.qty, 6, true, 999999999999999999n);
      const unitPrice = decimal(line.unitPrice, 2, false, MAX_AMOUNT);
      // PostgreSQL rounds each positive line to cents, then sums the lines.
      total += (scaledDecimal(qty, 6) * scaledDecimal(unitPrice, 2) + 500000n) / 1000000n;
      if (total > MAX_AMOUNT) throw new Error("El total de la compra supera el rango permitido.");
      items.push({ ingredientId: line.ingredientId === null ? null : id(line.ingredientId), description: text(line.description, 1000), qty, unit: text(line.unit, 40), unitPrice });
    }
    review = { ...base, kind, items };
  }
  return { extractionId: id(r.extractionId), businessId: id(r.businessId), userId: id(r.userId), expectedFields: parsePurchaseExpectedFields(r.expectedFields), review };
}

type PurchaseJournalContext = Pick<InboxPurchaseReview, "extractionId" | "businessId" | "userId">;
export function inboxPurchaseJournalKey(r: PurchaseJournalContext) {
  return `gastropilot:inbox-purchase:${id(r.businessId)}:${id(r.userId)}:${id(r.extractionId)}:v1`;
}
export function recoverInboxPurchase(raw: string | null, r: PurchaseJournalContext): InboxPurchaseApproval | null {
  if (raw === null) return null;
  if (typeof raw !== "string" || raw.length > MAX_JOURNAL_LENGTH) throw new Error("El intento guardado no es válido.");
  const value = parseInboxPurchaseApproval(JSON.parse(raw));
  if (value.businessId !== r.businessId || value.userId !== r.userId || value.extractionId !== r.extractionId) throw new Error("El intento pertenece a otro contexto.");
  return value;
}
export function saveInboxPurchaseJournal(storage: Pick<Storage, "getItem" | "setItem">, proposal: InboxPurchaseApproval): void {
  const key = inboxPurchaseJournalKey(proposal);
  const serialized = JSON.stringify(proposal);
  if (serialized.length > MAX_JOURNAL_LENGTH) throw new Error("El intento guardado supera el tamaño permitido.");
  const existing = storage.getItem(key);
  if (existing !== null && existing !== serialized) throw new Error("Ya existe otra revisión pendiente. Conservá el intento original.");
  storage.setItem(key, serialized);
  if (storage.getItem(key) !== serialized) throw new Error("No pudimos verificar el intento guardado.");
}
export function clearInboxPurchaseJournal(storage: Pick<Storage, "getItem" | "removeItem">, proposal: InboxPurchaseApproval): void {
  const key = inboxPurchaseJournalKey(proposal);
  const existing = storage.getItem(key);
  if (existing !== null && existing !== JSON.stringify(proposal)) throw new Error("La revisión guardada cambió. Verificá la compra antes de continuar.");
  storage.removeItem(key);
  if (storage.getItem(key) !== null) throw new Error("No pudimos limpiar el intento guardado.");
}
