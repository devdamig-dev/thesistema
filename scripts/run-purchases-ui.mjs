// Real purchase page, isolated actions. Browser execution belongs to CI; use
// BUNDLE_ONLY=1 for environments where browser launch is unavailable/denied.
import { assert, clickTwice, editorReady, fixturePath, noOverflow, releaseWrites, root, runUiHarness, viewports } from './ui-fixtures/harness.mjs';
const actions = fixturePath('purchases-actions.mjs');
await runUiHarness({
 name: 'purchases', actionModules: { '@/app/actions/purchases-page': actions, '@/app/actions/exports': actions, '@/app/actions/suppliers-page': actions },
 entry: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${root}/app/compras/page.tsx';import {ToastProvider} from '${root}/components/ui/toast.tsx';createRoot(document.getElementById('root')).render(<ToastProvider><Page/></ToastProvider>);`,
 async run({ page, origin, check, screenshot }) {
  const row = (description) => page.getByRole('row').filter({ has: page.getByRole('cell', { name: description, exact: true }) });
  async function openNew() { await page.getByRole('button', { name: 'Registrar compra', exact: true }).first().click(); return editorReady(page); }
  async function fillNew(description, multiline = false) {
   const editor = await openNew();
   await editor.getByLabel('Sucursal *', { exact: true }).selectOption({ label: 'Sucursal QA Ficticia' });
   await editor.getByLabel('Proveedor *', { exact: true }).selectOption({ label: 'Proveedor QA Ficticio' });
   await editor.getByLabel('Fecha *', { exact: true }).fill('2026-10-09');
   if (multiline) await editor.getByLabel('Referencia de comprobante (opcional)', { exact: true }).fill('Ticket QA 123');
   if (multiline) await editor.getByLabel('Línea 1: insumo opcional', { exact: true }).selectOption({ label: 'Harina QA Ficticia (kg)' });
   await editor.getByLabel('Descripción *', { exact: true }).first().fill(description);
   await editor.getByLabel('Cantidad *', { exact: true }).first().fill(multiline ? '1,5' : '1');
   await editor.getByLabel('Precio unitario *', { exact: true }).first().fill(multiline ? '500' : '100');
   if (multiline) {
    await editor.getByRole('button', { name: 'Agregar línea', exact: true }).click();
    await editor.getByLabel('Descripción *', { exact: true }).nth(1).fill('Flete QA Ficticio sin stock');
    await editor.getByLabel('Cantidad *', { exact: true }).nth(1).fill('2');
    await editor.getByLabel('Precio unitario *', { exact: true }).nth(1).fill('100');
   }
   return editor;
  }
  for (const viewport of viewports) {
   const prefix = viewport.name; const description = `Compra QA Multilínea ${prefix}`;
   await page.setViewportSize({ width: viewport.width, height: viewport.height }); await page.goto(origin);
   await row('Compra QA Ficticia Inicial').waitFor();
   await check(`${prefix}: lista real sin overflow ni alertas demo`, async () => { await noOverflow(page); assert.equal(await page.getByText('Don José aumentó 14% el kilo de carne', { exact: true }).count(), 0); });
   await screenshot(`${prefix}-directory`);
   await check(`${prefix}: cerrar un borrador sin enviar no crea compra`, async () => {
    const editor = await fillNew('Descartada QA'); await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click(); await editor.waitFor({ state: 'hidden' }); assert.equal(await page.evaluate(() => window.qa.createCalls), 0);
   });
   await check(`${prefix}: alta multilínea, insumo opcional, doble clic y bloqueo mientras guarda`, async () => {
    const editor = await fillNew(description, true); await screenshot(`${prefix}-multiline-editor`);
    await page.evaluate(() => { window.qa.holdWrites = true; }); await clickTwice(editor.getByRole('button', { name: 'Registrar compra', exact: true }));
    await page.waitForFunction(() => window.qa.createCalls > 0); assert.equal(await page.evaluate(() => window.qa.createCalls), 1, 'One synchronous submit lock, not just database deduplication');
    assert.equal(await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().isDisabled(), true);
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).first().click(); assert.equal(await editor.isVisible(), true);
    await releaseWrites(page); await editor.waitFor({ state: 'hidden' }); await row(description).waitFor();
    const saved = await page.evaluate((text) => window.qa.purchases.find((p) => p.insumo === text), description);
    assert.equal(saved.receiptReference, 'Ticket QA 123'); assert.equal(saved.items.length, 2); assert.equal(saved.items[0].ingredientId, '33333333-3333-4333-8333-333333333371'); assert.equal(saved.items[1].ingredientId, null); assert.equal(saved.monto, 950);
    assert.equal(await page.evaluate((text) => window.qa.purchases.filter((p) => p.insumo === text).length, description), 1);
   });
   await check(`${prefix}: rechazo conocido conserva formulario editable y permite corregir`, async () => {
    await page.evaluate(() => { window.qa.response = 'rejected'; }); const editor = await fillNew(`Compra QA Rechazada ${prefix}`);
    await editor.getByRole('button', { name: 'Registrar compra', exact: true }).click(); await page.getByText('QA ficticio: datos rechazados sin guardar.', { exact: true }).waitFor();
    assert.equal(await editor.getByLabel('Descripción *', { exact: true }).isDisabled(), false);
    await editor.getByLabel('Descripción *', { exact: true }).fill(`Compra QA Corregida ${prefix}`); await page.evaluate(() => { window.qa.response = 'success'; });
    await editor.getByRole('button', { name: 'Registrar compra', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await row(`Compra QA Corregida ${prefix}`).waitFor();
   });
   await check(`${prefix}: resultado incierto conserva UUID y datos al cerrar/reabrir`, async () => {
    await page.evaluate(() => { window.qa.response = 'throw-after-commit'; }); const uncertainDescription = `Compra QA Incierta ${prefix}`; let editor = await fillNew(uncertainDescription);
    await editor.getByRole('button', { name: 'Registrar compra', exact: true }).click(); await editor.getByRole('button', { name: 'Verificar el mismo intento', exact: true }).waitFor();
    assert.equal(await editor.getByLabel('Descripción *', { exact: true }).isDisabled(), true);
    const original = await page.evaluate(() => window.qa.writes.at(-1)); await screenshot(`${prefix}-uncertain`);
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click(); await editor.waitFor({ state: 'hidden' });
    editor = await openNew(); await editor.getByRole('button', { name: 'Verificar el mismo intento', exact: true }).waitFor();
    await page.evaluate(() => { window.qa.response = 'success'; }); await editor.getByRole('button', { name: 'Verificar el mismo intento', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await row(uncertainDescription).waitFor();
    const replay = await page.evaluate(() => window.qa.writes.at(-1)); assert.deepEqual(replay, original); assert.equal(await page.evaluate((text) => window.qa.purchases.filter((p) => p.insumo === text).length, uncertainDescription), 1);
   });
   await check(`${prefix}: respuesta incierta previa al commit reintenta exactamente el intento`, async () => {
    await page.evaluate(() => { window.qa.response = 'uncertain-before'; }); const retryDescription = `Compra QA Reintento ${prefix}`; const editor = await fillNew(retryDescription);
    await editor.getByRole('button', { name: 'Registrar compra', exact: true }).click(); await editor.getByRole('button', { name: 'Verificar el mismo intento', exact: true }).waitFor();
    const original = await page.evaluate(() => window.qa.writes.at(-1)); await page.evaluate(() => { window.qa.response = 'success'; });
    await editor.getByRole('button', { name: 'Verificar el mismo intento', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await row(retryDescription).waitFor();
    assert.deepEqual(await page.evaluate(() => window.qa.writes.at(-1)), original);
   });
   await check(`${prefix}: corregir exige motivo, conserva original y registra reemplazo`, async () => {
    const originalDescription = `Compra QA Corregida ${prefix}`;
    const original = await page.evaluate((text) => window.qa.purchases.find((p) => p.insumo === text), originalDescription);
    await row(originalDescription).getByRole('button', { name: 'Corregir', exact: true }).click(); const editor = await editorReady(page);
    await editor.getByRole('button', { name: 'Registrar compra', exact: true }).click(); await editor.getByText('Ingresá el motivo de la corrección.', { exact: true }).waitFor();
    await editor.getByLabel('Motivo de corrección *', { exact: true }).fill('Corrección QA comprobada');
    await editor.getByLabel('Descripción *', { exact: true }).first().fill(`Compra QA Reemplazo ${prefix}`);
    await editor.getByRole('button', { name: 'Registrar compra', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await row(`Compra QA Reemplazo ${prefix}`).waitFor();
    const write = await page.evaluate(() => window.qa.writes.at(-1)); assert.equal(write.replacesPurchaseId, original.id); assert.equal(write.expectedVersion, original.version); assert.equal(write.correctionReason, 'Corrección QA comprobada');
    await row(originalDescription).getByRole('cell', { name: 'Anulada', exact: true }).waitFor();
   });
   await check(`${prefix}: anular exige motivo y conserva registro e ítems`, async () => {
    await row(description).getByRole('button', { name: 'Anular', exact: true }).click(); const editor = await editorReady(page);
    assert.equal(await editor.getByRole('button', { name: 'Confirmar anulación', exact: true }).isDisabled(), true);
    await editor.getByLabel('Motivo obligatorio', { exact: true }).fill('Corrección QA ficticia'); await screenshot(`${prefix}-void-reason`);
    await page.evaluate(() => { window.qa.holdWrites = true; }); await clickTwice(editor.getByRole('button', { name: 'Confirmar anulación', exact: true }));
    await page.waitForFunction(() => window.qa.voidCalls > 0); assert.equal(await page.evaluate(() => window.qa.voidCalls), 1);
    await releaseWrites(page); await editor.waitFor({ state: 'hidden' }); await row(description).getByRole('cell', { name: 'Anulada', exact: true }).waitFor();
    const saved = await page.evaluate((text) => window.qa.purchases.find((p) => p.insumo === text), description); assert.equal(saved.items.length, 2); assert.equal(saved.voidReason, 'Corrección QA ficticia'); assert.equal(saved.version, 2);
   });
   await check(`${prefix}: anulación rechazada deja compra activa y permite revisar motivo`, async () => {
    await page.evaluate(() => { window.qa.response = 'rejected'; }); await row('Compra QA Ficticia Inicial').getByRole('button', { name: 'Anular', exact: true }).click(); const editor = await editorReady(page);
    await editor.getByLabel('Motivo obligatorio', { exact: true }).fill('No se debe guardar'); await editor.getByRole('button', { name: 'Confirmar anulación', exact: true }).click();
    await page.getByText('QA ficticio: el stock consumido impide anular.', { exact: true }).waitFor();
    // The toast can render before React finishes the async transition. Filling
    // auto-waits for editability and proves the rejected draft can be corrected.
    await editor.getByLabel('Motivo obligatorio', { exact: true }).fill('Motivo revisado sin enviar');
    assert.equal(await editor.getByLabel('Motivo obligatorio', { exact: true }).isDisabled(), false);
    assert.equal(await editor.getByLabel('Motivo obligatorio', { exact: true }).inputValue(), 'Motivo revisado sin enviar');
    assert.equal(await page.evaluate(() => window.qa.purchases.find((p) => p.insumo === 'Compra QA Ficticia Inicial').status), 'active');
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await page.evaluate(() => { window.qa.response = 'success'; });
   });
   await check(`${prefix}: referencia de texto y resumen sin renglones ni cantidades ficticias`, async () => {
    let editor = await openNew();
    await editor.getByLabel('Sucursal *', { exact: true }).selectOption({ label: 'Sucursal QA Ficticia' });
    await editor.getByLabel('Proveedor *', { exact: true }).selectOption({ label: 'Proveedor QA Ficticio' });
    await editor.getByLabel('Tipo de compra', { exact: true }).selectOption('summary');
    await editor.getByLabel('Importe total *', { exact: true }).fill('45,67');
    await editor.getByLabel('Referencia de comprobante (opcional)', { exact: true }).fill('Resumen QA 456');
    await editor.getByText('Referencia de texto, como un número de ticket. No adjunta ni sube archivos.', { exact: true }).waitFor();
    assert.equal(await editor.locator('input[type=file]').count(), 0);
    assert.equal(await editor.getByLabel('Cantidad *', { exact: true }).count(), 0);
    await editor.getByRole('button', { name: 'Registrar compra', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
    await row('Compra resumida').waitFor();
    const saved = await page.evaluate(() => window.qa.purchases.find(p => p.insumo === 'Compra resumida'));
    assert.equal(saved.monto, 45.67); assert.equal(saved.receiptReference, 'Resumen QA 456'); assert.deepEqual(saved.items, []);
    await row('Compra resumida').getByRole('button', { name: 'Corregir', exact: true }).click(); editor = await editorReady(page);
    assert.equal(await editor.getByLabel('Tipo de compra', { exact: true }).inputValue(), 'summary');
    assert.equal(await editor.getByLabel('Importe total *', { exact: true }).inputValue(), '45.67');
    assert.equal(await editor.getByLabel('Referencia de comprobante (opcional)', { exact: true }).inputValue(), 'Resumen QA 456');
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click(); await editor.waitFor({ state: 'hidden' });
   });
   await check(`${prefix}: intento v1 sin kind sobrevive rechazo y reintenta sin duplicar`, async () => {
    const legacy = await page.evaluate(() => {
     const input = { requestId: '33333333-3333-4333-8333-333333333398', branchId: '33333333-3333-4333-8333-333333333321', supplierId: '33333333-3333-4333-8333-333333333341', purchasedAt: '2026-10-09', paymentMethod: 'Efectivo', description: 'Compra QA anterior a actualización', qty: 2, unit: 'kg', unitPrice: 100 };
     window.qa.receipts[input.requestId] = { id: input.requestId, input: structuredClone(input) };
     window.qa.purchases.push({ ...window.qa.purchases[0], id: input.requestId, insumo: input.description, monto: 200, status: 'active', version: 1, source: 'manual', items: [{ description: input.description, qty: 2, unit: 'kg', unitPrice: 100 }] });
     sessionStorage.setItem('gastropilot:purchase-attempt:qa-ficticio:user:business', JSON.stringify({ key: input.requestId, input }));
     window.qa.response = 'rejected';return input;
    });
    let editor = await openNew();
    await editor.getByRole('button', { name: 'Verificar el mismo intento', exact: true }).click();
    await editor.getByText(/Este rechazo no descarta que el intento anterior/).waitFor();
    assert.equal(await editor.getByLabel('Descripción *', { exact: true }).isDisabled(), true);
    const journal = await page.evaluate(() => JSON.parse(sessionStorage.getItem('gastropilot:purchase-attempt:qa-ficticio:user:business')));
    assert.deepEqual(journal.input, legacy);assert.equal(Object.hasOwn(journal.input, 'kind'), false);
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click(); await editor.waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.qa.response = 'success'; });editor = await openNew();
    await editor.getByRole('button', { name: 'Verificar el mismo intento', exact: true }).click();await editor.waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(id => window.qa.purchases.filter(p => p.id === id).length, legacy.requestId), 1);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('gastropilot:purchase-attempt:qa-ficticio:user:business')), null);
   });
   await check(`${prefix}: lectura fallida no muestra compras de ejemplo`, async () => {
    await page.evaluate(() => { window.qa.failLoad = true; });
    // A successful mutation refreshes the list, exercising the real error path.
    const editor = await fillNew(`Compra QA ReadError ${prefix}`); await editor.getByRole('button', { name: 'Registrar compra', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
    await page.getByText('QA ficticio: lectura de compras no disponible.', { exact: true }).waitFor(); assert.equal(await page.getByRole('row').count(), 0);
    await page.evaluate(() => { window.qa.failLoad = false; }); await page.getByRole('button', { name: 'Reintentar', exact: true }).click(); await row(`Compra QA ReadError ${prefix}`).waitFor(); await noOverflow(page);
   });
  }
 }
});
