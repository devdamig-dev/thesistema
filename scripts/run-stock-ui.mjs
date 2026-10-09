// Real StockPage + Drawer, isolated fictitious stock and ledger actions.
import { assert, clickTwice, editorReady, fixturePath, noOverflow, releaseWrites, root, runUiHarness, viewports } from './ui-fixtures/harness.mjs';
const actions = fixturePath('stock-actions.mjs');
await runUiHarness({
  name: 'stock',
  actionModules: { '@/app/actions/stock-page': actions },
  entry: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${root}/app/stock/page.tsx';import {ToastProvider} from '${root}/components/ui/toast.tsx';createRoot(document.getElementById('root')).render(<ToastProvider><Page/></ToastProvider>);`,
  async run({ page, origin, check, screenshot }) {
    const open = async () => {
      await page.getByRole('button', { name: 'Movimiento manual', exact: true }).click();
      return editorReady(page);
    };
    const close = async () => {
      await page.locator('aside').getByRole('button', { name: 'Cancelar', exact: true }).click();
      await page.locator('aside').waitFor({ state: 'hidden' });
    };
    const historyRow = (reason) => page.locator('tr').filter({ has: page.getByText(reason, { exact: true }) });
    for (const viewport of viewports) {
      const prefix = viewport.name;
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(origin);
      await page.getByText('Ingreso QA ficticio inicial', { exact: true }).waitFor();
      await check(`${prefix}: stock e historial sin overflow de página`, () => noOverflow(page));
      await screenshot(`${prefix}-stock-history`);

      await check(`${prefix}: reposición real separa stock, consumo físico, recetas y compras sin pronóstico`, async () => {
        const branches = await page.evaluate(() => window.qa.branches);
        await page.getByLabel('Sucursal de reposición').selectOption(branches[0].id);
        await page.getByLabel('Reposición desde').fill('2026-10-01');
        await page.getByLabel('Reposición hasta').fill('2026-10-08');
        await page.evaluate(() => { window.qa.holdReplenishment = true; });
        await clickTwice(page.getByRole('button', { name: 'Consultar reposición', exact: true }));
        await page.waitForFunction(() => window.qa.replenishmentQueries.length === 1);
        assert.equal(await page.getByRole('button', { name: 'Consultar reposición', exact: true }).isDisabled(), true);
        await page.evaluate(() => window.qa.releaseReplenishment());
        const report = page.getByLabel('Informe de reposición');
        await report.waitFor();
        await report.locator('summary').click();
        await report.getByText(/Actual: 20 kg. Mínimo: 5 kg/).waitFor();
        await report.getByText(/Salidas registradas: 3 kg. Mermas: 0,25 kg. Ajustes netos: -0,5 kg/).waitFor();
        await report.getByText(/Pizza QA Ficticia: 10 vendidos → 2 kg teóricos/).waitFor();
        await report.getByText(/Entrega QA ficticia, 5 kg. Compra 88888888/).waitFor();
        await report.getByText(/no predice cuándo se agotará/).waitFor();
        assert.deepEqual(await page.evaluate(() => window.qa.replenishmentQueries[0]), { branchId: branches[0].id, from: '2026-10-01', to: '2026-10-08' });
        await noOverflow(page); await screenshot(`${prefix}-replenishment`);
      });
      await check(`${prefix}: reposición descarta consultas obsoletas, admite vacío, limpieza y recuperación de error`, async () => {
        const branches = await page.evaluate(() => window.qa.branches);
        await page.getByRole('button', { name: 'Limpiar consulta', exact: true }).click();
        await page.evaluate(() => { window.qa.holdReplenishment = true; });
        await page.getByRole('button', { name: 'Consultar reposición', exact: true }).click();
        await page.getByText('Consultando datos del período…', { exact: true }).waitFor();
        await page.getByLabel('Sucursal de reposición').selectOption(branches[1].id);
        await page.evaluate(() => window.qa.releaseReplenishment());
        assert.equal(await page.getByLabel('Informe de reposición').count(), 0);
        await page.getByRole('button', { name: 'Consultar reposición', exact: true }).click();
        await page.getByText('No hay insumos registrados.', { exact: true }).waitFor();
        await page.getByLabel('Sucursal de reposición').selectOption(branches[0].id);
        await page.evaluate(() => { window.qa.replenishmentMode = 'error'; });
        await page.getByRole('button', { name: 'Consultar reposición', exact: true }).click();
        await page.getByText('QA ficticio: no se pudo verificar la versión del informe.', { exact: true }).waitFor();
        await page.evaluate(() => { window.qa.replenishmentMode = 'success'; });
        await page.getByRole('button', { name: 'Consultar reposición', exact: true }).click();
        await page.getByLabel('Informe de reposición').waitFor();
        await page.getByRole('button', { name: 'Limpiar consulta', exact: true }).click();
        assert.equal(await page.getByLabel('Informe de reposición').count(), 0);
      });

      await check(`${prefix}: historial muestra origen, responsable, saldo y legacy sin inventar datos`, async () => {
        const initial = historyRow('Ingreso QA ficticio inicial');
        await initial.getByText('Carga manual', { exact: true }).waitFor();
        await initial.getByText('Operador QA Ficticio', { exact: true }).waitFor();
        await initial.getByText('15 kg → 20 kg', { exact: true }).waitFor();
        await page.getByText('Registro anterior (legacy)', { exact: true }).waitFor();
        await page.getByText('Saldos sin registrar', { exact: true }).waitFor();
        await page.getByText('Impacto histórico no verificado', { exact: true }).waitFor();
        await page.getByText(/1–2 de 3 movimientos · Página 1 de 2/).waitFor();
      });

      await check(`${prefix}: filtros, paginación, vacío y recuperación de error del historial`, async () => {
        await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
        await page.getByText('Merma QA ficticia en Norte', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Siguiente', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: 'Anterior', exact: true }).click();
        await page.getByText('Ingreso QA ficticio inicial', { exact: true }).waitFor();
        const branches = await page.evaluate(() => window.qa.branches);
        const ingredients = await page.evaluate(() => window.qa.ingredients);
        await page.getByLabel('Filtrar historial por sucursal').selectOption(branches[1].id);
        await page.getByText('Merma QA ficticia en Norte', { exact: true }).waitFor();
        await page.getByText(/1–1 de 1 movimientos · Página 1 de 1/).waitFor();
        await page.getByLabel('Filtrar historial por insumo').selectOption(ingredients[1].id);
        await page.getByText('No hay movimientos registrados para estos filtros.', { exact: true }).waitFor();
        const query = await page.evaluate(() => window.qa.historyQueries.at(-1));
        assert.equal(query.page, 1);
        assert.equal(query.branchId, branches[1].id);
        assert.equal(query.ingredientId, ingredients[1].id);
        await page.getByLabel('Filtrar historial por sucursal').selectOption('');
        await page.getByLabel('Filtrar historial por insumo').selectOption('');
        await page.getByText('Ingreso QA ficticio inicial', { exact: true }).waitFor();
        await page.evaluate(() => { window.qa.historyMode = 'error'; });
        await page.getByRole('button', { name: 'Actualizar historial', exact: true }).click();
        await page.getByText('QA ficticio: historial no disponible temporalmente.', { exact: true }).waitFor();
        await page.evaluate(() => { window.qa.historyMode = 'success'; });
        await page.getByRole('button', { name: 'Reintentar historial', exact: true }).click();
        await page.getByText('Ingreso QA ficticio inicial', { exact: true }).waitFor();
      });

      await check(`${prefix}: motivo obligatorio y unidades compatibles kg/g, l/ml y unit`, async () => {
        const editor = await open();
        const submit = editor.getByRole('button', { name: 'Registrar movimiento', exact: true });
        assert.equal(await submit.isDisabled(), true);
        await editor.getByLabel('Cantidad', { exact: false }).first().fill('250');
        assert.equal(await submit.isDisabled(), true);
        await editor.getByLabel('Motivo obligatorio').fill('   ');
        assert.equal(await submit.isDisabled(), true);
        await editor.getByLabel('Motivo obligatorio').fill('Motivo QA ficticio descartable');
        await editor.getByLabel('Unidad de la cantidad').selectOption('g');
        await editor.getByText(/Equivale a 0,25 kg\./).waitFor();
        assert.deepEqual(await editor.getByLabel('Unidad de la cantidad').locator('option').evaluateAll((options) => options.map((option) => option.value)), ['', 'g']);
        const ingredients = await page.evaluate(() => window.qa.ingredients);
        await editor.getByRole('combobox', { name: 'Insumo', exact: true }).selectOption(ingredients[1].id);
        assert.equal(await editor.getByLabel('Unidad de la cantidad').inputValue(), '');
        assert.deepEqual(await editor.getByLabel('Unidad de la cantidad').locator('option').evaluateAll((options) => options.map((option) => option.value)), ['', 'ml']);
        await editor.getByLabel('Unidad de la cantidad').selectOption('ml');
        await editor.getByText(/Equivale a 0,25 l\./).waitFor();
        await editor.getByRole('combobox', { name: 'Insumo', exact: true }).selectOption(ingredients[2].id);
        assert.deepEqual(await editor.getByLabel('Unidad de la cantidad').locator('option').evaluateAll((options) => options.map((option) => option.value)), ['']);
        await editor.getByRole('combobox', { name: 'Insumo', exact: true }).selectOption(ingredients[0].id);
        await editor.getByRole('button', { name: 'Merma', exact: true }).click();
        await editor.getByLabel('Unidad de la cantidad').selectOption('g');
        await screenshot(`${prefix}-movement-draft`);
      });

      await check(`${prefix}: cancelar no registra y reabrir limpia motivo/cantidad/unidad/tipo`, async () => {
        await close();
        assert.equal(await page.evaluate(() => window.qa.movementCalls), 0);
        const editor = await open();
        assert.equal(await editor.getByLabel('Cantidad', { exact: false }).first().inputValue(), '');
        assert.equal(await editor.getByLabel('Motivo obligatorio').inputValue(), '');
        assert.equal(await editor.getByLabel('Unidad de la cantidad').inputValue(), '');
        assert.equal(await editor.getByRole('button', { name: 'Entrada', exact: true }).getAttribute('aria-pressed'), 'true');
      });

      await check(`${prefix}: doble activación y cierre durante guardado producen un único movimiento`, async () => {
        const editor = page.locator('aside');
        const reason = `Ingreso QA ficticio confirmado ${prefix}`;
        await editor.getByLabel('Cantidad', { exact: false }).first().fill('250');
        await editor.getByLabel('Unidad de la cantidad').selectOption('g');
        await editor.getByLabel('Motivo obligatorio').fill(`  ${reason}  `);
        await page.evaluate(() => { window.qa.holdWrites = true; });
        await clickTwice(editor.getByRole('button', { name: 'Registrar movimiento', exact: true }));
        await page.waitForFunction(() => window.qa.movementCalls === 1);
        assert.equal(await editor.getByRole('button', { name: 'Registrar movimiento', exact: true }).isDisabled(), true);
        assert.equal(await editor.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(), true);
        await editor.getByRole('button', { name: 'Cerrar', exact: true }).click();
        assert.equal(await editor.isVisible(), true);
        await releaseWrites(page);
        await editor.waitFor({ state: 'hidden' });
        const row = historyRow(reason);
        await row.waitFor();
        await row.getByText('250 g', { exact: true }).waitFor();
        await row.getByText('+0,25 kg', { exact: true }).waitFor();
        await row.getByText('20 kg → 20,25 kg', { exact: true }).waitFor();
        const snapshot = await page.evaluate(() => ({ calls: window.qa.movementCalls, writes: window.qa.writes, stock: window.qa.stock, history: window.qa.history }));
        assert.equal(snapshot.calls, 1);
        assert.deepEqual({ quantity: snapshot.writes[0].quantity, unit: snapshot.writes[0].unit, reason: snapshot.writes[0].reason }, { quantity: 250, unit: 'g', reason });
        assert.equal(snapshot.stock[0].stock, 20.25);
        assert.equal(snapshot.history.filter((movement) => movement.reasonNote === reason).length, 1);
        await screenshot(`${prefix}-confirmed-history`);
      });

      await check(`${prefix}: salida excesiva mantiene el borrador y no cambia existencias`, async () => {
        const editor = await open();
        await editor.getByRole('button', { name: 'Salida', exact: true }).click();
        await editor.getByLabel('Cantidad', { exact: false }).first().fill('999');
        await editor.getByLabel('Motivo obligatorio').fill('Salida QA ficticia rechazada');
        await editor.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
        await editor.getByText('La salida o merma supera el stock disponible.', { exact: true }).waitFor();
        assert.equal(await editor.getByLabel('Cantidad', { exact: false }).first().inputValue(), '999');
        assert.equal(await page.evaluate(() => window.qa.stock[0].stock), 20.25);
        assert.equal(await page.evaluate(() => window.qa.history.length), 4);
        await close();
      });

      await check(`${prefix}: corrección a cero es válida y registra saldo anterior`, async () => {
        const editor = await open();
        await editor.getByRole('button', { name: 'Corrección', exact: true }).click();
        await editor.getByLabel('Nuevo stock exacto', { exact: false }).fill('0');
        await editor.getByLabel('Motivo obligatorio').fill(`Conteo QA ficticio a cero ${prefix}`);
        await editor.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        const row = historyRow(`Conteo QA ficticio a cero ${prefix}`);
        await row.getByText('20,25 kg → 0 kg', { exact: true }).waitFor();
        await row.getByText('Corrección', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.qa.stock[0].stock), 0);
      });

      await check(`${prefix}: respuesta incierta bloquea repetir y recarga historial para verificar`, async () => {
        await page.evaluate(() => { window.qa.response = 'throw-after-commit'; });
        const editor = await open();
        const reason = `Entrada QA ficticia incierta ${prefix}`;
        await editor.getByLabel('Cantidad', { exact: false }).first().fill('2');
        await editor.getByLabel('Motivo obligatorio').fill(reason);
        const before = await page.evaluate(() => ({ writes: window.qa.movementCalls, reads: window.qa.stockReads, history: window.qa.historyQueries.length }));
        await editor.getByRole('button', { name: 'Registrar movimiento', exact: true }).click();
        await editor.getByText(/No pudimos confirmar el resultado/).waitFor();
        await page.waitForFunction(() => document.querySelector('aside form')?.getAttribute('aria-busy') === 'false');
        assert.equal(await editor.getByRole('button', { name: 'Registrar movimiento', exact: true }).isDisabled(), true);
        await clickTwice(editor.getByRole('button', { name: 'Registrar movimiento', exact: true }));
        assert.equal(await page.evaluate(() => window.qa.movementCalls), before.writes + 1);
        assert.ok(await page.evaluate((count) => window.qa.stockReads > count, before.reads));
        assert.ok(await page.evaluate((count) => window.qa.historyQueries.length > count, before.history));
        await screenshot(`${prefix}-uncertain`);
        await editor.getByRole('button', { name: 'Cerrar y revisar historial', exact: true }).click();
        await editor.waitFor({ state: 'hidden' });
        await historyRow(reason).getByText('0 kg → 2 kg', { exact: true }).waitFor();
        assert.equal(await page.evaluate((note) => window.qa.history.filter((row) => row.reasonNote === note).length, reason), 1);
        await screenshot(`${prefix}-verified-uncertain-history`);
      });

      await check(`${prefix}: lectura mantiene historial y deshabilita registrar movimientos`, async () => {
        await page.goto(`${origin}/?readonly=1`);
        await page.getByText('Tu rol permite consultar stock, pero no registrar movimientos.', { exact: true }).waitFor();
        assert.equal(await page.getByRole('button', { name: 'Movimiento manual', exact: true }).isDisabled(), true);
        await page.getByText('Ingreso QA ficticio inicial', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
        await page.getByText('Merma QA ficticia en Norte', { exact: true }).waitFor();
        assert.equal(await page.evaluate(() => window.qa.movementCalls), 0);
        assert.equal(await page.locator('aside').count(), 0);
        await screenshot(`${prefix}-read-only`);
      });
    }
  },
});
