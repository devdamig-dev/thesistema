import { convertQuantity, normalizeUnit } from "../recipes/quantities";
import type { ReplenishmentData, ReplenishmentInput, ReplenishmentReport, ReplenishmentRow } from "./types";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export function validateReplenishmentInput(value: unknown): ReplenishmentInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Elegí sucursal y fechas válidas para la reposición.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !["branchId", "from", "to"].includes(key)) || !uuid(input.branchId) || !date(input.from) || !date(input.to)) throw new Error("Elegí sucursal y fechas completas válidas para la reposición.");
  const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
  if (days < 0 || days >= 366) throw new Error("El período debe tener entre 1 y 366 días.");
  return { branchId: input.branchId, from: input.from, to: input.to };
}
export function quantity(value: unknown): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && Math.abs(parsed) < 1e12 ? parsed : null;
}
function add(left: number, right: number) {
  const value = left + right;
  if (!Number.isFinite(value) || Math.abs(value) >= 1e9) throw new Error("El consumo supera el límite seguro. Acotá el período.");
  return Math.round(value * 1e9) / 1e9;
}
function converted(value: unknown, from: unknown, to: string): number | null {
  const number = quantity(value);
  if (number === null || number <= 0) return null;
  try { return quantity(convertQuantity(number, from, to)); } catch { return null; }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Pure read projection. A recipe snapshot already includes sold quantity: never
 * multiply it again, subtract it from physical stock, or add it to ledger usage. */
export function buildReplenishmentReport(
  input: ReplenishmentInput,
  context: { branchName: string; timezone: string; readAt: string; today: string },
  data: ReplenishmentData,
): ReplenishmentReport {
  const rows = new Map<string, ReplenishmentRow>();
  for (const ingredient of data.ingredients) {
    if (rows.has(ingredient.id) || typeof ingredient.active !== "boolean") throw new Error("Catálogo de insumos inconsistente.");
    rows.set(ingredient.id, {
      ingredientId: ingredient.id, name: ingredient.name, active: ingredient.active, unit: normalizeUnit(ingredient.unit) ?? ingredient.unit,
      current: null, minimum: null, updatedAt: null, minimumShortfall: null,
      recordedOutflow: 0, recordedPurchaseReversal: 0, recordedWaste: 0, recordedAdjustment: 0, unverifiedMovementCount: 0, recordedMovementCount: 0,
      theoreticalUsage: data.sales === null ? null : 0, contributors: [], recentReceipts: [], unverifiedReceiptCount: 0, attention: "no_basis",
    });
  }
  const stocks = new Set<string>();
  for (const stock of data.stock) {
    const row = rows.get(stock.ingredient_id);
    if (!row || stocks.has(stock.ingredient_id)) throw new Error("El stock no coincide con el catálogo autorizado.");
    stocks.add(stock.ingredient_id);
    const current = quantity(stock.current), minimum = quantity(stock.min);
    row.current = current !== null && current >= 0 ? current : null;
    row.minimum = minimum !== null && minimum >= 0 ? minimum : null;
    row.updatedAt = stock.updated_at;
    row.minimumShortfall = row.active && normalizeUnit(row.unit) !== null && row.current !== null && row.minimum !== null ? Math.max(0, add(row.minimum, -row.current)) : null;
  }
  for (const movement of data.movements) {
    const row = rows.get(movement.ingredient_id);
    if (!row) throw new Error("Un movimiento no coincide con el catálogo autorizado.");
    const delta = quantity(movement.qty), before = quantity(movement.balance_before), after = quantity(movement.balance_after);
    if (delta === null || before === null || after === null || before < 0 || after < 0 || Math.abs((after - before) - delta) > 0.000001 || !normalizeUnit(movement.base_unit) || !["in", "out", "waste", "set"].includes(movement.operation ?? "")) {
      row.unverifiedMovementCount++; continue;
    }
    const amount = delta === 0 ? 0 : converted(Math.abs(delta), movement.base_unit, row.unit);
    if (amount === null || ((movement.operation === "out" || movement.operation === "waste") && delta >= 0) || (movement.operation === "in" && delta <= 0)) { row.unverifiedMovementCount++; continue; }
    row.recordedMovementCount++;
    if (movement.operation === "out") {
      if (movement.ref_type === "purchase_item_void") row.recordedPurchaseReversal = add(row.recordedPurchaseReversal, amount);
      else row.recordedOutflow = add(row.recordedOutflow, amount);
    }
    if (movement.operation === "waste") row.recordedWaste = add(row.recordedWaste, amount);
    if (movement.operation === "set") row.recordedAdjustment = add(row.recordedAdjustment, delta < 0 ? -amount : amount);
  }
  let missingRecipeLines = 0, incompleteRecipeLines = 0;
  const sales = new Map((data.sales ?? []).map((sale) => [sale.id, sale]));
  const detailedSales = new Set<string>();
  for (const line of data.saleLines ?? []) {
    if (!sales.has(line.sale_id)) throw new Error("El detalle de ventas cambió durante la lectura.");
    detailedSales.add(line.sale_id);
    const snapshot = line.recipe_snapshot;
    if (!line.product_id || !object(snapshot) || snapshot.state === "none" || !Array.isArray(snapshot.ingredients) || !snapshot.ingredients.length) { missingRecipeLines++; continue; }
    const sold = quantity(line.quantity);
    const linked = new Set<string>();
    const componentCounts = new Map<string, number>();
    for (const part of snapshot.ingredients) if (object(part) && typeof part.ingredientId === "string") componentCounts.set(part.ingredientId, (componentCounts.get(part.ingredientId) ?? 0) + 1);
    let incomplete = snapshot.state !== "complete" || sold === null || sold <= 0;
    for (const part of snapshot.ingredients) {
      // Canonical recipes have one component per ingredient. Duplicated IDs are
      // ambiguous: exclude every duplicate, never choose one or double usage.
      if (!object(part) || (typeof part.ingredientId === "string" && (componentCounts.get(part.ingredientId) ?? 0) > 1)) { incomplete = true; continue; }
      const row = typeof part.ingredientId === "string" ? rows.get(part.ingredientId) : undefined;
      const amount = row ? converted(part.theoreticalQuantity, part.baseUnit, row.unit) : null;
      if (!row || amount === null || sold === null || sold <= 0) { incomplete = true; continue; }
      row.theoreticalUsage = add(row.theoreticalUsage ?? 0, amount);
      linked.add(row.ingredientId);
      let contributor = row.contributors.find((item) => item.productId === line.product_id && item.productName === line.description);
      if (!contributor) { contributor = { productId: line.product_id, productName: line.description, soldQuantity: 0, theoreticalQuantity: 0, saleLineCount: 0 }; row.contributors.push(contributor); }
      // Sum verified historical amounts; sold quantity is counted once below.
      contributor.theoreticalQuantity = add(contributor.theoreticalQuantity, amount);
    }
    for (const ingredientId of linked) {
      const contributor = rows.get(ingredientId)!.contributors.find((item) => item.productId === line.product_id && item.productName === line.description)!;
      if (sold !== null) { contributor.soldQuantity = add(contributor.soldQuantity, sold); contributor.saleLineCount++; }
    }
    if (incomplete) incompleteRecipeLines++;
  }
  const purchases = new Map((data.purchases ?? []).map((purchase) => [purchase.id, purchase]));
  const linkedPurchases = new Set<string>();
  for (const line of data.purchaseLines ?? []) {
    const purchase = purchases.get(line.purchase_id);
    if (!purchase) throw new Error("El detalle de compras cambió durante la lectura.");
    const row = line.ingredient_id ? rows.get(line.ingredient_id) : undefined;
    if (!row) continue;
    const amount = converted(line.qty, line.unit, row.unit);
    if (amount === null) { row.unverifiedReceiptCount++; continue; }
    linkedPurchases.add(line.purchase_id);
    row.recentReceipts.push({ purchaseId: purchase.id, lineId: line.id, purchasedAt: purchase.purchased_at, description: line.description, quantity: amount, unit: row.unit });
  }
  for (const row of rows.values()) {
    row.contributors.sort((a, b) => b.theoreticalQuantity - a.theoreticalQuantity || a.productId.localeCompare(b.productId));
    row.recentReceipts.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt) || a.lineId.localeCompare(b.lineId));
    if (!row.active) { row.attention = "archived"; continue; }
    if (row.current === null || row.minimum === null || !normalizeUnit(row.unit)) { row.attention = "no_basis"; continue; }
    row.attention = row.current < row.minimum ? "below_minimum" : row.minimum > 0 && row.current === row.minimum ? "at_minimum"
      : row.recordedOutflow > 0 && row.current <= row.recordedOutflow ? "below_recorded_period_usage"
      : row.theoreticalUsage !== null && row.theoreticalUsage > 0 && row.current <= row.theoreticalUsage ? "below_theoretical_period_usage" : "none";
  }
  return {
    ...input, branchName: context.branchName, timezone: context.timezone, readAt: context.readAt, partialCurrentDay: input.to === context.today, rows: [...rows.values()],
    visibility: { sales: data.sales !== null, purchases: data.purchases !== null }, historyCoverage: "not_verified", coverageDays: null,
    evidence: { activeSales: data.sales?.length ?? null, saleLines: data.saleLines?.length ?? null,
      missingRecipeLines: data.saleLines === null ? null : missingRecipeLines, incompleteRecipeLines: data.saleLines === null ? null : incompleteRecipeLines,
      salesWithoutDetail: data.sales === null ? null : data.sales.filter((sale) => sale.sale_kind !== "detailed" || !detailedSales.has(sale.id)).length,
      activePurchases: data.purchases?.length ?? null, purchasesWithoutLinkedDetail: data.purchases === null ? null : data.purchases.filter((purchase) => !linkedPurchases.has(purchase.id)).length },
  };
}
