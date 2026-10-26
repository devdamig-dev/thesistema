// Production component with controlled backend responses. No Meta requests or real groups.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.test-artifacts', 'whatsapp-groups-ui');
await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
const memberId = '00000000-0000-4000-8000-000000000001';
const missingId = '00000000-0000-4000-8000-000000000002';
const branchId = '00000000-0000-4000-8000-000000000003';
const groupId = 'Y2FwaV9ncm91cDox';
await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {GroupEditor} from './app/ajustes/whatsapp/group-editor';createRoot(document.getElementById('root')).render(<GroupEditor connected={true} members={[{id:'${memberId}',name:'Ana',phone:'5491111111111',active:true},{id:'${missingId}',name:'Julián',phone:null,active:true}]} branches={[{id:'${branchId}',name:'Local principal'}]}/>);`, resolveDir: root, loader: 'tsx' },
  outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated-next', setup(b) {
    b.onResolve({ filter: /^next\/(link|navigation)$/ }, ({ path: p }) => ({ path: p, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: p }) => ({ contents: p === 'next/link' ? "import React from 'react';export default function Link(props){return React.createElement('a',props);}" : 'export function useRouter(){return {refresh(){}};}', loader: 'js', resolveDir: root }));
  } }],
});
execFileSync(process.execPath, [path.join(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', path.join(root, 'app/globals.css'), '-o', path.join(out, 'app.css'), '--minify'], { cwd: root, stdio: 'pipe' });
if (process.env.BUNDLE_ONLY === '1') { console.log(JSON.stringify({ name: 'whatsapp-groups', stage: 'bundle-only', browserExecuted: false })); process.exit(0); }
const server = http.createServer(async (req, res) => {
  if (req.url === '/') { res.setHeader('content-type', 'text/html'); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><main style="max-width:920px;margin:0 auto;padding:16px"><div id="root"></div></main><script src="/app.js"></script></body></html>'); }
  else if (['/app.js', '/app.css'].includes(req.url)) { res.setHeader('content-type', req.url.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(await readFile(path.join(out, req.url.slice(1)))); }
  else res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright');
let browser, ready = false, saved = [], requests = [];
const checks = [], errors = [], blocked = [];
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin === origin && url.pathname === '/api/integrations/whatsapp/groups' && req.method() === 'POST') {
      const body = req.postDataJSON(); requests.push(body); let result = { ok: true };
      if (body.action === 'list') result = { ...result, readiness: { ready, code: ready ? 'ready' : 'business_app', message: ready ? 'Número habilitado para grupos oficiales.' : 'Este número usa WhatsApp Business app. Los grupos oficiales requieren Cloud API sin coexistencia.', phone: '+5491199999999' }, groups: ready ? [{ id: groupId, subject: 'Operaciones del local' }] : [], saved };
      if (body.action === 'details') result = { ...result, info: { id: groupId, subject: 'Operaciones del local', participants: ['5491111111111'], suspended: false, approvalRequired: true }, inviteLink: 'https://chat.whatsapp.com/controlled-fixture', requests: [] };
      if (body.action === 'authorize') { saved = [{ id: '00000000-0000-4000-8000-000000000004', provider_conversation_id: groupId, display_name: 'Operaciones del local', enabled: true, branch_id: body.branchId, whatsapp_group_members: body.memberIds.map(member_id => ({ member_id })) }]; result.message = 'Grupo autorizado.'; }
      if (body.action === 'pause') { saved = saved.map(row => ({ ...row, enabled: false })); result.message = 'Grupo pausado.'; }
      if (body.action === 'identify_member') result.message = 'Teléfono guardado.';
      if (body.action === 'create') { await route.fulfill({ status: 502, json: { ok: false, error: 'Meta no confirmó la creación. Actualizá la lista antes de repetir.' } }); return; }
      await route.fulfill({ json: result }); return;
    }
    if (url.origin === origin && ['/', '/app.js', '/app.css'].includes(url.pathname) && req.method() === 'GET') { await route.continue(); return; }
    blocked.push(req.url()); await route.abort();
  });
  const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
  for (const width of [1440, 390]) {
    ready = false; saved = []; requests = [];
    await page.setViewportSize({ width, height: 1000 }); await page.goto(origin);
    assert.equal(requests.length, 0);
    await page.getByRole('button', { name: 'Comprobar acceso a grupos' }).click();
    await page.getByText(/Este número usa WhatsApp Business app/).waitFor();
    assert.equal(await page.getByText('Crear un grupo nuevo', { exact: true }).count(), 0);
    checks.push(`${width}: coexistence is explicitly blocked without creation controls`);
    ready = true; await page.getByRole('button', { name: 'Actualizar grupos y requisitos' }).click();
    await page.getByLabel('Elegí el grupo de trabajo').selectOption(groupId);
    const authorize = page.getByRole('button', { name: 'Autorizar grupo', exact: true });
    assert.equal(await authorize.isDisabled(), true);
    await page.getByRole('checkbox', { name: /^Ana / }).check();
    assert.equal(await page.getByRole('checkbox', { name: /^Julián / }).isDisabled(), true);
    assert.equal(await authorize.isDisabled(), true);
    await page.getByLabel('Confirmo los integrantes, la sucursal y que las respuestas del asistente serán compartidas en este grupo.').check();
    await authorize.click(); await page.getByText('Autorizado', { exact: true }).waitFor();
    assert.deepEqual(requests.find(row => row.action === 'authorize'), { action: 'authorize', groupId, branchId, memberIds: [memberId], confirmed: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(out, `group-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Pausar procesamiento' }).click(); await page.getByText('Pausado', { exact: true }).waitFor();
    checks.push(`${width}: explicit member/branch consent, invitation, pause, and no horizontal overflow`);
  }
  await page.getByText('Completar teléfonos del equipo', { exact: true }).click();
  await page.getByLabel('Persona sin teléfono registrado').selectOption(missingId);
  await page.getByLabel('Teléfono del integrante, con código de país').fill('+54 9 11 2222 2222');
  const identify = page.getByRole('button', { name: 'Guardar teléfono del integrante' }); assert.equal(await identify.isDisabled(), true);
  await page.getByLabel('Confirmo que el teléfono pertenece a esta persona del equipo.').check(); await identify.click();
  await page.getByText('Teléfono guardado.', { exact: true }).waitFor();
  assert.equal(requests.filter(row => row.action === 'identify_member').length, 1);
  await page.getByText('Crear un grupo nuevo', { exact: true }).click();
  await page.getByLabel('Nombre del grupo').fill('Grupo fixture');
  const create = page.getByRole('button', { name: 'Solicitar creación del grupo' }); assert.equal(await create.isDisabled(), true);
  await page.getByLabel('Confirmo la creación de este grupo en la cuenta del negocio. Cada persona ingresará con una invitación y aprobación.').check();
  await create.click(); await page.getByRole('alert').filter({ hasText: /Meta no confirmó/ }).waitFor();
  assert.equal(requests.filter(row => row.action === 'create').length, 1);
  checks.push('missing phone requires confirmation; uncertain group creation remains an error and is not automatically replayed');
  assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
  await writeFile(path.join(out, 'browser-result.json'), JSON.stringify({ passed: true, fixturesOnly: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, fixturesOnly: true, checks }));
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
