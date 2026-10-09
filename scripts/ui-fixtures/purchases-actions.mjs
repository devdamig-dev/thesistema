// Isolated, deliberately fictitious purchases. No production actions, credentials,
// Supabase, stock service or network are imported by this fixture.
import { clone, makeState } from './state.mjs';
const { state, pause } = makeState({ createCalls: 0, voidCalls: 0, listCalls: 0, writes: [], failLoad: false });
const branchId = '33333333-3333-4333-8333-333333333321';
const supplierId = '33333333-3333-4333-8333-333333333341';
const ingredientId = '33333333-3333-4333-8333-333333333371';
state.purchases = [{ id: '33333333-3333-4333-8333-333333333391', version: 1, status: 'active', source: 'manual', fecha: '09/10/26', proveedor: 'Proveedor QA Ficticio', insumo: 'Compra QA Ficticia Inicial', cantidad: '1 u', variacion: 0, monto: 100, sucursal: 'Sucursal QA Ficticia', items: [{ ingredientId: null, description: 'Compra QA Ficticia Inicial', qty: 1, unit: 'u', unitPrice: 100 }] }];
state.receipts = {};
state.costRefreshPending = false;
state.canRefreshCosts = true;
const reject = (error) => ({ ok: false, persisted: false, error });
const uncertain = () => ({ ok: false, persisted: null, error: 'QA ficticio: respuesta incierta; conservá el mismo intento.' });
function response(id) {
 if (state.response === 'uncertain') return uncertain();
 if (state.response === 'throw-after-commit') throw new Error('QA ficticio: transporte perdido después de guardar.');
 return { ok: true, persisted: true, id };
}
export async function getPurchasesPageDataAction() {
 state.listCalls++;
 if (state.failLoad) return { ok: false, error: 'QA ficticio: lectura de compras no disponible.' };
 const active = state.purchases.filter((row) => row.status === 'active');
 return { ok: true, data: { costRefreshPending: state.costRefreshPending, canRefreshCosts: state.canRefreshCosts, supplierDraftScope: 'qa-ficticio:user:business', canManageSuppliers: state.canManage,
  recentPurchases: clone(state.purchases), topSuppliers: [{ nombre: 'Proveedor QA Ficticio', rubro: 'Pruebas ficticias', ordenes: active.length, totalMes: active.reduce((sum, row) => sum + row.monto, 0), tendencia: 0 }],
  ingredients: [{ id: ingredientId, name: 'Harina QA Ficticia', unit: 'kg' }], suppliers: [{ id: supplierId, name: 'Proveedor QA Ficticio', category: 'QA', active: true }], branches: [{ id: branchId, name: 'Sucursal QA Ficticia' }], supplierCount: 1, orderCount: active.length, totalMonth: active.reduce((sum, row) => sum + row.monto, 0) } };
}
export async function createPurchaseAction(input) {
 state.createCalls++; state.writes.push({ kind: 'create', ...clone(input) }); await pause();
 if (!state.canManage) return reject('QA ficticio: permiso de compra denegado.');
 if (state.response === 'rejected') return reject('QA ficticio: datos rechazados sin guardar.');
 if (state.response === 'uncertain-before') return uncertain();
 const prior = state.receipts[input.requestId];
 if (prior) {
  if (JSON.stringify(prior.input) !== JSON.stringify(input)) return reject('QA ficticio: el intento ya tiene otros datos.');
  return response(prior.id);
 }
 const items = input.kind === 'summary' ? [] : input.items ?? [input];
 if (!input.requestId || input.branchId !== branchId || input.supplierId !== supplierId || (input.kind === 'summary' ? !(Number(input.amount) > 0) : !items.length) || items.some((line) => !line.description?.trim() || !Number.isFinite(Number(line.qty)) || Number(line.qty) <= 0 || !Number.isFinite(Number(line.unitPrice)) || Number(line.unitPrice) < 0)) return reject('QA ficticio: datos incompletos.');
 const original = input.replacesPurchaseId ? state.purchases.find((row) => row.id === input.replacesPurchaseId) : null;
 if (input.replacesPurchaseId && (!original || original.status !== 'active' || original.version !== input.expectedVersion || !input.correctionReason?.trim())) return reject('QA ficticio: corrección desactualizada o sin motivo.');
 if (original) { original.status = 'voided'; original.version++; original.voidReason = input.correctionReason.trim(); }
 const id = input.requestId;
 const row = { id, version: 1, status: 'active', source: 'manual', fecha: '09/10/26', proveedor: 'Proveedor QA Ficticio', correctionOrigin: original ? original.correctionOrigin ?? original.source : null, receiptReference: input.receiptReference, kind: input.kind ?? 'detailed', insumo: items[0]?.description ?? 'Compra resumida', cantidad: items.length ? `${items[0].qty} ${items[0].unit}` : '—', variacion: 0, monto: input.kind === 'summary' ? Number(input.amount) : items.reduce((sum, line) => sum + Math.round(Number(line.qty) * Number(line.unitPrice) * 100) / 100, 0), sucursal: 'Sucursal QA Ficticia', items: clone(items) };
 state.purchases.unshift(row); state.receipts[input.requestId] = { id, input: clone(input) };
 return response(id);
}
export async function voidPurchaseAction(input) {
 state.voidCalls++; state.writes.push({ kind: 'void', ...clone(input) }); await pause();
 if (!state.canManage) return reject('QA ficticio: permiso de anulación denegado.');
 if (state.response === 'rejected') return reject('QA ficticio: el stock consumido impide anular.');
 if (state.response === 'uncertain-before') return uncertain();
 const row = state.purchases.find((value) => value.id === input.id);
 if (!row || !input.reason?.trim()) return reject('QA ficticio: registro o motivo inválido.');
 if (row.status === 'voided' && row.version === input.expectedVersion + 1 && row.voidReason === input.reason.trim()) return response(row.id);
 if (row.version !== input.expectedVersion || row.status !== 'active') return reject('QA ficticio: versión de compra desactualizada.');
 row.status = 'voided'; row.version++; row.voidReason = input.reason.trim();
 return response(row.id);
}
export async function exportPurchasesCsvAction() { return { ok: true, persisted: true, filename: 'compras-qa.csv', content: 'Compra\nFixture QA', rows: state.purchases.length }; }
// SupplierForm is imported by the production page but not exercised here. Keep
// all of its imports isolated too, without resetting the shared fixture state.
export async function createSupplierManualAction() { return reject('QA ficticio: alta de proveedores fuera de esta suite.'); }
export async function updateSupplierManualAction() { return reject('QA ficticio: edición de proveedores fuera de esta suite.'); }
export async function getSupplierManualAction() { return { ok: false, error: 'QA ficticio: verificación de proveedores fuera de esta suite.' }; }

export async function getPurchaseCorrectionAction(id) {
 const row = state.purchases.find((value) => value.id === id);
 if (!state.canManage || !row || row.status !== 'active') return { ok: false, error: 'QA ficticio: compra no disponible para corregir.' };
 return { ok: true, input: { requestId: '', replacesPurchaseId: id, expectedVersion: row.version, correctionReason: '', branchId, supplierId, purchasedAt: '2026-10-09', paymentMethod: 'Efectivo', kind: row.kind ?? 'detailed', amount: row.kind === 'summary' ? String(row.monto) : undefined, receiptReference: row.receiptReference, ...clone(row.items[0]), items: clone(row.items) } };
}

export async function refreshPurchaseCostsAction() {
 if (!state.canRefreshCosts) return {ok:false,error:'QA: solo propietario o administrador.'};
 state.costRefreshPending = false; return {ok:true,refreshed:1,pending:0};
}
