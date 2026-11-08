// Pruebas de contrato completamente sintéticas: NUNCA conectan a Supabase/Fudo.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const gateUrl = pathToFileURL(resolve(root, 'scripts/qa/live-auth-rls-readonly.mjs')).href;
// JWT ficticio: el gate sólo inspecciona el claim role=anon, no la firma.
const anonKey = 'fixture.' + Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') + '.fixture';

function runFixture(scenario, overrides = {}) {
  const source = [
    "const scenario = process.env.QA_FIXTURE_SCENARIO;",
    "let privateGets = 0;",
    "let anonymousEntityGets = 0;", 
    "globalThis.fetch = async (input, init = {}) => {",
    "  const url = new URL(String(input));",
    "  if (init.redirect !== 'error') throw Error('QA fetch must reject provider redirects');",
    "  const headers = new Headers(init.headers || {});",
    "  const auth = headers.get('Authorization') || '';",
    "  const who = auth.includes('mock-token-A') ? 'A' : 'B';",
    "  const isAnon = !auth || auth === 'Bearer ' + process.env.QA_PUBLIC_KEY;", 
    "  const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers:{'content-type':'application/json'}});",
    "  if (url.pathname === '/auth/v1/token') {",
    "    if (init.method !== 'POST') throw Error('Auth must use POST');",
    "    const credentials = JSON.parse(init.body);",
    "    return json({access_token: credentials.email === 'qa-a@example.invalid' ? 'mock-token-A' : 'mock-token-B'});",
    "  }",
    "  if (url.pathname === '/auth/v1/user') return json({id: scenario === 'same-auth-user' ? 'user-A' : who === 'A' ? 'user-A' : 'user-B'});",
    "  if (!url.pathname.startsWith('/rest/v1/')) throw Error('Unexpected network path');",
    "  if (init.method && init.method !== 'GET') throw Error('Business write detected');",
    "  const table = url.pathname.slice('/rest/v1/'.length);",
    "  if (isAnon && (table === 'organizations' || table === 'businesses')) {",
    "    if (auth !== 'Bearer ' + process.env.QA_PUBLIC_KEY) throw Error('Legacy anon JWT probe must use bearer');",
    "    anonymousEntityGets++;",
    "  }",  
    "  if (table.startsWith('fudo_')) {",
    "    privateGets++;",
    "    if (scenario === 'private-200') return json([]);",
    "    if (scenario === 'authenticated-401' && auth) return json({message:'expired'}, 401);",
    "    if (scenario === 'anon-401' && !auth) return json({message:'denied'}, 401);",
    "    return json({message:'denied'}, 403);",
    "  }",
    "  const requestedId = url.searchParams.get('id')?.replace('eq.', '');",
    "  const requestedOrg = url.searchParams.get('organization_id')?.replace('eq.', '');",
    "  if (table === 'organizations') {",
    "    if (isAnon) return json(scenario === 'anon-org-leak' ? [{id:'org-A'}] : []);", 
    "    const ids = who === 'A' ? ['org-A'] : ['org-B'];",
    "    if (scenario === 'cross-tenant' && who === 'A') ids.push('org-B');",
    "    return json(ids.filter(id => !requestedId || id === requestedId).map(id => ({id})));",
    "  }",
    "  if (table === 'businesses') {",
    "    if (isAnon) return json(scenario === 'anon-business-leak' ? [{id:'business-A',organization_id:'org-A'}] : []);", 
    "    const own = who === 'A' ? 'org-A' : 'org-B';",
    "    if (scenario === 'cross-business-id' && who === 'B' && requestedId === 'business-A')",
    "      return json([{id:'business-A',organization_id:'org-A'}]);",
    "    const row = {id:'business-'+who,organization_id:own};",
    "    return json((!requestedOrg || requestedOrg === own) && (!requestedId || requestedId === row.id) ? [row] : []);",
    "  }",
    "  throw Error('Unexpected table');",
    "};",
    "await import(" + JSON.stringify(gateUrl) + ");",
    "if (privateGets !== 12) throw Error('Expected exactly 12 private-table GETs, got ' + privateGets);",
    "if (anonymousEntityGets !== 4) throw Error('Expected 4 anonymous entity GETs, got ' + anonymousEntityGets);", 
  ].join('\n');
  const env = {
    ...process.env,
    QA_FIXTURE_SCENARIO: scenario,
    QA_PUBLIC_KEY: anonKey,
    QA_USER_A_EMAIL: 'qa-a@example.invalid',
    QA_USER_B_EMAIL: 'qa-b@example.invalid',
    QA_USER_A_PASSWORD: 'fixture-password-A',
    QA_USER_B_PASSWORD: 'fixture-password-B',
    ...overrides,
  };
  for (const [key, value] of Object.entries(env)) if (value === undefined) delete env[key];
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root, env, encoding: 'utf8', timeout: 10000,
  });
}

test('Gate sintético A/B: organizaciones separadas y 12 GET privados denegados', () => {
  const run = runFixture('success');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /PASS: 2 sesiones Auth QA reales/);
  assert.match(run.stdout, /12 GET/);
  assert.match(run.stdout, /4 GET/);
  assert.doesNotMatch(run.stdout + run.stderr, /fixture-password|mock-token/);
});

test('Gate rechaza 401 en tablas privadas con sesión A/B: podría ser un JWT inválido', () => {
  const run = runFixture('authenticated-401');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /sesión QA autenticada no acredita RLS mediante HTTP 401/);
  assert.doesNotMatch(run.stdout, /PASS:/);
});

test('Gate permite 401 anónimo cuando A/B reciben denegación 403', () => {
  const run = runFixture('anon-401');
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /12 GET/);
  assert.doesNotMatch(run.stdout + run.stderr, /fixture-password|mock-token/);
});

test('Gate falla ante HTTP 200 aunque la tabla privada devuelva filas vacías', () => {
  const run = runFixture('private-200');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Acceso directo inesperado a tabla Fudo/);
  assert.doesNotMatch(run.stdout, /PASS:/);
});

test('Gate falla si se exponen organizaciones cruzadas A/B', () => {
  const run = runFixture('cross-tenant');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /comparten una organización/);
  assert.doesNotMatch(run.stdout, /PASS:/);
});

test('Gate rechaza lectura directa de business_id ajeno aunque el filtro por organización funcione', () => {
  const run = runFixture('cross-business-id');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Usuario B accede directamente a un negocio de A/);
  assert.doesNotMatch(run.stdout, /PASS:/);
});

test('Gate rechaza dos credenciales que resuelven al mismo usuario Auth', () => {
  const run = runFixture('same-auth-user');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /No se probaron dos usuarios distintos/);
  assert.doesNotMatch(run.stdout, /PASS:/);
});

test('Gate rechaza service key antes de autenticar', () => {
  const run = runFixture('success', { QA_PUBLIC_KEY: 'sb_secret_fixture_never_use' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /clave privada/);
  assert.doesNotMatch(run.stdout, /PASS:/);
});

test('Gate rechaza ausencia de cuentas QA en vez de fingir aprobación', () => {
  const run = runFixture('success', { QA_USER_B_PASSWORD: undefined });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /QA no configurada/);
  assert.doesNotMatch(run.stdout, /PASS:/);
});

test('Gate rechaza descubrimiento anónimo del ID de una organización A/B', () => {
  const run = runFixture('anon-org-leak');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Consulta anónima expuso un identificador privado de organizations/);
  assert.doesNotMatch(run.stdout, /PASS: 4 tablas Fudo/);
  assert.doesNotMatch(run.stdout + run.stderr, /fixture-password|mock-token/);
});

test('Gate rechaza descubrimiento anónimo del ID de un negocio A/B', () => {
  const run = runFixture('anon-business-leak');
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Consulta anónima expuso un identificador privado de businesses/);
  assert.doesNotMatch(run.stdout, /PASS: 4 tablas Fudo/);
  assert.doesNotMatch(run.stdout + run.stderr, /fixture-password|mock-token/);
});
