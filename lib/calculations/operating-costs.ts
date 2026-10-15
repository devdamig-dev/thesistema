/** Deterministic arithmetic: no LLM, provider tokens or inferred financial data. */
export function moneyCents(value: string, signed = false): bigint {
  if (typeof value !== "string") throw new Error("Ingresá un importe válido.");
  let raw = value.trim().replace(/^(?:ARS\s*|\$\s*)/i, "");
  const negative = raw.startsWith("-");
  if (negative) raw = raw.slice(1);
  if (negative && !signed) throw new Error("El importe no puede ser negativo.");
  // Accept AR currency (595.700,50) and canonical ungrouped decimals (595700.50).
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(raw)) raw = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d+(?:,\d{1,2})?$/.test(raw)) raw = raw.replace(",", ".");
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(raw)) throw new Error("Usá importes como 595700,50 o $595.700,50.");
  const [whole, decimals = ""] = raw.split(".");
  const cents = BigInt(whole) * 100n + BigInt(decimals.padEnd(2, "0"));
  if (cents > 999999999999n) throw new Error("El importe supera el máximo permitido.");
  return negative ? -cents : cents;
}
export function decimalMoney(cents: bigint): string {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  return `${negative ? "-" : ""}${absolute / 100n}.${String(absolute % 100n).padStart(2, "0")}`;
}
export const DEDUCTION_LABELS = {
  discounts: "Descuentos", refunds: "Devoluciones", commissions: "Comisiones de cobro",
  withholdings: "Retenciones informadas", other: "Otras deducciones de ventas",
} as const;
export type SalesDeductions = Record<keyof typeof DEDUCTION_LABELS, string>;
export const EMPTY_DEDUCTIONS: SalesDeductions = {discounts:"0",refunds:"0",commissions:"0",withholdings:"0",other:"0"};
export function calculateNetSales(gross: string, deductions: SalesDeductions) {
  const grossCents = moneyCents(gross);
  let deducted = 0n;
  const canonical = {} as SalesDeductions;
  for (const key of Object.keys(DEDUCTION_LABELS) as (keyof SalesDeductions)[]) {
    const cents = moneyCents(deductions[key]);
    deducted += cents;
    canonical[key] = decimalMoney(cents);
  }
  const net = grossCents - deducted;
  if (net < -999999999999n) throw new Error("Revisá las deducciones: el neto supera el rango permitido.");
  const grossTotal = decimalMoney(grossCents), netTotal = decimalMoney(net);
  const detail = Object.entries(DEDUCTION_LABELS).map(([key,label]) => `${label}: ${canonical[key as keyof SalesDeductions]}`).join("; ");
  return {grossTotal, netTotal, deductionsTotal:decimalMoney(deducted),
    note:`Cálculo de neto de ventas: bruto ${grossTotal}; ${detail}; neto ${netTotal}. No es ganancia ni efectivo en caja. Retiros y cambio no se deducen automáticamente.`};
}
/** Pack price / usable pack quantity gives cost per base unit. Quantity is not a cost. */
export function calculatePackUnitCost(packTotal: string, packQuantity: string): number {
  const cents = moneyCents(packTotal);
  const raw = packQuantity.trim().replace(",", ".");
  if (!/^\d{1,10}(?:\.\d{1,6})?$/.test(raw)) throw new Error("Ingresá la cantidad del envase, con hasta seis decimales.");
  const [whole, decimal = ""] = raw.split(".");
  const quantityMicros = BigInt(whole) * 1000000n + BigInt(decimal.padEnd(6,"0"));
  if (quantityMicros <= 0n) throw new Error("La cantidad del envase debe ser mayor a cero.");
  // Six-decimal currency precision, rounded once rather than at every recipe line.
  const micros = (cents * 10000000000n + quantityMicros / 2n) / quantityMicros;
  if (micros > 9999999999999999n) throw new Error("El costo por unidad supera el máximo permitido.");
  if (cents > 0n && micros === 0n) throw new Error("Usá una unidad base mayor para no redondear el costo a cero.");
  return Number(micros) / 1000000;
}
