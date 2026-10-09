import type { ExpensesDatabase } from "./service";
export async function readExpenseRevision(db: ExpensesDatabase, businessId: string): Promise<string> {
  const result = await db.rpc("get_expenses_revision", { p_business_id: businessId });
  if (result.error || typeof result.data !== "string" || !/^\d+$/.test(result.data)) throw new Error("No pudimos verificar el registro de gastos.");
  return result.data;
}
export async function readExpenseRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown; count: number | null }>): Promise<T[]> {
  const rows: T[] = []; let count: number | null = null;
  for (let from = 0; from < 100_000; from += 1000) {
    const result = await page(from, from + 999);
    if (result.error || !Array.isArray(result.data) || result.count === null || (count !== null && count !== result.count)) throw new Error("No pudimos leer todos los registros. Volvé a cargar.");
    count = result.count; rows.push(...result.data);
    if (rows.length === count) return rows;
    if (result.data.length !== 1000 || rows.length > count) throw new Error("El registro cambió durante la lectura. Volvé a cargar.");
  }
  throw new Error("El registro supera el límite de lectura. No se muestran totales parciales.");
}
