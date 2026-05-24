/**
 * Roles canónicos de GastroPilot.
 *
 * El brief pide 6, pero mantenemos los granulares de Sprint 0
 * (kitchen, cashier, waiter, delivery) como aliases de `employee`
 * para que la UI pueda diferenciar la posición operativa pero
 * compartan la matriz de permisos.
 */
export type Role =
  | "owner"
  | "admin"
  | "manager"
  | "accountant"
  | "marketing"
  | "employee"
  | "kitchen"
  | "cashier"
  | "waiter"
  | "delivery"
  | "viewer";

/** Roles "primarios" para mostrar en la UI. */
export const PRIMARY_ROLES: Role[] = [
  "owner",
  "admin",
  "manager",
  "accountant",
  "marketing",
  "employee",
];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Socio",
  admin: "Administrador",
  manager: "Encargado",
  accountant: "Contador",
  marketing: "Marketing",
  employee: "Empleado",
  kitchen: "Cocina",
  cashier: "Caja",
  waiter: "Atención",
  delivery: "Delivery",
  viewer: "Lectura",
};

/**
 * Las permissions están agrupadas por dominio · verbo para que sea
 * fácil chequear desde server actions y filtros de UI.
 */
export type Permission =
  // Inbox IA
  | "inbox.view"
  | "inbox.approve"
  // Facturas OCR
  | "invoices.view"
  | "invoices.upload"
  | "invoices.approve"
  | "invoices.send_to_accountant"
  // Compras
  | "purchases.view"
  | "purchases.create"
  // Stock
  | "stock.view"
  | "stock.adjust"
  // Productos / recetas / costos
  | "products.view"
  | "products.edit_price"
  | "recipes.edit"
  // Ventas
  | "sales.view"
  | "sales.create"
  // Cierres diarios
  | "closures.view"
  | "closures.approve"
  // Gastos fijos
  | "expenses.view"
  | "expenses.create"
  // Deudas
  | "debts.view"
  | "debts.create"
  | "debts.pay"
  // Empleados
  | "employees.view"
  | "employees.manage"
  | "advances.create"
  // Clientes
  | "customers.view"
  | "customers.manage"
  // Marketing
  | "marketing.view"
  | "marketing.send_campaign"
  // Reportes IA
  | "reports.view"
  | "reports.export"
  // Balances
  | "balances.view"
  // Ajustes
  | "settings.view"
  | "settings.business"
  | "settings.team"
  | "settings.whatsapp"
  | "settings.ai"
  | "settings.industry";

/**
 * Keys de módulos del sidebar — alineadas con `lib/entities.ts`
 * pero acá las usamos para visibility filtering por rol.
 */
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
  | "debts"
  | "stock"
  | "products"
  | "balances"
  | "employees"
  | "customers";
