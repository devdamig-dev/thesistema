-- Isolated fictitious fixtures; rolled back. Never execute against production.
begin;
create function pg_temp.c_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if; end $$;
insert into auth.users(id,email) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'closure-'||i||'@example.invalid' from generate_series(1,10) i;
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000000020','Offline closures');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000020' where id::text like '00000000-0000-4000-8000-%';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000004';
insert into public.businesses(id,organization_id,name) values('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','Closure A'),('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000020','Closure B');
insert into public.business_members(id,business_id,user_id,role) select ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000021',('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,r::public.role_key from unnest(array['owner','admin','viewer','owner','kitchen','employee','cashier','waiter','delivery','manager']) with ordinality t(r,i);
insert into public.branches(id,business_id,name) values('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000021','A1'),('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000021','A2'),('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000022','B');
insert into public.branch_assignments(business_member_id,branch_id) select ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000031' from generate_series(3,9) i;
insert into public.business_modules(business_id,module_key,enabled) values('00000000-0000-4000-8000-000000000021','daily_closures',true);
insert into public.daily_closures(id,business_id,branch_id,closure_date,raw_text,parsed,inconsistencies,status,gross_total,net_total) values('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','2026-01-01','Original histórico','{"incomes":[{"amount":100}]}','["original inconsistency"]','approved',100,80),('00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000032','2026-01-01','Other branch',null,'[]','approved',1,1);
create function pg_temp.closure_input() returns jsonb language sql as $$ select jsonb_build_object('requestId',gen_random_uuid(),'businessId','00000000-0000-4000-8000-000000000021','userId',auth.uid(),'id',null,'expectedVersion',null,'branchId','00000000-0000-4000-8000-000000000031','closureDate','2026-01-02','grossTotal','100.10','netTotal','-0.10','note','Nota original manual','reason',null) $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.c_assert(not has_table_privilege('authenticated','public.daily_closures','INSERT'),'direct create denied');
select pg_temp.c_assert(not has_table_privilege('service_role','public.daily_closures','UPDATE'),'service correction bypass denied');
select pg_temp.c_assert(not has_column_privilege('service_role','public.daily_closures','source','INSERT'),'legacy transport cannot forge manual origin');
select pg_temp.c_assert(has_column_privilege('service_role','public.daily_closures','raw_text','INSERT'),'legacy Inbox insertion retained');
select pg_temp.c_assert(not has_table_privilege('authenticated','public.closure_mutations','INSERT'),'audit forgery denied');
select pg_temp.c_assert(not has_function_privilege('authenticated','closures_private.mutate(uuid,uuid,text,jsonb)','EXECUTE'),'private engine denied');
select pg_temp.c_assert(not has_function_privilege('anon','public.save_closure_atomic(uuid,jsonb)','EXECUTE'),'anonymous RPC denied');
do $$ declare p jsonb; r jsonb; r2 jsonb; sid uuid; n int; rev text; begin
 p:=pg_temp.closure_input(); rev:=public.get_closures_revision('00000000-0000-4000-8000-000000000021'); r:=public.save_closure_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.c_assert(r->>'ok'='true','create: '||r::text); sid:=(r->>'id')::uuid;
 perform pg_temp.c_assert(public.get_closures_revision('00000000-0000-4000-8000-000000000021')<>rev,'revision changes');
 perform pg_temp.c_assert((select source='manual' and version=1 and gross_total=100.10 and net_total=-0.10 and status='pending' and parsed is null from public.daily_closures where id=sid),'factual manual source exact signed totals no invented approval/detail');
 r2:=public.save_closure_atomic('00000000-0000-4000-8000-000000000021',p); perform pg_temp.c_assert(r2=r,'repeated create returns receipt');
 r2:=public.save_closure_atomic('00000000-0000-4000-8000-000000000021',p||'{"note":"different"}');perform pg_temp.c_assert(r2->>'error'='closure_idempotency_conflict','changed payload denied');
 p:=p||jsonb_build_object('requestId',gen_random_uuid(),'id',sid,'expectedVersion',1,'note','Corregido','reason','Importe corregido','grossTotal','500.50');
 r2:=public.save_closure_atomic('00000000-0000-4000-8000-000000000021',p);perform pg_temp.c_assert(r2->>'version'='2','correction committed');
 perform pg_temp.c_assert((select raw_text='Nota original manual' and manual_note='Corregido' and gross_total=500.50 from public.daily_closures where id=sid),'original text immutable');
 r2:=public.save_closure_atomic('00000000-0000-4000-8000-000000000021',p||jsonb_build_object('requestId',gen_random_uuid()));perform pg_temp.c_assert(r2->>'error'='closure_conflict','CAS rejects stale version');
 r2:=public.archive_closure_atomic('00000000-0000-4000-8000-000000000021',jsonb_build_object('requestId',gen_random_uuid(),'businessId',p->>'businessId','userId',auth.uid(),'id',sid,'expectedVersion',2,'reason','Duplicado documentado'));perform pg_temp.c_assert(r2->>'version'='3','archive commits');
 perform pg_temp.c_assert((select archived_at is not null and gross_total=500.50 and source='manual' and raw_text='Nota original manual' from public.daily_closures where id=sid),'archive keeps historical facts');
 perform pg_temp.c_assert((select count(*) from public.closure_mutations where closure_id=sid)=3,'one audit per mutation');
 perform pg_temp.c_assert((select count(*) from public.activity_logs where target_id=sid)=3,'audit atomic');
 perform pg_temp.c_assert((select count(*) from public.sales)=0 and (select count(*) from public.expenses)=0 and (select count(*) from public.debt_payments)=0 and (select count(*) from public.stock_movements)=0,'closures do not create financial/stock transactions');
 p:=pg_temp.closure_input()||jsonb_build_object('id','00000000-0000-4000-8000-000000000091','expectedVersion',0,'reason','Revisión histórica');
 r:=public.save_closure_atomic('00000000-0000-4000-8000-000000000021',p); perform pg_temp.c_assert(r->>'ok'='true','legacy correction');
 perform pg_temp.c_assert((select source is null and raw_text='Original histórico' and parsed='{"incomes":[{"amount":100}]}'::jsonb and inconsistencies='["original inconsistency"]'::jsonb and status='approved' from public.daily_closures where id='00000000-0000-4000-8000-000000000091'),'no historical origin or received data rewritten');
 perform pg_temp.c_assert((select before_snapshot->>'gross_total'='100.00' from public.closure_mutations where request_id=(p->>'requestId')::uuid),'original amount audit retained');
end $$;
-- Invalid payloads leave no partial closure, revision or audit.
do $$ declare bad jsonb; r jsonb; n int; a int; rev text; begin
 select count(*) into n from public.daily_closures; select count(*) into a from public.closure_mutations; rev:=public.get_closures_revision('00000000-0000-4000-8000-000000000021');
 for bad in select * from jsonb_array_elements('[{"branchId":"00000000-0000-4000-8000-000000000033"},{"branchId":null},{"source":"manual"},{"grossTotal":"0.001"},{"grossTotal":"-1"},{"netTotal":"NaN"},{"closureDate":"2026-02-30"},{"closureDate":"2099-01-01"},{"userId":"00000000-0000-4000-8000-000000000002"}]'::jsonb) loop
  r:=public.save_closure_atomic('00000000-0000-4000-8000-000000000021',pg_temp.closure_input()||bad); perform pg_temp.c_assert(r->>'ok'='false','invalid data denied: '||bad::text||r::text);
 end loop;
 perform pg_temp.c_assert((select count(*) from public.daily_closures)=n and (select count(*) from public.closure_mutations)=a and public.get_closures_revision('00000000-0000-4000-8000-000000000021')=rev,'invalid requests fully rollback');
 for i in 2..10 loop
  perform set_config('request.jwt.claim.sub',('00000000-0000-4000-8000-'||lpad(i::text,12,'0')),true);
  r:=public.save_closure_atomic('00000000-0000-4000-8000-000000000021',pg_temp.closure_input());
  perform pg_temp.c_assert(r->>'ok'=case when i in(3,4,8,9) then 'false' else 'true' end,'role '||i::text);
 end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',true);
select pg_temp.c_assert((select count(*) from public.daily_closures where branch_id='00000000-0000-4000-8000-000000000032')=0,'branch RLS read');
select pg_temp.c_assert(public.save_closure_atomic('00000000-0000-4000-8000-000000000021',pg_temp.closure_input()||'{"branchId":"00000000-0000-4000-8000-000000000032"}')->>'error'='closure_branch_forbidden','branch write denied');
reset role;
update public.business_modules set enabled=false where module_key='daily_closures';
set local role authenticated;
select pg_temp.c_assert((select count(*) from public.daily_closures)=0,'disabled module hides records');
select pg_temp.c_assert(public.save_closure_atomic('00000000-0000-4000-8000-000000000021',pg_temp.closure_input())->>'error'='closure_module_disabled','disabled module blocks mutation');
rollback;
