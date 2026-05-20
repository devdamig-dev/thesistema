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

const adapter = env.appMode === "database" ? supabaseAdapter : demoAdapter;

export const business = adapter.business;
export const dashboard = adapter.dashboard;
export const inbox = adapter.inbox;
export const invoices = adapter.invoices;
export const closures = adapter.closures;
export const products = adapter.products;
export const sales = adapter.sales;
export const purchases = adapter.purchases;
export const expenses = adapter.expenses;
export const stock = adapter.stock;
export const employees = adapter.employees;
export const customers = adapter.customers;
export const marketing = adapter.marketing;
export const reports = adapter.reports;

// Helpers para casos puntuales donde la UI todavía consume todo el mock.
// Conforme migremos cada módulo, estos pueden ir desapareciendo.
export { env };
