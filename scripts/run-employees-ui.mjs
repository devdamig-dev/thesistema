import { assert, clickTwice, editorReady, fixturePath, noOverflow, releaseWrites, root, runUiHarness, viewports } from './ui-fixtures/harness.mjs';
const actions = fixturePath('employees-actions.mjs');
await runUiHarness({
 name: 'employees', actionModules: { '@/app/actions/employees-page': actions, '@/app/actions/exports': actions },
 entry: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${root}/app/empleados/page.tsx';import {ToastProvider} from '${root}/components/ui/toast.tsx';createRoot(document.getElementById('root')).render(<ToastProvider><Page/></ToastProvider>);`,
 async run({ page, origin, check, screenshot }) {
  const card = (name) => page.locator('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const storage = 'thesistema:employee-create:v1:qa-ficticio:user:business';
  async function fillNew(name) {
   await page.getByRole('button', { name: 'Agregar empleado', exact: true }).click(); const editor = await editorReady(page);
   await editor.getByLabel('Nombre completo *', { exact: true }).fill(name);
   await editor.getByLabel('Rol operativo *', { exact: true }).fill('Cocinero QA');
   await editor.getByLabel('Sucursal *', { exact: true }).selectOption({ label: 'Sucursal QA Ficticia' });
   await editor.getByLabel('Horas del mes', { exact: true }).fill('170.5');
   await editor.getByLabel('Costo del mes (ARS)', { exact: true }).fill('700000.25');
   await editor.getByLabel('Adelantos pendientes (ARS)', { exact: true }).fill('10000');
   return editor;
  }
  for (const viewport of viewports) {
   const prefix = viewport.name; const name = `Empleado QA Ficticio Alta ${prefix}`; const edited = `${name} Editado`;
   await page.setViewportSize({ width: viewport.width, height: viewport.height }); await page.goto(origin);
   await page.getByRole('button', { name: 'Agregar empleado', exact: true }).waitFor();
   await check(`${prefix}: lista, filtros e indicadores sin overflow`, async () => { await noOverflow(page); assert.equal(await page.getByLabel('Estado', { exact: true }).count(), 1); assert.equal(await page.getByLabel('Sucursal', { exact: true }).count(), 1); });
   await screenshot(`${prefix}-directory`);
   await check(`${prefix}: cerrar un formulario sin enviar no crea empleado`, async () => {
    const editor = await fillNew('Descartado QA'); await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click(); await editor.waitFor({ state: 'hidden' }); assert.equal(await page.evaluate(() => window.qa.createCalls), 0);
   });
   await check(`${prefix}: alta completa, doble clic y cierre bloqueado`, async () => {
    const editor = await fillNew(name); await screenshot(`${prefix}-new-editor`); await page.evaluate(() => { window.qa.holdWrites = true; });
    await clickTwice(editor.getByRole('button', { name: 'Guardar empleado', exact: true })); await page.waitForFunction(() => window.qa.createCalls === 1);
    assert.equal(await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().isDisabled(), true);
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).first().click(); assert.equal(await editor.isVisible(), true);
    await releaseWrites(page); await editor.waitFor({ state: 'hidden' }); await card(name).waitFor();
    const saved = await page.evaluate((n) => window.qa.employees.find((r) => r.fullName === n), name);
    assert.equal(saved.monthlyHours, 170.5); assert.equal(saved.monthlyCost, 700000.25); assert.equal(await page.evaluate((k) => sessionStorage.getItem(k), storage), null);
   });
   await check(`${prefix}: edición conserva ID y token CAS`, async () => {
    const before = await page.evaluate((n) => window.qa.employees.find((r) => r.fullName === n), name);
    await card(name).getByRole('button', { name: 'Editar', exact: true }).click(); const editor = await editorReady(page);
    await editor.getByLabel('Nombre completo *', { exact: true }).fill(edited); await editor.getByLabel('Faltas', { exact: true }).fill('2');
    await editor.getByRole('button', { name: 'Guardar empleado', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await card(edited).waitFor();
    const write = await page.evaluate(() => window.qa.writes.at(-1)); assert.equal(write.id, before.id); assert.equal(write.expectedUpdatedAt, before.updatedAt);
   });
   await check(`${prefix}: archivar y restaurar conserva adelantos y registro`, async () => {
    await card(edited).getByRole('button', { name: 'Archivar', exact: true }).click(); let editor = await editorReady(page);
    await editor.getByRole('button', { name: 'Confirmar archivo', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await card(edited).waitFor({ state: 'hidden' });
    await page.getByLabel('Estado', { exact: true }).selectOption('archived'); await card(edited).waitFor();
    assert.equal(await page.evaluate((n) => window.qa.employees.find((r) => r.fullName === n).pendingAdvance, edited), 10000);
    await screenshot(`${prefix}-archived`); await card(edited).getByRole('button', { name: 'Restaurar', exact: true }).click(); editor = await editorReady(page);
    await editor.getByRole('button', { name: 'Confirmar restauración', exact: true }).click(); await editor.waitFor({ state: 'hidden' });
    await page.getByLabel('Estado', { exact: true }).selectOption('active'); await card(edited).waitFor();
   });
   await check(`${prefix}: alta incierta se retoma sin duplicar al cerrar y reabrir`, async () => {
    await page.evaluate(() => { window.qa.response = 'throw-after-commit'; }); const uncertainName = `Empleado QA Incierto ${prefix}`; let editor = await fillNew(uncertainName);
    const before = await page.evaluate(() => window.qa.createCalls); await editor.getByRole('button', { name: 'Guardar empleado', exact: true }).click();
    await editor.getByText('La conexión se interrumpió. Verificá si el empleado se guardó antes de continuar.', { exact: true }).waitFor();
    assert.equal(await editor.getByLabel('Nombre completo *', { exact: true }).isDisabled(), true); await screenshot(`${prefix}-uncertain`);
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click(); await editor.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Agregar empleado', exact: true }).click(); editor = await editorReady(page);
    await editor.getByRole('button', { name: 'Verificar resultado', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await card(uncertainName).waitFor();
    assert.equal(await page.evaluate(() => window.qa.createCalls), before + 1); assert.equal(await page.evaluate((n) => window.qa.employees.filter((r) => r.fullName === n).length, uncertainName), 1);
    await page.evaluate(() => { window.qa.response = 'success'; });
   });
   await check(`${prefix}: resultado ausente permite solo reenviar el mismo UUID`, async () => {
    await page.evaluate(() => { window.qa.response = 'uncertain-before'; }); const retryName = `Empleado QA Reintento ${prefix}`; const editor = await fillNew(retryName);
    await editor.getByRole('button', { name: 'Guardar empleado', exact: true }).click(); await editor.getByRole('button', { name: 'Verificar resultado', exact: true }).click();
    await editor.getByRole('button', { name: 'Reenviar el mismo intento', exact: true }).waitFor(); const id = await page.evaluate((k) => JSON.parse(sessionStorage.getItem(k)).id, storage);
    await page.evaluate(() => { window.qa.response = 'success'; }); await editor.getByRole('button', { name: 'Reenviar el mismo intento', exact: true }).click(); await editor.waitFor({ state: 'hidden' }); await card(retryName).waitFor();
    assert.equal(await page.evaluate((n) => window.qa.employees.find((r) => r.fullName === n).id, retryName), id);
   });
   await check(`${prefix}: conflicto de edición exige recargar y no pisa cambios externos`, async () => {
    await card(edited).getByRole('button', { name: 'Editar', exact: true }).click(); const editor = await editorReady(page);
    await page.evaluate((n) => { const r = window.qa.employees.find((r) => r.fullName === n); r.updatedAt = '2026-10-10T00:00:00.000Z'; r.role = 'Cambio externo QA'; }, edited);
    await editor.getByLabel('Rol operativo *', { exact: true }).fill('No debe sobrescribir'); await editor.getByRole('button', { name: 'Guardar empleado', exact: true }).click();
    await editor.getByText('QA ficticio: versión desactualizada.', { exact: true }).waitFor(); assert.equal(await editor.getByRole('button', { name: 'Guardar empleado', exact: true }).count(), 0);
    await editor.getByRole('button', { name: 'Recargar datos guardados', exact: true }).click(); assert.equal(await editor.getByLabel('Rol operativo *', { exact: true }).inputValue(), 'Cambio externo QA');
    await editor.getByRole('button', { name: 'Cerrar', exact: true }).last().click(); await editor.waitFor({ state: 'hidden' });
   });
   await check(`${prefix}: archivo incierto se verifica antes de cualquier repetición`, async () => {
    await page.evaluate(() => { window.qa.response = 'uncertain'; }); await card(edited).getByRole('button', { name: 'Archivar', exact: true }).click(); const editor = await editorReady(page);
    // Refresh the stale list entry once before trying: this also tests archive CAS.
    await editor.getByRole('button', { name: 'Confirmar archivo', exact: true }).click(); await editor.getByRole('button', { name: 'Verificar estado', exact: true }).click();
    if (await editor.isVisible()) {
      await editor.getByRole('button', { name: 'Confirmar archivo', exact: true }).click(); await editor.getByRole('button', { name: 'Verificar estado', exact: true }).click();
    }
    await editor.waitFor({ state: 'hidden' }); assert.equal(await page.evaluate((n) => window.qa.employees.find((r) => r.fullName === n).active, edited), false);
    await page.evaluate(() => { window.qa.response = 'success'; });
   });
   await check(`${prefix}: error de lectura muestra bloqueo sin filas demo`, async () => {
    await page.evaluate(() => { window.qa.failLoad = true; }); await page.getByRole('button', { name: 'Actualizar', exact: true }).click();
    await page.getByText('QA ficticio: no pudimos cargar el equipo.', { exact: true }).waitFor(); assert.equal(await page.locator('article').count(), 0); assert.equal(await page.getByRole('button', { name: 'Agregar empleado', exact: true }).count(), 0);
    await page.evaluate(() => { window.qa.failLoad = false; }); await page.getByRole('button', { name: 'Actualizar', exact: true }).click(); await page.getByRole('button', { name: 'Agregar empleado', exact: true }).waitFor();
   });
   await check(`${prefix}: usuarios de lectura no reciben controles de gestión`, async () => {
    await page.goto(`${origin}/?readonly=1`); await card('Empleado QA Ficticio Inicial').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Agregar empleado', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: 'Editar', exact: true }).count(), 0); assert.equal(await page.getByRole('button', { name: 'Archivar', exact: true }).count(), 0); await noOverflow(page);
   });
  }
 }
});
