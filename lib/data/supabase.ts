/**
 * Adaptador "supabase".
 *
 * En Sprint 0 las tablas existen pero todavía no consumimos datos desde
 * acá — cada repositorio cae al adaptador demo. Conforme se migren los
 * módulos en Sprint 1+, vamos reemplazando los stubs por queries reales.
 *
 * El patrón es siempre el mismo:
 *
 *   async list() {
 *     const supabase = createSupabaseServerClient();
 *     if (!supabase) return demo.products.list();
 *     const { data, error } = await supabase
 *       .from("products")
 *       .select("*")
 *       .order("name");
 *     if (error || !data?.length) return demo.products.list();
 *     return data.map(mapProductRow);
 *   }
 *
 * En cada paso del sprint backend reemplazamos `demo.X.Y` por la query
 * real. Si Supabase devuelve vacío o falla, caemos al demo para
 * mantener la experiencia.
 */

import * as demo from "./demo";

// Por ahora, el adaptador supabase delega 100% al demo.
// Las firmas calzan exactamente porque cada repo demo es un objeto con
// async methods.
export const business = demo.business;
export const dashboard = demo.dashboard;
export const inbox = demo.inbox;
export const invoices = demo.invoices;
export const closures = demo.closures;
export const products = demo.products;
export const sales = demo.sales;
export const purchases = demo.purchases;
export const expenses = demo.expenses;
export const stock = demo.stock;
export const employees = demo.employees;
export const customers = demo.customers;
export const marketing = demo.marketing;
export const reports = demo.reports;
