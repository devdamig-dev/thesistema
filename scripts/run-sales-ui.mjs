import { assert, clickTwice, editorReady, fixturePath, noOverflow, releaseWrites, root, runUiHarness, viewports } from './ui-fixtures/harness.mjs';
const actions = fixturePath('sales-actions.mjs');
await runUiHarness({
  name: 'sales',
  actionModules: { '@/app/actions/sales': actions, '@/app/actions/sales-page': actions, '@/app/actions/exports': actions },
  entry: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${root}/app/ventas/database-sales.tsx';createRoot(document.getElementById('root')).render(<Page/>);`,
  async run({ page, origin, check, screenshot }) {
    const open = async () => { await page.getByRole('button', { name: 'Nueva venta', exact: true }).click(); return editorReady(page); };
    const fill = async (editor, description) => {
      await editor.getByLabel('Fecha y hora', { exact: true }).fill(await page.evaluate(() => new Intl.DateTimeFormat('sv-SE', { timeZone: window.qa.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() - 3600000)).replace(' ', 'T')));
      await editor.getByLabel('Sucursal', { exact: true }).selectOption({ label: 'Central QA ficticia' });
      await editor.getByLabel('Medio de pago', { exact: true }).fill('Transferencia');
      await editor.getByLabel('Concepto 1', { exact: true }).fill(description);
      await editor.getByLabel('Cantidad 1', { exact: true }).fill('2');
      await editor.getByLabel('Precio unitario 1', { exact: true }).fill('5.50');
    };
    const close = async (editor) => { await editor.getByRole('button', { name: /^(Cancelar|Cerrar y revisar)$/ }).click(); await editor.waitFor({ state: 'hidden' }); };
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(origin); await page.getByText('Registro histórico · detalle no informado', { exact: true }).waitFor();
      await check(`${viewport.name}: original values, legacy semantics and no overflow`, async () => {
        await noOverflow(page);
        await page.getByText('Moneda no informada.', { exact: false }).first().waitFor();
        const legacy = page.locator('tr').filter({ hasText: 'Registro histórico · detalle no informado' });
        assert.equal(await legacy.getByRole('button', { name: 'Editar', exact: true }).count(), 0);
        await legacy.getByRole('button', { name: 'Anular', exact: true }).waitFor();
      });
      await check(`${viewport.name}: detail exposes stored price, theoretical BOM and audit history`, async () => {
        const row = page.locator('tr').filter({ hasText: '2 × Producto QA ficticio' }).first();
        await row.getByRole('button', { name: 'Detalle', exact: true }).click(); const detail = await editorReady(page);
        await detail.getByText('2 × 12,50 = 25,00', { exact: true }).waitFor();
        await detail.getByText('Harina QA ficticia: 0.2 kg', { exact: true }).waitFor();
        await detail.getByText('Historial auditado', { exact: true }).waitFor();
        await detail.locator('summary').first().click(); await detail.getByText('Importe de esta versión: 25,00', { exact: true }).waitFor();
        await noOverflow(page); await screenshot(`${viewport.name}-detail-history`); await detail.getByRole('button', { name: 'Cerrar detalle', exact: true }).click(); await detail.waitFor({ state: 'hidden' });
      });
      await check(`${viewport.name}: cancel preserves zero writes and date is explicit`, async () => {
        const editor = await open(); assert.equal(await editor.getByLabel('Fecha y hora', { exact: true }).inputValue(), '');
        await fill(editor, 'Descartado QA ficticio'); await noOverflow(page); await screenshot(`${viewport.name}-new-sale`); await close(editor);
        assert.equal(await page.evaluate(() => window.qa.saveCalls), 0);
      });
      await check(`${viewport.name}: double click commits once, refreshes reports and protects close while saving`, async () => {
        const editor = await open(); await fill(editor, 'Venta nueva QA ficticia');
        await editor.getByRole('button', { name: 'Agregar ítem', exact: true }).click();
        await editor.getByLabel('Producto 2', { exact: true }).selectOption({ label: 'Producto QA ficticio' });
        await editor.getByLabel('Cliente (opcional)', { exact: true }).selectOption({ label: 'Cliente QA ficticio' });
        await page.evaluate(() => { window.qa.holdWrites = true; });
        await clickTwice(editor.getByRole('button', { name: 'Guardar venta', exact: true }));
        await page.waitForFunction(() => window.qa.saveCalls === 1);
        await editor.getByRole('button', { name: 'Cerrar', exact: true }).click(); assert.equal(await editor.isVisible(), true);
        await releaseWrites(page); await editor.waitFor({ state: 'hidden' });
        await page.locator('tr').filter({ hasText: 'Venta nueva QA ficticia' }).waitFor();
        assert.equal(await page.evaluate(() => window.qa.saveCalls), 1);
        assert.equal(await page.evaluate(() => window.qa.writes[0].input.items.length), 2);
        assert.ok(await page.evaluate(() => window.qa.reportReads) > 1);
      });
      await check(`${viewport.name}: edit and void retain row and require reason`, async () => {
        const row = page.locator('tr').filter({ hasText: 'Venta nueva QA ficticia' });
        await row.getByRole('button', { name: 'Editar', exact: true }).click(); const editor = await editorReady(page);
        await editor.getByLabel('Concepto 1', { exact: true }).fill('Venta editada QA ficticia');
        await editor.getByRole('button', { name: 'Guardar venta', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
        const edited = page.locator('tr').filter({ hasText: 'Venta editada QA ficticia' });
        await edited.getByRole('button', { name: 'Anular', exact: true }).click(); const voidEditor = await editorReady(page);
        assert.equal(await voidEditor.getByRole('button', { name: 'Confirmar anulación', exact: true }).isDisabled(), true);
        await voidEditor.getByLabel('Motivo obligatorio').fill('Corrección QA ficticia');
        await clickTwice(voidEditor.getByRole('button', { name: 'Confirmar anulación', exact: true })); await voidEditor.waitFor({ state: 'hidden' });
        await edited.getByText('Anulada', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.qa.voidCalls), 1);
      });
      await check(`${viewport.name}: unknown result freezes payload across close and replays exact attempt`, async () => {
        const editor = await open(); await fill(editor, 'Incierta QA ficticia');
        await page.evaluate(() => { window.qa.response = 'throw-after-commit'; });
        await editor.getByRole('button', { name: 'Guardar venta', exact: true }).click();
        await editor.getByText(/No pudimos confirmar el resultado/).waitFor();
        assert.equal(await editor.getByLabel('Concepto 1', { exact: true }).isDisabled(), true); await screenshot(`${viewport.name}-uncertain-sale`); await close(editor);
        assert.equal(await page.getByRole('button', { name: 'Nueva venta', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: 'Reintentar mismo intento', exact: true }).click();
        await page.getByText('Hay una operación pendiente de confirmar.', { exact: false }).waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.qa.sales.filter((row) => row.items.some((item) => item.description === 'Incierta QA ficticia')).length), 1);
        assert.deepEqual(await page.evaluate(() => window.qa.writes.at(-1).input), await page.evaluate(() => window.qa.writes.at(-2).input));
      });
      await check(`${viewport.name}: branch filter and error show no partial statistics`, async () => {
        await page.getByLabel('Filtrar por sucursal').selectOption({ label: 'Norte QA ficticia' });
        assert.equal(await page.locator('tr').filter({ hasText: 'Registro histórico · detalle no informado' }).count(), 0);
        await page.evaluate(() => { window.qa.reportMode = 'error'; });
        await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
        await page.getByText('QA ficticio: informe incompleto.', { exact: true }).waitFor();
        assert.equal(await page.getByText('Promedio de tickets detallados', { exact: true }).count(), 0);
      });
      await check(`${viewport.name}: changed authenticated context aborts the old draft`, async () => {
        await page.evaluate(() => { window.qa.reportMode = 'success'; });
        const editor = await open(); await fill(editor, 'Borrador de sesión anterior');
        await page.evaluate(() => { window.qa.userId = crypto.randomUUID(); window.dispatchEvent(new Event('focus')); });
        await editor.waitFor({ state: 'hidden' });
        const newEditor = await open(); assert.equal(await newEditor.getByLabel('Concepto 1', { exact: true }).inputValue(), ''); await close(newEditor);
      });
      await screenshot(`${viewport.name}-sales`);
      await check(`${viewport.name}: readonly keeps records but blocks new writes`, async () => {
        await page.goto(`${origin}/?readonly=1`); await page.getByText(/Tu rol permite consultar ventas/).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Nueva venta', exact: true }).isDisabled(), true);
        assert.equal(await page.evaluate(() => window.qa.saveCalls), 0);
      });
    }
  },
});
