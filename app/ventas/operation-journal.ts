import type { SaveSaleInput, VoidSaleInput } from "@/lib/sales/types";
import { parseSaveSaleInput, parseVoidSaleInput, saleLineCents } from "../../lib/sales/validation";
export type PendingSaleOperation = { kind: "save"; input: SaveSaleInput } | { kind: "void"; input: VoidSaleInput };
export function saleJournalKey(businessId: string, userId: string) { return `sale-operation:v1:${businessId}:${userId}`; }
/** Only a confirmed result may clear this entry. It is recovery data, never authority. */
export function readSaleOperation(raw: string | null, businessId: string, userId: string): PendingSaleOperation | null {
  if (raw === null) return null;
  if (raw.length > 200000) throw new Error("invalid_sale_operation");
  const value = JSON.parse(raw) as PendingSaleOperation;
  if (!value || !["save", "void"].includes(value.kind) || !value.input || value.input.businessId !== businessId || value.input.userId !== userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.input.requestId)) throw new Error("invalid_sale_operation");
  if (value.kind === "save" && (!Array.isArray(value.input.items) || value.input.items.length === 0 || value.input.items.length > 100)) throw new Error("invalid_sale_operation");
  if (value.kind === "void" && (typeof value.input.id !== "string" || typeof value.input.reason !== "string")) throw new Error("invalid_sale_operation");
  return value.kind === "save" ? { kind: "save", input: parseSaveSaleInput(value.input) } : { kind: "void", input: parseVoidSaleInput(value.input) };
}
export function retainSaleOperation(current: PendingSaleOperation | null, proposed: PendingSaleOperation): PendingSaleOperation {
  if (current && JSON.stringify(current) !== JSON.stringify(proposed)) throw new Error("Hay una operación pendiente de confirmar.");
  return JSON.parse(JSON.stringify(current ?? proposed)) as PendingSaleOperation;
}
/** Mirrors numeric line rounding without floating-point multiplication. */
export function lineTotal(quantity: string, price: string): number | null {
  try { return Number(saleLineCents({ quantity, unitPrice: price })) / 100; } catch { return null; }
}
