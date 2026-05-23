/**
 * Matriz role × permission.
 *
 * Cada rol tiene un conjunto explícito de permisos. Los roles
 * granulares (kitchen, cashier, waiter, delivery) heredan del rol
 * "employee" en la resolución, así que no necesitan entradas
 * separadas a menos que queramos diferenciarlos.
 */

import type { ModuleKey, Permission, Role } from "./types";

/** Permisos base de "employee" — kitchen/cashier/waiter/delivery heredan estos. */
const EMPLOYEE_PERMISSIONS: Permission[] = [
  "inbox.view",
  "inbox.approve",
  "sales.view",
  "sales.create",
  "stock.view",
  "stock.adjust",
  "closures.view",
  "closures.approve",
  "products.view",
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...EMPLOYEE_PERMISSIONS,
  "purchases.view",
  "purchases.create",
  "expenses.view",
  "expenses.create",
  "debts.view",
  "debts.create",
  "debts.pay",
  "employees.view",
  "customers.view",
  "customers.manage",
  "invoices.view",
  "invoices.upload",
  "reports.view",
  "balances.view",
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...MANAGER_PERMISSIONS,
  "invoices.approve",
  "invoices.send_to_accountant",
  "products.edit_price",
  "recipes.edit",
  "employees.manage",
  "advances.create",
  "marketing.view",
  "marketing.send_campaign",
  "reports.export",
  "settings.view",
  "settings.business",
  "settings.team",
  "settings.whatsapp",
  "settings.ai",
  "settings.industry",
];

const OWNER_PERMISSIONS: Permission[] = [...ADMIN_PERMISSIONS];

const ACCOUNTANT_PERMISSIONS: Permission[] = [
  "invoices.view",
  "invoices.send_to_accountant",
  "purchases.view",
  "expenses.view",
  "debts.view",
  "reports.view",
  "reports.export",
  "balances.view",
  "settings.view",
];

const MARKETING_PERMISSIONS: Permission[] = [
  "customers.view",
  "customers.manage",
  "marketing.view",
  "marketing.send_campaign",
  "reports.view",
  "sales.view",
];

const VIEWER_PERMISSIONS: Permission[] = [
  "inbox.view",
  "invoices.view",
  "purchases.view",
  "sales.view",
  "stock.view",
  "products.view",
  "employees.view",
  "customers.view",
  "reports.view",
  "balances.view",
];

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: OWNER_PERMISSIONS,
  admin: ADMIN_PERMISSIONS,
  manager: MANAGER_PERMISSIONS,
  accountant: ACCOUNTANT_PERMISSIONS,
  marketing: MARKETING_PERMISSIONS,
  employee: EMPLOYEE_PERMISSIONS,
  kitchen: EMPLOYEE_PERMISSIONS,
  cashier: EMPLOYEE_PERMISSIONS,
  waiter: EMPLOYEE_PERMISSIONS,
  delivery: EMPLOYEE_PERMISSIONS,
  viewer: VIEWER_PERMISSIONS,
};

/**
 * Módulos visibles en el sidebar por rol.
 *
 * Es la unión de los permisos relevantes, expresada en términos de
 * módulos para que el filtrado sea barato.
 */
const ROLE_MODULES: Record<Role, ModuleKey[]> = {
  owner: [
    "dashboard", "inbox_ai", "reports_ai", "marketing_ai",
    "invoices_ocr", "daily_closures",
    "sales", "purchases", "fixed_expenses", "debts", "stock", "products",
    "balances", "employees", "customers",
  ],
  admin: [
    "dashboard", "inbox_ai", "reports_ai", "marketing_ai",
    "invoices_ocr", "daily_closures",
    "sales", "purchases", "fixed_expenses", "debts", "stock", "products",
    "balances", "employees", "customers",
  ],
  manager: [
    "dashboard", "inbox_ai", "reports_ai",
    "invoices_ocr", "daily_closures",
    "sales", "purchases", "fixed_expenses", "debts", "stock", "products",
    "balances", "employees", "customers",
  ],
  accountant: [
    "dashboard",
    "invoices_ocr",
    "fixed_expenses", "debts",
    "balances", "reports_ai",
  ],
  marketing: [
    "dashboard",
    "marketing_ai",
    "customers",
    "reports_ai",
  ],
  employee: [
    "dashboard", "inbox_ai",
    "daily_closures",
    "stock", "sales",
  ],
  kitchen: ["dashboard", "inbox_ai", "daily_closures", "stock"],
  cashier: ["dashboard", "inbox_ai", "daily_closures", "sales"],
  waiter: ["dashboard", "inbox_ai", "sales"],
  delivery: ["dashboard", "sales"],
  viewer: [
    "dashboard", "inbox_ai", "reports_ai", "sales", "purchases",
    "fixed_expenses", "stock", "products", "balances", "customers",
  ],
};

export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function modulesFor(role: Role): ModuleKey[] {
  return ROLE_MODULES[role] ?? [];
}
