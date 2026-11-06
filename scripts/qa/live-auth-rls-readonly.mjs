// QA manual de sesiones Auth reales y aislamiento RLS. No escribe datos de negocio.
import assert from 'node:assert/strict';

const required = ['QA_PUBLIC_KEY','QA_USER_A_EMAIL','QA_USER_A_PASSWORD','QA_USER_B_EMAIL','QA_USER_B_PASSWORD'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
  throw Error('QA no configurada: faltan secrets '+ missing.join(', ') +'. No se considera un test aprobado.');
}
const origin = "https://tcgcgrftnsuhorssjojk.supabase.co";
const key = process.env.QA_PUBLIC_KEY;
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
    signal: AbortSignal.timeout(15000),
  });
  const data = await readResponse(response,'Autenticación QA');
  assert.ok(data.access_token,'No se obtuvo sesión');
  const who = await readResponse(await fetch(origin+'/auth/v1/user',{
    headers:apiHeaders(data.access_token),
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
for (const id of orgIdsB) {
  assert.equal((await select(a,childTable,'&organization_id=eq.'+encodeURIComponent(id))).length,0,'A puede leer datos de B');
}
for (const id of orgIdsA) {
  assert.equal((await select(b,childTable,'&organization_id=eq.'+encodeURIComponent(id))).length,0,'B puede leer datos de A');
}
console.log('PASS: 2 sesiones Auth reales, organizaciones separadas, datos propios visibles y lectura cruzada denegada (RLS).');
console.log('Scope:',"gastro",'; consultas sin escrituras; filas privadas y credenciales no se imprimen.');
