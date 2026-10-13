import type { ModuleKey, Role } from "../permissions";

/** Supplied only by authenticated manual/agent transports, never by tool input. */
export type ReplenishmentActor = {
  businessId: string; userId: string; role: Role;
  enabledModules: ModuleKey[]; branchIds: string[] | null;
};
export type ReplenishmentInput = { branchId: string; from: string; to: string };
export type ReplenishmentIngredient = { id: string; name: string; unit: string; active: boolean };
export type ReplenishmentStock = { id: string; ingredient_id: string; current: unknown; min: unknown; updated_at: string | null };
export type ReplenishmentMovement = {
  id: string; ingredient_id: string; qty: unknown; operation: string | null; reason: string;
  ref_type: string | null; base_unit: string | null; balance_before: unknown; balance_after: unknown; created_at: string;
};
export type ReplenishmentSale = { id: string; sale_kind: string };
export type ReplenishmentSaleLine = { id: string; sale_id: string; product_id: string | null; description: string; quantity: unknown; recipe_snapshot: unknown };
export type ReplenishmentPurchase = { id: string; purchased_at: string };
export type ReplenishmentPurchaseLine = { id: string; purchase_id: string; ingredient_id: string | null; description: string; qty: unknown; unit: string };
export type ReplenishmentContributor = { productId: string; productName: string; soldQuantity: number; theoreticalQuantity: number; saleLineCount: number };
export type ReplenishmentReceipt = { purchaseId: string; lineId: string; purchasedAt: string; description: string; quantity: number; unit: string };
export type ReplenishmentRow = {
  ingredientId: string; name: string; unit: string; active: boolean;
  current: number | null; minimum: number | null; updatedAt: string | null;
  minimumShortfall: number | null;
  recordedOutflow: number; recordedPurchaseReversal: number; recordedWaste: number; recordedAdjustment: number;
  unverifiedMovementCount: number; recordedMovementCount: number;
  theoreticalUsage: number | null; contributors: ReplenishmentContributor[];
  recentReceipts: ReplenishmentReceipt[]; unverifiedReceiptCount: number;
  attention: "archived" | "below_minimum" | "at_minimum" | "below_recorded_period_usage" | "below_theoretical_period_usage" | "no_basis" | "none";
};
export type ReplenishmentReport = {
  branchId: string; branchName: string; from: string; to: string; timezone: string;
  readAt: string; partialCurrentDay: boolean; rows: ReplenishmentRow[];
  visibility: { sales: boolean; purchases: boolean };
  evidence: {
    activeSales: number | null; saleLines: number | null; missingRecipeLines: number | null;
    incompleteRecipeLines: number | null; salesWithoutDetail: number | null;
    activePurchases: number | null; purchasesWithoutLinkedDetail: number | null;
  };
  /** Neither absence of events nor the first event proves complete history. */
  historyCoverage: "not_verified";
  coverageDays: null;
};
export type ReplenishmentData = {
  ingredients: ReplenishmentIngredient[]; stock: ReplenishmentStock[]; movements: ReplenishmentMovement[];
  sales: ReplenishmentSale[] | null; saleLines: ReplenishmentSaleLine[] | null;
  purchases: ReplenishmentPurchase[] | null; purchaseLines: ReplenishmentPurchaseLine[] | null;
};
