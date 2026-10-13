import { clone, makeState } from './state.mjs';
const { state, pause, stamp } = makeState({ movementCalls: 0, stockReads: 0, writes: [], historyQueries: [], historyMode: 'success' });
const branches = [{ id: '33333333-3333-4333-8333-333333333331', name: 'Sucursal QA Ficticia Central' }, { id: '33333333-3333-4333-8333-333333333332', name: 'Sucursal QA Ficticia Norte' }];
const ingredients = [
  { id: '44444444-4444-4444-8444-444444444441', name: 'Harina QA Ficticia', unit: 'kg' },
  { id: '44444444-4444-4444-8444-444444444442', name: 'Aceite QA Ficticio', unit: 'l' },
  { id: '44444444-4444-4444-8444-444444444443', name: 'Envase QA Ficticio', unit: 'unit' },
];
state.branches = branches; state.ingredients = ingredients;
state.stock = [{ id: '55555555-5555-4555-8555-555555555551', ingredientId: ingredients[0].id, branchId: branches[0].id, branchName: branches[0].name, insumo: ingredients[0].name, unidad: 'kg', stock: 20, minimo: 5, updatedAt: '2026-10-09T12:00:00.000Z' }];
const base = { ingredientId: ingredients[0].id, ingredientName: ingredients[0].name, branchId: branches[0].id, branchName: branches[0].name };
state.history = [
  { ...base, id: '66666666-6666-4666-8666-666666666661', createdAt: '2026-10-09T12:00:00.000Z', delta: 5, reason: 'manual_adjust', operation: 'in', reasonNote: 'Ingreso QA ficticio inicial', source: 'manual', actorName: 'Operador QA Ficticio', actorRole: 'owner', inputQuantity: 5, inputUnit: 'kg', baseUnit: 'kg', balanceBefore: 15, balanceAfter: 20, legacy: false },
  { ...base, id: '66666666-6666-4666-8666-666666666662', createdAt: '2026-10-08T12:00:00.000Z', delta: 1, reason: 'purchase', operation: null, reasonNote: null, source: null, actorName: null, actorRole: null, inputQuantity: null, inputUnit: null, baseUnit: null, balanceBefore: null, balanceAfter: null, legacy: true },
  { ...base, branchId: branches[1].id, branchName: branches[1].name, id: '66666666-6666-4666-8666-666666666663', createdAt: '2026-10-07T12:00:00.000Z', delta: -2, reason: 'manual_adjust', operation: 'waste', reasonNote: 'Merma QA ficticia en Norte', source: 'manual', actorName: 'Operador QA Ficticio', actorRole: 'owner', inputQuantity: 2, inputUnit: 'kg', baseUnit: 'kg', balanceBefore: 10, balanceAfter: 8, legacy: false },
];
export async function getStockPageDataAction() {
  state.stockReads++;
  return { ok: true, data: { items: clone(state.stock), branches: clone(branches), ingredients: clone(ingredients), criticalCount: state.stock.filter((row) => row.stock <= row.minimo).length, alertCount: 0, lastUpdatedAt: state.stock[0]?.updatedAt || null, canAdjust: state.canManage } };
}
export async function getStockMovementHistoryAction(input) {
  state.historyQueries.push(clone(input));
  if (state.historyMode === 'error') return { ok: false, error: 'QA ficticio: historial no disponible temporalmente.' };
  const rows = state.history.filter((row) => (!input.branchId || row.branchId === input.branchId) && (!input.ingredientId || row.ingredientId === input.ingredientId));
  const pageSize = 2;
  return { ok: true, data: { items: clone(rows.slice((input.page - 1) * pageSize, input.page * pageSize)), total: rows.length, page: input.page, pageSize } };
}
export async function adjustStockManualAction(input) {
  state.movementCalls++; state.writes.push(clone(input)); await pause();
  const reject = (error) => ({ ok: false, persisted: false, error });
  if (!state.canManage) return reject('QA ficticio: permiso de escritura denegado.');
  const ingredient = ingredients.find((row) => row.id === input.ingredientId);
  const branch = branches.find((row) => row.id === input.branchId);
  if (!ingredient || !branch || !input.reason.trim()) return reject('QA ficticio: insumo, sucursal y motivo obligatorios.');
  const factors = { kg: 1, g: 0.001, l: 1, ml: 0.001, unit: 1 };
  const unit = input.unit || ingredient.unit;
  const units = ingredient.unit === 'kg' ? ['kg', 'g'] : ingredient.unit === 'l' ? ['l', 'ml'] : ['unit'];
  if (!units.includes(unit)) return reject('QA ficticio: unidad incompatible.');
  const quantity = input.quantity * factors[unit];
  if (!Number.isFinite(quantity) || quantity < 0 || (input.operation !== 'set' && quantity === 0)) return reject('QA ficticio: cantidad inválida.');
  const existing = state.stock.find((row) => row.ingredientId === input.ingredientId && row.branchId === input.branchId);
  const before = existing?.stock || 0;
  const next = input.operation === 'set' ? quantity : before + (input.operation === 'in' ? quantity : -quantity);
  if (next < 0) return reject('La salida o merma supera el stock disponible.');
  const time = stamp();
  const row = { id: existing?.id || crypto.randomUUID(), ingredientId: ingredient.id, branchId: branch.id, branchName: branch.name, insumo: ingredient.name, unidad: ingredient.unit, stock: next, minimo: existing?.minimo || 0, updatedAt: time };
  state.stock = existing ? state.stock.map((item) => item.id === row.id ? row : item) : [...state.stock, row];
  state.history.unshift({ id: crypto.randomUUID(), createdAt: time, ingredientId: ingredient.id, ingredientName: ingredient.name, branchId: branch.id, branchName: branch.name, delta: next - before, reason: 'manual_adjust', operation: input.operation, reasonNote: input.reason, source: 'manual', actorName: 'Operador QA Ficticio', actorRole: 'owner', inputQuantity: input.quantity, inputUnit: unit, baseUnit: ingredient.unit, balanceBefore: before, balanceAfter: next, legacy: false });
  if (state.response === 'throw-after-commit') throw new Error('QA ficticio: resultado incierto después de guardar.');
  return { ok: true, persisted: true, newCurrent: next, delta: next - before };
}

state.replenishmentQueries = []; state.replenishmentMode = 'success'; state.holdReplenishment = false;
const waitingReplenishment = [];
state.releaseReplenishment = () => { state.holdReplenishment = false; waitingReplenishment.splice(0).forEach((release) => release()); };
export async function getStockReplenishmentAction(input) {
  state.replenishmentQueries.push(clone(input));
  const branch = branches.find((item) => item.id === input.branchId);
  const rows = state.stock.filter((item) => item.branchId === input.branchId).map((item) => ({
    ingredientId: item.ingredientId, name: item.insumo, active: true, unit: item.unidad, current: item.stock, minimum: item.minimo,
    minimumShortfall: Math.max(0, item.minimo - item.stock), updatedAt: item.updatedAt,
    recordedOutflow: 3, recordedPurchaseReversal: 0, recordedWaste: 0.25, recordedAdjustment: -0.5, recordedMovementCount: 3, unverifiedMovementCount: 1,
    theoreticalUsage: 2, contributors: [{ productId: '77777777-7777-4777-8777-777777777771', productName: 'Pizza QA Ficticia', soldQuantity: 10, theoreticalQuantity: 2, saleLineCount: 1 }],
    recentReceipts: [{ purchaseId: '88888888-8888-4888-8888-888888888881', lineId: '88888888-8888-4888-8888-888888888882', purchasedAt: input.from, description: 'Entrega QA ficticia', quantity: 5, unit: item.unidad }],
    unverifiedReceiptCount: 0, attention: item.stock < item.minimo ? 'below_minimum' : 'none',
  }));
  const response = state.replenishmentMode === 'error' ? { ok: false, error: 'QA ficticio: no se pudo verificar la versión del informe.' } : { ok: true, data: {
    ...clone(input), branchName: branch?.name, timezone: 'America/Argentina/Buenos_Aires', readAt: '2026-10-09T12:00:00Z', partialCurrentDay: false, rows,
    visibility: { sales: true, purchases: true }, evidence: { activeSales: 2, saleLines: 1, missingRecipeLines: 0, incompleteRecipeLines: 0, salesWithoutDetail: 1, activePurchases: 1, purchasesWithoutLinkedDetail: 0 },
    historyCoverage: 'not_verified', coverageDays: null,
  } };
  if (state.holdReplenishment) await new Promise((resolve) => waitingReplenishment.push(resolve));
  return response;
}
