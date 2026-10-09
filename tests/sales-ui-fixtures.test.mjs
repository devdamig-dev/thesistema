import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';
let run = 0;
async function fixture(t) {
  const descriptors = ['window', 'location', 'crypto'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'window', { value: {}, writable: true, configurable: true });
  Object.defineProperty(globalThis, 'location', { value: { search: '' }, writable: true, configurable: true });
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  t.after(() => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const actions = await import(`../scripts/ui-fixtures/sales-actions.mjs?test=${++run}`);
  const state = window.qa;
  const input = () => ({ requestId: crypto.randomUUID(), businessId: state.businessId, userId: state.userId, id: null, expectedVersion: null, branchId: state.branches[0].id, occurredAt: new Date().toISOString(), channel: 'salon', paymentMethod: 'Efectivo', customerId: null, notes: null, items: [{ productId: null, description: 'Concepto ficticio', quantity: '2', unitPrice: '4.50' }] });
  return { actions, state, input };
}
test('sales fixtures model create/edit/CAS/void without deleting rows', async (t) => {
  const { actions, state, input } = await fixture(t); const initial = state.sales.length; const first = input();
  const created = await actions.saveSaleAction(first); assert.equal(created.ok, true); assert.equal(state.sales.length, initial + 1);
  const edit = { ...first, requestId: crypto.randomUUID(), id: created.id, expectedVersion: 1, notes: 'Editada' };
  const changed = await actions.saveSaleAction(edit); assert.equal(changed.version, 2);
  assert.equal((await actions.saveSaleAction({ ...edit, requestId: crypto.randomUUID() })).ok, false);
  const voided = await actions.voidSaleAction({ requestId: crypto.randomUUID(), businessId: state.businessId, userId: state.userId, id: created.id, expectedVersion: 2, reason: 'Corrección' });
  assert.equal(voided.version, 3); assert.equal(state.sales.length, initial + 1); assert.equal(state.sales.find((sale) => sale.id === created.id).status, 'voided');
});
test('sales fixture commit-then-timeout replays exact request once', async (t) => {
  const { actions, state, input } = await fixture(t); const request = input(); state.response = 'throw-after-commit'; const before = state.sales.length;
  await assert.rejects(actions.saveSaleAction(request));
  assert.equal((await actions.saveSaleAction(request)).ok, true); assert.equal(state.sales.length, before + 1);
  assert.equal((await actions.saveSaleAction({ ...request, notes: 'Different' })).ok, false);
});
test('sales fixtures distinguish record count, tickets and branch revenue', async (t) => {
  const { actions, state } = await fixture(t); const result = await actions.getSalesPageDataAction();
  assert.equal(result.data.totalRecords, 3); assert.equal(result.data.totalTickets, 1); assert.equal(result.data.averageTicket, 25); assert.equal(result.data.salesByChannel[0].total, 215);
  const scoped = await actions.getSalesPageDataAction('current_month', state.branches[1].id);
  assert.equal(scoped.data.totalTickets, 0); assert.equal(scoped.data.salesByChannel[0].total, 100);
});
test('sales fixtures return isolated data and deny stale sessions and readonly writes', async (t) => {
  const { actions, state, input } = await fixture(t); const result = await actions.getSalesWorkspaceAction(); result.data.sales[0].amount = 10000;
  assert.equal(state.sales[0].amount, 25); const request = input(); state.userId = crypto.randomUUID();
  assert.equal((await actions.saveSaleAction(request)).ok, false); state.canManage = false;
  assert.equal((await actions.saveSaleAction(input())).ok, false);
});
