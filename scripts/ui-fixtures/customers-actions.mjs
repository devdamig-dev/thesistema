import { clone, makeState } from './state.mjs';
const { state, pause, stamp } = makeState({ saveCalls: 0, readCalls: 0, writes: [] });
state.customers = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Cliente QA Ficticio Inicial', phone: null, email: 'cliente.qa@example.invalid', channel: 'QA ficticio', notes: 'Fixture local sin personas reales.', active: true, updatedAt: '2026-10-09T12:00:00.000Z' },
  { id: '11111111-1111-4111-8111-111111111112', name: 'Cliente QA Ficticio Archivado', phone: null, email: null, channel: null, notes: null, active: false, updatedAt: '2026-10-09T12:00:00.000Z' },
];
export function initialCustomers() {
  return { ok: true, data: { customers: clone(state.customers), canManage: state.canManage, truncated: false } };
}
export async function getCustomersPageDataAction() {
  state.readCalls++;
  return initialCustomers();
}
export async function saveCustomerAction(input) {
  state.saveCalls++;
  state.writes.push(clone(input));
  await pause();
  if (!state.canManage) return { ok: false, persisted: false, error: 'QA ficticio: permiso de escritura denegado.' };
  const existing = state.customers.find((row) => row.id === input.id);
  if (input.id && existing?.updatedAt !== input.expectedUpdatedAt) return { ok: false, persisted: false, error: 'QA ficticio: versión desactualizada.' };
  const { id, expectedUpdatedAt: _version, ...fields } = input;
  const row = { ...fields, id: id || crypto.randomUUID(), updatedAt: stamp() };
  state.customers = id ? state.customers.map((item) => item.id === id ? row : item) : [...state.customers, row];
  if (state.response === 'uncertain') return { ok: false, persisted: 'unknown', error: 'QA ficticio: respuesta incierta, verificá el resultado.' };
  if (state.response === 'throw-after-commit') throw new Error('QA ficticio: transporte interrumpido después de guardar.');
  return { ok: true, persisted: true, customer: clone(row) };
}

export async function getCustomerSalesHistoryAction(id) {
  await pause();
  if (state.failHistory) return { ok: false, error: 'QA ficticio: historial no disponible.' };
  const customer = state.customers.find(row => row.id === id);
  return customer ? { ok: true, customerName: customer.name, timezone: 'America/Argentina/Buenos_Aires', rows: id === '11111111-1111-4111-8111-111111111111' ? [{ id: '11111111-1111-4111-8111-111111111190', occurredAt: '2026-10-09T12:00:00Z', amount: '25000.25', branch: 'Sucursal QA permitida', source: 'manual', status: 'active', description: '2 × Producto QA vinculado' }] : [] } : { ok: false, error: 'Cliente no disponible.' };
}
