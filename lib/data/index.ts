/**
 * Punto de entrada único del data layer.
 *
 * Las páginas y componentes deben importar desde acá:
 *
 *   import { products, inbox } from "@/lib/data";
 *
 * No importar desde `@/lib/mock-data` ni `@/lib/supabase/*`
 * directamente.
 */

import { env } from "@/lib/env";
import * as demoAdapter from "./demo";
import * as supabaseAdapter from "./supabase";
import { databaseBusiness } from "./business-database";
import { getCurrentUserContext } from "./auth";

const adapter = env.appMode === "database" ? supabaseAdapter : demoAdapter;

/**
 * Inbox, facturas y cierres aceptan `branch_id IS NULL` para registros de
 * negocio compartidos cuando un rol restringido sí tiene al menos una sucursal.
 * Pero `assignedBranchIds=[]` significa explícitamente "sin acceso a sucursales"
 * y debe cortar antes de esa excepción para no devolver filas NULL.
 */
async function hasNoAssignedBranchAccess(): Promise<boolean> {
  const ctx = await getCurrentUserContext();
  return ctx.assignedBranchIds !== null && ctx.assignedBranchIds.length === 0;
}

const databaseInbox = {
  ...supabaseAdapter.inbox,
  async list() {
    if (await hasNoAssignedBranchAccess()) return [];
    return supabaseAdapter.inbox.list();
  },
};

const databaseInvoices = {
  ...supabaseAdapter.invoices,
  async list() {
    if (await hasNoAssignedBranchAccess()) return [];
    return supabaseAdapter.invoices.list();
  },
};

const databaseClosures = {
  ...supabaseAdapter.closures,
  async list() {
    if (await hasNoAssignedBranchAccess()) return [];
    return supabaseAdapter.closures.list();
  },
};

// Business identity is security-sensitive: in database mode resolve it from the
// same fail-closed authenticated tenant context used by middleware/server auth.
export const business = env.appMode === "database" ? databaseBusiness : demoAdapter.business;
export const dashboard = adapter.dashboard;
export const inbox = env.appMode === "database" ? databaseInbox : demoAdapter.inbox;
export const invoices = env.appMode === "database" ? databaseInvoices : demoAdapter.invoices;
export const closures = env.appMode === "database" ? databaseClosures : demoAdapter.closures;
export const products = adapter.products;
export const sales = adapter.sales;
export const purchases = adapter.purchases;
export const expenses = adapter.expenses;
export const stock = adapter.stock;
export const employees = adapter.employees;
export const customers = adapter.customers;
export const marketing = adapter.marketing;
export const reports = adapter.reports;
export const debts = adapter.debts;
export const balances = adapter.balances;

// Helpers para casos puntuales donde la UI todavía consume todo el mock.
// Conforme migremos cada módulo, estos pueden ir desapareciendo.
export { env };
