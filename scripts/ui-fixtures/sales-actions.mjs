// Local-only fictional fixtures. Never import credentials, production actions or Supabase.
import { clone, makeState } from './state.mjs';
const { state, pause } = makeState({ saveCalls: 0, voidCalls: 0, workspaceReads: 0, reportReads: 0, writes: [], workspaceMode: 'success', reportMode: 'success' });
const id = (n) => `90000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
state.businessId = id(1); state.userId = id(2); state.timezone = 'Asia/Kolkata';
state.branches = [{ id: id(3), name: 'Central QA ficticia' }, { id: id(4), name: 'Norte QA ficticia' }];
state.products = [{ id: id(5), name: 'Producto QA ficticio', price: 12.50 }];
state.customers = [{ id: id(6), name: 'Cliente QA ficticio' }];
const occurred = new Date(Date.now() - 3600000).toISOString();
const base = { business_id: state.businessId, branch_id: id(3), channel: 'salon', amount: 25, occurred_at: occurred, status: 'active', sale_kind: 'detailed', source: 'manual', payment_method: 'Efectivo', customer_id: null, notes: null, currency: null, version: 1, void_reason: null, voided_at: null, created_at: occurred, updated_at: occurred };
state.sales = [
  { ...base, id: id(7), items: [{ id: id(8), sale_id: id(7), product_id: id(5), description: 'Producto QA ficticio', quantity: '2', unit_price: '12.50', total: '25', recipe_snapshot: { recipeId: id(20), recipeUpdatedAt: occurred, state: 'complete', ingredients: [{ ingredientId: id(21), name: 'Harina QA ficticia', quantity: '100', unit: 'g', baseUnit: 'kg', baseQuantity: '0.1', theoreticalQuantity: '0.2' }] }, position: 1 }] },
  { ...base, id: id(9), sale_kind: 'legacy', source: null, amount: 90, items: [] },
  { ...base, id: id(10), branch_id: id(4), sale_kind: 'summary', source: 'inbox', amount: 100, items: [] },
  { ...base, id: id(11), status: 'voided', void_reason: 'Error QA ficticio ya anulado', amount: 999, items: [] },
];
const results = new Map();
export async function getSalesWorkspaceAction() {
  state.workspaceReads++;
  if (state.workspaceMode === 'error') return { ok: false, error: 'QA ficticio: workspace no disponible.' };
  return { ok: true, data: clone({ businessId: state.businessId, userId: state.userId, timezone: state.timezone, branches: state.branches, products: state.products, customers: state.customers, canManage: state.canManage, sales: state.sales }) };
}
export async function getSalesPageDataAction(_period, branchId = null) {
  state.reportReads++;
  if (state.reportMode === 'error') return { ok: false, error: 'QA ficticio: informe incompleto.' };
  const sales = state.sales.filter((row) => row.status === 'active' && (!branchId || row.branch_id === branchId));
  const detailed = sales.filter((row) => row.sale_kind === 'detailed'); const total = sales.reduce((sum, row) => sum + Number(row.amount), 0);
  return { ok: true, data: { totalAmount: total, totalRecords: sales.length, totalTickets: detailed.length, averageTicket: detailed.length ? detailed.reduce((sum, row) => sum + Number(row.amount), 0) / detailed.length : null, salesByChannel: sales.length ? [{ canal: 'Salón', total, ticket: detailed.length ? 25 : null, share: 100, delta: 0 }] : [], salesByDay: sales.length ? [{ day: 'QA', ventas: total, costo: null }] : [], dailySalesTable: [], bestDay: null } };
}
async function mutate(kind, input) {
  state[kind === 'save' ? 'saveCalls' : 'voidCalls']++; state.writes.push(clone({ kind, input })); await pause();
  const fail = (error) => ({ ok: false, persisted: false, error });
  if (!state.canManage || input.businessId !== state.businessId || input.userId !== state.userId) return fail('QA ficticio: sesión o permiso cambió.');
  const key = `${kind}:${input.requestId}`; const found = results.get(key);
  if (found) return JSON.stringify(found.input) === JSON.stringify(input) ? clone(found.result) : fail('QA ficticio: intento cambió de contenido.');
  const existing = input.id ? state.sales.find((row) => row.id === input.id) : null;
  if (input.id && (!existing || existing.status !== 'active' || existing.version !== input.expectedVersion)) return fail('La venta cambió. Cerrá y abrí su versión actual antes de editar.');
  let row;
  if (kind === 'save') {
    if (!input.paymentMethod || !input.occurredAt || !input.items.length) return fail('QA ficticio: datos incompletos.');
    if (existing && existing.sale_kind !== 'detailed') return fail('QA ficticio: el histórico sólo permite anular.');
    const saleId = existing?.id ?? crypto.randomUUID();
    const items = input.items.map((item, position) => ({ id: item.id ?? crypto.randomUUID(), sale_id: saleId, product_id: item.productId, description: item.description, quantity: item.quantity, unit_price: item.unitPrice, total: Number(item.quantity) * Number(item.unitPrice), recipe_snapshot: existing?.items.find(old => old.id === item.id && old.product_id === item.productId)?.recipe_snapshot ?? null, position: position + 1 }));
    row = { ...base, id: saleId, branch_id: input.branchId, channel: input.channel, occurred_at: input.occurredAt, payment_method: input.paymentMethod, customer_id: input.customerId, notes: input.notes, amount: items.reduce((sum, item) => sum + item.total, 0), items, version: existing ? existing.version + 1 : 1 };
    state.sales = existing ? state.sales.map((sale) => sale.id === existing.id ? row : sale) : [row, ...state.sales];
  } else {
    if (!input.reason.trim()) return fail('QA ficticio: motivo obligatorio.');
    row = { ...existing, status: 'voided', void_reason: input.reason, voided_at: new Date().toISOString(), version: existing.version + 1 };
    state.sales = state.sales.map((sale) => sale.id === row.id ? row : sale);
  }
  const result = { ok: true, persisted: true, id: row.id, version: row.version }; results.set(key, { input: clone(input), result });
  if (state.response === 'throw-after-commit') throw new Error('QA ficticio: conexión perdida después de guardar.');
  if (state.response === 'uncertain') return { ok: false, persisted: 'unknown', error: 'QA ficticio: resultado incierto.' };
  return result;
}
export const saveSaleAction = (input) => mutate('save', input);
export const voidSaleAction = (input) => mutate('void', input);
export async function exportSalesCsvAction() { return { ok: true, persisted: false, filename: 'ventas-qa-ficticias.csv', content: 'Sólo fixtures', rows: state.sales.filter((sale) => sale.status === 'active').length }; }

export async function getSaleHistoryAction(saleId) {
  const sale = state.sales.find((row) => row.id === saleId);
  return !sale ? { ok: false, error: 'QA ficticio: venta no disponible.' } : { ok: true, history: sale.sale_kind === 'legacy' ? [] : [{ request_id: id(100), sale_id: sale.id, actor_id: state.userId, actor_role: 'owner', source: 'manual', operation: 'save', created_at: sale.created_at, before_snapshot: null, after_snapshot: { sale: clone(sale), items: clone(sale.items) }, result: { id: sale.id, version: sale.version } }] };
}
