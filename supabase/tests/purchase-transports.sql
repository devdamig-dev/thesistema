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
select pg_temp.customer_throws($q$insert into public.purchases(business_id,branch_id,purchased_at,total,payment_method) values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','2026-10-09',1,'Legacy')$q$,'purchase_receipt_required');
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

-- Independent WhatsApp and Inbox transport fixtures.
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
values('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','internal','purchase-fixture','direct');
insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,channel,raw) values
 ('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Fixture','text','Purchase fixture'),
 ('00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000023','Other','text','Other business');
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status) values
 ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','purchase','{"supplier":"Fixture supplier","total_amount":45.67}','pending'),
 ('00000000-0000-4000-8000-000000000212','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','purchase','{"item":"Flour","quantity":500,"unit":"g","unit_price":1.25}','needs_review'),
 ('00000000-0000-4000-8000-000000000213','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','purchase','{"total_amount":45.67}','pending'),
 ('00000000-0000-4000-8000-000000000214','00000000-0000-4000-8000-000000000202','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000023','purchase','{"total_amount":45.67}','pending'),
 ('00000000-0000-4000-8000-000000000215','00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','purchase','{"total_amount":45.67}','rejected');
create function pg_temp.purchase_summary() returns jsonb language sql as $$ select '{"kind":"summary","branchId":"00000000-0000-4000-8000-000000000021","supplierId":"00000000-0000-4000-8000-000000000040","purchasedAt":"2026-10-09","paymentMethod":"Efectivo","amount":"45.67"}'::jsonb $$;
create function pg_temp.purchase_review(p_extraction uuid,p_review jsonb default pg_temp.purchase_summary()) returns jsonb language sql as $$ select jsonb_build_object('expectedFields',fields,'review',p_review) from public.ai_extractions where id=p_extraction $$;
select pg_temp.customer_assert(not (select prosecdef from pg_proc where oid='public.commit_purchase_atomic(uuid,jsonb,uuid,uuid)'::regprocedure),'purchase kernel is invoker');
select pg_temp.customer_assert(not (select prosecdef from pg_proc where oid='public.stock_validate_movement()'::regprocedure),'stock validation stays invoker');
select pg_temp.customer_assert(not (select prosecdef from pg_proc where oid='public.record_stock_movement_atomic(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid)'::regprocedure),'stock RPC stays invoker');
select pg_temp.customer_assert(not has_function_privilege('anon','public.commit_purchase_atomic(uuid,jsonb,uuid,uuid)','execute'),'anonymous cannot call purchase kernel');
select pg_temp.customer_assert(not has_function_privilege('authenticated','public.claim_purchase_pending_execution(uuid,uuid,uuid,uuid,boolean)','execute'),'browser cannot claim WA pending');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; e uuid:='00000000-0000-4000-8000-000000000211'; input jsonb:=pg_temp.purchase_review(e); result jsonb; before_count integer; begin
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,jsonb_set(input,'{expectedFields,total_amount}','99'),e),'purchase_extraction_changed');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,jsonb_set(input,'{review,branchId}','"00000000-0000-4000-8000-000000000022"'),e),'purchase_branch_forbidden');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,jsonb_set(input,'{review,supplierId}','"00000000-0000-4000-8000-000000009999"'),e),'purchase_supplier_unavailable');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,input#-'{review,kind}',e),'purchase_invalid_review');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,jsonb_set(input,'{review,requestId}','"00000000-0000-4000-8000-000000009999"'),e),'purchase_invalid_review');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,jsonb_set(input,'{review,items}','[{"qty":"1"}]'),e),'purchase_summary_has_no_items');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,input,'00000000-0000-4000-8000-000000000214'),'purchase_extraction_forbidden');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,pg_temp.purchase_review('00000000-0000-4000-8000-000000000215'),'00000000-0000-4000-8000-000000000215'),'purchase_extraction_changed');
 select count(*) into before_count from public.purchases;
 result:=public.commit_purchase_atomic(b,input,e,null);
 perform pg_temp.customer_assert(result->'ok'='true' and result->>'kind'='summary' and result->>'source'='inbox','Inbox summary result');
 perform pg_temp.customer_assert((select source='inbox' and total=45.67 and created_by=auth.uid() and origin_expected_fields=input->'expectedFields' from public.purchases where id=(result->>'id')::uuid),'Inbox exact origin actor and amount');
 perform pg_temp.customer_assert((select status='approved' and approved_by=auth.uid() and target_entity='purchases' and target_record_id=(result->>'id')::uuid and fields=input->'expectedFields' from public.ai_extractions where id=e),'Inbox approval atomic, original fields preserved');
 perform pg_temp.customer_assert(not exists(select 1 from public.purchase_items where purchase_id=(result->>'id')::uuid),'summary never invents lines');
 perform pg_temp.customer_assert(not exists(select 1 from public.stock_movements),'summary never touches stock');
 perform pg_temp.customer_assert((select count(*)=1 from public.activity_logs where action='purchase.created' and target_id=(result->>'id')::uuid and data->>'source'='inbox' and data->>'kind'='summary'),'Inbox atomic audit');
 perform pg_temp.customer_assert(public.commit_purchase_atomic(b,input,e,null)->'replayed'='true','Inbox retry recovers exact receipt');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,jsonb_set(input,'{review,amount}','"46.00"'),e),'purchase_idempotency_conflict');
 perform pg_temp.customer_assert((select source='inbox' from public.purchases where id=(result->>'id')::uuid),'approved Inbox retains authoritative origin');
 perform pg_temp.customer_assert((select count(*)=before_count+1 from public.purchases),'all rejected/retried Inbox attempts keep one receipt');
end $$;
-- Detailed Inbox has real reviewed quantities and the normal invoker stock path.
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; e uuid:='00000000-0000-4000-8000-000000000212'; detail jsonb; input jsonb; result jsonb; begin
 detail:=(pg_temp.purchase_summary()-'amount')||'{"kind":"detailed","items":[{"ingredientId":"00000000-0000-4000-8000-000000000070","description":"Flour reviewed","qty":"500","unit":"g","unitPrice":"1.25"}]}'::jsonb;
 input:=pg_temp.purchase_review(e,detail); result:=public.commit_purchase_atomic(b,input,e,null);
 perform pg_temp.customer_assert((select total=625 and purchase_kind='detailed' from public.purchases where id=(result->>'id')::uuid),'detailed total from actual reviewed lines');
 perform pg_temp.customer_assert((select current=0.5 from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000070'),'Inbox quantity converts to ingredient base unit');
 perform pg_temp.customer_assert((select count(*)=1 from public.stock_movements where source='inbox' and actor_id=auth.uid() and ref_type='purchase_item'),'Inbox stock factual actor/source');
 perform pg_temp.customer_assert(public.commit_purchase_atomic(b,input,e,null)->'replayed'='true','detailed Inbox retry');
 perform pg_temp.customer_assert((select count(*)=1 from public.stock_movements),'detailed Inbox does not replay stock');
end $$;
set constraints all immediate;
set constraints all deferred;
reset role;
-- Failure at the last extraction update must roll back header/items/stock/audit.
create function pg_temp.break_purchase_approval() returns trigger language plpgsql as $$ begin if new.id='00000000-0000-4000-8000-000000000213' and new.status='approved' then raise exception 'fixture_approval_failure'; end if;return new;end $$;
create trigger fixture_purchase_approval before update on public.ai_extractions for each row execute function pg_temp.break_purchase_approval();
set local role authenticated;
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; e uuid:='00000000-0000-4000-8000-000000000213'; counts bigint[]; begin
 counts:=array[(select count(*) from public.purchases),(select count(*) from public.purchase_items),(select count(*) from public.stock_movements),(select count(*) from public.activity_logs)];
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)',b,pg_temp.purchase_review(e),e),'fixture_approval_failure');
 perform pg_temp.customer_assert(counts=array[(select count(*) from public.purchases),(select count(*) from public.purchase_items),(select count(*) from public.stock_movements),(select count(*) from public.activity_logs)],'failed approval rolls back every financial side effect');
 perform pg_temp.customer_assert((select status='pending' and target_record_id is null from public.ai_extractions where id=e),'failed approval preserves pending extraction');
end $$;
reset role;
drop trigger fixture_purchase_approval on public.ai_extractions;
-- Disabled module blocks both RPC void and direct update, including a summary.
set local role authenticated;
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',pg_temp.purchase_summary()||'{"requestId":"00000000-0000-4000-8000-000000000401"}');
set constraints all immediate;
set constraints all deferred;
reset role;
update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000011' and module_key='purchases';
set local role authenticated;
do $$ declare pid uuid; begin
 select id into pid from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000401';
 perform pg_temp.customer_throws(format('select public.void_purchase_manual_atomic(%L,%L,1,''Bypass'')','00000000-0000-4000-8000-000000000011',pid),'purchase_module_disabled');
 perform pg_temp.customer_throws(format('update public.purchases set record_status=''voided'',version=version+1,voided_at=now(),void_reason=''Bypass'' where id=%L',pid),'purchase_module_disabled');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,%L,null)','00000000-0000-4000-8000-000000000011',pg_temp.purchase_review('00000000-0000-4000-8000-000000000213'),'00000000-0000-4000-8000-000000000213'),'purchase_module_disabled');
end $$;
reset role;
update public.business_modules set enabled=true where business_id='00000000-0000-4000-8000-000000000011' and module_key='purchases';
-- WA consumes only persisted confirmation facts; transport cannot impersonate.
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; c uuid:='00000000-0000-4000-8000-000000000101'; m uuid; pending_id uuid; args jsonb; r jsonb; begin
 select id into m from public.business_members where business_id=b and user_id='00000000-0000-4000-8000-000000000001';
 args:=pg_temp.purchase_summary()||'{"requestId":"00000000-0000-4000-8000-000000000301","supplierLabel":"Fixture supplier","branchLabel":"A first"}';
 pending_id:=(public.replace_whatsapp_agent_pending(b,m,c,'confirmation','purchases.create',args,now()+interval '10 minutes')->>'id')::uuid;
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'purchase_pending_forbidden');
 perform pg_temp.customer_assert(public.claim_purchase_pending_execution(b,m,c,pending_id,false),'first WA claim persists uncertainty');
 perform pg_temp.customer_assert(not public.claim_purchase_pending_execution(b,m,c,pending_id,false),'second fresh claim rejected');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,%L,null,%L)',b,args,pending_id),'purchase_transport_forbidden');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)','00000000-0000-4000-8000-000000000012',pending_id),'purchase_pending_forbidden');
 r:=public.commit_purchase_atomic(b,null,null,pending_id);
 perform pg_temp.customer_assert(r->>'kind'='summary' and r->>'source'='whatsapp','WA factual summary result');
 perform pg_temp.customer_assert((select total=45.67 and source='whatsapp' and created_by='00000000-0000-4000-8000-000000000001' and manual_payload=args-'supplierLabel'-'branchLabel' and origin_pending_id=pending_id from public.purchases where id=(r->>'id')::uuid),'WA actor/source/input from persisted pending');
 perform pg_temp.customer_assert(not exists(select 1 from public.purchase_items where purchase_id=(r->>'id')::uuid),'WA summary has no invented detail');
 perform pg_temp.customer_assert(public.claim_purchase_pending_execution(b,m,c,pending_id,true),'WA uncertain recovery allowed');
 perform pg_temp.customer_assert(public.commit_purchase_atomic(b,null,null,pending_id)->'replayed'='true','WA recovery returns existing receipt');
 perform pg_temp.customer_assert((select count(*)=1 from public.purchases where origin_pending_id=pending_id),'WA recovery produces one receipt');
 perform pg_temp.customer_assert((select count(*)=1 from public.activity_logs where action='purchase.created' and target_id=(r->>'id')::uuid),'WA audit once');
 perform pg_temp.customer_assert(public.cancel_purchase_pending_execution(b,m,c,pending_id)='{"consumed":true,"resultUncertain":true}'::jsonb,'WA cancellation reports durable uncertainty');
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'purchase_pending_forbidden');
 perform pg_temp.customer_assert((select count(*)=1 from public.purchases where origin_pending_id=pending_id),'cancellation cannot roll back prior purchase');
 -- Detailed purchases still require exact catalog mappings; invented detail is forbidden.
 args:=(args-'amount')||'{"requestId":"00000000-0000-4000-8000-000000000302","kind":"detailed","items":[{"description":"Invented","qty":"1","unit":"u","unitPrice":"45.67"}]}';
 pending_id:=(public.replace_whatsapp_agent_pending(b,m,c,'confirmation','purchases.create',args,now()+interval '10 minutes')->>'id')::uuid;
 perform public.claim_purchase_pending_execution(b,m,c,pending_id,false);
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'purchase_agent_ingredient_required');
 perform public.cancel_purchase_pending_execution(b,m,c,pending_id);
 perform pg_temp.customer_throws(format('insert into public.purchases(business_id,branch_id,purchased_at,total,payment_method,created_by) values(%L,%L,''2026-10-09'',1,''Legacy'',%L)',b,'00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001'),'purchase_receipt_required');
end $$;
-- Authorization is checked again from live persisted state after durable claim.
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; c uuid:='00000000-0000-4000-8000-000000000101'; actor uuid:='00000000-0000-4000-8000-000000000001'; m uuid; pending_id uuid; args jsonb; begin
 select id into m from public.business_members where business_id=b and user_id=actor;
 args:=pg_temp.purchase_summary()||'{"requestId":"00000000-0000-4000-8000-000000000303"}';
 pending_id:=(public.replace_whatsapp_agent_pending(b,m,c,'confirmation','purchases.create',args,now()+interval '10 minutes')->>'id')::uuid;
 update public.business_modules set enabled=false where business_id=b and module_key='purchases';
 perform pg_temp.customer_assert(not public.claim_purchase_pending_execution(b,m,c,pending_id,false),'disabled module cannot claim purchase');
 update public.business_modules set enabled=true where business_id=b and module_key='purchases';
 perform pg_temp.customer_assert(public.claim_purchase_pending_execution(b,m,c,pending_id,false),'restored module may claim');
 update public.business_modules set enabled=false where business_id=b and module_key='purchases';
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'purchase_module_disabled');
 update public.business_modules set enabled=true where business_id=b and module_key='purchases';
 update public.profiles set active=false where id=actor;
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'stock_actor_inactive');
 update public.profiles set active=true where id=actor;
 update public.business_members set role='viewer' where id=m;
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'stock_role_forbidden');
 update public.business_members set role='owner' where id=m;
 update public.whatsapp_authorized_conversations set enabled=false where id=c;
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'purchase_pending_forbidden');
 update public.whatsapp_authorized_conversations set enabled=true where id=c;
 update public.whatsapp_authorized_conversations set branch_id='00000000-0000-4000-8000-000000000022' where id=c;
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'purchase_branch_forbidden');
 update public.whatsapp_authorized_conversations set branch_id='00000000-0000-4000-8000-000000000021' where id=c;
 update public.suppliers set active=false where id='00000000-0000-4000-8000-000000000040';
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'purchase_supplier_unavailable');
 update public.suppliers set active=true where id='00000000-0000-4000-8000-000000000040';
 perform pg_temp.customer_assert(not exists(select 1 from public.purchases where origin_pending_id=pending_id),'all revoked live contexts leave no purchase');
 perform public.commit_purchase_atomic(b,null,null,pending_id);
 update public.whatsapp_agent_pending_operations set arguments=jsonb_set(arguments,'{amount}','"46.00"') where id=pending_id;
 perform pg_temp.customer_throws(format('select public.commit_purchase_atomic(%L,null,null,%L)',b,pending_id),'purchase_idempotency_conflict');
 perform pg_temp.customer_assert((select count(*)=1 and sum(total)=45.67 from public.purchases where origin_pending_id=pending_id),'changed persisted retry cannot rewrite receipt');
 perform public.cancel_purchase_pending_execution(b,m,c,pending_id);
end $$;
set constraints all immediate;
rollback;

-- Invoice transport remains exact and supports a separate authorized approver.
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
insert into public.business_modules(business_id,module_key,enabled) values('00000000-0000-4000-8000-000000000011','invoices_ocr',true) on conflict(business_id,module_key) do update set enabled=true;
create table pg_temp.invoice_fixture(input jsonb);grant all on pg_temp.invoice_fixture to authenticated,service_role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare r jsonb; begin
 r:=public.save_invoice_review_atomic('00000000-0000-4000-8000-000000000011',jsonb_build_object('requestId',gen_random_uuid(),'businessId','00000000-0000-4000-8000-000000000011','userId',auth.uid(),'id',null,'expectedVersion',null,'branchId','00000000-0000-4000-8000-000000000021','supplierId','00000000-0000-4000-8000-000000000040','number','ACTUAL-123','type','A','invoiceDate','2026-10-09','dueDate',null,'taxId',null,'paymentMethod','Efectivo','tax','0','items',jsonb_build_array(jsonb_build_object('description','Actual flour','quantity','0.5','unit','kg','unitPrice','2.50','ingredientId','00000000-0000-4000-8000-000000000070')),'reviewed',true));
 perform pg_temp.customer_assert(r->'ok'='true','real reviewed invoice prepared');
 insert into pg_temp.invoice_fixture values(jsonb_build_object('requestId',gen_random_uuid(),'businessId','00000000-0000-4000-8000-000000000011','userId','00000000-0000-4000-8000-000000000002','id',r->>'id','expectedVersion',(r->>'version')::integer));
end $$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; a uuid:='00000000-0000-4000-8000-000000000002'; p jsonb; r jsonb; inv public.invoices%rowtype; begin
 select input into p from pg_temp.invoice_fixture; select * into inv from public.invoices where id=(p->>'id')::uuid;
 perform pg_temp.customer_throws(format('insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total,payment_method,invoice_id,created_by) values(%L,%L,%L,%L,999,%L,%L,%L)',b,inv.branch_id,inv.supplier_id,inv.invoice_date,inv.payment_method,inv.id,a),'purchase_invoice_origin_invalid');
 perform pg_temp.customer_throws(format('insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total,payment_method,invoice_id,created_by) values(%L,%L,%L,%L,%L,%L,%L,%L)',b,inv.branch_id,inv.supplier_id,inv.invoice_date,inv.total,inv.payment_method,inv.id,'00000000-0000-4000-8000-000000000003'),'purchase_invoice_origin_invalid');
 begin
  insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total,payment_method,invoice_id,created_by) values(b,inv.branch_id,inv.supplier_id,inv.invoice_date,inv.total,inv.payment_method,inv.id,a);
  set constraints all immediate;
  raise exception 'expected_incomplete_invoice_failure';
 exception when others then if sqlerrm<>'purchase_invoice_not_approved' then raise; end if; end;
 perform pg_temp.customer_assert(not exists(select 1 from public.purchases),'direct invoice header cannot commit without atomic approval');
 r:=public.approve_invoice_reviewed_atomic(b,a,p);
 perform pg_temp.customer_assert(r->'ok'='true','authorized admin can approve owner review: '||r::text);
 perform pg_temp.customer_assert((select created_by=a and total=1.25 and source is null and invoice_id=inv.id from public.purchases),'invoice transport preserves exact approving actor and actual total');
 perform pg_temp.customer_assert((select current=0.5 from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000070'),'invoice compatibility keeps actual stock quantity');
 perform pg_temp.customer_assert((select count(*)=1 from public.stock_movements where actor_id=a and source='manual'),'manual invoice source preserved in stock receipt');
end $$;
set constraints all immediate;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.customer_throws($q$select public.void_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',(select id from public.purchases),1,'Not a purchase correction')$q$,'purchase_requires_source_review');
select pg_temp.customer_throws($q$update public.purchases set record_status='voided',version=2,voided_at=now(),void_reason='Bypass' where invoice_id is not null$q$,'purchase_history_immutable');
set constraints all immediate;
rollback;
