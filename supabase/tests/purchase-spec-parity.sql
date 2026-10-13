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
insert into public.business_modules(business_id,module_key,enabled) values ('00000000-0000-4000-8000-000000000011','inbox_ai',true) on conflict(business_id,module_key) do update set enabled=true;
insert into public.whatsapp_authorized_conversations(id,business_id,branch_id,provider,provider_conversation_id,conversation_type)
values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','internal','purchase-parity-fixture','direct');
insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,channel,raw) values
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Fixture','text','Reviewed purchase fixture');
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status) values
 ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','purchase','{"supplier":"Fixture supplier"}','pending');
create function pg_temp.purchase_detail(request text, price text, quantity text default '2', unit text default 'kg') returns jsonb language sql as $$
 select jsonb_build_object('requestId',request,'kind','detailed','branchId','00000000-0000-4000-8000-000000000021','supplierId','00000000-0000-4000-8000-000000000040','purchasedAt','2026-10-09','paymentMethod','Efectivo','receiptReference','Ticket A-123','items',jsonb_build_array(jsonb_build_object('ingredientId','00000000-0000-4000-8000-000000000070','description','Harina','qty',quantity,'unit',unit,'unitPrice',price)));
$$;
insert into public.ingredients(id,business_id,name,unit) values ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000012','Foreign ingredient','kg');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.products(id,business_id,name,category,price,cost) values ('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000011','Bread fixture','Test',100,0);
select pg_temp.customer_assert(public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000080',null,'[{"ingredientId":"00000000-0000-4000-8000-000000000070","quantity":0.1,"unit":"kg"}]')->'ok'='true','recipe prepared');
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000060','100'));
select pg_temp.customer_assert((select avg_unit_cost=100 from public.ingredients where id='00000000-0000-4000-8000-000000000070'),'owner purchase reprices ingredient');
select pg_temp.customer_assert((select cost=10 from public.products),'owner purchase reprices recipe');
select pg_temp.customer_assert((select receipt_reference='Ticket A-123' and not cost_refresh_pending from public.purchases),'reference persisted separately from upload and current cost');
select pg_temp.customer_throws($q$select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000062','100')||'{"receiptReference":null}')$q$,'purchase_reference_invalid');
select pg_temp.customer_throws($q$select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000062','100')||jsonb_build_object('receiptReference',repeat('a',201)))$q$,'purchase_reference_invalid');
set constraints all immediate;
set constraints all deferred;
-- Manager purchases and stock work without acquiring catalog mutation rights.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000061','400','1'));
select pg_temp.customer_assert((select cost_refresh_pending from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000061'),'manager purchase flags stale cost');
select pg_temp.customer_assert((select current=3 from public.stock_items),'manager creates actual stock');
select pg_temp.customer_assert((select avg_unit_cost=100 from public.ingredients where id='00000000-0000-4000-8000-000000000070') and (select cost=10 from public.products),'manager did not reprice catalog via trigger');
select pg_temp.customer_throws($q$select public.refresh_purchase_costs_atomic('00000000-0000-4000-8000-000000000011')$q$,'purchase_cost_refresh_forbidden');
update public.ingredients set avg_unit_cost=999 where id='00000000-0000-4000-8000-000000000070';
update public.products set cost=999;
select pg_temp.customer_assert((select avg_unit_cost=100 from public.ingredients where id='00000000-0000-4000-8000-000000000070') and (select cost=10 from public.products),'manager direct catalog writes remain blocked by RLS');
select pg_temp.customer_throws($q$update public.purchases set cost_refresh_pending=false where manual_request_id='00000000-0000-4000-8000-000000000061'$q$,'purchase_cost_refresh_forbidden');
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.customer_assert(public.refresh_purchase_costs_atomic('00000000-0000-4000-8000-000000000011')->>'refreshed'='1','admin refresh closes pending receipt');
select pg_temp.customer_assert((select avg_unit_cost=200 from public.ingredients where id='00000000-0000-4000-8000-000000000070') and (select cost=20 from public.products),'weighted active cost refresh propagates to recipe');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.void_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',(select id from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000061'),1,'Manager correction');
select pg_temp.customer_assert((select avg_unit_cost=200 from public.ingredients where id='00000000-0000-4000-8000-000000000070') and (select cost_refresh_pending from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000061'),'manager void retains old cost visibly pending');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.refresh_purchase_costs_atomic('00000000-0000-4000-8000-000000000011');
select pg_temp.customer_assert((select avg_unit_cost=100 from public.ingredients where id='00000000-0000-4000-8000-000000000070') and (select cost=10 from public.products),'voided expensive purchase excluded from refreshed weighted cost');
select public.void_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',(select id from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000060'),1,'Last receipt void');
select pg_temp.customer_assert(public.refresh_purchase_costs_atomic('00000000-0000-4000-8000-000000000011')->>'pending'='1','no active purchase evidence remains pending even after authorized refresh');
select pg_temp.customer_assert((select avg_unit_cost=100 from public.ingredients where id='00000000-0000-4000-8000-000000000070'),'last known cost retained rather than fabricated zero');
select pg_temp.customer_throws($q$update public.purchases set cost_refresh_pending=false where manual_request_id='00000000-0000-4000-8000-000000000060'$q$,'purchase_cost_evidence_missing');
set constraints all immediate;
set constraints all deferred;
-- WhatsApp detailed transport keeps every confirmed quantity/unit/price and receipt.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; m uuid; c uuid:='00000000-0000-4000-8000-000000000101'; pending uuid; args jsonb; result jsonb; begin
 select id into m from public.business_members where business_id=b and user_id='00000000-0000-4000-8000-000000000001';
 args:=pg_temp.purchase_detail('00000000-0000-4000-8000-000000000063','0.30','500','g');
 pending:=(public.replace_whatsapp_agent_pending(b,m,c,'confirmation','purchases.create',args,now()+interval '10 minutes')->>'id')::uuid;
 perform pg_temp.customer_assert(public.claim_purchase_pending_execution(b,m,c,pending,false),'detailed WA claim supported');
 result:=public.commit_purchase_atomic(b,null,null,pending);
 perform pg_temp.customer_assert(result->>'kind'='detailed' and result->>'source'='whatsapp','detailed WA factual result');
 perform pg_temp.customer_assert((select total=150 and receipt_reference='Ticket A-123' from public.purchases where id=(result->>'id')::uuid),'WA total and reference exact');
 perform pg_temp.customer_assert((select count(*)=1 from public.purchase_items where purchase_id=(result->>'id')::uuid and qty=500 and unit='g' and unit_price=0.30),'WA retains qty500, not fabricated qty1');
 perform pg_temp.customer_assert((select avg_unit_cost=300 from public.ingredients where id='00000000-0000-4000-8000-000000000070'),'WA owner cost converts grams to kg');
 perform public.commit_purchase_atomic(b,null,null,pending);
 perform pg_temp.customer_assert((select count(*)=1 from public.stock_movements where source='whatsapp'),'WA recovery never duplicates stock');
 perform public.cancel_purchase_pending_execution(b,m,c,pending);
 -- Privileged transport must still honor manager actor catalog restrictions.
 select id into m from public.business_members where business_id=b and user_id='00000000-0000-4000-8000-000000000003';
 args:=pg_temp.purchase_detail('00000000-0000-4000-8000-000000000064','900','1');
 pending:=(public.replace_whatsapp_agent_pending(b,m,c,'confirmation','purchases.create',args,now()+interval '10 minutes')->>'id')::uuid;
 perform public.claim_purchase_pending_execution(b,m,c,pending,false);
 result:=public.commit_purchase_atomic(b,null,null,pending);
 perform pg_temp.customer_assert(result->>'costRefreshPending'='true' and (select avg_unit_cost=300 from public.ingredients where id='00000000-0000-4000-8000-000000000070'),'service transport does not bypass manager catalog permission');
 perform public.cancel_purchase_pending_execution(b,m,c,pending);
end $$;
set constraints all immediate;
set constraints all deferred;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.void_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',(select id from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000064'),1,'Remove extra delivery');
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; original uuid; payload jsonb; result jsonb; begin
 select id into original from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000063';
 payload:=pg_temp.purchase_detail('00000000-0000-4000-8000-000000000065','0.20','1000','g')||jsonb_build_object('replacesPurchaseId',original,'correctionReason','Correct actual weight');
 result:=public.replace_purchase_manual_atomic(b,original,1,'Correct actual weight',payload);
 perform pg_temp.customer_assert((select source='whatsapp' and record_status='voided' and total=150 from public.purchases where id=original),'original WA receipt immutable and voided');
 perform pg_temp.customer_assert((select source='manual' and correction_origin='whatsapp' and total=200 and receipt_reference='Ticket A-123' from public.purchases where id=(result->>'id')::uuid),'manual correction preserves WhatsApp provenance');
 perform pg_temp.customer_assert((select avg_unit_cost=200 from public.ingredients where id='00000000-0000-4000-8000-000000000070') and (select current=1 from public.stock_items),'correction reprices only active actual weight and reverses original stock');
 perform public.refresh_purchase_costs_atomic(b);
 perform pg_temp.customer_assert(not exists(select 1 from public.purchases where cost_refresh_pending),'new active evidence allows pending historical voids to clear');
end $$;
-- Inbox correction retains its extraction link and original reviewed fields.
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; e uuid:='00000000-0000-4000-8000-000000000211'; original uuid; result jsonb; review jsonb; begin
 review:=pg_temp.purchase_detail('00000000-0000-4000-8000-000000000066','50')-'requestId';
 result:=public.commit_purchase_atomic(b,jsonb_build_object('expectedFields','{"supplier":"Fixture supplier"}'::jsonb,'review',review),e,null);
 original:=(result->>'id')::uuid;
 result:=public.replace_purchase_manual_atomic(b,original,1,'Correct reviewed weight',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000067','50','1')||jsonb_build_object('replacesPurchaseId',original,'correctionReason','Correct reviewed weight'));
 perform pg_temp.customer_assert((select source='inbox' and origin_extraction_id=e and record_status='voided' from public.purchases where id=original),'original Inbox extraction provenance preserved');
 perform pg_temp.customer_assert((select source='manual' and correction_origin='inbox' from public.purchases where id=(result->>'id')::uuid),'Inbox correction origin retained');
 perform pg_temp.customer_assert((select status='approved' and target_record_id=original and fields='{"supplier":"Fixture supplier"}'::jsonb from public.ai_extractions where id=e),'Inbox original approved extraction remains untouched');
 perform public.void_purchase_manual_atomic(b,(result->>'id')::uuid,1,'Cancel corrected receipt');
 perform pg_temp.customer_assert((select avg_unit_cost=200 from public.ingredients where id='00000000-0000-4000-8000-000000000070'),'void excludes corrected Inbox receipt from ingredient cost');
end $$;
set constraints all immediate;
set constraints all deferred;
reset role;
select pg_temp.customer_assert(not has_function_privilege('authenticated','purchases_private.lock_purchase_context()','EXECUTE') and not has_function_privilege('service_role','purchases_private.lock_purchase_context()','EXECUTE'),'lock-only helper has no caller execute grant');
select pg_temp.customer_assert((select tgname from pg_trigger where tgrelid='public.purchases'::regclass and tgname in ('purchase_origin_guard','purchase_origin_lock') order by tgname limit 1)='purchase_origin_guard','origin authorization precedes lock-only trigger');
set local role authenticated;
select pg_temp.customer_throws($q$select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',jsonb_set(pg_temp.purchase_detail('00000000-0000-4000-8000-000000000068','100'),'{items,0,ingredientId}','"00000000-0000-4000-8000-000000000071"'))$q$,'purchase_ingredient_unavailable');
-- Archived catalog rows still have legitimate historical cost evidence to refresh.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000069','300','1'));
set constraints all immediate;
set constraints all deferred;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
update public.ingredients set active=false where id='00000000-0000-4000-8000-000000000070';
select public.refresh_purchase_costs_atomic('00000000-0000-4000-8000-000000000011');
select pg_temp.customer_assert((select not cost_refresh_pending from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000069'),'archival does not strand legitimate pending cost evidence');
select pg_temp.customer_assert((select not active and avg_unit_cost=250 from public.ingredients where id='00000000-0000-4000-8000-000000000070'),'archived ingredient refresh uses active purchase evidence without reactivation');

select pg_temp.customer_throws($q$select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000068','100')||'{"branchId":"00000000-0000-4000-8000-000000000023"}')$q$,'stock_branch_forbidden');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select pg_temp.customer_throws($q$select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000068','100'))$q$,'stock_role_forbidden');
select pg_temp.customer_throws($q$insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total,payment_method,created_by,manual_request_id,manual_payload,source) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000040','2026-10-09',200,'Efectivo',auth.uid(),'00000000-0000-4000-8000-000000000068',pg_temp.purchase_detail('00000000-0000-4000-8000-000000000068','100'),'manual')$q$,'stock_role_forbidden');
select pg_temp.customer_assert(not exists(select 1 from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000068'),'unauthorized actor and foreign branch never reach a persisted purchase');
set constraints all immediate;
rollback;
