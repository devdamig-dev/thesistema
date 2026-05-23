/**
 * Tipos del subsistema de extracción IA.
 *
 * Lo que la IA devuelve para cada mensaje entrante:
 *   - movement_type      → tipo de movimiento detectado
 *   - confidence         → 0..1
 *   - detected_fields    → campos estructurados según el tipo
 *   - missing_fields     → qué falta para registrar
 *   - suggested_action   → qué hacer cuando se aprueba
 *   - normalized_summary → frase corta tipo "Compra de 20kg de carne a Don José"
 *   - target_entity      → tabla destino donde se insertará al aprobar
 */

export type MovementType =
  | "purchase"
  | "sale"
  | "expense"
  | "stock_update"
  | "employee_advance"
  | "daily_closure"
  | "supplier_price_change"
  | "debt_created"
  | "debt_payment"
  | "unknown";

export type TargetEntity =
  | "purchases"
  | "sales"
  | "expenses"
  | "stock_movements"
  | "advance_payments"
  | "daily_closures"
  | "debts"
  | "debt_payments"
  | null;

export interface ExtractedPurchase {
  supplier?: string;
  item?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  total_amount?: number;
  payment_method?: string;
  stock_destination?: string;
}

export interface ExtractedSaleChannel {
  channel: string;
  amount: number;
}

export interface ExtractedSale {
  total_amount?: number;
  channels?: ExtractedSaleChannel[];
  date?: string;
  notes?: string;
}

export interface ExtractedExpense {
  concept?: string;
  amount?: number;
  category?: string;
  payment_method?: string;
  date?: string;
}

export interface ExtractedStockUpdate {
  ingredient?: string;
  qty?: number;
  unit?: string;
  reason?: "purchase" | "sale_consumption" | "waste" | "manual_adjust";
}

export interface ExtractedAdvance {
  employee_name?: string;
  amount?: number;
  date?: string;
}

export interface ExtractedDailyClosure {
  business_unit?: string;
  date?: string;
  cash?: number;
  card?: number;
  qr?: number;
  total?: number;
  expenses?: { amount: number; description: string }[];
  withdrawal?: number;
  change?: number;
  products?: { name: string; quantity: number }[];
}

export interface ExtractedSupplierPriceChange {
  supplier?: string;
  item?: string;
  percentage?: number;
  new_unit_price?: number;
}

export interface ExtractedDebtCreated {
  creditor?: string;
  concept?: string;
  original_amount?: number;
  due_date?: string;
  interest_rate?: number;
}

export interface ExtractedDebtPayment {
  creditor?: string;
  concept?: string;
  amount?: number;
  payment_method?: string;
}

export type DetectedFields =
  | ExtractedPurchase
  | ExtractedSale
  | ExtractedExpense
  | ExtractedStockUpdate
  | ExtractedAdvance
  | ExtractedDailyClosure
  | ExtractedSupplierPriceChange
  | ExtractedDebtCreated
  | ExtractedDebtPayment
  | Record<string, unknown>;

export interface ExtractionResult {
  movement_type: MovementType;
  confidence: number;
  detected_fields: DetectedFields;
  missing_fields: string[];
  suggested_action: string;
  normalized_summary: string;
  target_entity: TargetEntity;
  /**
   * Cómo se obtuvo el resultado.
   *   - "claude"     → llamada real a Anthropic Claude.
   *   - "heuristic"  → fallback regex (sin API key o Claude falló).
   *   - "failed"     → ni el heurístico pudo entender (necesita revisión).
   */
  source: "claude" | "heuristic" | "failed";
  error?: string;
}
