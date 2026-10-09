/** Fixture-only Data API rehearsal; execute only on an authorized Docker runner.
 * Run from a checkout with Docker on an authorized CI runner:
 *   npm run test:sales:rest
 * Official PG17/PostgREST16.4/Node24 images are resolved to digests. All running
 * containers use network none, no published ports, no host bind mounts. Their
 * only communication is through a disposable Docker volume of Unix sockets.
 * JWTs and every record are ephemeral test fixtures. This is not Supabase Auth,
 * GoTrue, the managed gateway or a deployed PostgREST-version compatibility test.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), 'sales-rest-config-'));
await chmod(directory, 0o700);
const suffix = randomUUID();
const pg = `sales-rest-pg-${suffix}`, api = `sales-rest-api-${suffix}`, clientName = `sales-rest-client-${suffix}`, volume = `sales-rest-sockets-${suffix}`;
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: directory, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
const dockerArgs = ['--host', 'unix:///var/run/docker.sock', '--config', directory];
const created = [];
let volumeCreated = false;
const report = { passed: false, fixturesOnly: true, images: {}, checks: [], error: null };
const out = join(root, '.test-artifacts', 'sales-postgrest');
await mkdir(out, { recursive: true });
async function docker(args, input = '') {
  const child = spawn('docker', [...dockerArgs, ...args], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const result = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => resolve({ code, stdout, stderr }));
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
  if (result.code !== 0) throw new Error(`docker ${args[0]} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
async function image(tag, repository) {
  await docker(['pull', tag]);
  const digests = JSON.parse(await docker(['image', 'inspect', tag, '--format', '{{json .RepoDigests}}']));
  const value = digests.find(digest => digest.startsWith(repository + '@sha256:'));
  assert.match(value ?? '', /@sha256:[a-f0-9]{64}$/);
  report.images[tag] = value;
  return value;
}
async function checkIsolation(name) {
  const [data] = JSON.parse(await docker(['inspect', name]));
  assert.equal(data.HostConfig.NetworkMode, 'none');
  assert.deepEqual(data.HostConfig.PortBindings || {}, {});
  assert.deepEqual(data.HostConfig.Binds || [], []);
  assert.ok(data.Mounts.every(m => m.Type === 'tmpfs' || m.Type === 'volume' && m.Name === volume));
}
const sql = text => docker(['exec', '--user', 'postgres', '-i', pg, 'psql', '--no-psqlrc', '--no-password', '-h', '/var/run/postgresql', '-U', 'sales_rest_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], text);
try {
  const pgImage = await image('postgres:17', 'postgres');
  const restImage = await image('postgrest/postgrest:v16.4', 'postgrest/postgrest');
  const nodeImage = await image('node:24-alpine', 'node');
  await docker(['volume', 'create', volume]); volumeCreated = true;
  const mount = `type=volume,source=${volume},target=/var/run/postgresql`;
  await docker(['create', '--name', pg, '--network', 'none', '--mount', mount,
    '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=512m',
    '--env', 'POSTGRES_HOST_AUTH_METHOD=trust', '--env', 'POSTGRES_USER=sales_rest_admin', '--env', 'POSTGRES_DB=postgres',
    pgImage, '-c', 'listen_addresses=', '-c', 'unix_socket_permissions=0700']); created.push(pg);
  await checkIsolation(pg); await docker(['start', pg]);
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    ready = await docker(['exec', '--user', 'postgres', pg, 'sh', '-c', 'test "$(cat /proc/1/comm)" = postgres && pg_isready -q -h /var/run/postgresql -U sales_rest_admin -d postgres']).then(() => true, () => false);
    if (!ready) await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'PostgreSQL fixture must become ready');
  await docker(['exec', '--user', 'postgres', pg, 'chmod', '700', '/var/run/postgresql']);
  const uid = (await docker(['exec', '--user', 'postgres', pg, 'id', '-u'])).trim();
  assert.match(uid, /^\d+$/);
  assert.equal((await sql("select current_setting('server_version_num')::int between 170000 and 179999 and current_setting('listen_addresses')='' and current_setting('unix_socket_permissions')='0700';")).trim(), 't');
  const source = await readFile(join(root, 'scripts/run-sales-sql.mjs'), 'utf8');
  const scaffold = source.match(/const scaffolding = `([\s\S]*?)`;/)?.[1];
  assert.ok(scaffold, 'Scaffolding must be extracted from the existing fixture runner');
  await sql(scaffold);
  const files = (await readdir(join(root, 'supabase/migrations'))).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    const text = await readFile(join(root, 'supabase/migrations', file), 'utf8');
    for (const statement of text.match(/^alter type [^;]+ add value[^;]+;/gim) ?? []) await sql(statement);
    await sql(text);
  }
  report.migrations = files.length;
  // Modern PostgREST puts signed JWT claims in a JSON GUC. This scaffold mirrors
  // auth.uid() only; it does not use any managed Auth service or real identity.
  await sql(`create or replace function auth.uid() returns uuid language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;`);
  const fixture = await readFile(join(root, 'supabase/tests/sales.sql'), 'utf8');
  const boundary = fixture.indexOf('set local role authenticated;');
  assert.ok(boundary > 0 && fixture.slice(0, boundary).includes('create function pg_temp.sale_input'));
  await sql(`create schema rest_test; grant usage on schema rest_test to authenticated; ${fixture.slice(0, boundary).replaceAll('pg_temp.', 'rest_test.')} commit;`);
  const business = '00000000-0000-4000-8000-000000000021';
  const actor = '00000000-0000-4000-8000-000000000001';
  const seed = await sql(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);select public.save_sale_atomic('${business}',rest_test.sale_input());commit;`);
  assert.equal(JSON.parse(seed.split('\n').find(line => line.startsWith('{'))).ok, true);
  const foreignBusiness = '00000000-0000-4000-8000-000000000022';
  const foreign = await sql(`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);select public.save_sale_atomic('${foreignBusiness}',rest_test.sale_input('00000000-0000-4000-8000-000000000202')||jsonb_build_object('businessId','${foreignBusiness}','branchId','00000000-0000-4000-8000-000000000033','customerId',null,'items',jsonb_build_array(jsonb_build_object('id',null,'productId','00000000-0000-4000-8000-000000000062','description','Foreign fixture','quantity','1','unitPrice','7.25'))));commit;`);
  assert.equal(JSON.parse(foreign.split('\n').find(line => line.startsWith('{'))).ok, true);
  assert.equal((await sql(`select count(*) from public.sale_items where business_id='${foreignBusiness}';`)).trim(), '1');
  await sql('create role rest_authenticator login noinherit; grant anon,authenticated to rest_authenticator;');
  const secret = randomBytes(48).toString('base64url');
  await docker(['create', '--name', api, '--network', 'none', '--user', uid, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', mount,
    '--env', 'PGRST_DB_URI=postgresql://rest_authenticator@/postgres?host=/var/run/postgresql',
    '--env', 'PGRST_DB_SCHEMAS=public', '--env', 'PGRST_DB_ANON_ROLE=anon', '--env', 'PGRST_DB_CONFIG=false',
    '--env', `PGRST_JWT_SECRET=${secret}`, '--env', 'PGRST_SERVER_UNIX_SOCKET=/var/run/postgresql/rest.sock', '--env', 'PGRST_SERVER_UNIX_SOCKET_MODE=600', restImage]); created.push(api);
  await checkIsolation(api); await docker(['start', api]);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'authenticated', sub: '00000000-0000-4000-8000-000000000007', exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
  const signed = `${header}.${payload}`;
  const token = `${signed}.${createHmac('sha256', secret).update(signed).digest('base64url')}`;
  const client = `let input='';for await(const chunk of process.stdin)input+=chunk;const value=JSON.parse(input);const http=await import('node:http');const req=http.request({socketPath:'/var/run/postgresql/rest.sock',path:value.path,method:'GET',headers:value.headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>process.stdout.write(JSON.stringify({status:res.statusCode,headers:res.headers,body})));});req.on('error',e=>{process.stderr.write(e.message);process.exitCode=1;});req.setTimeout(10000,()=>req.destroy(new Error('fixture request timeout')));req.end();`;
  // The reader is the fixture cashier assigned only to branch A1, unlike the
  // owner used to seed both businesses. A hidden B row is proven to exist.
  created.push(clientName);
  const request = (path, authorized = true) => docker(['run', '--rm', '--name', clientName, '--network', 'none', '--user', uid, '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--mount', mount, '-i', nodeImage, 'node', '--input-type=module', '-e', client], JSON.stringify({ path, headers: { Prefer: 'count=exact', Range: '0-999', ...(authorized ? { Authorization: `Bearer ${token}` } : {}) } })).then(JSON.parse);
  let response;
  for (let i = 0; i < 40; i++) {
    response = await request('/').catch(() => null);
    if (response?.status === 200) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.equal(response?.status, 200, 'PostgREST must load the migrated schema');
  const action = await readFile(join(root, 'app/actions/sales.ts'), 'utf8');
  const select = action.match(/from\("sale_items"\)\.select\("([^"]*quantity::text[^"]*)"/)?.[1];
  assert.ok(select?.includes('unit_price::text,total::text'), 'Use the exact real action SELECT');
  const params = new URLSearchParams({ select, business_id: `eq.${business}`, order: 'sale_id.asc,position.asc' });
  response = await request('/sale_items?' + params);
  assert.ok([200, 206].includes(response.status), response.body);
  assert.equal(response.headers['content-range'], '0-1/2');
  const rows = JSON.parse(response.body);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => [row.quantity, row.unit_price, row.total]), [['2.000000', '10.25', '20.50'], ['1.000000', '0.10', '0.10']]);
  assert.ok(rows.every(row => ['quantity', 'unit_price', 'total'].every(key => typeof row[key] === 'string')));
  assert.ok(rows[0].recipe_snapshot && rows.every(row => row.business_id === business));
  report.checks.push('Exact action SELECT preserves decimal strings, column names, count, order and recipe snapshot');
  const empty = await request('/sale_items?' + new URLSearchParams({ select, business_id: 'eq.00000000-0000-4000-8000-000000000022' }));
  assert.equal(empty.status, 200); assert.deepEqual(JSON.parse(empty.body), []);
  const denied = await request('/sale_items?' + params, false);
  assert.ok([401, 403].includes(denied.status));
  report.checks.push('Existing foreign-business item is hidden by RLS; unauthenticated reads are denied');
  report.passed = true;
  console.log(JSON.stringify({ ...report, limits: 'Only fixture PostgREST transport; not managed Supabase Auth/gateway or deployed-version E2E' }));
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  throw error;
} finally {
  const cleanupErrors = [];
  for (const name of created.reverse()) await docker(['rm', '--force', '--volumes', name]).catch(error => { if (!/No such (?:container|object):/.test(error.message)) cleanupErrors.push(error.message); });
  if (volumeCreated) await docker(['volume', 'rm', volume]).catch(error => cleanupErrors.push(error.message));
  if (cleanupErrors.length) { report.passed = false; report.cleanupErrors = cleanupErrors; }
  await rm(directory, { recursive: true, force: true });
  await writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2));
  if (cleanupErrors.length) throw new Error('Fixture cleanup did not complete: ' + cleanupErrors.join('; '));
}
