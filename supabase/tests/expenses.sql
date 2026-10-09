-- Offline fixtures only. Every test rolls back. No remote database is used.
begin;
create function pg_temp.e_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin
 if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if;
end $$;
insert into auth.users(id,email) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'expense-'||i||'@example.invalid' from generate_series(1,7) i;
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000000020','Offline expense test');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000020' where id::text like '00000000-0000-4000-8000-%';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000004';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','Business A'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000020','Business B');
insert into public.business_members(id,business_id,user_id,role) select
 ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000021',
 ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,r::public.role_key
 from unnest(array['owner','admin','viewer','owner','employee','manager','accountant']) with ordinality t(r,i);
insert into public.business_members(business_id,user_id,role) values('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','owner');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000021','Branch A1'),
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000021','Branch A2'),
 ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000022','Branch B');
insert into public.business_modules(business_id,module_key,enabled) select id,'fixed_expenses',true from public.businesses;
insert into public.expenses(id,business_id,branch_id,name,amount,status) values
 ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','Legacy rent',1000,'historic-status');
insert into public.balance_snapshots(business_id,period_month,expenses_total) values('00000000-0000-4000-8000-000000000021','2026-01-01',1000);
create function pg_temp.expense_input(p_request text default '00000000-0000-4000-8000-000000000201',p_actor text default '00000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select jsonb_build_object('requestId',p_request,'businessId','00000000-0000-4000-8000-000000000021','userId',p_actor,'id',null,'expectedVersion',null,'branchId','00000000-0000-4000-8000-000000000031','name','Internet','category','Servicios','amount','123.45','dueDate','2026-10-31','status','paid')
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.e_assert(not has_table_privilege('authenticated','public.expenses','INSERT'),'direct expense insert denied');
select pg_temp.e_assert(not has_table_privilege('service_role','public.expenses','UPDATE'),'direct server update denied');
select pg_temp.e_assert(not has_table_privilege('authenticated','public.expense_mutations','DELETE'),'history immutable');
select pg_temp.e_assert(not has_function_privilege('authenticated','expenses_private.mutate(uuid,uuid,text,text,jsonb)','EXECUTE'),'private engine not exposed');
select pg_temp.e_assert(not has_function_privilege('anon','public.save_expense_atomic(uuid,jsonb)','EXECUTE'),'anonymous RPC denied');
select pg_temp.e_assert(not has_function_privilege('authenticated','public.mutate_expense_for_agent(uuid,uuid,text,jsonb)','EXECUTE'),'actor impersonation denied');
do $$ declare p jsonb:=pg_temp.expense_input(); r jsonb; r2 jsonb; eid uuid; state jsonb; begin
 r:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.e_assert(r->>'ok'='true','create expense '||r::text); eid:=(r->>'id')::uuid;
 perform pg_temp.e_assert((select amount=123.45 and status='paid' and source='manual' and version=1 from public.expenses where id=eid),'exact values and manual origin');
 perform pg_temp.e_assert((select count(*)=1 from public.expense_mutations where expense_id=eid),'one atomic receipt');
 perform pg_temp.e_assert((select expenses_data_stale and expenses_total=1000 from public.balance_snapshots),'snapshots invalidated without rewriting');
 perform pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p)=r,'idempotent replay');
 r2:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p||'{"amount":"999"}');
 perform pg_temp.e_assert(r2->>'error'='expense_idempotency_conflict','payload mismatch denied');
 p:=p||jsonb_build_object('requestId',gen_random_uuid(),'id',eid,'expectedVersion',1,'amount','200.10','branchId','00000000-0000-4000-8000-000000000032');
 r2:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.e_assert(r2->>'ok'='true' and r2->>'version'='2','edit with original version');
 perform pg_temp.e_assert((select before_snapshot->>'amount'='123.45' and after_snapshot->>'amount'='200.10' from public.expense_mutations where request_id=(p->>'requestId')::uuid),'full history preserved');
 perform pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_input())=r,'original receipt stable after edit');
 r2:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p||jsonb_build_object('requestId',gen_random_uuid()));
 perform pg_temp.e_assert(r2->>'error'='expense_conflict','stale version denied');
 state:=jsonb_build_object('requestId',gen_random_uuid(),'businessId','00000000-0000-4000-8000-000000000021','userId',auth.uid(),'id',eid,'expectedVersion',2,'reason','Carga duplicada');
 r2:=public.void_expense_atomic('00000000-0000-4000-8000-000000000021',state);
 perform pg_temp.e_assert(r2->>'ok'='true','void succeeds');
 perform pg_temp.e_assert((select record_status='voided' and amount=200.10 and status='paid' and void_reason='Carga duplicada' from public.expenses where id=eid),'void preserves original financial facts');
 perform pg_temp.e_assert(public.void_expense_atomic('00000000-0000-4000-8000-000000000021',state)=r2,'void replay');
 state:=state||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',3,'reason','Anulación equivocada');
 r2:=public.restore_expense_atomic('00000000-0000-4000-8000-000000000021',state);
 perform pg_temp.e_assert(r2->>'ok'='true' and r2->>'version'='4','recoverable restore');
 perform pg_temp.e_assert((select record_status='active' and void_reason is null and source='manual' and amount=200.10 from public.expenses where id=eid),'restore returns original facts');
 perform pg_temp.e_assert((select count(*)=4 from public.expense_mutations where expense_id=eid),'all four audit entries survive');
 perform pg_temp.e_assert((select version=0 and source is null and status='historic-status' from public.expenses where id='00000000-0000-4000-8000-000000000091'),'legacy not backfilled');
 perform pg_temp.e_assert((select count(*)=0 from public.debt_payments),'no payments executed');
end $$;
-- Invalid domain values, fabricated identities and cross-tenant branches roll back.
do $$ declare bad jsonb; r jsonb; n int; begin
 select count(*) into n from public.expenses;
 for bad in select * from jsonb_array_elements(jsonb_build_array(
  '{"amount":"0"}'::jsonb,'{"amount":12.34}','{"amount":"0.001"}','{"amount":"10000000000"}','{"amount":"NaN"}',
  '{"amount":"1e2"}','{"name":""}','{"category":""}','{"status":"deleted"}','{"dueDate":"2026-02-30"}',
  '{"dueDate":"0000-01-01"}','{"dueDate":"infinity"}','{"source":"whatsapp"}','{"expectedVersion":1}',
  '{"branchId":"00000000-0000-4000-8000-000000000033"}','{"userId":"00000000-0000-4000-8000-000000000002"}'
 )) loop
  r:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_input(gen_random_uuid()::text)||bad);
  perform pg_temp.e_assert(r->>'ok'='false','reject invalid '||bad::text);
  perform pg_temp.e_assert((select count(*) from public.expenses)=n,'no partial mutation');
 end loop;
end $$;
-- Runtime permissions checked again even for idempotent replays.
do $$ declare i int; r jsonb; actor text; begin
 for i in 2..7 loop
  actor:='00000000-0000-4000-8000-'||lpad(i::text,12,'0'); perform set_config('request.jwt.claim.sub',actor,true);
  r:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_input(gen_random_uuid()::text,actor));
  perform pg_temp.e_assert(r->>'ok'=case when i in(2,6) then 'true' else 'false' end,'role and active profile: '||i||' '||r::text);
  if i in(3,4,5) then perform pg_temp.e_assert((select count(*)=0 from public.expenses),'unauthorized expense reads denied'); end if;
 end loop;
end $$;
reset role;
update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000021';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_input())->>'error'='expense_module_disabled','replay requires live module permission');
select pg_temp.e_assert((select count(*)=0 from public.expenses),'disabled module read denied');
reset role;
update public.business_modules set enabled=true where business_id='00000000-0000-4000-8000-000000000021';
-- Force audit failure: no expense or receipt may survive its transaction.
create function pg_temp.break_expense_audit() returns trigger language plpgsql as $$ begin raise exception 'forced audit failure'; end $$;
create trigger test_expense_audit before insert on public.activity_logs for each row execute function pg_temp.break_expense_audit();
set local role authenticated;
do $$ declare n int; r jsonb; begin
 select count(*) into n from public.expenses;
 r:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_input(gen_random_uuid()::text));
 perform pg_temp.e_assert(r->>'ok'='false','audit failure is rejected');
 perform pg_temp.e_assert((select count(*) from public.expenses)=n,'audit failure rolls back expense');
end $$;
reset role;
drop trigger test_expense_audit on public.activity_logs;
set local role service_role;
select pg_temp.e_assert(public.mutate_expense_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','save',pg_temp.expense_input(gen_random_uuid()::text))->>'ok'='true','agent shares same engine');
select pg_temp.e_assert(public.mutate_expense_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000005','save',pg_temp.expense_input(gen_random_uuid()::text,'00000000-0000-4000-8000-000000000005'))->>'error'='expense_permission_denied','agent cannot upgrade employee permissions');
reset role;
-- Inbox expense approvals share the domain transaction and cannot infer payment.
insert into public.business_modules(business_id,module_key,enabled) values('00000000-0000-4000-8000-000000000021','inbox_ai',true);
insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,channel,raw) values
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','Operator','text','Offline expense'),
 ('00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000033','Other tenant','text','Offline other expense');
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status) values
 ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','expense','{"concept":"Internet","amount":45.67,"payment_method":"Efectivo","date":"2026-10-09"}','pending'),
 ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','expense','{"amount":45.67}','pending'),
 ('00000000-0000-4000-8000-000000000304','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','expense','{"amount":45.67}','rejected'),
 ('00000000-0000-4000-8000-000000000306','00000000-0000-4000-8000-000000000305','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000033','expense','{"amount":45.67}','pending');
create function pg_temp.expense_review() returns jsonb language sql as $$ select '{"branchId":"00000000-0000-4000-8000-000000000031","name":"Internet revisado","category":"Servicios","amount":"45.67","dueDate":null,"status":"pending"}'::jsonb $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.e_assert(not has_function_privilege('service_role','public.approve_expense_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'Inbox expense RPC cannot impersonate via service role');
do $$ declare p jsonb:=pg_temp.expense_review(); expected jsonb:='{"concept":"Internet","amount":45.67,"payment_method":"Efectivo","date":"2026-10-09"}'; r jsonb; r2 jsonb; n int; begin
 select count(*) into n from public.expenses;
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302',expected,p-'status');
 perform pg_temp.e_assert(r->>'ok'='false','explicit payment status mandatory');
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302','{"amount":99}',p);
 perform pg_temp.e_assert(r->>'error'='expense_extraction_changed','stale reviewed extraction denied');
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302',expected,p||'{"branchId":"00000000-0000-4000-8000-000000000032"}');
 perform pg_temp.e_assert(r->>'error'='expense_branch_forbidden','message and extraction branch immutable');
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000302',expected,p);
 perform pg_temp.e_assert(r->>'error'='expense_permission_denied','approval actor must match authenticated identity');
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000306','{"amount":45.67}',p);
 perform pg_temp.e_assert(r->>'error'='expense_permission_denied','foreign message/extraction refused despite dual membership');
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000304','{"amount":45.67}',p);
 perform pg_temp.e_assert(r->>'error'='expense_extraction_closed','closed extraction refused');
 perform pg_temp.e_assert((select count(*) from public.expenses)=n,'all rejected review attempts leave no expense');
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302',expected,p);
 perform pg_temp.e_assert(r->>'ok'='true','reviewed Inbox expense persisted: '||r::text);
 perform pg_temp.e_assert((select count(*) from public.expenses)=n+1,'exactly one expense created');
 perform pg_temp.e_assert((select source='inbox' and status='pending' and due_date is null and amount=45.67 from public.expenses where id=(r->>'id')::uuid),'explicit reviewed status and no inferred date');
 perform pg_temp.e_assert((select status='approved' and approved_by=auth.uid() and target_entity='expenses' and target_record_id=(r->>'id')::uuid and fields=expected from public.ai_extractions where id='00000000-0000-4000-8000-000000000302'),'expense, actor and approval atomic; extracted fields preserved');
 perform pg_temp.e_assert((select count(*)=1 from public.expense_mutations where expense_id=(r->>'id')::uuid),'single atomic audit receipt');
 r2:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302',expected,p);
 perform pg_temp.e_assert(r2=r,'lost response replays same original result');
 r2:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302',expected,p||'{"status":"paid"}');
 perform pg_temp.e_assert(r2->>'error'='expense_idempotency_conflict','same extraction cannot create with modified review');
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
 r2:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302',expected,p);
 perform pg_temp.e_assert(r2->>'error'='expense_idempotency_conflict','other actor cannot take original receipt');
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
end $$;
reset role;
create function pg_temp.break_expense_approval() returns trigger language plpgsql as $$ begin raise exception 'forced approval failure'; end $$;
create trigger test_expense_approval before update on public.ai_extractions for each row execute function pg_temp.break_expense_approval();
set local role authenticated;
do $$ declare n int; audits int; r jsonb; begin
 select count(*) into n from public.expenses; select count(*) into audits from public.expense_mutations;
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000303','{"amount":45.67}',pg_temp.expense_review());
 perform pg_temp.e_assert(r->>'ok'='false','forced approval failure rejected');
 perform pg_temp.e_assert((select count(*) from public.expenses)=n,'approval failure rolls back expense');
 perform pg_temp.e_assert((select count(*) from public.expense_mutations)=audits,'approval failure rolls back audit');
 perform pg_temp.e_assert((select status='pending' and target_record_id is null from public.ai_extractions where id='00000000-0000-4000-8000-000000000303'),'approval failure preserves extraction');
end $$;
reset role;
drop trigger test_expense_approval on public.ai_extractions;
update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000021' and module_key='inbox_ai';
set local role authenticated;
select pg_temp.e_assert(public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000303','{"amount":45.67}',pg_temp.expense_review())->>'error'='expense_module_disabled','Inbox module checked at action time');
reset role;
rollback;
