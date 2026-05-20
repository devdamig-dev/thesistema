/**
 * Entidades base de GastroPilot AI.
 *
 * Estas interfaces describen el modelo de datos que vamos a usar cuando
 * conectemos Supabase. Hoy todo es mock — los tipos sólo sirven para que
 * componentes y mock data compartan un vocabulario consistente.
 *
 * Cuando armemos las tablas de Supabase, los nombres de columnas deberían
 * matchear `snake_case` de cada campo (id -> id, createdAt -> created_at, etc).
 */

// ---------- Bases ----------
export type UUID = string;
export type ISODate = string;

export interface Timestamps {
  createdAt: ISODate;
  updatedAt: ISODate;
}

// ---------- Multi-tenant ----------
export interface Organization extends Timestamps {
  id: UUID;
  name: string;
  ownerId: UUID;
  plan: "free" | "pro" | "enterprise";
}

export interface Business extends Timestamps {
  id: UUID;
  organizationId: UUID;
  name: string;
  industry: Industry;
  taxId?: string; // CUIT
  timezone: string;
}

export interface Branch extends Timestamps {
  id: UUID;
  businessId: UUID;
  name: string;
  address?: string;
  isMain: boolean;
}

// ---------- Usuarios y permisos ----------
export type RoleKey =
  | "owner"
  | "manager"
  | "accountant"
  | "kitchen"
  | "cashier"
  | "waiter"
  | "delivery"
  | "viewer";

export interface Role {
  key: RoleKey;
  label: string;
  permissions: string[]; // ex: "purchases.approve", "invoices.send_to_accountant"
}

export interface User extends Timestamps {
  id: UUID;
  organizationId: UUID;
  fullName: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  roles: RoleKey[];
  active: boolean;
}

// ---------- Rubros y módulos ----------
export type Industry =
  | "hamburgueseria"
  | "foodtruck"
  | "cafeteria"
  | "pizzeria"
  | "bar"
  | "heladeria"
  | "panaderia"
  | "restaurante"
  | "dark_kitchen";

export type ModuleKey =
  | "dashboard"
  | "inbox_ai"
  | "reports_ai"
  | "marketing_ai"
  | "invoices_ocr"
  | "daily_closures"
  | "sales"
  | "purchases"
  | "fixed_expenses"
  | "stock"
  | "products"
  | "recipes"
  | "food_cost"
  | "employees"
  | "shifts"
  | "customers"
  | "deliveries"
  | "production"
  | "expirations"
  | "waste"
  | "beverages_stock"
  | "drink_recipes"
  | "happy_hour"
  | "shift_consumption"
  | "breakfast_combos"
  | "frequent_customers"
  | "batch_recipes";

export interface ModuleConfig {
  key: ModuleKey;
  enabled: boolean;
  suggested: boolean;
}

// ---------- WhatsApp + IA ----------
export type WhatsappChannel = "text" | "audio" | "image" | "document";

export interface WhatsappMessage extends Timestamps {
  id: UUID;
  businessId: UUID;
  senderId: UUID;
  channel: WhatsappChannel;
  raw: string;
  mediaUrl?: string;
  receivedAt: ISODate;
}

export type ExtractionType =
  | "purchase"
  | "sale"
  | "expense"
  | "advance"
  | "stock_update"
  | "price_alert"
  | "daily_closure"
  | "invoice";

export interface AiExtraction extends Timestamps {
  id: UUID;
  messageId: UUID;
  type: ExtractionType;
  fields: Record<string, unknown>; // parsed data
  missing: string[];
  confidence: number; // 0..1
}

export type ApprovalStatus = "pending" | "needs_review" | "approved" | "rejected";

export interface ApprovalRecord extends Timestamps {
  id: UUID;
  extractionId: UUID;
  status: ApprovalStatus;
  approvedBy?: UUID;
  approvedAt?: ISODate;
  notes?: string;
}

// ---------- Compras ----------
export interface Supplier extends Timestamps {
  id: UUID;
  businessId: UUID;
  name: string;
  taxId?: string;
  category?: string;
  contact?: { phone?: string; email?: string };
}

export interface Purchase extends Timestamps {
  id: UUID;
  businessId: UUID;
  supplierId: UUID;
  date: ISODate;
  total: number;
  paymentMethod: string;
  invoiceId?: UUID;
}

export interface PurchaseItem {
  id: UUID;
  purchaseId: UUID;
  ingredientId: UUID;
  qty: number;
  unit: string;
  unitPrice: number;
  total: number;
}

// ---------- Facturas / OCR ----------
export type InvoiceType = "A" | "B" | "C";
export type InvoiceLifecycle =
  | "processing"
  | "needs_review"
  | "approved"
  | "sent_to_accountant";

export interface Invoice extends Timestamps {
  id: UUID;
  businessId: UUID;
  supplierId?: UUID;
  number: string;
  type: InvoiceType;
  date: ISODate;
  dueDate?: ISODate;
  paymentMethod: string;
  subtotal: number;
  tax: number;
  total: number;
  status: InvoiceLifecycle;
  confidence: number;
  documentUrl?: string;
}

// ---------- Stock ----------
export interface Ingredient extends Timestamps {
  id: UUID;
  businessId: UUID;
  name: string;
  unit: string;
  avgUnitCost: number;
}

export interface StockItem {
  ingredientId: UUID;
  branchId: UUID;
  current: number;
  min: number;
}

export type StockMovementReason =
  | "purchase"
  | "sale_consumption"
  | "waste"
  | "manual_adjust";

export interface StockMovement extends Timestamps {
  id: UUID;
  ingredientId: UUID;
  branchId: UUID;
  reason: StockMovementReason;
  qty: number; // signed
  refType?: "purchase" | "sale" | "closure";
  refId?: UUID;
}

// ---------- Productos y recetas ----------
export type ProductCategory =
  | "hamburger"
  | "side"
  | "combo"
  | "beverage"
  | "dessert"
  | "coffee"
  | "bakery"
  | "pizza"
  | "drink";

export interface Product extends Timestamps {
  id: UUID;
  businessId: UUID;
  name: string;
  category: ProductCategory;
  price: number;
  recipeId?: UUID;
}

export interface Recipe {
  id: UUID;
  productId: UUID;
}

export interface RecipeItem {
  id: UUID;
  recipeId: UUID;
  ingredientId: UUID;
  qty: number;
  unit: string;
}

// ---------- Ventas + cierres ----------
export type SalesChannel =
  | "salon"
  | "delivery"
  | "whatsapp"
  | "pedidos_ya"
  | "rappi"
  | "mp_qr";

export interface Sale extends Timestamps {
  id: UUID;
  businessId: UUID;
  channel: SalesChannel;
  amount: number;
  date: ISODate;
  productId?: UUID;
}

export interface DailyClosure extends Timestamps {
  id: UUID;
  businessId: UUID;
  branchId?: UUID;
  date: ISODate;
  rawText: string;
  parsed: {
    incomes: { method: string; amount: number }[];
    expenses: { name: string; amount: number }[];
    withdrawals: { name: string; amount: number }[];
    change: number;
    products: { name: string; qty: number }[];
    grossTotal: number;
    netTotal: number;
  };
  inconsistencies: string[];
  status: ApprovalStatus;
}

// ---------- Empleados ----------
export interface Employee extends Timestamps {
  id: UUID;
  businessId: UUID;
  fullName: string;
  role: string;
  hourlyRate: number;
  active: boolean;
}

export interface Shift {
  id: UUID;
  employeeId: UUID;
  branchId: UUID;
  weekday: "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
  from: string; // "18:00"
  to: string; // "00:00"
  hours: number;
}

export interface AdvancePayment extends Timestamps {
  id: UUID;
  employeeId: UUID;
  amount: number;
  date: ISODate;
  status: "pending" | "settled";
}

// ---------- Clientes y marketing ----------
export interface Customer extends Timestamps {
  id: UUID;
  businessId: UUID;
  name: string;
  phone?: string;
  email?: string;
  channels: SalesChannel[];
  totalSpend: number;
  visits: number;
  lastVisitAt?: ISODate;
  segment?: string;
}

export type CampaignChannel = "whatsapp" | "instagram" | "email";
export type CampaignType = "promo" | "reactivation" | "launch" | "content" | "reminder";
export type CampaignStatus = "suggested" | "ready" | "scheduled" | "sent" | "archived";

export interface Campaign extends Timestamps {
  id: UUID;
  businessId: UUID;
  name: string;
  channel: CampaignChannel;
  type: CampaignType;
  audienceSegment: string;
  copy: string;
  scheduledFor?: ISODate;
  status: CampaignStatus;
  estimatedImpact: number;
  confidence: number;
}

// ---------- Recomendaciones IA ----------
export type Priority = "high" | "medium" | "low";

export interface AiRecommendation extends Timestamps {
  id: UUID;
  businessId: UUID;
  area: "product" | "supplier" | "schedule" | "channel" | "customer" | "margin";
  priority: Priority;
  title: string;
  detail: string;
  estimatedImpact: number;
  confidence: number;
  status: "open" | "applied" | "dismissed";
}
