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
insert into auth.users(id,email) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'stock-'||i||'@example.invalid' from generate_series(1,11) i;
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000000020','Offline stock test');
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
-- Model an old balance/history mismatch without any application write bypass.
-- Only this rolled-back database-owner fixture disables triggers. Deployment
-- never disables triggers, rebuilds current, or replays these historical rows.
insert into public.stock_items(ingredient_id,branch_id,current,min) values
 ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031',12,2);
alter table public.stock_movements disable trigger stock_movement_authorize;
alter table public.stock_movements disable trigger stock_movement_lock;
alter table public.stock_movements disable trigger stock_movement_validate;
alter table public.stock_movements disable trigger stock_movement_apply;
insert into public.stock_movements(id,ingredient_id,branch_id,reason,qty) values
 ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','purchase',999);
alter table public.stock_movements enable trigger stock_movement_authorize;
alter table public.stock_movements enable trigger stock_movement_lock;
alter table public.stock_movements enable trigger stock_movement_validate;
alter table public.stock_movements enable trigger stock_movement_apply;

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.s_assert(not has_column_privilege('authenticated','public.stock_items','current','UPDATE'),'no silent Data API balance update grant');
select pg_temp.s_assert(not has_column_privilege('service_role','public.stock_items','current','UPDATE'),'server transports cannot bypass ledger either');
select pg_temp.s_assert(not has_column_privilege('authenticated','public.stock_items','current','INSERT'),'nonzero initial balance requires event');
select pg_temp.s_assert(not has_table_privilege('authenticated','public.stock_movements','DELETE'),'append-only ledger grant');
select pg_temp.s_assert(not has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='stock_private' and p.proname='apply_movement'),'EXECUTE'),'derived trigger not callable');
select pg_temp.s_assert(not has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='stock_private' and p.proname='lock_movement_ingredient'),'EXECUTE'),'lock-only trigger not callable');
select pg_temp.s_assert(not (select prosecdef from pg_proc where oid='public.record_stock_movement_atomic(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure),'shared RPC invoker');
select pg_temp.s_assert(not (select prosecdef from pg_proc where oid='public.adjust_stock_for_agent(uuid,uuid,uuid,uuid,text,numeric,text,text)'::regprocedure),'WhatsApp RPC invoker');
select pg_temp.s_assert(to_regprocedure('public.adjust_stock_manual(uuid,uuid,text,numeric)') is null,'old unaudited manual overload gone');
select pg_temp.s_assert(to_regprocedure('public.adjust_stock_for_agent(uuid,uuid,uuid,text,numeric)') is null,'old actorless agent overload gone');
select pg_temp.s_assert(not has_function_privilege('authenticated','public.approve_invoice_atomic(uuid,uuid,uuid)','EXECUTE'),'invoice approval server-only');
select pg_temp.s_assert(not has_function_privilege('anon','public.adjust_stock_manual(uuid,uuid,text,numeric,text,text)','EXECUTE'),'anon denied');

do $$ declare r record; n bigint; b numeric; begin
  select count(*) into n from public.activity_logs where action='stock.movement_recorded';
  select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',250,'Received delivery','g');
  perform pg_temp.s_assert(r.new_current=12.25 and r.delta=0.25,'g to kg and legacy current preserved');
  perform pg_temp.s_assert((select current from public.stock_items where id=r.stock_item_id)=12.25,'balance persisted once');
  perform pg_temp.s_assert((select count(*) from public.activity_logs where action='stock.movement_recorded')=n+1,'exactly one atomic audit');
  perform pg_temp.s_assert(exists(select 1 from public.stock_movements where stock_item_id=r.stock_item_id and qty=0.25
    and input_quantity=250 and input_unit='g' and base_unit='kg' and actor_id=auth.uid() and actor_role='owner'
    and source='manual' and reason_note='Received delivery' and balance_before=12 and balance_after=12.25),'movement stores real actor/input/base/snapshots');
  perform pg_temp.s_assert((select qty=999 and business_id is null and balance_after is null from public.stock_movements where id='00000000-0000-4000-8000-000000000051'),'legacy history unchanged, not reinterpreted');
  select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','out',100,'Kitchen use','g');
  perform pg_temp.s_assert(r.new_current=12.15 and r.delta=-0.1,'out reduces base balance once');
  select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','waste',50,'Spoilage','g');
  perform pg_temp.s_assert(r.new_current=12.1 and r.delta=-0.05,'waste reduces base balance once');
  select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','set',0,'Physical count: empty','kg');
  perform pg_temp.s_assert(r.new_current=0 and r.delta=-12.1,'set zero records correcting event');
  select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',0.001,'Precise restock','g');
  perform pg_temp.s_assert(r.new_current=0.000001 and r.delta=0.000001,'six-decimal base stock retained');
  select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000031','in',2,'Milk received','l');
  perform pg_temp.s_assert(r.new_current=2000 and r.delta=2000,'l to ml');
  select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000031','in',3,'Buns','unidades');
  perform pg_temp.s_assert(r.new_current=3,'unit alias accepted');
  select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000031','set',3,'Recount unchanged',null);
  perform pg_temp.s_assert(r.delta=0,'no-op recount still auditable');
end; $$;

-- Every failure leaves both stock and ledger unchanged.
do $$ declare q text; n bigint; b numeric; begin
  select count(*) into n from public.stock_movements;
  select current into b from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041';
  foreach q in array array['null','-1','0','''NaN''','''Infinity''','''-Infinity'''] loop
    perform pg_temp.s_throws(format('select public.adjust_stock_manual(''00000000-0000-4000-8000-000000000041'',''00000000-0000-4000-8000-000000000031'',''in'',%s,''Test'',''kg'')',q),'invalid_stock_quantity');
  end loop;
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','out',1,'Too much','kg')$q$,'insufficient_stock');
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,' ','kg')$q$,'stock_reason_required');
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,repeat('x',1001),'kg')$q$,'stock_reason_required');
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'Density not inferred','ml')$q$,'incompatible_stock_units');
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'Packs not inferred','box')$q$,'incompatible_stock_units');
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',0.0001,'No silent rounding','g')$q$,'stock_quantity_precision');
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','delete',1,'Bad operation','kg')$q$,'invalid_stock_operation');
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n,'invalid writes create no movement');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041')=b,'invalid writes preserve balance');
end; $$;
-- REST cannot inject balances, rewrite history, change identity, spoof actor or source.
select pg_temp.s_throws($q$update public.stock_items set current=500$q$,'permission denied');
select pg_temp.s_throws($q$insert into public.stock_items(ingredient_id,branch_id,current) values('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000032',55)$q$,'permission denied');
select pg_temp.s_throws($q$update public.stock_items set ingredient_id='00000000-0000-4000-8000-000000000043'$q$,'permission denied');
select pg_temp.s_throws($q$delete from public.stock_items$q$,'permission denied');
select pg_temp.s_throws($q$update public.stock_movements set qty=999$q$,'permission denied');
select pg_temp.s_throws($q$delete from public.stock_movements$q$,'permission denied');
select pg_temp.s_throws($q$select public.record_stock_movement_atomic('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'Spoof actor','kg')$q$,'stock_actor_forbidden');
select pg_temp.s_throws($q$select public.record_stock_movement_atomic('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'Spoof origin','kg','whatsapp')$q$,'stock_source_forbidden');
select pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000044','00000000-0000-4000-8000-000000000031','in',1,'Mixed tenant','kg')$q$,'stock_branch_forbidden');
-- Authorized direct INSERT is the same domain boundary, never an orphan history.
insert into public.stock_movements(ingredient_id,branch_id,reason,qty,operation,input_quantity,reason_note,input_unit,balance_after,actor_role)
 values('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000031','purchase',900,'in',2,'Direct API delivery','unit',999,'owner');
select pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000043')=5,'REST movement computes current, ignores forged qty/balance');

-- Operational roles retain their exact current permission scope.
do $$ declare actor text; r record; begin
  foreach actor in array array['00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008','00000000-0000-4000-8000-000000000009'] loop
    perform set_config('request.jwt.claim.sub',actor,true);
    select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000031','in',1,'Assigned branch',null);
    perform pg_temp.s_assert(r.delta=1,'existing operational role allowed '||actor);
    update public.ingredients set avg_unit_cost=999999 where id='00000000-0000-4000-8000-000000000043';
    perform pg_temp.s_assert((select avg_unit_cost from public.ingredients where id='00000000-0000-4000-8000-000000000043')=100,'ingredient write RLS is not broadened to acquire stock locks');
    perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000032','in',1,'Unassigned branch',null)$q$,'stock_branch_forbidden');
    perform pg_temp.s_assert(not exists(select 1 from public.stock_items where branch_id='00000000-0000-4000-8000-000000000033'),'foreign balance hidden');
  end loop;
  foreach actor in array array['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000011'] loop
    perform set_config('request.jwt.claim.sub',actor,true);
    perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000031','in',1,'Forbidden role',null)$q$,'stock_role_forbidden');
  end loop;
  foreach actor in array array['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000010'] loop
    perform set_config('request.jwt.claim.sub',actor,true);
    select * into r from public.adjust_stock_manual('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000032','in',1,'Manager/admin branch',null);
    perform pg_temp.s_assert(r.new_current>0,'manager/admin cross-branch own business allowed');
  end loop;
end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000031','in',1,'Inactive',null)$q$,'stock_actor_inactive');
select pg_temp.s_assert(not exists(select 1 from public.stock_items),'inactive Data API reads denied');
update public.stock_items set min=100; -- restrictive policy affects zero rows
select pg_temp.s_throws($q$insert into public.stock_items(ingredient_id,branch_id) values('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000032')$q$,'stock_actor_inactive');
select pg_temp.s_throws($q$insert into public.stock_movements(ingredient_id,branch_id,reason,qty,operation,input_quantity,reason_note) values('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000031','manual_adjust',1,'in',1,'Inactive REST')$q$,'stock_actor_inactive');

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare r record; begin
  select * into r from public.adjust_stock_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',100,'Sumá 100 g de carne al stock','g');
  perform pg_temp.s_assert(r.delta=0.1 and r.new_current=0.100001,'WhatsApp same unit conversion and exactly-once balance');
  perform pg_temp.s_assert(exists(select 1 from public.stock_movements where source='whatsapp' and actor_role='kitchen' and actor_id='00000000-0000-4000-8000-000000000005' and input_unit='g'),'WhatsApp real actor, role and origin');
end; $$;
select pg_temp.s_throws($q$select public.adjust_stock_for_agent('00000000-0000-4000-8000-000000000021',null,'00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'No actor','kg')$q$,'stock_actor_forbidden');
select pg_temp.s_throws($q$select public.adjust_stock_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'Inactive','kg')$q$,'stock_actor_inactive');
select pg_temp.s_throws($q$select public.adjust_stock_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'Viewer','kg')$q$,'stock_role_forbidden');
select pg_temp.s_throws($q$select public.adjust_stock_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000032','in',1,'Unassigned','kg')$q$,'stock_branch_forbidden');
select pg_temp.s_throws($q$select public.adjust_stock_for_agent('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000033','in',1,'Foreign ingredient','kg')$q$,'stock_ingredient_forbidden');
reset role;

-- Explicit admin fixture review receipts permit focused accounting-engine tests.
-- Production callers cannot insert or forge these review receipts.
-- Public exact-version review/approval is covered by invoice-manual.sql.
-- Approval contributes one movement per purchase line, even repeated ingredients.
insert into public.invoices(id,business_id,branch_id,number,invoice_date,total,status) values
 ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','INV-STOCK','2026-10-01',500,'extracted'),
 ('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','INV-BADUNIT','2026-10-01',500,'extracted'),
 ('00000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','INV-AUDIT-FAIL','2026-10-01',500,'extracted'),
 ('00000000-0000-4000-8000-000000000064','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','INV-OLD-APPROVED','2026-10-01',500,'approved');
insert into public.invoice_items(invoice_id,description,qty,qty_numeric,unit,unit_price,total,matched_ingredient_id) values
 ('00000000-0000-4000-8000-000000000061','Beef line 1','500 g',500,'g',0.5,250,'00000000-0000-4000-8000-000000000041'),
 ('00000000-0000-4000-8000-000000000061','Beef line 2','250 g',250,'g',0.5,125,'00000000-0000-4000-8000-000000000041'),
 ('00000000-0000-4000-8000-000000000061','Milk line','250 ml',250,'ml',0.5,125,'00000000-0000-4000-8000-000000000042'),
 ('00000000-0000-4000-8000-000000000061','Delivery concept','1',1,'u',0,0,null),
 ('00000000-0000-4000-8000-000000000062','Invalid density','1 l',1,'l',500,500,'00000000-0000-4000-8000-000000000041'),
 ('00000000-0000-4000-8000-000000000063','Good line but audit must fail','250 g',250,'g',2,500,'00000000-0000-4000-8000-000000000041');
-- Simulate a row that existed before the new origin guards. This fixture is
-- inserted only by the disposable database owner; application roles retain all
-- guards. Disable exactly the new-insert checks for this one historical seed.
do $$begin
 if exists(select 1 from pg_trigger where tgname='purchase_origin_guard' and tgrelid='public.purchases'::regclass) then alter table public.purchases disable trigger purchase_origin_guard; end if;
 if exists(select 1 from pg_trigger where tgname='purchase_receipt_complete' and tgrelid='public.purchases'::regclass) then alter table public.purchases disable trigger purchase_receipt_complete; end if;
end$$;
insert into public.purchases(business_id,branch_id,invoice_id,purchased_at,total) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000064','2026-10-01',500);
do $$begin
 if exists(select 1 from pg_trigger where tgname='purchase_origin_guard' and tgrelid='public.purchases'::regclass) then alter table public.purchases enable trigger purchase_origin_guard; end if;
 if exists(select 1 from pg_trigger where tgname='purchase_receipt_complete' and tgrelid='public.purchases'::regclass) then alter table public.purchases enable trigger purchase_receipt_complete; end if;
end$$;


insert into public.business_modules(business_id,module_key,enabled) values('00000000-0000-4000-8000-000000000021','invoices_ocr',true) on conflict(business_id,module_key) do update set enabled=true;
do $$declare inv public.invoices%rowtype;k uuid;a uuid;begin
 for inv in select * from public.invoices where id in('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000063') loop
  k:=gen_random_uuid();
  insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data) values(inv.business_id,'00000000-0000-4000-8000-000000000001','Fixture owner','owner','invoice.reviewed','invoices',inv.id,'Explicit test fixture review','{}') returning id into a;
  update public.invoices set reviewed_version=edit_version,reviewed_by='00000000-0000-4000-8000-000000000001',reviewed_at=now(),reviewed_request_id=k where id=inv.id;
  insert into public.invoice_mutations(business_id,request_id,invoice_id,branch_id,actor_id,actor_role,payload,result,after_snapshot,activity_log_id) values(inv.business_id,k,inv.id,inv.branch_id,'00000000-0000-4000-8000-000000000001','owner','{"reviewed":true}',jsonb_build_object('version',inv.edit_version),'{}',a);
 end loop;
end$$;

set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare r jsonb; n bigint; b numeric; p uuid; line uuid; begin
  select count(*) into n from public.stock_movements;
  r:=invoices_private.approve_ledger('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000004',(select edit_version from public.invoices where id='00000000-0000-4000-8000-000000000061'));
  perform pg_temp.s_assert(r->>'error'='membership_not_found','inactive approval denied');
  r:=invoices_private.approve_ledger('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000010',(select edit_version from public.invoices where id='00000000-0000-4000-8000-000000000061'));
  perform pg_temp.s_assert(r->>'error'='permission_denied','manager cannot approve invoices');
  r:=invoices_private.approve_ledger('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001',(select edit_version from public.invoices where id='00000000-0000-4000-8000-000000000061'));
  perform pg_temp.s_assert(r->>'error'='invoice_not_found','cross-business approval denied even dual owner');
  r:=invoices_private.approve_ledger('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001',(select edit_version from public.invoices where id='00000000-0000-4000-8000-000000000061'));
  perform pg_temp.s_assert((r->>'ok')::boolean and not(r->>'already_approved')::boolean and (r->>'stock_count')::integer=3 and (r->>'item_count')::integer=4,'invoice real lines approved');
  p:=(r->>'purchase_id')::uuid;
  perform pg_temp.s_assert((select count(*) from public.purchase_items where purchase_id=p)=4,'all purchase lines retained including unmatched concept');
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n+3,'one event per matched purchase line');
  perform pg_temp.s_assert((select count(distinct m.ref_id) from public.stock_movements m join public.purchase_items pi on pi.id=m.ref_id where pi.purchase_id=p and m.ref_type='purchase_item')=3,'purchase line identity unique');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=0.850001,'invoice grams converted and balance updated');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000042' and branch_id='00000000-0000-4000-8000-000000000031')=2250,'invoice ml update');
  perform pg_temp.s_assert((select avg_unit_cost from public.ingredients where id='00000000-0000-4000-8000-000000000041')=500,'invoice cost expressed per base kg');
  r:=invoices_private.approve_ledger('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001',(select edit_version from public.invoices where id='00000000-0000-4000-8000-000000000061'));
  perform pg_temp.s_assert((r->>'ok')::boolean and (r->>'already_approved')::boolean and (r->>'purchase_id')::uuid=p,'repeat returns same purchase');
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n+3,'repeat does not add stock events');
  perform pg_temp.s_assert((select count(*) from public.activity_logs where action='invoice.approved' and target_id='00000000-0000-4000-8000-000000000061')=1,'one approval audit');
  select id into line from public.purchase_items where purchase_id=p and ingredient_id='00000000-0000-4000-8000-000000000041' and qty=500;
  perform pg_temp.s_throws(format('select public.record_stock_movement_atomic(''00000000-0000-4000-8000-000000000021'',''00000000-0000-4000-8000-000000000001'',''00000000-0000-4000-8000-000000000041'',''00000000-0000-4000-8000-000000000031'',''in'',500,''Duplicate line'',''g'',''ocr'',''purchase_item'',%L)',line),'stock_movements_purchase_line_once_idx');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=0.850001,'duplicate line rolls back balance');
  r:=invoices_private.approve_ledger('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001',(select edit_version from public.invoices where id='00000000-0000-4000-8000-000000000062'));
  perform pg_temp.s_assert(r->>'error'='invalid_stock_units_or_precision','invalid unit prevents approval');
  perform pg_temp.s_assert(not exists(select 1 from public.purchases where invoice_id='00000000-0000-4000-8000-000000000062'),'invalid unit creates no purchase');
  perform pg_temp.s_assert((select status from public.invoices where id='00000000-0000-4000-8000-000000000062')='extracted','invalid unit leaves invoice pending');
  r:=invoices_private.approve_ledger('00000000-0000-4000-8000-000000000064','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001',(select edit_version from public.invoices where id='00000000-0000-4000-8000-000000000064'));
  perform pg_temp.s_assert((r->>'already_approved')::boolean,'legacy approval not replayed');
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n+3,'legacy approval preserves stock history');
end; $$;
reset role;

-- Failure injection happens only in this rolled-back local transaction.
create function pg_temp.s_fail_audit() returns trigger language plpgsql as $$ begin
  if new.action='stock.movement_recorded' and new.data->>'reason'='FORCE_STOCK_AUDIT_FAIL'
    or new.action='invoice.approved' and new.target_id='00000000-0000-4000-8000-000000000063' then
    raise exception 'forced_stock_audit_failure';
  end if;
  return new;
end; $$;
create trigger stock_test_audit_failure before insert on public.activity_logs for each row execute function pg_temp.s_fail_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare n bigint; a bigint; b numeric; begin
  select count(*) into n from public.stock_movements; select count(*) into a from public.activity_logs;
  select current into b from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031';
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'FORCE_STOCK_AUDIT_FAIL','kg')$q$,'forced_stock_audit_failure');
  perform pg_temp.s_throws($q$select public.adjust_stock_manual('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000032','in',1,'FORCE_STOCK_AUDIT_FAIL','l')$q$,'forced_stock_audit_failure');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=b,'audit failure rolls back prior balance');
  perform pg_temp.s_assert(not exists(select 1 from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000042' and branch_id='00000000-0000-4000-8000-000000000032'),'audit failure rolls back newly created stock item');
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n,'audit failure rolls back movement');
  perform pg_temp.s_assert((select count(*) from public.activity_logs)=a,'audit failure rolls back auxiliary minimum audit too');
end; $$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare n bigint; a bigint; b numeric; c numeric; begin
  select count(*) into n from public.stock_movements; select count(*) into a from public.activity_logs;
  select current into b from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031';
  select avg_unit_cost into c from public.ingredients where id='00000000-0000-4000-8000-000000000041';
  perform pg_temp.s_throws($q$select invoices_private.approve_ledger('00000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001',(select edit_version from public.invoices where id='00000000-0000-4000-8000-000000000063'))$q$,'forced_stock_audit_failure');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=b,'late approval failure rolls back balance');
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n,'late approval failure rolls back movement');
  perform pg_temp.s_assert((select count(*) from public.activity_logs)=a,'late approval failure rolls back every audit');
  perform pg_temp.s_assert((select avg_unit_cost from public.ingredients where id='00000000-0000-4000-8000-000000000041')=c,'late approval failure rolls back cost');
  perform pg_temp.s_assert(not exists(select 1 from public.purchases where invoice_id='00000000-0000-4000-8000-000000000063'),'late approval failure rolls back purchase and lines');
  perform pg_temp.s_assert(not exists(select 1 from public.invoice_processing_logs where invoice_id='00000000-0000-4000-8000-000000000063'),'late approval failure rolls back processing log');
  perform pg_temp.s_assert((select status from public.invoices where id='00000000-0000-4000-8000-000000000063')='extracted','late approval failure leaves invoice pending');
end; $$;
reset role;
select pg_temp.s_assert((select min from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=2,'inactive direct update never changed minimum');
select pg_temp.s_assert((select qty=999 and business_id is null and balance_after is null from public.stock_movements where id='00000000-0000-4000-8000-000000000051'),'legacy movement remains untouched after all corrections');

-- Inbox stock uses the exact same ledger and approves its source atomically.
insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,raw) values
 ('00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','Offline owner','Quedan 4 kg de Beef'),
 ('00000000-0000-4000-8000-000000000079','00000000-0000-4000-8000-000000000021',null,'Offline owner','Sin sucursal');
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,target_entity) values
 ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','stock_update','{"ingredient":"Beef","qty":2,"unit":"kg","reason":"manual_adjust"}','stock_movements'),
 ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','stock_update','{"ingredient":"Beef","qty":4,"unit":"kg","operation":"set","reason_note":"Quedan 4 kg de Beef"}','stock_movements'),
 ('00000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','stock_update','{"ingredient":"Beef","qty":1,"unit":"kg","operation":"in","reason_note":"FORCE_STOCK_AUDIT_FAIL"}','stock_movements'),
 ('00000000-0000-4000-8000-000000000074','00000000-0000-4000-8000-000000000079','00000000-0000-4000-8000-000000000021',null,'stock_update','{"ingredient":"Beef","qty":1,"unit":"kg","operation":"in","reason_note":"No branch"}','stock_movements'),
 ('00000000-0000-4000-8000-000000000075','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','stock_update','{"ingredient":"Bee","qty":1,"unit":"kg","operation":"in","reason_note":"Do not fuzzy guess"}','stock_movements'),
 ('00000000-0000-4000-8000-000000000076','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','stock_update','{"ingredient":"Beef","qty":1,"unit":"box","operation":"in","reason_note":"No packs inferred"}','stock_movements'),
 ('00000000-0000-4000-8000-000000000077','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','stock_update','{"ingredient":"Beef","unit":"kg","operation":"in","reason_note":"No quantity"}','stock_movements'),
 ('00000000-0000-4000-8000-000000000078','00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','stock_update','{"ingredient":"Beef","qty":250,"unit":"g","operation":"in","reason_note":"Validated data only"}','stock_movements');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare r jsonb; x_id uuid; n bigint; a bigint; b numeric; event uuid; begin
  select count(*) into n from public.stock_movements;
  foreach x_id in array array['00000000-0000-4000-8000-000000000071'::uuid,'00000000-0000-4000-8000-000000000074'::uuid,'00000000-0000-4000-8000-000000000075'::uuid,'00000000-0000-4000-8000-000000000076'::uuid,'00000000-0000-4000-8000-000000000077'::uuid] loop
    r:=public.approve_stock_extraction_atomic(x_id,'00000000-0000-4000-8000-000000000021');
    perform pg_temp.s_assert(not(r->>'ok')::boolean and (r->>'needs_review')::boolean,'incomplete Inbox stock needs review');
    perform pg_temp.s_assert((select status from public.ai_extractions where ai_extractions.id=x_id)='needs_review','needs_review persisted');
  end loop;
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n,'incomplete Inbox created no guessed movements');
  r:=public.approve_stock_extraction_atomic('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000022');
  perform pg_temp.s_assert(r->>'error'='stock_extraction_not_found','Inbox cross-business rejected');
  r:=public.approve_stock_extraction_atomic('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000021');
  event:=(r->>'target_record_id')::uuid;
  perform pg_temp.s_assert((r->>'ok')::boolean and event is not null,'complete Inbox stock approved');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=4,'absolute Inbox count sets rather than adds');
  perform pg_temp.s_assert(exists(select 1 from public.stock_movements where stock_movements.id=event and source='inbox'
    and ref_type='ai_extraction' and ref_id='00000000-0000-4000-8000-000000000072' and operation='set' and actor_id=auth.uid()),'Inbox exact origin, actor, extraction link');
  perform pg_temp.s_assert(exists(select 1 from public.ai_extractions where ai_extractions.id='00000000-0000-4000-8000-000000000072'
    and target_record_id=event and status='approved' and approved_by=auth.uid()),'Inbox status and ledger inseparable');
  r:=public.approve_stock_extraction_atomic('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000021');
  perform pg_temp.s_assert((r->>'already_approved')::boolean and (r->>'target_record_id')::uuid=event,'Inbox repeat returns same event');
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n+1,'Inbox repeat adds no movement');
  -- BEFORE INSERT can run for a conflicting id. It must not approve a
  -- pending extraction when the row is skipped by ON CONFLICT DO NOTHING.
  insert into public.stock_movements(id,ingredient_id,branch_id,reason,qty,operation,input_quantity,input_unit,reason_note,source,ref_type,ref_id)
    values('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','manual_adjust',0,'in',1,'kg','FORCE_STOCK_AUDIT_FAIL','inbox','ai_extraction','00000000-0000-4000-8000-000000000073')
    on conflict(id) do nothing;
  perform pg_temp.s_assert((select status='pending' and target_record_id is null from public.ai_extractions where ai_extractions.id='00000000-0000-4000-8000-000000000073'),'conflict-skipped movement never approves source');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=4,'conflict-skipped movement never changes current');
  select count(*) into a from public.activity_logs;
  perform pg_temp.s_throws($q$select public.approve_stock_extraction_atomic('00000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000021')$q$,'forced_stock_audit_failure');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=4,'Inbox audit failure rolls back balance');
  perform pg_temp.s_assert((select count(*) from public.stock_movements)=n+1,'Inbox audit failure rolls back movement');
  perform pg_temp.s_assert((select count(*) from public.activity_logs)=a,'Inbox audit failure rolls back every audit');
  perform pg_temp.s_assert((select status='pending' and approved_at is null and target_record_id is null from public.ai_extractions where ai_extractions.id='00000000-0000-4000-8000-000000000073'),'Inbox audit failure rolls back approval state');
  perform pg_temp.s_throws($q$select public.record_stock_movement_atomic('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',900,'Validated data only','g','inbox','ai_extraction','00000000-0000-4000-8000-000000000078')$q$,'invalid_stock_extraction_reference');
  r:=public.approve_stock_extraction_atomic('00000000-0000-4000-8000-000000000078','00000000-0000-4000-8000-000000000021');
  perform pg_temp.s_assert((r->>'ok')::boolean,'Inbox entry approved with actual extracted amount');
  perform pg_temp.s_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041' and branch_id='00000000-0000-4000-8000-000000000031')=4.25,'Inbox grams converted exactly once');
end; $$;
update public.ai_extractions set status='approved',target_record_id='00000000-0000-4000-8000-000000000051' where id='00000000-0000-4000-8000-000000000076';
select pg_temp.s_assert(public.approve_stock_extraction_atomic('00000000-0000-4000-8000-000000000076','00000000-0000-4000-8000-000000000021')->>'error'='approval_inconsistent','idempotence rejects unrelated or legacy target without replay');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.s_assert(public.approve_stock_extraction_atomic('00000000-0000-4000-8000-000000000078','00000000-0000-4000-8000-000000000021')->>'error'='stock_actor_forbidden','inactive Inbox approval forbidden');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.s_assert(public.approve_stock_extraction_atomic('00000000-0000-4000-8000-000000000078','00000000-0000-4000-8000-000000000021')->>'error'='stock_actor_forbidden','viewer Inbox approval forbidden');
reset role;

set constraints all immediate;
rollback;
