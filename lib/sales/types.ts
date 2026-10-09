export const SALES_CHANNELS = ["salon", "delivery", "whatsapp", "pedidos_ya", "rappi", "mp_qr"] as const;
export type SaleChannel = typeof SALES_CHANNELS[number];
export type SaleItemInput = { id?: string | null; productId: string | null; description: string; quantity: string; unitPrice: string };
export type SaveSaleInput = {
  requestId: string; businessId: string; userId: string; id: string | null; expectedVersion: number | null;
  branchId: string; occurredAt: string; channel: SaleChannel; paymentMethod: string;
  customerId: string | null; notes: string | null; items: SaleItemInput[];
};
export type VoidSaleInput = { requestId: string; businessId: string; userId: string; id: string; expectedVersion: number; reason: string };
export type SaleResult = { ok: true; persisted: true; id: string; version: number } | { ok: false; persisted: false | "unknown"; error: string };
export type RecipeSnapshot = { recipeId: string | null; recipeUpdatedAt: string | null; state: "none" | "complete" | "incomplete"; ingredients: Array<{ ingredientId: string | null; name: string; quantity: string | null; unit: string | null; baseUnit: string | null; baseQuantity: string | null; theoreticalQuantity: string | null }> };
export type SaleItem = { id: string; sale_id: string; product_id: string | null; description: string; quantity: number | string; unit_price: number | string; total: number | string; recipe_snapshot: RecipeSnapshot | null; position: number };
export type SaleRecord = {
  id: string; business_id: string; branch_id: string | null; channel: string; amount: number | string; occurred_at: string;
  status: "active" | "voided"; sale_kind: "legacy" | "detailed" | "summary"; source: "manual" | "whatsapp" | "inbox" | "api" | "system" | null;
  payment_method: string | null; customer_id: string | null; notes: string | null; currency: string | null;
  version: number; void_reason: string | null; voided_at: string | null; created_at: string; updated_at: string; items: SaleItem[];
};
export type SalesWorkspace = { businessId: string; userId: string; timezone: string; branches: Array<{ id: string; name: string }>; products: Array<{ id: string; name: string; price: number }>; customers: Array<{ id: string; name: string }>; canManage: boolean; sales: SaleRecord[] };
export type SalesWorkspaceResult = { ok: true; data: SalesWorkspace } | { ok: false; error: string };
export type SaleMutation = { request_id: string; sale_id: string; actor_id: string; actor_role: string; source: string; operation: string; created_at: string; before_snapshot: {sale:Record<string,unknown>;items:SaleItem[]}|null; after_snapshot: {sale:Record<string,unknown>;items:SaleItem[]}; result: {id:string;version:number} };
