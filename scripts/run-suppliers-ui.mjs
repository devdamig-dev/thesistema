// Real suppliers page + SupplierForm, fictitious actions and isolated sessionStorage.
import { assert, clickTwice, editorReady, fixturePath, noOverflow, releaseWrites, root, runUiHarness, viewports } from './ui-fixtures/harness.mjs';
const actions = fixturePath('suppliers-actions.mjs');
await runUiHarness({
  name: 'suppliers',
  actionModules: { '@/app/actions/suppliers-page': actions },
  entry: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${root}/app/compras/proveedores/page.tsx';import {ToastProvider} from '${root}/components/ui/toast.tsx';createRoot(document.getElementById('root')).render(<ToastProvider><Page/></ToastProvider>);`,
  async run({ page, origin, check, screenshot }) {
    const card = (name) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    for (const viewport of viewports) {
      const prefix = viewport.name;
      const newName = `Proveedor QA Ficticio Alta ${prefix}`;
      const editedName = `${newName} Editado`;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(origin);
      await page.getByRole('button', { name: 'Nuevo proveedor', exact: true }).waitFor();
      await check(`${prefix}: directorio sin overflow y filtro de estado accesible`, async () => {
        assert.equal(await page.getByRole('combobox', { name: 'Estado', exact: true }).count(), 1);
        await noOverflow(page);
      });
      await screenshot(`${prefix}-directory`);

      await check(`${prefix}: cerrar descarta un borrador aún no enviado`, async () => {
        await page.getByRole('button', { name: 'Nuevo proveedor', exact: true }).click();
        const editor = await editorReady(page);
        await editor.getByLabel('Nombre *', { exact: true }).fill('Proveedor QA Ficticio Descartado');
        await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
        await page.locator('aside').waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate(() => window.qa.createCalls), 0);
        await page.getByRole('button', { name: 'Nuevo proveedor', exact: true }).click();
        await editorReady(page);
        assert.equal(await page.locator('aside').getByLabel('Nombre *', { exact: true }).inputValue(), '');
      });

      await check(`${prefix}: alta estable, doble activación y cierre bloqueado mientras guarda`, async () => {
        const editor = page.locator('aside');
        await editor.getByLabel('Nombre *', { exact: true }).fill(newName);
        await editor.getByLabel('Email', { exact: true }).fill('alta.proveedor.qa@example.invalid');
        await editor.getByLabel('Categoría', { exact: true }).fill('Fixture QA ficticio');
        await editor.getByLabel('Condiciones de pago', { exact: true }).fill('Condiciones QA ficticias, sin compromiso comercial.');
        await screenshot(`${prefix}-new-editor`);
        await page.evaluate(() => { window.qa.holdWrites = true; });
        await clickTwice(editor.getByRole('button', { name: 'Guardar proveedor', exact: true }));
        await page.waitForFunction(() => window.qa.createCalls === 1);
        // Creation has an identified attempt: the form removes Save while pending.
        assert.equal(await editor.getByRole('button', { name: 'Guardar proveedor', exact: true }).count(), 0);
        assert.equal(await editor.getByRole('button', { name: 'Verificar resultado', exact: true }).isDisabled(), true);
        assert.equal(await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().isDisabled(), true);
        await editor.getByRole('button', { name: 'Cerrar', exact: true }).first().click();
        assert.equal(await editor.isVisible(), true);
        await releaseWrites(page);
        await editor.waitFor({ state: 'hidden' });
        await card(newName).waitFor();
        assert.equal(await page.evaluate(() => window.qa.createCalls), 1);
        assert.equal(await page.evaluate((name) => window.qa.suppliers.filter((row) => row.name === name).length, newName), 1);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('thesistema:supplier-create:v1:qa-ficticio:user:business')), null);
      });

      await check(`${prefix}: editar conserva ID y control de versión`, async () => {
        const before = await page.evaluate((name) => window.qa.suppliers.find((row) => row.name === name), newName);
        await card(newName).getByRole('button', { name: 'Editar', exact: true }).click();
        const editor = await editorReady(page);
        await editor.getByLabel('Nombre *', { exact: true }).fill(editedName);
        await editor.getByRole('button', { name: 'Guardar proveedor', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await card(editedName).waitFor();
        const write = await page.evaluate(() => window.qa.writes.at(-1));
        assert.equal(write.id, before.id);
        assert.equal(write.expectedUpdatedAt, before.updated_at);
      });

      await check(`${prefix}: archivar/restaurar conserva proveedor e historial`, async () => {
        await card(editedName).getByRole('button', { name: 'Archivar', exact: true }).click();
        let editor = await editorReady(page);
        await editor.getByRole('button', { name: 'Confirmar archivo', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await card(editedName).waitFor({ state: 'hidden' });
        assert.equal(await page.evaluate((name) => window.qa.suppliers.find((row) => row.name === name)?.active, editedName), false);
        await page.getByLabel('Estado', { exact: true }).selectOption('archived');
        await card(editedName).getByRole('button', { name: 'Compras e insumos', exact: true }).click();
        editor = await editorReady(page);
        await editor.getByText('2 kg · Insumo QA Ficticio', { exact: true }).waitFor();
        await screenshot(`${prefix}-archived-history`);
        await editor.getByRole('button', { name: 'Cerrar', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await card(editedName).getByRole('button', { name: 'Restaurar', exact: true }).click();
        editor = await editorReady(page);
        await editor.getByRole('button', { name: 'Confirmar restauración', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await page.getByLabel('Estado', { exact: true }).selectOption('active');
        await card(editedName).waitFor();
        assert.equal(await page.evaluate((name) => window.qa.suppliers.filter((row) => row.name === name && row.active).length, editedName), 1);
      });

      await check(`${prefix}: alta incierta se recupera al reabrir con el mismo identificador`, async () => {
        const uncertainName = `Proveedor QA Ficticio Incierto ${prefix}`;
        await page.evaluate(() => { window.qa.response = 'uncertain'; });
        await page.getByRole('button', { name: 'Nuevo proveedor', exact: true }).click();
        let editor = await editorReady(page);
        await editor.getByLabel('Nombre *', { exact: true }).fill(uncertainName);
        const before = await page.evaluate(() => window.qa.createCalls);
        await editor.getByRole('button', { name: 'Guardar proveedor', exact: true }).click();
        await editor.getByText('QA ficticio: respuesta incierta; verificá lo guardado.', { exact: true }).waitFor();
        await editor.getByRole('button', { name: 'Verificar resultado', exact: true }).waitFor();
        assert.equal(await editor.getByLabel('Nombre *', { exact: true }).isDisabled(), true);
        assert.equal(await editor.getByRole('button', { name: 'Guardar proveedor', exact: true }).count(), 0);
        const attempt = await page.evaluate(() => JSON.parse(sessionStorage.getItem('thesistema:supplier-create:v1:qa-ficticio:user:business')));
        await editor.getByRole('button', { name: 'Verificar resultado', exact: true }).scrollIntoViewIfNeeded();
        await screenshot(`${prefix}-uncertain`);
        await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click();
        await editor.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Nuevo proveedor', exact: true }).click();
        editor = await editorReady(page);
        await editor.getByText(/Hay un alta pendiente de confirmar/).waitFor();
        assert.equal(await editor.getByLabel('Nombre *', { exact: true }).inputValue(), uncertainName);
        await editor.getByRole('button', { name: 'Verificar resultado', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await card(uncertainName).waitFor();
        assert.equal(await page.evaluate(() => window.qa.createCalls), before + 1);
        assert.equal(await page.evaluate((id) => window.qa.suppliers.filter((row) => row.id === id).length, attempt.id), 1);
        assert.equal(await page.evaluate(() => sessionStorage.getItem('thesistema:supplier-create:v1:qa-ficticio:user:business')), null);
      });

      await check(`${prefix}: lectura oculta altas/cambios y conserva consulta de compras`, async () => {
        await page.goto(`${origin}/?readonly=1`);
        await page.getByText(/Acceso de lectura/).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Nuevo proveedor', exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: /^(Editar|Archivar|Restaurar)$/ }).count(), 0);
        await page.getByLabel('Estado', { exact: true }).selectOption('archived');
        await page.getByLabel('Buscar por nombre').fill('Archivado');
        await card('Proveedor QA Ficticio Archivado').getByRole('button', { name: 'Compras e insumos', exact: true }).click();
        const editor = await editorReady(page);
        await editor.getByText('2 kg · Insumo QA Ficticio', { exact: true }).waitFor();
        await screenshot(`${prefix}-read-only`);
        assert.equal(await page.evaluate(() => window.qa.createCalls + window.qa.updateCalls + window.qa.statusCalls), 0);
        await editor.getByRole('button', { name: 'Cerrar', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
      });
    }
  },
});
