/** Independent sessions against the runner's disposable PostgreSQL only. */
import {readFile} from 'node:fs/promises';

export async function verifyPurchasesConcurrency(db) {
 const fixture=await readFile(new URL('../supabase/tests/purchases.sql',import.meta.url),'utf8');
 const boundary=fixture.indexOf('set local role authenticated;');
 if(boundary<0)throw new Error('Purchase fixture boundary missing');
 await db.exec(`${fixture.slice(0,boundary)}\ncommit;`);
 const business='00000000-0000-4000-8000-000000000011',actor='00000000-0000-4000-8000-000000000001';
 const auth=`set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);`;
 const input=requestId=>({requestId,branchId:'00000000-0000-4000-8000-000000000021',supplierId:'00000000-0000-4000-8000-000000000040',purchasedAt:'2026-10-09',paymentMethod:'Cuenta corriente',items:[{ingredientId:'00000000-0000-4000-8000-000000000070',description:'Fixture flour',qty:'500',unit:'g',unitPrice:'1.25'}]});
 const literal=value=>`'${JSON.stringify(value).replaceAll("'","''")}'::jsonb`;
 const create=value=>`select public.create_purchase_manual_atomic('${business}',${literal(value)})`;
 const parse=out=>out.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).at(-1);
 const assert=(ok,message)=>{if(!ok)throw new Error(`Purchase concurrency: ${message}`);};
 let sequence=0;
 async function race(lockSql,firstSql,secondSql,secondError=null) {
  const name=`purchase_race_${++sequence}`;let mark;const marker=new Promise(resolve=>{mark=resolve;});
  const first=db.session(`begin;${lockSql};select 'LOCK_ACQUIRED';select pg_sleep(1.2);${auth}${firstSql};commit;`,out=>{if(out.includes('LOCK_ACQUIRED'))mark();});
  await Promise.race([marker,first.promise.then(result=>{if(!result.stdout.includes('LOCK_ACQUIRED'))throw new Error(result.stderr||result.stdout);})]);
  const second=db.session(`begin;set local application_name='${name}';${auth}${secondSql};commit;`);
  let waited=false;
  for(let n=0;n<20&&!waited;n++){const state=await db.exec(`select pg_sleep(0.04);select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock');`);waited=state.split('\n').includes('t');}
  const [a,b]=await Promise.all([first.promise,second.promise]);
  assert(waited,'independent request did not demonstrably wait on a lock');assert(a.code===0,a.stderr);
  if(secondError)assert(b.code!==0&&b.stderr.includes(secondError),`expected ${secondError}: ${b.stderr}`);else assert(b.code===0,b.stderr);
  return [parse(a.stdout),parse(b.stdout)];
 }
 const request='00000000-0000-4000-8000-000000000501',payload=input(request);
 const [created,replayed]=await race(`select pg_advisory_xact_lock(hashtextextended('${business}'||'${request}',0))`,create(payload),create(payload));
 assert(created?.ok&&created.id===replayed?.id&&replayed.replayed===true,'same request must replay one purchase');
 const counts=await db.exec(`select (select count(*) from public.purchases)=1 and (select count(*) from public.purchase_items)=1 and (select count(*) from public.stock_movements where ref_type='purchase_item')=1 and (select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000070')=0.5;`);
 assert(counts.trim()==='t','retry duplicated receipt, items or stock');
 const voidSql=`select public.void_purchase_manual_atomic('${business}','${created.id}',1,'Concurrency correction')`;
 const [voided,voidReplay]=await race(`select id from public.purchases where id='${created.id}' for update`,voidSql,voidSql);
 assert(voided?.ok&&voidReplay?.replayed===true,'same void must replay');
 const reversed=await db.exec(`select (select count(*) from public.stock_movements where ref_type='purchase_item_void')=1 and (select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000070')=0;`);
 assert(reversed.trim()==='t','concurrent void reversed stock twice');
 const correction=input('00000000-0000-4000-8000-000000000502');
 const original=parse(await db.exec(`begin;${auth}${create(correction)};commit;`));
 const replacement=key=>({...input(key),replacesPurchaseId:original.id,correctionReason:'Correct price'});
 const replace=value=>`select public.replace_purchase_manual_atomic('${business}','${original.id}',1,'Correct price',${literal(value)})`;
 await race(`select id from public.purchases where id='${original.id}' for update`,replace(replacement('00000000-0000-4000-8000-000000000503')),replace(replacement('00000000-0000-4000-8000-000000000504')),'purchase_single_replacement');
 const single=await db.exec(`select count(*)=1 from public.purchases where manual_payload->>'replacesPurchaseId'='${original.id}';`);
 assert(single.trim()==='t','two requests replaced one original');
 console.log('PASS purchases native concurrency: same-ID create, void replay, stock exactly once, competing replacement, observed independent-session lock waits');
}
