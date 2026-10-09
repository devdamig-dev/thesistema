/** Real purchase-review DOM interactions using inert actions and fictitious data.
 * BUNDLE_ONLY=1 exits inside the shared harness before any server/browser starts. */
import { assert, root, runUiHarness, noOverflow, viewports, clickTwice } from '../scripts/ui-fixtures/harness.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

await mkdir(join(root, '.test-artifacts'), { recursive: true });
const actions = join(root, '.test-artifacts/inbox-purchases-actions.mjs');
await writeFile(actions, `
export async function approveInboxPurchaseAction(input) {
  const key = 'gastropilot:inbox-purchase:' + input.businessId + ':' + input.userId + ':' + input.extractionId + ':v1';
  window.qa.calls.push(structuredClone(input));
  window.qa.journalsAtCall.push(sessionStorage.getItem(key));
  const result = window.qa.responses.shift() ?? {ok:true,persisted:true,id:'00000000-0000-4000-8000-000000000020',replayed:false,kind:input.review.kind,source:'inbox'};
  if (window.qa.delay) await new Promise(resolve => { window.qa.release = resolve; });
  return result;
}
`);
const ids = {
  user: '00000000-0000-4000-8000-000000000001',
  business: '00000000-0000-4000-8000-000000000002',
  branch: '00000000-0000-4000-8000-000000000003',
  supplier: '00000000-0000-4000-8000-000000000004',
  ingredient: '00000000-0000-4000-8000-000000000005',
  extraction: '00000000-0000-4000-8000-000000000010',
};
const journalKey = `gastropilot:inbox-purchase:${ids.business}:${ids.user}:${ids.extraction}:v1`;
const entry = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {InboxPurchaseReviewDialog} from '${root}/app/inbox/purchase-review.tsx';
const ids = ${JSON.stringify(ids)};
const review = {
  alreadyApproved:false, extractionId:ids.extraction, businessId:ids.business, userId:ids.user,
  branchId:null, branches:[{id:ids.branch,name:'Central QA ficticia'},{id:'00000000-0000-4000-8000-000000000006',name:'Norte QA ficticia'}],
  suppliers:[{id:ids.supplier,name:'Proveedor QA ficticio'}], ingredients:[{id:ids.ingredient,name:'Harina QA ficticia',unit:'kg'}],
  expectedFields:{supplier:'Proveedor QA ficticio',total_amount:25.5,item:'Harina extraída',quantity:500,unit:'g',unit_price:0.05},
  supplierId:'', purchasedAt:'', paymentMethod:'', amount:'25.50',
  items:[{ingredientId:null,description:'Harina extraída',qty:'500',unit:'g',unitPrice:'0.05'}]
};
const root = createRoot(document.getElementById('root'));
window.qa = {calls:[],journalsAtCall:[],responses:[],saved:0,closed:0,delay:false,review:structuredClone(review)};
window.qa.render = () => root.render(<InboxPurchaseReviewDialog review={window.qa.review}
  onClose={() => {window.qa.closed++;root.render(<button onClick={() => window.qa.render()}>Reabrir compra</button>);}}
  onSaved={() => {window.qa.saved++;root.render(<p role="status">Compra confirmada en fixture</p>);}} />);
window.qa.changeContext = patch => {window.qa.review={...window.qa.review,...patch};window.qa.render();};
window.qa.render();
`;

await runUiHarness({
  name: 'inbox-purchases',
  actionModules: { '@/app/actions/inbox-purchases': actions },
  entry,
  async run({ page, origin, check, screenshot }) {
    const field = name => page.getByLabel(name, { exact: true });
    const button = name => page.getByRole('button', { name, exact: true });
    async function fresh() {
      await page.goto(origin);
      await page.evaluate(() => sessionStorage.clear());
      await page.reload();
      await page.getByRole('dialog', { name: 'Revisar compra', exact: true }).waitFor();
      await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
    }
    async function completeHeader() {
      await field('Sucursal de la compra').selectOption(ids.branch);
      await field('Proveedor de la compra').selectOption(ids.supplier);
      await field('Fecha de compra').fill('2026-10-09');
      await field('Medio de pago de la compra').fill('Transferencia');
    }
    async function summary() {
      await completeHeader();
      await field('Tipo de compra').selectOption('summary');
      await field('Monto de la compra').fill('123,45');
    }
    async function layout() {
      await noOverflow(page);
      const bounds = await page.getByRole('dialog', { name: 'Revisar compra', exact: true }).boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.width <= page.viewportSize().width + 1, 'dialog fits viewport');
      assert.equal(await page.locator('[role="dialog"] section').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'review editor has no horizontal overflow');
    }
    async function uncertainSummary() {
      await summary();
      await page.evaluate(() => window.qa.responses.push({ ok: false, persisted: 'unknown', error: 'Conexión interrumpida en fixture' }));
      await button('Confirmar compra').click();
      await button('Reintentar misma revisión').waitFor();
      assert.equal(await field('Monto de la compra').isDisabled(), true);
      return page.evaluate(() => structuredClone(window.qa.calls[0]));
    }

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await fresh();
      await check(`${viewport.name}: explicit branch, supplier, date, method and mode are required`, async () => {
        for (const name of ['Sucursal de la compra', 'Proveedor de la compra', 'Fecha de compra', 'Medio de pago de la compra', 'Tipo de compra']) assert.equal(await field(name).inputValue(), '');
        await button('Confirmar compra').click();
        await page.getByRole('alert').waitFor();
        assert.equal(await page.evaluate(() => window.qa.calls.length), 0);
        await completeHeader();
        await button('Confirmar compra').click();
        assert.equal(await page.evaluate(() => window.qa.calls.length), 0, 'header alone cannot infer summary/detailed mode');
        await layout();
        await screenshot(`${viewport.name}-explicit-review`);
      });
      await check(`${viewport.name}: double click journals one exact summary before its RPC`, async () => {
        await field('Tipo de compra').selectOption('summary');
        await field('Monto de la compra').fill('123,45');
        await page.evaluate(() => { window.qa.delay = true; window.qa.responses.push({ ok: false, persisted: 'unknown', error: 'Respuesta interrumpida' }); });
        await clickTwice(button('Confirmar compra'));
        await page.waitForFunction(() => window.qa.calls.length === 1 && typeof window.qa.release === 'function');
        assert.equal(await button('Cancelar').isDisabled(), true);
        const call = await page.evaluate(() => window.qa.calls[0]);
        assert.deepEqual(call.review, { branchId: ids.branch, supplierId: ids.supplier, purchasedAt: '2026-10-09', paymentMethod: 'Transferencia', kind: 'summary', amount: '123.45' });
        assert.equal(Object.hasOwn(call.review, 'items'), false);
        assert.deepEqual(JSON.parse(await page.evaluate(() => window.qa.journalsAtCall[0])), call);
        await page.evaluate(() => { window.qa.delay = false; window.qa.release(); });
        await button('Reintentar misma revisión').waitFor();
        for (const name of ['Sucursal de la compra', 'Proveedor de la compra', 'Fecha de compra', 'Medio de pago de la compra', 'Tipo de compra', 'Monto de la compra']) assert.equal(await field(name).isDisabled(), true);
        await layout();
        await screenshot(`${viewport.name}-uncertain-summary`);
      });
      await check(`${viewport.name}: close/reopen/reload retains the exact uncertain review`, async () => {
        const original = await page.evaluate(() => window.qa.calls[0]);
        await button('Cerrar y revisar').click();
        await button('Reabrir compra').waitFor();
        assert.deepEqual(JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), journalKey)), original);
        await button('Reabrir compra').click();
        await button('Reintentar misma revisión').waitFor();
        assert.equal(await field('Monto de la compra').inputValue(), '123.45');
        await page.reload();
        await button('Reintentar misma revisión').waitFor();
        assert.equal(await field('Tipo de compra').inputValue(), 'summary');
        assert.equal(await field('Monto de la compra').isDisabled(), true);
        await button('Reintentar misma revisión').click();
        await page.getByRole('status').waitFor();
        assert.equal(await page.evaluate(() => window.qa.saved), 1);
        assert.deepEqual(await page.evaluate(() => window.qa.calls), [original]);
        assert.equal(await page.evaluate(key => sessionStorage.getItem(key), journalKey), null);
      });

      await fresh();
      await check(`${viewport.name}: detailed lines preserve actual quantity/unit/price and explicit stock mapping`, async () => {
        await completeHeader();
        await field('Tipo de compra').selectOption('detailed');
        assert.equal(await field('Insumo de línea 1').inputValue(), '', 'extracted name does not silently resolve stock');
        await field('Insumo de línea 1').selectOption(ids.ingredient);
        await field('Descripción de línea 1').fill('Harina real revisada');
        await field('Cantidad de línea 1').fill('500');
        await field('Unidad de línea 1').fill('g');
        await field('Precio de línea 1').fill('0,05');
        await button('Agregar línea').click();
        await field('Descripción de línea 2').fill('Flete real sin stock');
        await field('Cantidad de línea 2').fill('1');
        await field('Unidad de línea 2').fill('servicio');
        await field('Precio de línea 2').fill('0,50');
        await button('Agregar línea').click();
        await button('Quitar línea 3').click();
        assert.equal(await page.getByLabel('Descripción de línea 3', { exact: true }).count(), 0);
        await layout();
        await screenshot(`${viewport.name}-detailed-review`);
        await button('Confirmar compra').click();
        await page.getByRole('status').waitFor();
        const call = await page.evaluate(() => window.qa.calls[0]);
        assert.equal(call.review.kind, 'detailed');
        assert.equal(Object.hasOwn(call.review, 'amount'), false, 'detailed total is never supplied from extraction summary');
        assert.deepEqual(call.review.items, [
          { ingredientId: ids.ingredient, description: 'Harina real revisada', qty: '500', unit: 'g', unitPrice: '0.05' },
          { ingredientId: null, description: 'Flete real sin stock', qty: '1', unit: 'servicio', unitPrice: '0.50' },
        ]);
        assert.deepEqual(call.expectedFields, { supplier: 'Proveedor QA ficticio', total_amount: 25.5, item: 'Harina extraída', quantity: 500, unit: 'g', unit_price: 0.05 });
      });

      for (const [contextField, alternate] of [
        ['userId', '00000000-0000-4000-8000-000000000101'],
        ['businessId', '00000000-0000-4000-8000-000000000102'],
        ['extractionId', '00000000-0000-4000-8000-000000000110'],
      ]) {
        await fresh();
        await check(`${viewport.name}: changing ${contextField} never restores another context's journal`, async () => {
          const original = await uncertainSummary();
          const priorContext = original[contextField];
          await page.evaluate(({ contextField, alternate }) => window.qa.changeContext({ [contextField]: alternate }), { contextField, alternate });
          await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
          assert.equal(await field('Tipo de compra').inputValue(), '');
          assert.equal(await field('Sucursal de la compra').inputValue(), '');
          assert.equal(await button('Reintentar misma revisión').count(), 0);
          assert.equal(await page.evaluate(() => window.qa.calls.length), 1);
          assert.deepEqual(JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), journalKey)), original);
          await page.evaluate(({ contextField, priorContext }) => window.qa.changeContext({ [contextField]: priorContext }), { contextField, priorContext });
          await button('Reintentar misma revisión').waitFor();
          assert.equal(await field('Monto de la compra').inputValue(), '123.45');
        });
      }

      await fresh();
      await check(`${viewport.name}: response from an unmounted actor cannot close or rewrite the new review`, async () => {
        await summary();
        await page.evaluate(() => { window.qa.delay = true; });
        await button('Confirmar compra').click();
        await page.waitForFunction(() => typeof window.qa.release === 'function');
        const original = await page.evaluate(() => window.qa.calls[0]);
        await page.evaluate(() => window.qa.changeContext({ userId: '00000000-0000-4000-8000-000000000101' }));
        await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
        await page.evaluate(() => { window.qa.delay = false; window.qa.release(); });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await page.evaluate(() => window.qa.saved), 0);
        assert.equal(await field('Tipo de compra').inputValue(), '');
        assert.deepEqual(JSON.parse(await page.evaluate(key => sessionStorage.getItem(key), journalKey)), original);
        await layout();
        await screenshot(`${viewport.name}-changed-context`);
      });

      await fresh();
      await check(`${viewport.name}: failed journal storage blocks the action before any write`, async () => {
        await summary();
        await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Fixture quota', 'QuotaExceededError'); }; });
        await button('Confirmar compra').click();
        await page.getByRole('alert').waitFor();
        assert.match(await page.getByRole('alert').innerText(), /conservar el intento/);
        assert.equal(await page.evaluate(() => window.qa.calls.length), 0);
        assert.equal(await button('Confirmar compra').isDisabled(), true);
      });
    }
  },
});
