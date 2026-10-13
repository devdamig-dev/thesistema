-- Offline-only, transactional fixtures. Never run against production.
begin;
create function pg_temp.customer_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %', p_message; end if;
end; $$;
create function pg_temp.customer_throws(p_sql text, p_message text)
returns void language plpgsql security invoker as $$ begin
  begin execute p_sql;
  exception when others then
    if position(p_message in sqlerrm)>0 then return; end if;
    raise exception 'Expected error %, received %',p_message,sqlerrm;
  end;
  raise exception 'Expected error %, statement succeeded',p_message;
end; $$;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','customer-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','customer-admin@example.invalid'),
 ('00000000-0000-4000-8000-000000000003','customer-manager@example.invalid'),
 ('00000000-0000-4000-8000-000000000004','customer-marketing@example.invalid'),
 ('00000000-0000-4000-8000-000000000005','customer-viewer@example.invalid'),
 ('00000000-0000-4000-8000-000000000006','customer-employee@example.invalid'),
 ('00000000-0000-4000-8000-000000000007','customer-inactive@example.invalid'),
 ('00000000-0000-4000-8000-000000000008','customer-stranger@example.invalid');
insert into public.organizations(id,name) values ('00000000-0000-4000-8000-000000000010','Customer test organization');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000010';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000007';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','Customer A'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','Customer B');
insert into public.business_members(business_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','admin'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003','manager'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000004','marketing'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000005','viewer'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000006','employee'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000007','owner');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','A first'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000011','A second'),
 ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000012','B first');
insert into public.branch_assignments(business_member_id,branch_id)
 select id,'00000000-0000-4000-8000-000000000021'::uuid from public.business_members
 where user_id='00000000-0000-4000-8000-000000000004';
insert into public.customers(id,business_id,name,visits,total_spend,last_visit_at) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000011','Existing A',2,100,'2025-01-01Z'),
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000012','Existing B',0,0,null);

insert into public.business_modules(business_id,module_key,enabled) values ('00000000-0000-4000-8000-000000000011','purchases',true) on conflict(business_id,module_key) do update set enabled=true;
insert into public.suppliers(id,business_id,name) values ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000011','Fixture supplier');
insert into public.ingredients(id,business_id,name,unit) values ('00000000-0000-4000-8000-000000000070','00000000-0000-4000-8000-000000000011','Fixture ingredient','kg');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011','{"requestId":"00000000-0000-4000-8000-000000000060","branchId":"00000000-0000-4000-8000-000000000021","supplierId":"00000000-0000-4000-8000-000000000040","purchasedAt":"2026-10-09","paymentMethod":"Cuenta corriente","items":[{"description":"Fixture item","qty":"2","unit":"u","unitPrice":"1.25"}]}');
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011','{"requestId":"00000000-0000-4000-8000-000000000060","branchId":"00000000-0000-4000-8000-000000000021","supplierId":"00000000-0000-4000-8000-000000000040","purchasedAt":"2026-10-09","paymentMethod":"Cuenta corriente","items":[{"description":"Fixture item","qty":"2","unit":"u","unitPrice":"1.25"}]}');
select pg_temp.customer_assert((select count(*)=1 from public.purchases),'identical retry produces one purchase');
select pg_temp.customer_assert((select total=2.50 from public.purchases),'exact total');
select pg_temp.customer_assert((select count(*)=1 from public.purchase_items),'one detail');
select pg_temp.customer_assert((select count(*)=1 from public.activity_logs where action='purchase.created'),'atomic audit');
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011','{"requestId":"00000000-0000-4000-8000-000000000061","branchId":"00000000-0000-4000-8000-000000000021","supplierId":"00000000-0000-4000-8000-000000000040","purchasedAt":"2026-10-09","paymentMethod":"Cuenta corriente","items":[{"ingredientId":"00000000-0000-4000-8000-000000000070","description":"Flour","qty":"500","unit":"g","unitPrice":"1.25"}]}');
select pg_temp.customer_assert((select current=0.5 from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000070'),'stock conversion grams to kilos');
select pg_temp.customer_assert((select count(*)=1 from public.stock_movements where ref_type='purchase_item'),'one referenced stock entry');
select pg_temp.customer_throws($q$select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011','{"requestId":"00000000-0000-4000-8000-000000000062","branchId":"00000000-0000-4000-8000-000000000023","supplierId":"00000000-0000-4000-8000-000000000040","items":[]}')$q$,'stock_branch_forbidden');
select pg_temp.customer_throws($q$select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011','{"requestId":"00000000-0000-4000-8000-000000000060","branchId":"00000000-0000-4000-8000-000000000021","supplierId":"00000000-0000-4000-8000-000000000040","items":[]}')$q$,'purchase_idempotency_conflict');
select public.void_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',(select id from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000061'),1,'Fixture correction');
select public.void_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',(select id from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000061'),1,'Fixture correction');
select pg_temp.customer_assert((select current=0 from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000070'),'void reverses only original receipt');
select pg_temp.customer_assert((select count(*)=1 from public.stock_movements where ref_type='purchase_item_void'),'void repeat produces one reversal');
select pg_temp.customer_assert((select count(*)=1 from public.activity_logs where action='purchase.voided'),'void audit');
select pg_temp.customer_throws($q$delete from public.purchase_items where purchase_id=(select id from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000061')$q$,'purchase_items_history_immutable');
-- Seed a pre-existing legacy row only as the disposable fixture owner.
-- New application writes must satisfy the complete source/receipt contract.
set constraints all immediate;
set constraints all deferred;
reset role;
alter table public.purchases disable trigger purchase_origin_guard;
alter table public.purchases disable trigger purchase_origin_lock;
alter table public.purchases disable trigger purchase_receipt_complete;
alter table public.purchase_items disable trigger purchase_item_insert_guard;
alter table public.purchase_items disable trigger purchase_item_recalculate;
alter table public.purchase_items disable trigger purchase_item_receipt_complete;
insert into public.purchases(id,business_id,branch_id,purchased_at,total,payment_method) values ('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','2026-10-09',1,'Legacy');
insert into public.purchase_items(id,purchase_id,description,qty,unit,unit_price,total) values ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000080','Legacy',1,'u',1,1);
alter table public.purchases enable trigger purchase_origin_guard;
alter table public.purchases enable trigger purchase_origin_lock;
alter table public.purchases enable trigger purchase_receipt_complete;
alter table public.purchase_items enable trigger purchase_item_insert_guard;
alter table public.purchase_items enable trigger purchase_item_recalculate;
alter table public.purchase_items enable trigger purchase_item_receipt_complete;
set local role authenticated;
select pg_temp.customer_throws($q$update public.purchase_items set purchase_id=(select id from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000061') where id='00000000-0000-4000-8000-000000000081'$q$,'purchase_items_history_immutable');
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011','{"requestId":"00000000-0000-4000-8000-000000000064","branchId":"00000000-0000-4000-8000-000000000021","supplierId":"00000000-0000-4000-8000-000000000040","purchasedAt":"2026-10-09","paymentMethod":"Cuenta corriente","items":[{"description":"Same","qty":"2","unit":"u","unitPrice":"2"},{"description":"Same","qty":"2.0","unit":"u","unitPrice":"1"}]}');

do $$ declare original uuid; payload jsonb; result jsonb; begin
 select id into original from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000060';
 payload:=jsonb_build_object('requestId','00000000-0000-4000-8000-000000000065','branchId','00000000-0000-4000-8000-000000000021','supplierId','00000000-0000-4000-8000-000000000040','purchasedAt','2026-10-09','paymentMethod','Cuenta corriente','replacesPurchaseId',original,'correctionReason','Wrong value','items',jsonb_build_array(jsonb_build_object('description','Corrected','qty','1','unit','u','unitPrice','-1')));
 begin
  perform public.replace_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',original,1,'Wrong value',payload);
  raise exception 'expected_invalid_line';
 exception when others then if sqlerrm<>'purchase_invalid_line' then raise; end if; end;
 perform pg_temp.customer_assert((select record_status='active' and version=1 from public.purchases where id=original),'failed correction rolls back original void');
 payload:=jsonb_set(payload,'{items,0,unitPrice}','"3"');
 result:=public.replace_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',original,1,'Wrong value',payload);
 perform pg_temp.customer_assert((select total=3 and record_status='active' from public.purchases where id=(result->>'id')::uuid),'replacement persists new value');
 perform public.replace_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',original,1,'Wrong value',payload);
 perform pg_temp.customer_assert((select count(*)=1 from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000065'),'replacement retry idempotent');
 begin
  perform public.replace_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',original,1,'Wrong value',jsonb_set(payload,'{requestId}','"00000000-0000-4000-8000-000000000066"'));
  raise exception 'expected_duplicate_replacement_rejected';
 exception when unique_violation then null; end;
 perform pg_temp.customer_assert((select count(*)=1 from public.purchases where manual_payload->>'replacesPurchaseId'=original::text),'original has exactly one replacement');
end $$;
set constraints all immediate;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',true);
select pg_temp.customer_throws($q$select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011','{"requestId":"00000000-0000-4000-8000-000000000063","branchId":"00000000-0000-4000-8000-000000000021","supplierId":"00000000-0000-4000-8000-000000000040","items":[]}')$q$,'stock_actor_inactive');
rollback;
