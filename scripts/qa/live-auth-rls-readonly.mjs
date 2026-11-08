// QA manual de sesiones Auth reales y aislamiento RLS. No escribe datos de negocio.
import assert from 'node:assert/strict';

const required = ['QA_PUBLIC_KEY','QA_USER_A_EMAIL','QA_USER_A_PASSWORD','QA_USER_B_EMAIL','QA_USER_B_PASSWORD'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  throw Error('QA no configurada: faltan secrets '+ missing.join(', ') +'. No se considera un test aprobado.');
}
const origin = "https://tcgcgrftnsuhorssjojk.supabase.co";
const key = process.env.QA_PUBLIC_KEY;
// Never let a misconfigured service_role / private key turn a purported
// RLS test into a privileged read. Legacy keys must carry role=anon.
if (key.startsWith('sb_') && !key.startsWith('sb_publishable_')) {
  throw Error('QA_PUBLIC_KEY debe ser una clave pública anon/publishable; se rechazó una clave privada.');
}
if (!key.startsWith('sb_publishable_')) {
  let role;
  try {
    const encoded = key.split('.')[1];
    role = JSON.parse(Buffer.from(encoded ?? '', 'base64url').toString('utf8')).role;
  } catch {
    throw Error('QA_PUBLIC_KEY no es una clave anon válida.');
  }
  if (role !== 'anon') throw Error('QA_PUBLIC_KEY debe tener rol anon; no se ejecutará QA privilegiada.');
}
const apiHeaders = (accessToken = '') => ({
  apikey: key,
  ...(accessToken ? {Authorization: 'Bearer ' + accessToken} : {}),
  Accept: 'application/json',
});
async function readResponse(res,context) {
  if (!res.ok) throw Error(context + ': HTTP ' + res.status);
  return res.json();
}
async function signIn(email, password) {
  const response = await fetch(origin+'/auth/v1/token?grant_type=password',{
    method:'POST',
    headers: {...apiHeaders(),'Content-Type':'application/json'},
    body: JSON.stringify({email,password}),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const data = await readResponse(response,'Autenticación QA');
  assert.ok(data.access_token,'No se obtuvo sesión');
  const who = await readResponse(await fetch(origin+'/auth/v1/user',{
    headers:apiHeaders(data.access_token),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  }), 'Confirmar identidad');
  assert.ok(who.id,'Sesión sin identidad');
  return {accessToken:data.access_token,userId:who.id};
}
async function select(client,table,filter=''){
  const columns = table === orgTable ? 'id' : 'id,organization_id';
  const url=origin+'/rest/v1/'+table+'?select='+encodeURIComponent(columns)+'&limit=100'+filter;
  const rows=await readResponse(await fetch(url,{
    headers:apiHeaders(client.accessToken),
    redirect: 'error',
    signal:AbortSignal.timeout(15000),
  }), 'Consulta RLS '+table);
  assert.ok(Array.isArray(rows),'Se esperaba lista de filas');
  assert.ok(rows.length<100,'Demasiados registros: paginar antes de declarar cobertura');
  return rows;
}
const a=await signIn(process.env.QA_USER_A_EMAIL,process.env.QA_USER_A_PASSWORD);
const b=await signIn(process.env.QA_USER_B_EMAIL,process.env.QA_USER_B_PASSWORD);
assert.notEqual(a.userId,b.userId,'No se probaron dos usuarios distintos');
const orgTable="organizations", childTable="businesses";
const orgsA=await select(a,orgTable);
const orgsB=await select(b,orgTable);
assert.ok(orgsA.length>0 && orgsB.length>0,'Cada usuario QA necesita una organización');
const orgIdsA=new Set(orgsA.map(o=>o.id));
const orgIdsB=new Set(orgsB.map(o=>o.id));
assert.ok([...orgIdsA].every(id=>!orgIdsB.has(id)),'Los usuarios QA comparten una organización: no son tenants aislados');
for (const id of orgIdsA) {
  assert.equal((await select(b,orgTable,'&id=eq.'+encodeURIComponent(id))).length,0,'Usuario B accede a organización A');
}
for (const id of orgIdsB) {
  assert.equal((await select(a,orgTable,'&id=eq.'+encodeURIComponent(id))).length,0,'Usuario A accede a organización B');
}
const childA=await select(a,childTable);
const childB=await select(b,childTable);
assert.ok(childA.length>0 && childB.length>0,'Ambos tenants QA deben tener un negocio');
assert.ok(childA.every(row=>orgIdsA.has(row.organization_id)),'A tiene datos de otra empresa');
assert.ok(childB.every(row=>orgIdsB.has(row.organization_id)),'B tiene datos de otra empresa');
// El filtro por organización no alcanza para acreditar aislamiento de IDs de
// negocio. Comprobar también acceso directo por PK, con IDs de fixtures QA
// observados sólo en la sesión autorizada; nunca imprimirlos en CI.
for (const row of childA) {
  assert.equal((await select(b, childTable, '&id=eq.' + encodeURIComponent(row.id))).length, 0,
    'Usuario B accede directamente a un negocio de A');
}
for (const row of childB) {
  assert.equal((await select(a, childTable, '&id=eq.' + encodeURIComponent(row.id))).length, 0,
    'Usuario A accede directamente a un negocio de B');
}
for (const id of orgIdsB) {
  assert.equal((await select(a,childTable,'&organization_id=eq.'+encodeURIComponent(id))).length,0,'A puede leer datos de B');
}
for (const id of orgIdsA) {
  assert.equal((await select(b,childTable,'&organization_id=eq.'+encodeURIComponent(id))).length,0,'B puede leer datos de A');
}
// También comprobar que la Data API pública no permita descubrir IDs de
// organizaciones o negocios de A/B. Una sesión autenticada aislada no prueba
// por sí sola que los mismos IDs sean privados frente a consultas anónimas.
// Se consulta un ID por tipo y tenant; nunca mostrar IDs ni filas en CI.
async function assertAnonymousTenantIdHidden(table, id) {
  const url = origin + '/rest/v1/' + table
    + '?select=id&id=eq.' + encodeURIComponent(id) + '&limit=1';
  const response = await fetch(url, {
    headers: apiHeaders(),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 401 || response.status === 403) {
    try { await response.body?.cancel(); } catch { /* denegación sin contenido necesario */ }
    return;
  }
  assert.equal(response.status, 200, 'Consulta anónima a ' + table + ' sin respuesta válida');
  const rows = await response.json();
  assert.ok(Array.isArray(rows) && rows.length === 0,
    'Consulta anónima expuso un identificador privado de ' + table);
}
for (const [table, id] of [
  [orgTable, orgsA[0].id], [orgTable, orgsB[0].id],
  [childTable, childA[0].id], [childTable, childB[0].id],
]) {
  await assertAnonymousTenantIdHidden(table, id);
}
// Las tablas Fudo son exclusivamente de servicio. Una sesión de owner/admin
// tampoco debe poder recuperar ciphertext, staging, cursores o auditoría
// vía PostgREST. Este gate consulta con A, B y sin sesión: sólo GET.
// No basta recibir una lista vacía; exigimos denegación explícita.
const privateFudoTables = [
  'fudo_connections', 'fudo_sync_runs',
  'fudo_external_records', 'fudo_sync_progress',
];
async function assertPrivateFudoTableDenied(client, table) {
  const response = await fetch(origin + '/rest/v1/' + table + '?select=*&limit=1', {
    headers: apiHeaders(client.accessToken),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  const status = response.status;
  try { await response.body?.cancel(); } catch { /* la respuesta puede estar cerrada */ }
  // Con token Auth válido la denegación de privilegios en PostgREST es 403.
  // Un 401 en A/B podría ser sesión expirada o JWT rechazado: NO acredita RLS.
  // Sólo la solicitud sin sesión admite 401 (o 403, según el gateway).
  const deniedForRole = client.accessToken ? status === 403 : (status === 401 || status === 403);
  assert.ok(deniedForRole,
    'Acceso directo inesperado a tabla Fudo ' + table + ' (HTTP ' + status + ').' +
    (client.accessToken && status === 401 ? ' La sesión QA autenticada no acredita RLS mediante HTTP 401.' : ''));
}
for (const account of [a, b, { accessToken: '' }]) {
  for (const table of privateFudoTables) await assertPrivateFudoTableDenied(account, table);
}
console.log('PASS: 2 sesiones Auth QA reales, organizaciones y negocios separados, lectura cruzada bloqueada.');
console.log('PASS: organizaciones y negocios A/B no descubribles anónimamente (4 GET).');
console.log('PASS: 4 tablas Fudo denegadas por PostgREST para A, B y anon (12 GET sin escrituras).');
console.log('Alcance: sólo Auth QA y GET a Supabase; no certifica acciones server-side de GastroPilot, permisos Fudo ni conciliación real.');
