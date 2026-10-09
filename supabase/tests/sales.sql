-- Offline fixtures only; every write rolls back. Run via npm run test:db:stock
-- or against LOCAL Supabase after migrations. Never run fixtures in production.
begin;
create function pg_temp.s_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if;
end; $$;
create function pg_temp.s_throws(p_sql text,p_message text) returns void language plpgsql security invoker as $$ begin
  begin execute p_sql;
  exception when others then
    if position(p_message in sqlerrm)>0 then return; end if;
    raise exception 'Expected %, received %',p_message,sqlerrm;
  end;
  raise exception 'Expected %, but statement succeeded',p_message;
end; $$;
insert into auth.users(id,email) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'sale-'||i||'@example.invalid' from generate_series(1,11) i;
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000000020','Offline sales test');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000020' where id::text like '00000000-0000-4000-8000-%';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000004';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','Stock A'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000020','Stock B');
insert into public.business_members(id,business_id,user_id,role) select
 ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000021',('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 r::public.role_key from unnest(array['owner','admin','viewer','owner','kitchen','employee','cashier','waiter','delivery','manager','accountant']) with ordinality t(r,i);
-- Dual membership must not allow combining an ingredient from one business with
-- a branch from another business, even for an unrestricted owner.
insert into public.business_members(business_id,user_id,role) values('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','owner');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000021','Branch A1'),
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000021','Branch A2'),
 ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000022','Branch B');
insert into public.branch_assignments(business_member_id,branch_id) select
 ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000031' from generate_series(3,9) i;
insert into public.ingredients(id,business_id,name,unit,avg_unit_cost) values
 ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000021','Beef','kg',1000),
 ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000021','Milk','ml',1),
 ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000021','Bun','unit',100),
 ('00000000-0000-4000-8000-000000000044','00000000-0000-4000-8000-000000000022','Foreign','kg',1000);

insert into public.business_modules(business_id,module_key,enabled) select b.id,k::public.module_key,true from public.businesses b cross join unnest(array['sales','inbox_ai']) k;
insert into public.products(id,business_id,name,category,price,cost) values
 ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000021','Burger','Food',10,0),
 ('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000022','Foreign','Food',20,0);
insert into public.recipes(id,product_id) values('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000061');
insert into public.recipe_items(recipe_id,ingredient_id,name,qty,quantity,unit,unit_cost,share) values
 ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000041','Beef','180 g',180,'g',1000,100);
insert into public.customers(id,business_id,name) values('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000021','Local client'),('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000022','Foreign client');
insert into public.sales(id,business_id,branch_id,channel,amount,occurred_at) values('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','salon',1000,'2026-01-01T12:00:00Z');
create function pg_temp.sale_input(p_request text default '00000000-0000-4000-8000-000000000201',p_actor text default '00000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select jsonb_build_object('requestId',p_request,'businessId','00000000-0000-4000-8000-000000000021','userId',p_actor,'id',null,'expectedVersion',null,'branchId','00000000-0000-4000-8000-000000000031','occurredAt','2026-01-01T12:00:00Z','channel','salon','paymentMethod','Efectivo','customerId','00000000-0000-4000-8000-000000000081','notes',null,'items',jsonb_build_array(jsonb_build_object('id',null,'productId','00000000-0000-4000-8000-000000000061','description','Burger','quantity','2','unitPrice','10.25'),jsonb_build_object('id',null,'productId',null,'description','Delivery fee','quantity','1','unitPrice','0.10')))
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.s_assert(not has_table_privilege('authenticated','public.sales','INSERT'),'direct sales insert revoked');
select pg_temp.s_assert(not has_table_privilege('service_role','public.sales','UPDATE'),'server direct sales update revoked');
select pg_temp.s_assert(not has_table_privilege('authenticated','public.sale_items','INSERT'),'direct items denied');
select pg_temp.s_assert(not has_table_privilege('service_role','public.sale_mutations','INSERT'),'receipts unforgeable');
select pg_temp.s_assert(not has_function_privilege('authenticated','sales_private.mutate(uuid,uuid,text,text,jsonb,boolean)','EXECUTE'),'shared private engine uncallable');
select pg_temp.s_assert(not has_function_privilege('anon','public.save_sale_atomic(uuid,jsonb)','EXECUTE'),'anonymous RPC denied');
do $$ declare r jsonb; r2 jsonb; p jsonb; sid uuid; n bigint; begin
 p:=pg_temp.sale_input();
 r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.s_assert(r->>'ok'='true','create sale: '||r::text); sid:=(r->>'id')::uuid;
 perform pg_temp.s_assert((select amount=20.6 and sale_kind='detailed' and source='manual' and currency is null and version=1 from public.sales where id=sid),'exact totals and factual source');
 perform pg_temp.s_assert((select count(*) from public.sale_items where sale_id=sid)=2,'all lines saved');
 perform pg_temp.s_assert((select recipe_snapshot->>'state'='complete' and recipe_snapshot->'ingredients'->0->>'theoreticalQuantity'='0.360' from public.sale_items where sale_id=sid and position=1),'BOM snapshot converts grams to kg');
 perform pg_temp.s_assert((select count(*) from public.stock_movements)=0,'sales do not touch physical stock');
 perform pg_temp.s_assert((select sale_kind='legacy' and source is null and currency is null from public.sales where id='00000000-0000-4000-8000-000000000091'),'legacy unknown metadata retained');
 r2:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p); perform pg_temp.s_assert(r2=r,'same request replays result');
 r2:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',jsonb_set(p,'{notes}','"different"'));perform pg_temp.s_assert(r2->>'error'='sale_idempotency_conflict','same key different data denied');
 p:=jsonb_set(p,'{items}',(select jsonb_agg((p->'items'->(position-1))||jsonb_build_object('id',id) order by position) from public.sale_items where sale_id=sid));
 p:=p||jsonb_build_object('requestId','00000000-0000-4000-8000-000000000202','id',sid,'expectedVersion',1,'notes','Corrected note');
 r2:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);perform pg_temp.s_assert(r2->>'ok'='true' and r2->>'version'='2','CAS edit');
 r2:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p||jsonb_build_object('requestId','00000000-0000-4000-8000-000000000203'));perform pg_temp.s_assert(r2->>'error'='sale_conflict','stale CAS denied');
 r2:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',pg_temp.sale_input());perform pg_temp.s_assert(r2=r,'old receipt survives later edits');
 select count(*) into n from public.sale_mutations;
 r2:=public.void_sale_atomic('00000000-0000-4000-8000-000000000021',jsonb_build_object('requestId','00000000-0000-4000-8000-000000000204','businessId','00000000-0000-4000-8000-000000000021','userId',auth.uid(),'id',sid,'expectedVersion',2,'reason','Wrong charge'));
 perform pg_temp.s_assert(r2->>'ok'='true','void: '||r2::text);
 perform pg_temp.s_assert((select status='voided' and amount=20.6 and version=3 and void_reason='Wrong charge' from public.sales where id=sid),'void preserves income facts');
 perform pg_temp.s_assert((select count(*) from public.sale_items where sale_id=sid)=2,'void preserves detail');
 perform pg_temp.s_assert((select count(*) from public.sale_mutations)=n+1,'void atomic audit');
 perform pg_temp.s_assert((select sum(amount) from public.sales where status='active')=1000,'void excluded from active revenue');
end $$;


-- Rejected input cannot leave a partial sale, item, snapshot or audit row.
do $$ declare p jsonb; r jsonb; bad jsonb; n int; begin
 select count(*) into n from public.sales;
 for bad in select * from jsonb_array_elements(jsonb_build_array(
  jsonb_build_object('branchId','00000000-0000-4000-8000-000000000033'),
  jsonb_build_object('customerId','00000000-0000-4000-8000-000000000082'),
  jsonb_build_object('userId','00000000-0000-4000-8000-000000000002'),
  jsonb_build_object('source','whatsapp'),jsonb_build_object('currency','ARS'),
  jsonb_build_object('occurredAt','2026-02-30T12:00:00Z'),jsonb_build_object('occurredAt','2026-01-01T24:00:00Z'),jsonb_build_object('occurredAt','2099-01-01T00:00:00Z'),
  jsonb_build_object('channel','unknown'),jsonb_build_object('paymentMethod',''),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',null,'productId','00000000-0000-4000-8000-000000000062','description','Foreign','quantity','1','unitPrice','2'))),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',null,'productId',null,'description','Zero','quantity','0','unitPrice','2'))),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',null,'productId',null,'description','Fractions','quantity','1.0000001','unitPrice','2'))),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',null,'productId',null,'description','Fraction price','quantity','1','unitPrice','0.001'))),
  jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',null,'productId',null,'description','Overflow','quantity','999999999999','unitPrice','9999999999.99')))
 )) loop
  p:=pg_temp.sale_input(gen_random_uuid()::text)||bad;
  r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);
  perform pg_temp.s_assert(r->>'ok'='false','invalid rejected: '||bad::text||' -> '||r::text);
  perform pg_temp.s_assert((select count(*) from public.sales)=n,'invalid write fully rolled back');
 end loop;
 perform pg_temp.s_throws($q$insert into public.sales(business_id,channel,amount) values('00000000-0000-4000-8000-000000000021','salon',1)$q$,'permission denied');
 perform pg_temp.s_throws($q$update public.sales set amount=999 where id='00000000-0000-4000-8000-000000000091'$q$,'permission denied');
 perform pg_temp.s_throws($q$delete from public.sales where id='00000000-0000-4000-8000-000000000091'$q$,'permission denied');
 perform pg_temp.s_throws($q$insert into public.sale_items(sale_id,business_id,position,description,quantity,unit_price,total) values('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000021',1,'Forged',1,1,1)$q$,'permission denied');
end $$;
-- All operational roles keep their established matrix. Viewer/accountant and
-- inactive profiles are denied; business/branch assignments are checked live.
do $$ declare actor uuid; n int; r jsonb; i int; begin
 for i in 2..11 loop
  actor:=('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',pg_temp.sale_input(gen_random_uuid()::text,actor::text));
  perform pg_temp.s_assert(r->>'ok'=case when i in(3,4,11) then 'false' else 'true' end,'role/profile actor '||i||': '||r::text);
 end loop;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',true);
 r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',pg_temp.sale_input(gen_random_uuid()::text,auth.uid()::text)||jsonb_build_object('branchId','00000000-0000-4000-8000-000000000032'));
 perform pg_temp.s_assert(r->>'error'='sale_branch_forbidden','cashier cannot write other branch');
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
end $$;
-- A persisted recipe edit must not reinterpret past sale consumption.
reset role;
insert into public.balance_snapshots(business_id,period_month,sales_total) values('00000000-0000-4000-8000-000000000021','2026-01-01',5000),('00000000-0000-4000-8000-000000000021','2026-02-01',5000);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare p jsonb; r jsonb; sid uuid; original jsonb; begin
 p:=pg_temp.sale_input(gen_random_uuid()::text);r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);sid:=(r->>'id')::uuid;
 select recipe_snapshot into original from public.sale_items where sale_id=sid and position=1;
 p:=jsonb_set(p,'{items}',(select jsonb_agg((p->'items'->(position-1))||jsonb_build_object('id',id) order by position) from public.sale_items where sale_id=sid));
 update public.recipe_items set quantity=200 where recipe_id='00000000-0000-4000-8000-000000000071';
 p:=p||jsonb_build_object('requestId',gen_random_uuid(),'id',sid,'expectedVersion',1,'notes','Header only','occurredAt','2026-02-01T12:00:00Z');
 r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.s_assert(r->>'ok'='true','edit after BOM change');
 perform pg_temp.s_assert((select recipe_snapshot=original from public.sale_items where sale_id=sid and position=1),'header edit preserves original BOM');
 perform pg_temp.s_assert((select count(*) from public.balance_snapshots where sales_data_stale)=2,'both old and new civil month snapshots invalidated');
 p:=jsonb_set(p||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',2),'{items,0,quantity}','"3"');r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.s_assert((select (recipe_snapshot->'ingredients'->0->>'theoreticalQuantity')::numeric=0.54 from public.sale_items where sale_id=sid and position=1),'quantity correction scales original recipe');
end $$;
-- An audit sink failure rolls back the entire transaction, not just the receipt.
reset role;
create function pg_temp.reject_sale_audit() returns trigger language plpgsql as $$ begin if new.action like 'sale.%' then raise exception 'forced_audit_failure'; end if;return new;end $$;
create trigger sale_test_reject_audit before insert on public.activity_logs for each row execute function pg_temp.reject_sale_audit();
set local role authenticated;
do $$ declare n int; r jsonb; begin
 select count(*) into n from public.sales;
 r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',pg_temp.sale_input(gen_random_uuid()::text));
 perform pg_temp.s_assert(r->>'ok'='false','audit failure reported');
 perform pg_temp.s_assert((select count(*) from public.sales)=n,'sale rollback when audit failed');
end $$;
reset role;drop trigger sale_test_reject_audit on public.activity_logs;
-- Server role is a verified transport, not an authorization shortcut.
set local role service_role;
do $$ declare r jsonb; begin
 r:=public.mutate_sale_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','save',pg_temp.sale_input(gen_random_uuid()::text));
 perform pg_temp.s_assert(r->>'ok'='true','agent shares transaction engine: '||r::text);
 perform pg_temp.s_assert((select source='whatsapp' from public.sales where id=(r->>'id')::uuid),'agent source cannot become manual');
 r:=public.mutate_sale_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000003','save',pg_temp.sale_input(gen_random_uuid()::text,'00000000-0000-4000-8000-000000000003'));
 perform pg_temp.s_assert(r->>'error'='sale_permission_denied','agent viewer denied');
 r:=public.mutate_sale_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000004','save',pg_temp.sale_input(gen_random_uuid()::text,'00000000-0000-4000-8000-000000000004'));
 perform pg_temp.s_assert(r->>'error'='sale_permission_denied','agent inactive denied');
 perform pg_temp.s_throws($q$update public.sales set amount=2$q$,'permission denied');
end $$;
reset role;
-- Inbox fixtures are real extraction/message schema, and remain transaction-local.
insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,channel,raw) values
 ('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','Operator','text','Offline summary');
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status) values
 ('00000000-0000-4000-8000-000000000302','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','sale','{"total_amount":30}','pending'),
 ('00000000-0000-4000-8000-000000000303','00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','sale','{"total_amount":30}','pending');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare p jsonb; r jsonb; n int; begin
 p:='{"kind":"summary","branchId":"00000000-0000-4000-8000-000000000031","occurredAt":"2026-01-01T12:00:00Z","paymentMethod":null,"notes":null,"channels":[{"channel":"salon","amount":"20"},{"channel":"whatsapp","amount":"10"}]}';
 select count(*) into n from public.sales;
 r:=public.approve_sale_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302','{"total_amount":30}',p);
 perform pg_temp.s_assert(r->>'ok'='true','Inbox approved: '||r::text);
 perform pg_temp.s_assert((select count(*) from public.sales)=n+2,'one summary row per stated channel');
 perform pg_temp.s_assert((select status='approved' and approved_by=auth.uid() and target_record_id=(r->>'id')::uuid from public.ai_extractions where id='00000000-0000-4000-8000-000000000302'),'approval commits with sale');
 perform pg_temp.s_assert((select sale_kind='summary' and source='inbox' and payment_method is null from public.sales where id=(r->>'id')::uuid),'summary is explicit and method unknown');
 perform pg_temp.s_assert(not exists(select 1 from public.sale_items where sale_id=(r->>'id')::uuid),'summary has no invented products');
 perform pg_temp.s_assert(public.approve_sale_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000302','{"total_amount":30}',p)=r,'Inbox retry returns exact receipt');
 select count(*) into n from public.sales;
 r:=public.approve_sale_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000303','{"total_amount":30}',jsonb_set(p,'{channels,1,amount}','"0.001"'));
 perform pg_temp.s_assert(r->>'ok'='false','second invalid channel fails');
 perform pg_temp.s_assert((select count(*) from public.sales)=n,'whole multi-channel batch rolls back');
 perform pg_temp.s_assert((select status='pending' from public.ai_extractions where id='00000000-0000-4000-8000-000000000303'),'approval also rolls back');
 r:=public.approve_sale_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000303','{"total_amount":31}',p);
 perform pg_temp.s_assert(r->>'error'='sale_extraction_changed','stale review rejected');
end $$;
reset role;
-- Direct reads remain tenant/branch/active-profile isolated.
insert into public.sales(id,business_id,branch_id,channel,amount) values
 ('00000000-0000-4000-8000-000000000092','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000032','salon',100),
 ('00000000-0000-4000-8000-000000000093','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000033','salon',200),
 ('00000000-0000-4000-8000-000000000094','00000000-0000-4000-8000-000000000021',null,'salon',300);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',true);
select pg_temp.s_assert(not exists(select 1 from public.sales where branch_id='00000000-0000-4000-8000-000000000032' or business_id='00000000-0000-4000-8000-000000000022'),'cashier reads only assigned branches and business');
select pg_temp.s_assert(exists(select 1 from public.sales where id='00000000-0000-4000-8000-000000000094'),'legacy business-wide visibility preserved');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.s_assert(not exists(select 1 from public.sales),'inactive profile reads no sales');
select pg_temp.s_assert(not exists(select 1 from public.sale_items),'inactive profile reads no detail');
select pg_temp.s_assert(not exists(select 1 from public.sale_mutations),'inactive profile reads no audit');

-- Both serial orders of claim/cancel are covered here. These isolated checks
-- verify durable recovery state and real SQL receipts, not native multi-session
-- concurrency or delivery of the final response to the WhatsApp provider.
reset role;
insert into public.whatsapp_authorized_conversations(id,business_id,provider_conversation_id,conversation_type)
values('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000021','sales-audit-isolated','direct');
set local role service_role;
do $$
declare
 p_pending uuid;
 p_business uuid:='00000000-0000-4000-8000-000000000021';
 p_member uuid:='00000000-0000-4000-8000-000000000101';
 p_conversation uuid:='00000000-0000-4000-8000-000000000401';
 result jsonb; input jsonb; before_revision text; after_revision text;
begin
 p_pending:=(public.replace_whatsapp_agent_pending(p_business,p_member,p_conversation,'confirmation','sales.create',
  '{"requestId":"00000000-0000-4000-8000-000000000402"}',now()+interval '10 minutes')->>'id')::uuid;
 perform pg_temp.s_assert(public.claim_sales_pending_execution(p_business,p_member,p_conversation,p_pending,false),'first sales claim wins');
 perform pg_temp.s_assert(not public.claim_sales_pending_execution(p_business,p_member,p_conversation,p_pending,false),'stale fresh confirmation loses');
 perform pg_temp.s_assert((select consumed_at is null and arguments->>'__resultUncertain'='true'
  from public.whatsapp_agent_pending_operations where id=p_pending),'recovery marker is durable before sales RPC');
 perform pg_temp.s_assert(public.claim_sales_pending_execution(p_business,p_member,p_conversation,p_pending,true),'recovery after claim-only interruption');

 before_revision:=public.get_sales_revision(p_business);
 input:=pg_temp.sale_input('00000000-0000-4000-8000-000000000402');
 result:=public.mutate_sale_for_agent(p_business,'00000000-0000-4000-8000-000000000001','save',input);
 perform pg_temp.s_assert(result->>'ok'='true','sales transaction succeeds while durable marker remains');
 after_revision:=public.get_sales_revision(p_business);
 perform pg_temp.s_assert(after_revision::bigint=before_revision::bigint+1,'sales mutation atomically advances revision');
 perform pg_temp.s_assert(public.claim_sales_pending_execution(p_business,p_member,p_conversation,p_pending,true),'recovery after sales transaction');
 perform pg_temp.s_assert(public.mutate_sale_for_agent(p_business,'00000000-0000-4000-8000-000000000001','save',input)=result,'recovery replays exact sales receipt');
 perform pg_temp.s_assert(public.get_sales_revision(p_business)=after_revision,'receipt replay does not advance revision');

 result:=public.cancel_sales_pending_execution(p_business,p_member,p_conversation,p_pending);
 perform pg_temp.s_assert(result->>'consumed'='true' and result->>'resultUncertain'='true','claim then cancellation reports uncertain outcome');
 perform pg_temp.s_assert(not public.claim_sales_pending_execution(p_business,p_member,p_conversation,p_pending,true),'cancelled recovery cannot be reclaimed');
 p_pending:=(public.replace_whatsapp_agent_pending(p_business,p_member,p_conversation,'confirmation','sales.create',
  '{"requestId":"00000000-0000-4000-8000-000000000403"}',now()+interval '10 minutes')->>'id')::uuid;
 result:=public.cancel_sales_pending_execution(p_business,p_member,p_conversation,p_pending);
 perform pg_temp.s_assert(result->>'consumed'='true' and result->>'resultUncertain'='false','cancellation before claim has no execution uncertainty');
 perform pg_temp.s_assert(not public.claim_sales_pending_execution(p_business,p_member,p_conversation,p_pending,false),'claim cannot start a cancelled operation');
 perform pg_temp.s_assert(not has_table_privilege('service_role','sales_private.revisions','UPDATE'),'API service role cannot reset sales revision');
end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
-- Stable line identity survives deleting an earlier item after recipe changes.
do $$ declare p jsonb; r jsonb; sid uuid; line_id uuid; original jsonb; before_revision text; begin
 p:=pg_temp.sale_input(gen_random_uuid()::text);
 p:=jsonb_set(p,'{items}',jsonb_build_array(p->'items'->1,p->'items'->0));
 r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);sid:=(r->>'id')::uuid;
 select id,recipe_snapshot into line_id,original from public.sale_items where sale_id=sid and position=2;
 update public.recipe_items set quantity=222 where recipe_id='00000000-0000-4000-8000-000000000071';
 p:=p||jsonb_build_object('id',sid,'expectedVersion',1,'requestId',gen_random_uuid(),'items',jsonb_build_array((p->'items'->1)||jsonb_build_object('id',line_id)));
 r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.s_assert(r->>'ok'='true','delete prior line edit succeeds');
 perform pg_temp.s_assert((select recipe_snapshot=original and position=1 from public.sale_items where id=line_id),'remaining line retains historical BOM and identity');
 -- Exact high-precision quantities remain strings in every audit snapshot.
 p:=pg_temp.sale_input(gen_random_uuid()::text);
 p:=jsonb_set(p,'{items,0,quantity}','"999999999999.123456"');
 p:=jsonb_set(p,'{items,0,unitPrice}','"0"');
 before_revision:=public.get_sales_revision('00000000-0000-4000-8000-000000000021');
 r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021',p);sid:=(r->>'id')::uuid;
 perform pg_temp.s_assert(r->>'ok'='true','valid full numeric18_6 range accepted with another positive line');
 perform pg_temp.s_assert((select after_snapshot->'items'->0->>'quantity'='999999999999.123456' and jsonb_typeof(after_snapshot->'items'->0->'quantity')='string' from public.sale_mutations where sale_id=sid),'snapshot does not lose decimals in JSON clients');
 perform pg_temp.s_assert(public.get_sales_revision('00000000-0000-4000-8000-000000000021')::bigint=before_revision::bigint+1,'mutation revision is atomic');
end $$;
rollback;
