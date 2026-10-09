/** True independent-session checks. Only called on the runner's disposable
 * PostgreSQL cluster, never accepts a DSN or external database credentials. */
import {readFile} from 'node:fs/promises';
export async function verifySalesConcurrency(db){
 const fixture=await readFile(new URL('../supabase/tests/sales.sql',import.meta.url),'utf8');
 const prefix=fixture.slice(0,fixture.indexOf('set local role authenticated;'));
 if(!prefix.includes('create function pg_temp.sale_input'))throw new Error('Sales concurrency fixture boundary missing');
 await db.exec(`create schema sales_test;grant usage on schema sales_test to authenticated,service_role;\n${prefix.replaceAll('pg_temp.','sales_test.')}\ncommit;`);
 const business='00000000-0000-4000-8000-000000000021',actor='00000000-0000-4000-8000-000000000001';
 const auth=`set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);`;
 const parse=out=>out.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).at(-1);
 const assert=(value,message)=>{if(!value)throw new Error(`Sales concurrency: ${message}`);};
 let iteration=0;
 async function race(lockSql,firstSql,secondSql){
  const name=`sales_race_${++iteration}`;let acquired;const marker=new Promise(resolve=>{acquired=resolve;});
  const first=db.session(`begin;${lockSql};select 'LOCK_ACQUIRED';select pg_sleep(1.2);${auth}${firstSql};commit;`,out=>{if(out.includes('LOCK_ACQUIRED'))acquired();});
  await Promise.race([marker,first.promise.then(result=>{if(!result.stdout.includes('LOCK_ACQUIRED'))throw new Error(result.stderr||result.stdout);})]);
  const second=db.session(`begin;set local application_name='${name}';${auth}${secondSql};commit;`);
  let waited=false;
  for(let n=0;n<20&&!waited;n++){const state=await db.exec(`select pg_sleep(0.04);select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`);waited=state.split('\n').includes('t');}
  const [a,b]=await Promise.all([first.promise,second.promise]);assert(waited,'second independent session did not demonstrably wait');assert(a.code===0,a.stderr);assert(b.code===0,b.stderr);return [parse(a.stdout),parse(b.stdout)];
 }
 const request='00000000-0000-4000-8000-000000000501';
 const create=`select public.save_sale_atomic('${business}',sales_test.sale_input('${request}'))`;
 const [created,replayed]=await race(`select pg_advisory_xact_lock(hashtextextended('${business}'||'${request}',0))`,create,create);
 assert(created?.ok&&JSON.stringify(created)===JSON.stringify(replayed),'same request did not replay same result');
 const id=created.id;let counts=await db.exec(`select count(*) from public.sale_mutations where business_id='${business}' and request_id='${request}';`);assert(counts.trim()==='1','duplicate create receipt');
 const update=(key,notes,version)=>`select public.save_sale_atomic('${business}',sales_test.sale_input('${key}')||jsonb_build_object('id','${id}','expectedVersion',${version},'notes','${notes}'))`;
 let [first,second]=await race(`select id from public.sales where id='${id}' for update`,update('00000000-0000-4000-8000-000000000502','first',1),update('00000000-0000-4000-8000-000000000503','second',1));
 assert(first?.ok&&second?.error==='sale_conflict','stale concurrent edit must fail');
 const voidKey='00000000-0000-4000-8000-000000000504';
 const voidSql=`select public.void_sale_atomic('${business}',jsonb_build_object('requestId','${voidKey}','businessId','${business}','userId','${actor}','id','${id}','expectedVersion',2,'reason','Concurrency fixture'))`;
 [first,second]=await race(`select id from public.sales where id='${id}' for update`,voidSql,update('00000000-0000-4000-8000-000000000505','late',2));
 assert(first?.ok&&second?.error==='sale_conflict','void/edit race must preserve one winning version');
 const again=parse(await db.exec(`begin;${auth}${voidSql};commit;`));assert(again?.id===id&&again?.version===3,'void response recovery must replay receipt');
 // Claim/cancel interleavings use the same durable conversation lock, and
 // cancellation reports the state obtained after acquiring that lock.
 const member='00000000-0000-4000-8000-000000000101',conversation='00000000-0000-4000-8000-000000000601';
 await db.exec(`insert into public.whatsapp_authorized_conversations(id,business_id,branch_id,provider,provider_conversation_id,conversation_type) values('${conversation}','${business}','00000000-0000-4000-8000-000000000031','internal','sales-native-fixture','direct');`);
 const server=`reset role;set local role service_role;`;
 const newPending=async()=>parse(await db.exec(`begin;${server}select public.replace_whatsapp_agent_pending('${business}','${member}','${conversation}','confirmation','sales.create','{"requestId":"00000000-0000-4000-8000-000000000602"}',now()+interval '10 minutes');commit;`)).id;
 const lockPending=`select pg_advisory_xact_lock(hashtextextended('whatsapp-pending:'||'${business}'||':'||'${member}'||':'||'${conversation}',0))`;
 const claim=pending=>`${server}select jsonb_build_object('claimed',public.claim_sales_pending_execution('${business}','${member}','${conversation}','${pending}',false))`;
 const cancel=pending=>`${server}select public.cancel_sales_pending_execution('${business}','${member}','${conversation}','${pending}')`;
 let pending=await newPending();[first,second]=await race(lockPending,claim(pending),cancel(pending));assert(first.claimed===true&&second.consumed===true&&second.resultUncertain===true,'claim then cancel must disclose uncertainty');
 pending=await newPending();[first,second]=await race(lockPending,cancel(pending),claim(pending));assert(first.consumed===true&&first.resultUncertain===false&&second.claimed===false,'cancel before claim prevents execution');
 // A profile revocation held by one session must be rechecked by the waiting
 // mutation, rather than using a previously resolved server/agent role.
 let marked;const marker=new Promise(resolve=>{marked=resolve;});
 const revoker=db.session(`begin;update public.profiles set active=false where id='${actor}';select 'PROFILE_LOCK';select pg_sleep(1);commit;`,out=>{if(out.includes('PROFILE_LOCK'))marked();});
 await Promise.race([marker,revoker.promise.then(r=>{if(!r.stdout.includes('PROFILE_LOCK'))throw new Error(r.stderr);})]);
 const denied=db.session(`begin;${auth}select public.save_sale_atomic('${business}',sales_test.sale_input('00000000-0000-4000-8000-000000000506'));commit;`);
 await revoker.promise;const deniedResult=await denied.promise;assert(parse(deniedResult.stdout)?.error==='sale_permission_denied','live active profile revalidation failed');
 console.log('PASS sales native concurrency: same-ID create/replay, stale CAS, void/edit, lost-response receipt, live profile revocation, claim/cancel in both orders; PostgreSQL lock waits observed');
}
