// Production chat UI, controlled network fixtures, no real team messages or AI calls.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.test-artifacts/internal-chat-ui');
await mkdir(out, { recursive: true });
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const me = { id: id(1), userId: id(11), name: 'Ana', admin: true };
const members = [{ ...me, role: 'owner', active: true, branchIds: null }, { id: id(2), userId: id(12), name: 'Luis', role: 'admin', active: true, branchIds: null }];
const initial = { me, members, rooms: [], branches: [{ id: id(20), name: 'Principal' }] };
await build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ChatClient} from './app/chat/chat-client';createRoot(document.getElementById('root')).render(<ChatClient initial={${JSON.stringify(initial)}}/>);`, resolveDir: root, loader: 'tsx' },
  outfile: path.join(out, 'app.js'), bundle: true, platform: 'browser', jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'isolated-next-and-upload', setup(b) {
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'fixture' }));
    b.onResolve({ filter: /^@\/lib\/supabase\/client$/ }, () => ({ path: 'upload', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path: p }) => ({ contents: p === 'link' ? "import React from 'react';export default function Link(props){return React.createElement('a',props);}" : "export function createSupabaseBrowserClient(){return {storage:{from(bucket){if(bucket!=='team-chat')throw Error('wrong bucket');return {async uploadToSignedUrl(path,token,file){window.fixtureUploads=(window.fixtureUploads||0)+1;return {error:null};}}}}};}", loader: 'js', resolveDir: root }));
  } }],
});
execFileSync(process.execPath, [path.join(root, 'node_modules/tailwindcss/lib/cli.js'), '-i', path.join(root, 'app/globals.css'), '-o', path.join(out, 'app.css'), '--minify'], { cwd: root, stdio: 'pipe' });
await writeFile(path.join(out, 'bundle-result.json'), JSON.stringify({ passed: true, browserExecuted: false }));
if (process.env.BUNDLE_ONLY === '1') { console.log('PASS internal chat UI bundle'); process.exit(0); }
const server = http.createServer(async (req, res) => {
  if (req.url === '/' || req.url.startsWith('/chat')) { res.setHeader('content-type', 'text/html'); res.end('<html lang="es" class="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><header style="height:56px">GastroPilot · Prueba aislada</header><div id="root"></div><script src="/app.js"></script></body></html>'); }
  else if (['/app.js', '/app.css'].includes(req.url)) { res.setHeader('content-type', req.url.endsWith('css') ? 'text/css' : 'text/javascript'); res.end(await readFile(path.join(out, req.url.slice(1)))); }
  else res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import('playwright');
let browser, room, pendingId = null, failSend = false, uploads = 0;
const messages = [], posts = [], errors = [], checks = [];
try {
  browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1440, height: 940 } });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/api/chat') {
      if (request.method() === 'GET') {
        const data = { ...initial, rooms: room ? [room] : [], ...(url.searchParams.get('room') && room ? { room, participants: members.map(m => ({ member_id: m.id, role_snapshot: m.role, joined_at: '2026-01-01T00:00:00Z' })), messages, pendingId, pendingKind: pendingId ? 'confirmation' : null, pendingExpiresAt: '2099-01-01T00:00:00Z', hasOlder: false } : {}) };
        return route.fulfill({ json: { ok: true, data } });
      }
      const body = request.postDataJSON(); posts.push(body); let result = { ok: true };
      if (body.action === 'configure') { room = { id: body.roomId, name: body.name, branch_id: body.branchId, archived: false, created_at: new Date().toISOString(), agent_busy_until: null }; result.roomId = room.id; }
      if (body.action === 'upload_prepare') { uploads++; result = { ...result, id: id(50 + uploads), path: 'private/fixture', token: 'fixture-upload-only' }; }
      if (body.action === 'send') {
        if (!messages.some(m => m.id === body.id)) {
          const confirming = body.body === 'confirmar';
          if (body.askAi) pendingId = confirming ? null : id(80);
          messages.push({ id: body.id, room_id: body.roomId, member_id: me.id, author_name: me.name, body: body.body, created_at: new Date().toISOString(), ask_ai: body.askAi, ai_status: body.askAi ? 'done' : 'none', ai_text: body.askAi ? confirming ? 'Operación confirmada en la prueba.' : 'Voy a crear Hamburguesa con precio $ 1.000. Revisá antes de confirmar.' : null, ai_result: body.askAi ? confirming ? 'completed' : 'needs_confirmation' : null, pending_id: pendingId, attachment_id: body.attachmentId, attachment: body.attachmentId ? { id: body.attachmentId, filename: 'comprobante.pdf', mime: 'application/pdf', size: 12 } : null });
        }
        if (failSend) { failSend = false; return route.fulfill({ status: 503, json: { ok: false, error: 'El envío no se confirmó. Reintentá sin duplicarlo.' } }); }
      }
      return route.fulfill({ json: result });
    }
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole('button', { name: 'Crear grupo', exact: true }).click();
  await page.getByLabel('Nombre del grupo').fill('Administración del local');
  await page.getByLabel('Luis', { exact: true }).check();
  await page.getByRole('dialog').getByRole('button', { name: 'Crear grupo', exact: true }).click();
  await page.getByLabel('Mensaje al grupo').waitFor();
  assert.deepEqual(posts.find(p => p.action === 'configure').memberIds, [id(1), id(2)]); checks.push('group includes only chosen members');
  await page.getByLabel('Mensaje al grupo').fill('Llegó el pedido para cocina');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await page.getByText('Llegó el pedido para cocina', { exact: true }).waitFor();
  assert.equal(messages[0].ask_ai, false); checks.push('plain team messages never request AI');
  failSend = true;
  await page.getByLabel('Mensaje al grupo').fill('Mensaje con respuesta de red perdida');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'El envío no se confirmó' }).waitFor();
  await page.getByRole('button', { name: 'Reintentar envío', exact: true }).click();
  await page.getByLabel('Mensaje al grupo').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
  const retries = posts.filter(p => p.action === 'send' && p.body.includes('red perdida'));
  assert.equal(retries.length, 2); assert.equal(retries[0].id, retries[1].id); assert.equal(messages.filter(m => m.body.includes('red perdida')).length, 1); checks.push('lost acknowledgement reuses the identical message ID');
  await page.getByLabel('Pedir ayuda a la IA').check();
  await page.getByLabel('Mensaje al grupo').fill('Crear producto Hamburguesa a 1000');
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar operación', exact: true }).waitFor();
  assert.equal(posts.some(p => p.body === 'confirmar'), false);
  await page.getByRole('button', { name: 'Confirmar operación', exact: true }).click();
  await page.getByText('Operación confirmada en la prueba.', { exact: true }).waitFor();
  assert.equal(posts.find(p => p.body === 'confirmar').pendingId, id(80)); checks.push('visible summary and exact pending confirmation');
  await page.getByLabel('Pedir ayuda a la IA').uncheck();
  await page.getByLabel('Adjuntar archivo', { exact: true }).setInputFiles({ name: 'comprobante.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%%EOF') });
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click();
  await page.getByRole('link', { name: 'comprobante.pdf', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.fixtureUploads), 1); assert(posts.some(p => p.action === 'upload_complete')); checks.push('private signed upload completes before message send');
  await page.screenshot({ path: path.join(out, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Grabar audio', exact: true }).click();
  await page.getByText(/Grabando/).waitFor();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Detener grabación', exact: true }).click();
  await page.getByLabel('Escuchar audio antes de enviar').waitFor();
  await page.getByRole('button', { name: 'Quitar adjunto', exact: true }).click(); checks.push('mobile recording provides playback and explicit send');
  const width = await page.evaluate(() => ({ body: document.documentElement.scrollWidth, viewport: innerWidth })); assert(width.body <= width.viewport); checks.push('390px mobile has no horizontal overflow');
  await page.screenshot({ path: path.join(out, 'mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Volver a grupos', exact: true }).click();
  await page.getByRole('button', { name: 'Instalar app', exact: true }).click();
  await page.getByText(/En iPhone: Compartir/).waitFor(); checks.push('mobile install instructions available');
  assert.deepEqual(errors, []);
  await writeFile(path.join(out, 'browser-result.json'), JSON.stringify({ passed: true, browserExecuted: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ name: 'internal-chat', passed: true, checks }));
} catch (error) {
  await writeFile(path.join(out, 'browser-result.json'), JSON.stringify({ passed: false, browserExecuted: true, checks, errors, error: error.message }, null, 2)); throw error;
} finally { await browser?.close(); server.close(); }
