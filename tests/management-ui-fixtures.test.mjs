// Fixture contract tests only: no browser, server, credentials, or external I/O.
import assert from 'node:assert/strict';
import test from 'node:test';
import { webcrypto } from 'node:crypto';

let iteration = 0;
async function fixture(t, name, readonly = false) {
  const previous = ['window', 'location', 'crypto'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'window', { value: {}, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'location', { value: { search: readonly ? '?readonly=1' : '' }, configurable: true, writable: true });
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const actions = await import(`../scripts/ui-fixtures/${name}-actions.mjs?case=${++iteration}`);
  return { actions, state: window.qa };
}
const customerInput = (overrides = {}) => ({ id: null, expectedUpdatedAt: null, name: 'Cliente QA Ficticio de Test', phone: null, email: 'fixture@example.invalid', channel: null, notes: null, active: true, ...overrides });
const supplierInput = (overrides = {}) => ({ id: '77777777-7777-4777-8777-777777777777', name: 'Proveedor QA Ficticio de Test', ...overrides });
const movementInput = (state, overrides = {}) => ({ ingredientId: state.ingredients[0].id, branchId: state.branches[0].id, operation: 'in', quantity: 250, unit: 'g', reason: 'Motivo QA Ficticio de Test', ...overrides });

test('customers fixture returns detached data and supports versioned CRUD without deleting', async (t) => {
  const { actions, state } = await fixture(t, 'customers');
  const first = actions.initialCustomers();
  first.data.customers[0].name = 'Un cambio local no cambia el fixture';
  assert.notEqual(state.customers[0].name, first.data.customers[0].name);
  assert.equal((await actions.saveCustomerAction(customerInput())).ok, true);
  const created = state.customers.at(-1);
  const edit = customerInput({ id: created.id, expectedUpdatedAt: created.updatedAt, name: 'Cliente QA Ficticio Editado' });
  assert.equal((await actions.saveCustomerAction(edit)).ok, true);
  assert.equal((await actions.saveCustomerAction(edit)).ok, false, 'Stale version must fail');
  const updated = state.customers.at(-1);
  assert.equal((await actions.saveCustomerAction(customerInput({ ...edit, expectedUpdatedAt: updated.updatedAt, active: false }))).ok, true);
  assert.equal(state.customers.length, 3);
  assert.equal(state.customers.at(-1).active, false);
});

test('customers fixture uncertain response commits once and read can verify', async (t) => {
  const { actions, state } = await fixture(t, 'customers');
  state.response = 'uncertain';
  assert.equal((await actions.saveCustomerAction(customerInput())).persisted, 'unknown');
  assert.equal((await actions.getCustomersPageDataAction()).data.customers.filter((row) => row.name === customerInput().name).length, 1);
  assert.equal(state.saveCalls, 1);
});

test('customers fixture enforces read-only state', async (t) => {
  const { actions, state } = await fixture(t, 'customers', true);
  assert.equal(actions.initialCustomers().data.canManage, false);
  assert.equal((await actions.saveCustomerAction(customerInput())).ok, false);
  assert.equal(state.customers.length, 2);
});

test('suppliers fixture uses stable IDs, versioned edits, and reversible archive', async (t) => {
  const { actions, state } = await fixture(t, 'suppliers');
  let result = await actions.createSupplierManualAction(supplierInput());
  assert.equal(result.ok, true);
  assert.equal((await actions.createSupplierManualAction(supplierInput())).supplier.id, result.id);
  assert.equal(state.suppliers.length, 3, 'Same attempt ID must not duplicate the supplier');
  result = await actions.updateSupplierManualAction(supplierInput({ name: 'Proveedor QA Ficticio Editado', expectedUpdatedAt: result.supplier.updated_at }));
  assert.equal(result.ok, true);
  result = await actions.setSupplierActiveAction({ id: result.id, expectedUpdatedAt: result.supplier.updated_at, active: false });
  assert.equal(result.supplier.active, false);
  assert.equal((await actions.getSuppliersPageDataAction({ status: 'archived', query: 'Editado', page: 0 })).data.count, 1);
  result = await actions.setSupplierActiveAction({ id: result.id, expectedUpdatedAt: result.supplier.updated_at, active: true });
  assert.equal(result.supplier.active, true);
  assert.equal(state.suppliers.length, 3);
});

test('suppliers fixture uncertain commit is verifiable by stable ID', async (t) => {
  const { actions, state } = await fixture(t, 'suppliers');
  state.response = 'uncertain';
  const result = await actions.createSupplierManualAction(supplierInput());
  assert.equal(result.status, 'uncertain');
  assert.equal(result.persisted, null);
  assert.equal((await actions.getSupplierManualAction(supplierInput().id)).supplier.name, supplierInput().name);
  assert.equal(state.createCalls, 1);
});

test('suppliers fixture read-only blocks all three mutation types', async (t) => {
  const { actions, state } = await fixture(t, 'suppliers', true);
  const original = structuredClone(state.suppliers);
  assert.equal((await actions.getSuppliersPageDataAction()).data.canManage, false);
  assert.equal((await actions.createSupplierManualAction(supplierInput())).ok, false);
  assert.equal((await actions.updateSupplierManualAction(supplierInput())).ok, false);
  assert.equal((await actions.setSupplierActiveAction({ id: state.suppliers[0].id, active: false })).ok, false);
  assert.deepEqual(state.suppliers, original);
});

test('stock fixture converts input units and captures original quantity, reason, and balances', async (t) => {
  const { actions, state } = await fixture(t, 'stock');
  const result = await actions.adjustStockManualAction(movementInput(state));
  assert.deepEqual(result, { ok: true, persisted: true, newCurrent: 20.25, delta: 0.25 });
  const history = await actions.getStockMovementHistoryAction({ page: 1, branchId: '', ingredientId: '' });
  assert.equal(history.data.total, 4);
  assert.equal(history.data.items[0].inputQuantity, 250);
  assert.equal(history.data.items[0].inputUnit, 'g');
  assert.equal(history.data.items[0].balanceBefore, 20);
  assert.equal(history.data.items[0].balanceAfter, 20.25);
  assert.equal(history.data.items[0].reasonNote, 'Motivo QA Ficticio de Test');
  history.data.items[0].reasonNote = 'Detached snapshot';
  assert.notEqual(state.history[0].reasonNote, 'Detached snapshot');
});

test('stock fixture rejects negative balances and incompatible units without adding ledger entries', async (t) => {
  const { actions, state } = await fixture(t, 'stock');
  assert.equal((await actions.adjustStockManualAction(movementInput(state, { operation: 'out', quantity: 30, unit: 'kg' }))).ok, false);
  assert.equal((await actions.adjustStockManualAction(movementInput(state, { unit: 'ml' }))).ok, false);
  assert.equal(state.stock[0].stock, 20);
  assert.equal(state.history.length, 3);
  assert.equal((await actions.adjustStockManualAction(movementInput(state, { operation: 'set', quantity: 0, unit: null }))).newCurrent, 0);
});

test('stock fixture uncertain transport preserves exactly one committed ledger row for verification', async (t) => {
  const { actions, state } = await fixture(t, 'stock');
  state.response = 'throw-after-commit';
  await assert.rejects(actions.adjustStockManualAction(movementInput(state)), /incierto/);
  assert.equal(state.movementCalls, 1);
  assert.equal(state.history.length, 4);
  assert.equal((await actions.getStockPageDataAction()).data.items[0].stock, 20.25);
});

test('stock fixture has pagination, filters, legacy data, error recovery, and read-only protection', async (t) => {
  const { actions, state } = await fixture(t, 'stock', true);
  assert.equal((await actions.getStockPageDataAction()).data.canAdjust, false);
  const page = await actions.getStockMovementHistoryAction({ page: 1, branchId: '', ingredientId: '' });
  assert.equal(page.data.items.length, 2);
  assert.equal(page.data.items[1].legacy, true);
  assert.equal(page.data.items[1].balanceBefore, null);
  const filtered = await actions.getStockMovementHistoryAction({ page: 1, branchId: state.branches[1].id, ingredientId: state.ingredients[0].id });
  assert.equal(filtered.data.total, 1);
  state.historyMode = 'error';
  assert.equal((await actions.getStockMovementHistoryAction({ page: 1 })).ok, false);
  state.historyMode = 'success';
  assert.equal((await actions.getStockMovementHistoryAction({ page: 2 })).data.items.length, 1);
  assert.equal((await actions.adjustStockManualAction(movementInput(state))).ok, false);
  assert.equal(state.stock[0].stock, 20);
  assert.equal(state.history.length, 3);
});

test('fixture write gate stays pending until explicitly released', async (t) => {
  const { actions, state } = await fixture(t, 'stock');
  state.holdWrites = true;
  let complete = false;
  const result = actions.adjustStockManualAction(movementInput(state)).then((value) => { complete = true; return value; });
  await Promise.resolve();
  assert.equal(complete, false);
  assert.equal(state.movementCalls, 1);
  assert.equal(state.history.length, 3);
  state.holdWrites = false;
  state.releaseWrites();
  assert.equal((await result).ok, true);
});

test('stock replenishment fixture exposes observed period and independent theoretical/physical quantities', async (t) => {
  const { actions, state } = await fixture(t, 'stock');
  const input = { branchId: state.branches[0].id, from: '2026-10-01', to: '2026-10-08' };
  const report = (await actions.getStockReplenishmentAction(input)).data;
  assert.equal(report.rows[0].current, 20); assert.equal(report.rows[0].recordedOutflow, 3); assert.equal(report.rows[0].theoreticalUsage, 2);
  assert.equal(report.coverageDays, null); assert.deepEqual(state.replenishmentQueries[0], input);
  state.replenishmentMode = 'error';
  assert.equal((await actions.getStockReplenishmentAction(input)).ok, false);
});
