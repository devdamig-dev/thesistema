import { clone, makeState } from './state.mjs';
const { state, pause, stamp } = makeState({ createCalls: 0, updateCalls: 0, statusCalls: 0, verifyCalls: 0, listQueries: [], writes: [], historyCalls: [] });
state.suppliers = [
  { id: '22222222-2222-4222-8222-222222222221', name: 'Proveedor QA Ficticio Inicial', tax_id: null, category: 'Pruebas ficticias', phone: null, email: 'proveedor.qa@example.invalid', payment_terms: 'Sin condiciones comerciales reales.', notes: 'Fixture local.', active: true, updated_at: '2026-10-09T12:00:00.000Z' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Proveedor QA Ficticio Archivado', tax_id: null, category: null, phone: null, email: null, payment_terms: null, notes: null, active: false, updated_at: '2026-10-09T12:00:00.000Z' },
];
const reject = (error) => ({ ok: false, persisted: false, status: 'rejected', error });
const rowFrom = (input, active = true) => ({ id: input.id, name: input.name.trim(), tax_id: input.taxId?.trim() || null, category: input.category?.trim() || null, phone: input.phone?.trim() || null, email: input.email?.trim() || null, payment_terms: input.paymentTerms?.trim() || null, notes: input.notes?.trim() || null, active, updated_at: stamp() });
function response(row) {
  if (state.response === 'uncertain') return { ok: false, persisted: null, status: 'uncertain', error: 'QA ficticio: respuesta incierta; verificá lo guardado.' };
  if (state.response === 'throw-after-commit') throw new Error('QA ficticio: transporte interrumpido después de guardar.');
  return { ok: true, persisted: true, id: row.id, supplier: clone(row) };
}
export async function getSuppliersPageDataAction(input = {}) {
  state.listQueries.push(clone(input));
  const rows = state.suppliers.filter((row) => (input.status === 'all' || row.active === (input.status !== 'archived')) && row.name.toLocaleLowerCase().includes((input.query || '').toLocaleLowerCase()));
  const page = input.page || 0;
  return { ok: true, data: { suppliers: clone(rows.slice(page * 30, (page + 1) * 30)), count: rows.length, page, pageSize: 30, canManage: state.canManage, draftScope: 'qa-ficticio:user:business' } };
}
export async function createSupplierManualAction(input) {
  state.createCalls++; state.writes.push({ kind: 'create', ...clone(input) }); await pause();
  if (!state.canManage) return reject('QA ficticio: permiso de escritura denegado.');
  const existing = state.suppliers.find((row) => row.id === input.id);
  if (existing) return response(existing);
  const row = rowFrom(input); state.suppliers.push(row);
  return response(row);
}
export async function updateSupplierManualAction(input) {
  state.updateCalls++; state.writes.push({ kind: 'update', ...clone(input) }); await pause();
  if (!state.canManage) return reject('QA ficticio: permiso de escritura denegado.');
  const existing = state.suppliers.find((row) => row.id === input.id);
  if (!existing || existing.updated_at !== input.expectedUpdatedAt) return { ok: false, persisted: false, status: 'conflict', error: 'QA ficticio: versión desactualizada.' };
  const row = rowFrom(input, existing.active);
  state.suppliers = state.suppliers.map((item) => item.id === row.id ? row : item);
  return response(row);
}
export async function setSupplierActiveAction(input) {
  state.statusCalls++; state.writes.push({ kind: 'status', ...clone(input) }); await pause();
  if (!state.canManage) return reject('QA ficticio: permiso de escritura denegado.');
  const existing = state.suppliers.find((row) => row.id === input.id);
  if (!existing || existing.updated_at !== input.expectedUpdatedAt) return { ok: false, persisted: false, status: 'conflict', error: 'QA ficticio: versión desactualizada.' };
  const row = { ...existing, active: input.active, updated_at: stamp() };
  state.suppliers = state.suppliers.map((item) => item.id === row.id ? row : item);
  return response(row);
}
export async function getSupplierManualAction(id) {
  state.verifyCalls++;
  return { ok: true, supplier: clone(state.suppliers.find((row) => row.id === id) || null) };
}
export async function getSupplierHistoryAction(id) {
  state.historyCalls.push(id);
  return { ok: true, purchases: [{ id: '22222222-2222-4222-8222-222222222229', purchasedAt: '2026-10-09', branch: 'Sucursal QA Ficticia', total: 100, items: [{ description: 'Insumo QA Ficticio', quantity: 2, unit: 'kg', ingredient: 'Insumo QA Ficticio' }] }] };
}
