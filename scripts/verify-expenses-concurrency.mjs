/** True independent-session checks. Only called on the runner's disposable
 * PostgreSQL cluster, never accepts a DSN or external database credentials. */
import {readFile} from 'node:fs/promises';
export async function verifyExpensesConcurrency(db){
 const fixture=await readFile(new URL('../supabase/tests/expenses.sql',import.meta.url),'utf8');
 const prefix=fixture.slice(0,fixture.indexOf('set local role authenticated;'));
 if(!prefix.includes('create function pg_temp.expense_input'))throw new Error('Expenses concurrency fixture boundary missing');
 await db.exec(`create schema expenses_test;grant usage on schema expenses_test to authenticated,service_role;\n${prefix.replaceAll('pg_temp.','expenses_test.')}\ncommit;`);
 const business='00000000-0000-4000-8000-000000000021',actor='00000000-0000-4000-8000-000000000001';
 const auth=`set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);`;
 const parse=out=>out.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).at(-1);
 const assert=(value,message)=>{if(!value)throw new Error(`Expenses concurrency: ${message}`);};
 let iteration=0;
 async function race(lockSql,firstSql,secondSql){
  const name=`expenses_race_${++iteration}`;let acquired;const marker=new Promise(resolve=>{acquired=resolve;});
  const first=db.session(`begin;${lockSql};select 'LOCK_ACQUIRED';select pg_sleep(1.2);${auth}${firstSql};commit;`,out=>{if(out.includes('LOCK_ACQUIRED'))acquired();});
  await Promise.race([marker,first.promise.then(result=>{if(!result.stdout.includes('LOCK_ACQUIRED'))throw new Error(result.stderr||result.stdout);})]);
  const second=db.session(`begin;set local application_name='${name}';${auth}${secondSql};commit;`);
  let waited=false;
  for(let n=0;n<20&&!waited;n++){const state=await db.exec(`select pg_sleep(0.04);select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`);waited=state.split('\n').includes('t');}
  const [a,b]=await Promise.all([first.promise,second.promise]);assert(waited,'second independent session did not demonstrably wait');assert(a.code===0,a.stderr);assert(b.code===0,b.stderr);return [parse(a.stdout),parse(b.stdout)];
 }
 const request='00000000-0000-4000-8000-000000000501';
 const operating="'{\"expenseDate\":\"2026-10-09\",\"paymentMethod\":\"Transferencia\",\"supplierId\":null,\"isRecurring\":true,\"periodicity\":\"monthly\"}'::jsonb";
 const create=`select public.save_expense_atomic('${business}',expenses_test.expense_input('${request}')||${operating})`;
 const [created,replayed]=await race(`select pg_advisory_xact_lock(hashtextextended('${business}'||'${request}',0))`,create,create);
 assert(created?.ok&&JSON.stringify(created)===JSON.stringify(replayed),'same request did not replay same result');
 const id=created.id;let counts=await db.exec(`select count(*) from public.expense_mutations where business_id='${business}' and request_id='${request}';`);assert(counts.trim()==='1','duplicate create receipt');
 const update=(key,name,version)=>`select public.save_expense_atomic('${business}',expenses_test.expense_input('${key}')||${operating}||jsonb_build_object('id','${id}','expectedVersion',${version},'name','${name}'))`;
 let [first,second]=await race(`select id from public.expenses where id='${id}' for update`,update('00000000-0000-4000-8000-000000000502','first',1),update('00000000-0000-4000-8000-000000000503','second',1));
 assert(first?.ok&&second?.error==='expense_conflict','stale concurrent edit must fail');
 const voidKey='00000000-0000-4000-8000-000000000504';
 const voidSql=`select public.void_expense_atomic('${business}',jsonb_build_object('requestId','${voidKey}','businessId','${business}','userId','${actor}','id','${id}','expectedVersion',2,'reason','Concurrency fixture'))`;
 [first,second]=await race(`select id from public.expenses where id='${id}' for update`,voidSql,update('00000000-0000-4000-8000-000000000505','late',2));
 assert(first?.ok&&second?.error==='expense_conflict','void/edit race must preserve one winning version');
 const again=parse(await db.exec(`begin;${auth}${voidSql};commit;`));assert(again?.id===id&&again?.version===3,'void response recovery must replay receipt');
 const facts=await db.exec(`select expense_date='2026-10-09' and payment_method='Transferencia' and is_recurring and periodicity='monthly' from public.expenses where id='${id}';`);assert(facts.trim()==='t','concurrent updates and void must preserve reviewed operational facts');
 // A profile revocation held by one session must be rechecked by the waiting
 // mutation, rather than using a previously resolved server/agent role.
 let marked;const marker=new Promise(resolve=>{marked=resolve;});
 const revoker=db.session(`begin;update public.profiles set active=false where id='${actor}';select 'PROFILE_LOCK';select pg_sleep(1);commit;`,out=>{if(out.includes('PROFILE_LOCK'))marked();});
 await Promise.race([marker,revoker.promise.then(r=>{if(!r.stdout.includes('PROFILE_LOCK'))throw new Error(r.stderr);})]);
 const denied=db.session(`begin;${auth}select public.save_expense_atomic('${business}',expenses_test.expense_input('00000000-0000-4000-8000-000000000506'));commit;`);
 await revoker.promise;const deniedResult=await denied.promise;assert(parse(deniedResult.stdout)?.error==='expense_permission_denied','live active profile revalidation failed');
 console.log('PASS expenses native concurrency: same-ID create/replay, stale CAS, void/edit, lost-response receipt, live profile revocation, PostgreSQL lock waits observed');
}
