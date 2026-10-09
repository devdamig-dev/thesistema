import { SALES_CHANNELS, type SaveSaleInput, type VoidSaleInput, type SaleItemInput } from "./types";
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CENTS = 999_999_999_999n;
export class SaleInputError extends Error { constructor(message: string) { super(message); this.name = "SaleInputError"; } }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) || Reflect.ownKeys(value).some(key => typeof key !== "string" || !("value" in Object.getOwnPropertyDescriptor(value,key)!))) throw new SaleInputError("Datos de venta inválidos.");
  return value as Record<string,unknown>;
}
export function keys(value: Record<string,unknown>, expected: string[]) {
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) throw new SaleInputError("La venta contiene campos faltantes o no permitidos.");
}
export function uuid(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) throw new SaleInputError("Referencia inválida."); return value; }
export function text(value: unknown, max: number, optional = false, allowMultiline = false): string | null {
  if (optional && value === null) return null;
  if (typeof value !== "string" || value.trim().length > max || /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) throw new SaleInputError("Texto inválido.");
  if (!allowMultiline && /[\n\r\t]/.test(value)) throw new SaleInputError("Usá una sola línea de texto.");
  const clean = value.trim(); if (!clean && !optional) throw new SaleInputError("Completá los campos obligatorios.");
  return clean || null;
}
/** Decimal strings only, so rounding cannot happen before validation. */
export function scaledDecimal(value: unknown, scale: number, positive: boolean): bigint {
  if (typeof value !== "string" || !new RegExp(`^(0|[1-9]\\d{0,11})(\\.\\d{1,${scale}})?$`).test(value)) throw new SaleInputError(`Usá un número decimal sin separador de miles, con hasta ${scale} decimales.`);
  const [whole,fraction=""] = value.split("."); const result = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale,"0"));
  if (positive && result === 0n) throw new SaleInputError("La cantidad debe ser mayor a cero.");
  return result;
}
export function saleLineCents(item: Pick<SaleItemInput,"quantity" | "unitPrice">): bigint {
  const quantity = scaledDecimal(item.quantity,6,true); const price = scaledDecimal(item.unitPrice,2,false);
  if (price > MAX_CENTS) throw new SaleInputError("El precio supera el límite permitido.");
  const product = quantity * price;
  // Per-line half-up rounding, identical to PostgreSQL round(numeric,2).
  const cents = (product + 500_000n) / 1_000_000n;
  if (cents > MAX_CENTS) throw new SaleInputError("El importe supera el límite permitido.");
  return cents;
}
export function saleTotalCents(items: SaleItemInput[]): number {
  const total = items.reduce((sum,item) => sum + saleLineCents(item),0n);
  if (total <= 0n || total > MAX_CENTS) throw new SaleInputError("El total debe ser mayor a cero y no superar el límite permitido.");
  return Number(total);
}
export function parseItems(raw: unknown): SaleItemInput[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) throw new SaleInputError("Agregá entre 1 y 100 renglones.");
  const items = raw.map(value => { const line = record(value); keys(line,Object.hasOwn(line,"id")?["id","productId","description","quantity","unitPrice"]:["productId","description","quantity","unitPrice"]); const item = { id: line.id === undefined || line.id === null ? null : uuid(line.id), productId: line.productId === null ? null : uuid(line.productId), description: text(line.description,200)!, quantity: line.quantity as string, unitPrice: line.unitPrice as string }; saleLineCents(item); return item; });
  const ids=items.filter(item=>item.id!==null).map(item=>item.id); if(new Set(ids).size!==ids.length)throw new SaleInputError("Un renglón no puede repetirse.");
  saleTotalCents(items); return items;
}
export function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(new Date(value).getTime()) || value.slice(0,4) === "0000") throw new SaleInputError("Indicá fecha y hora completas con zona horaria.");
  if (Number(value.slice(11,13))>23 || Number(value.slice(14,16))>59 || Number(value.slice(17,19))>59) throw new SaleInputError("Hora inválida.");
  const civil = value.slice(0,10); if (new Date(`${civil}T00:00:00Z`).toISOString().slice(0,10) !== civil) throw new SaleInputError("Fecha inválida.");
  return value;
}
export function version(value: unknown): number { if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= 2147483647) throw new SaleInputError("Versión de venta inválida."); return Number(value); }
export function parseSaveSaleInput(input: unknown): SaveSaleInput {
  const r = record(input); keys(r,["requestId","businessId","userId","id","expectedVersion","branchId","occurredAt","channel","paymentMethod","customerId","notes","items"]);
  const id = r.id === null ? null : uuid(r.id); const expectedVersion = r.expectedVersion === null ? null : version(r.expectedVersion);
  if ((id === null) !== (expectedVersion === null)) throw new SaleInputError("Versión requerida para editar una venta.");
  if (!(SALES_CHANNELS as readonly unknown[]).includes(r.channel)) throw new SaleInputError("Elegí un canal válido.");
  const items=parseItems(r.items); if(id===null && items.some(item=>item.id!==null))throw new SaleInputError("Una venta nueva no puede reutilizar renglones existentes.");
  return { requestId:uuid(r.requestId),businessId:uuid(r.businessId),userId:uuid(r.userId),id,expectedVersion,branchId:uuid(r.branchId),occurredAt:timestamp(r.occurredAt),channel:r.channel as SaveSaleInput["channel"],paymentMethod:text(r.paymentMethod,80)!,customerId:r.customerId===null?null:uuid(r.customerId),notes:text(r.notes,2000,true,true),items };
}
export function parseVoidSaleInput(input: unknown): VoidSaleInput {
  const r=record(input); keys(r,["requestId","businessId","userId","id","expectedVersion","reason"]);
  return {requestId:uuid(r.requestId),businessId:uuid(r.businessId),userId:uuid(r.userId),id:uuid(r.id),expectedVersion:version(r.expectedVersion),reason:text(r.reason,1000,false,true)!};
}
