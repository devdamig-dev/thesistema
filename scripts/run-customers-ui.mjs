// Real CustomersClient, fictitious in-memory server actions. No live services.
import { assert, clickTwice, editorReady, fixturePath, noOverflow, releaseWrites, root, runUiHarness, viewports } from './ui-fixtures/harness.mjs';
const actions = fixturePath('customers-actions.mjs');
await runUiHarness({
  name: 'customers',
  actionModules: { '@/app/actions/customers-page': actions, '@/app/actions/customers': actions, '@/app/actions/customer-history': actions },
  entry: `import React from 'react';import {createRoot} from 'react-dom/client';import {CustomersClient} from '${root}/app/clientes/customers-client.tsx';import {initialCustomers} from '${actions}';createRoot(document.getElementById('root')).render(<CustomersClient databaseMode={true} initial={initialCustomers()}/>);`,
  async run({ page, origin, check, screenshot }) {
    for (const viewport of viewports) {
      const prefix = viewport.name;
      const newName = `Cliente QA Ficticio Alta ${prefix}`;
      const editedName = `${newName} Editado`;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(origin);
      await page.getByRole('heading', { name: 'Clientes del negocio' }).waitFor();
      await check(`${prefix}: directorio sin overflow`, () => noOverflow(page));
      await screenshot(`${prefix}-directory`);
      await check(`${prefix}: related sales history shows factual linked records`, async () => {
        await page.getByRole('button', { name: 'Historial de ventas de Cliente QA Ficticio Inicial', exact: true }).click();
        const dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByText('2 × Producto QA vinculado', { exact: true }).waitFor();
        await dialog.getByText('25.000,25 · Activa', { exact: true }).waitFor();
        await noOverflow(page); await screenshot(`${prefix}-related-sales`);
        await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
      });

      await check(`${prefix}: closed history cannot overwrite a newer empty customer view`, async () => {
        await page.evaluate(() => { window.qa.holdWrites = true; });
        await page.getByRole('button', { name: 'Historial de ventas de Cliente QA Ficticio Inicial', exact: true }).click();
        let dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByText('Cargando historial…', { exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.evaluate(() => { window.qa.holdWrites = false; });
        await page.getByLabel('Estado', { exact: true }).selectOption('all');
        await page.getByRole('button', { name: 'Historial de ventas de Cliente QA Ficticio Archivado', exact: true }).click();
        dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByText('No hay ventas vinculadas a este cliente en las sucursales permitidas.', { exact: true }).waitFor();
        await releaseWrites(page);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(await dialog.getByText('2 × Producto QA vinculado', { exact: true }).count(), 0);
        await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.getByLabel('Estado', { exact: true }).selectOption('active');
      });
      await check(`${prefix}: history read failures are explicit and reopening retries`, async () => {
        await page.evaluate(() => { window.qa.failHistory = true; });
        await page.getByRole('button', { name: 'Historial de ventas de Cliente QA Ficticio Inicial', exact: true }).click();
        let dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByRole('alert').filter({ hasText: 'historial no disponible' }).waitFor();
        await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.evaluate(() => { window.qa.failHistory = false; });
        await page.getByRole('button', { name: 'Historial de ventas de Cliente QA Ficticio Inicial', exact: true }).click();
        dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByText('2 × Producto QA vinculado', { exact: true }).waitFor();
        await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.qa.saveCalls), 0);
      });


      await check(`${prefix}: cancelar descarta el borrador y reabrir parte vacío`, async () => {
        await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
        const dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByLabel('Nombre *', { exact: true }).fill('Cliente QA Ficticio Descartado');
        await dialog.getByLabel('Notas', { exact: true }).fill('Borrador ficticio que debe descartarse.');
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.qa.saveCalls), 0);
        await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).click();
        await editorReady(page, 'dialog[open]');
        assert.equal(await page.getByRole('dialog').getByLabel('Nombre *', { exact: true }).inputValue(), '');
        assert.equal(await page.getByRole('dialog').getByLabel('Notas', { exact: true }).inputValue(), '');
      });

      await check(`${prefix}: alta con contactos ficticios y doble activación guardada una sola vez`, async () => {
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Nombre *', { exact: true }).fill(newName);
        await dialog.getByLabel('Email', { exact: true }).fill('alta.qa@example.invalid');
        await dialog.getByLabel('Canal de contacto').fill('Prueba QA ficticia');
        await dialog.getByLabel('Notas', { exact: true }).fill('Sólo fixture local.\nSegunda línea ficticia.');
        await screenshot(`${prefix}-new-editor`);
        await page.evaluate(() => { window.qa.holdWrites = true; });
        await clickTwice(dialog.getByRole('button', { name: 'Guardar cliente', exact: true }));
        await page.waitForFunction(() => window.qa.saveCalls === 1);
        assert.equal(await dialog.getByRole('button', { name: 'Guardar cliente' }).isDisabled(), true);
        assert.equal(await dialog.getByRole('button', { name: 'Cancelar' }).isDisabled(), true);
        assert.equal(await dialog.getByRole('button', { name: 'Cerrar', exact: true }).isDisabled(), true);
        await page.keyboard.press('Escape');
        assert.equal(await dialog.isVisible(), true);
        await releaseWrites(page);
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: `Editar ${newName}`, exact: true }).waitFor();
        const state = await page.evaluate(() => ({ saveCalls: window.qa.saveCalls, customers: window.qa.customers, writes: window.qa.writes }));
        assert.equal(state.saveCalls, 1);
        assert.equal(state.customers.filter((row) => row.name === newName).length, 1);
        assert.equal(state.writes[0].id, null);
      });

      await check(`${prefix}: editar mantiene ID y envía la versión vigente`, async () => {
        const before = await page.evaluate((name) => window.qa.customers.find((row) => row.name === name), newName);
        await page.getByRole('button', { name: `Editar ${newName}`, exact: true }).click();
        const dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByLabel('Nombre *', { exact: true }).fill(editedName);
        await dialog.getByRole('button', { name: 'Guardar cliente', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: `Editar ${editedName}`, exact: true }).waitFor();
        const write = await page.evaluate(() => window.qa.writes.at(-1));
        assert.equal(write.id, before.id);
        assert.equal(write.expectedUpdatedAt, before.updatedAt);
      });

      await check(`${prefix}: archivar conserva el registro y restaurar lo devuelve a activos`, async () => {
        await page.getByRole('button', { name: `Archivar ${editedName}`, exact: true }).click();
        const dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByRole('button', { name: 'Archivar', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: `Editar ${editedName}`, exact: true }).waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate((name) => window.qa.customers.find((row) => row.name === name)?.active, editedName), false);
        await page.getByLabel('Estado', { exact: true }).selectOption('archived');
        await page.getByRole('button', { name: `Restaurar ${editedName}`, exact: true }).click();
        await editorReady(page, 'dialog[open]');
        await page.getByRole('dialog').getByRole('button', { name: 'Restaurar', exact: true }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
        await page.getByLabel('Estado', { exact: true }).selectOption('active');
        await page.getByRole('button', { name: `Editar ${editedName}`, exact: true }).waitFor();
        assert.equal(await page.evaluate((name) => window.qa.customers.filter((row) => row.name === name && row.active).length, editedName), 1);
      });

      await check(`${prefix}: resultado incierto bloquea reenvío y cerrar verifica lo guardado`, async () => {
        await page.evaluate(() => { window.qa.response = 'uncertain'; });
        await page.getByRole('button', { name: `Editar ${editedName}`, exact: true }).click();
        const dialog = await editorReady(page, 'dialog[open]');
        await dialog.getByLabel('Notas', { exact: true }).fill('QA ficticio: guardado con respuesta incierta.');
        const calls = await page.evaluate(() => window.qa.saveCalls);
        await dialog.getByRole('button', { name: 'Guardar cliente', exact: true }).click();
        await dialog.getByText('QA ficticio: respuesta incierta, verificá el resultado.', { exact: true }).waitFor();
        assert.equal(await dialog.getByRole('button', { name: 'Guardar cliente', exact: true }).isDisabled(), true);
        assert.equal(await dialog.getByLabel('Nombre *', { exact: true }).isDisabled(), true);
        await clickTwice(dialog.getByRole('button', { name: 'Guardar cliente', exact: true }));
        assert.equal(await page.evaluate(() => window.qa.saveCalls), calls + 1);
        await screenshot(`${prefix}-uncertain`);
        const reads = await page.evaluate(() => window.qa.readCalls);
        await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction((count) => window.qa.readCalls > count, reads);
        await page.getByRole('button', { name: `Editar ${editedName}`, exact: true }).click();
        await editorReady(page, 'dialog[open]');
        assert.equal(await page.getByRole('dialog').getByLabel('Notas', { exact: true }).inputValue(), 'QA ficticio: guardado con respuesta incierta.');
        await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
        await page.getByRole('dialog').waitFor({ state: 'hidden' });
      });

      await check(`${prefix}: lectura permite buscar/filtrar y oculta mutaciones`, async () => {
        await page.goto(`${origin}/?readonly=1`);
        await page.getByText('Solo lectura', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Nuevo cliente', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: /^(Editar|Archivar|Restaurar) / }).count(), 0);
        await page.getByLabel('Buscar en la lista').fill('Archivado');
        await page.getByLabel('Estado', { exact: true }).selectOption('archived');
        await page.getByText('Cliente QA Ficticio Archivado', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.qa.saveCalls), 0);
        await screenshot(`${prefix}-read-only`);
      });
    }
  },
});
