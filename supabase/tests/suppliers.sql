-- Isolated local regression tests. All fixture data rolls back.
begin;
create function pg_temp.supplier_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %', p_message; end if;
end; $$;
create function pg_temp.supplier_throws(p_sql text, p_message text)
returns void language plpgsql security invoker as $$ begin
  begin execute p_sql;
  exception when others then
    if position(p_message in sqlerrm) > 0 then return; end if;
    raise exception 'Expected error %, received %', p_message, sqlerrm;
  end;
  raise exception 'Expected error %, but statement succeeded', p_message;
end; $$;

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','supplier-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','supplier-admin@example.invalid'),
 ('00000000-0000-4000-8000-000000000003','supplier-manager@example.invalid'),
 ('00000000-0000-4000-8000-000000000004','supplier-viewer@example.invalid'),
 ('00000000-0000-4000-8000-000000000005','supplier-inactive@example.invalid'),
 ('00000000-0000-4000-8000-000000000006','supplier-accountant@example.invalid');
insert into public.organizations(id,name) values ('00000000-0000-4000-8000-000000000010','Supplier test organization');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000010';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000005';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','Supplier A'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','Supplier B');
insert into public.business_members(business_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','admin'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003','manager'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000004','viewer'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000005','owner'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000006','accountant');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','A main'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000011','A other'),
 ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000012','B main');
insert into public.ingredients(id,business_id,name,unit) values
 ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000011','Flour','kg');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.supplier_assert(not has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='supplier_private' and p.proname='audit_supplier_change'),'execute'),'audit trigger not callable');
select pg_temp.supplier_assert(not has_schema_privilege('authenticated','supplier_private','usage'),'private schema not exposed');
select pg_temp.supplier_assert(not has_function_privilege('anon','public.create_supplier_manual(uuid,uuid,text,text,text,text,text,text,text)','execute'),'anon RPC denied');
select pg_temp.supplier_assert(not (select prosecdef from pg_proc where oid='public.create_supplier_manual(uuid,uuid,text,text,text,text,text,text,text)'::regprocedure),'create is invoker');
select pg_temp.supplier_assert(not (select prosecdef from pg_proc where oid='public.update_supplier_manual(uuid,uuid,timestamptz,text,text,text,text,text,text,text)'::regprocedure),'edit is invoker');
select pg_temp.supplier_assert(not (select prosecdef from pg_proc where oid='public.set_supplier_active_manual(uuid,uuid,timestamptz,boolean)'::regprocedure),'archive is invoker');

do $$ declare v_business uuid := '00000000-0000-4000-8000-000000000011';
  v_id uuid := '00000000-0000-4000-8000-000000000031'; v_result jsonb; v_token timestamptz; v_token2 timestamptz; v_logs bigint;
begin
  v_result := public.create_supplier_manual(v_business,v_id,'  Supplier One  ','20-12345678-1','Foods','+54 (11) 5555-1234','sales@example.invalid','30 days',E'Real contact\nDelivery on Monday');
  perform pg_temp.supplier_assert(v_result->>'name'='Supplier One' and (v_result->>'active')::boolean,'create normalized active');
  v_token := (v_result->>'updated_at')::timestamptz;
  select count(*) into v_logs from public.activity_logs;
  v_result := public.create_supplier_manual(v_business,v_id,'  Supplier One  ','20-12345678-1','Foods','+54 (11) 5555-1234','sales@example.invalid','30 days',E'Real contact\nDelivery on Monday');
  perform pg_temp.supplier_assert((v_result->>'updated_at')::timestamptz=v_token,'idempotent create keeps version');
  perform pg_temp.supplier_assert((select count(*) from public.suppliers where id=v_id)=1,'retry does not duplicate supplier');
  perform pg_temp.supplier_assert((select count(*) from public.activity_logs)=v_logs,'retry does not duplicate audit');
  perform pg_temp.supplier_throws(format('select public.create_supplier_manual(%L,%L,%L)',v_business,v_id,'Different payload'),'supplier_request_conflict');
  perform pg_temp.supplier_throws(format('select public.update_supplier_manual(%L,%L,null,%L)',v_business,v_id,'No version'),'supplier_stale_version');
  v_result := public.update_supplier_manual(v_business,v_id,v_token,'Supplier Edited',null,'Foods','111-333-4444','contact@example.invalid','15 days','Edited note');
  v_token2 := (v_result->>'updated_at')::timestamptz;
  perform pg_temp.supplier_assert(v_token2>v_token,'edit token strictly monotonic in same transaction');
  perform pg_temp.supplier_assert(v_result->>'phone'='111-333-4444' and v_result->>'payment_terms'='15 days' and v_result->>'notes'='Edited note','contact and conditions persisted');
  perform pg_temp.supplier_throws(format('select public.update_supplier_manual(%L,%L,%L,%L)',v_business,v_id,v_token,'Stale edit'),'supplier_stale_version');
  perform pg_temp.supplier_throws(format('select public.set_supplier_active_manual(%L,%L,%L,false)',v_business,v_id,v_token),'supplier_stale_version');
  insert into public.purchases(id,business_id,branch_id,supplier_id,purchased_at,total) values
    ('00000000-0000-4000-8000-000000000051',v_business,'00000000-0000-4000-8000-000000000021',v_id,current_date,100);
  insert into public.purchase_items(purchase_id,ingredient_id,description,qty,unit,unit_price,total) values
    ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000041','Flour',1,'kg',100,100);
  v_result := public.set_supplier_active_manual(v_business,v_id,v_token2,false);
  perform pg_temp.supplier_assert(not (v_result->>'active')::boolean and (v_result->>'updated_at')::timestamptz>v_token2,'archive and version');
  perform pg_temp.supplier_assert((select supplier_id from public.purchases where id='00000000-0000-4000-8000-000000000051')=v_id,'archive preserves purchase FK');
  perform pg_temp.supplier_assert((select count(*) from public.purchase_items where ingredient_id='00000000-0000-4000-8000-000000000041')=1,'archive preserves ingredient relation');
  perform pg_temp.supplier_throws(format('insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total) values(%L,%L,%L,current_date,10)',v_business,'00000000-0000-4000-8000-000000000021',v_id),'supplier_inactive_or_unavailable');
  update public.purchases set supplier_id=v_id,total=110 where id='00000000-0000-4000-8000-000000000051';
  perform pg_temp.supplier_assert((select total from public.purchases where id='00000000-0000-4000-8000-000000000051')=110,'unchanged historic archived supplier is retained');
  v_result := public.set_supplier_active_manual(v_business,v_id,(v_result->>'updated_at')::timestamptz,true);
  perform pg_temp.supplier_assert((v_result->>'active')::boolean,'restore');
  insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total) values(v_business,'00000000-0000-4000-8000-000000000022',v_id,current_date,5);
  perform pg_temp.supplier_assert((select count(*) from public.purchases where supplier_id=v_id)=2,'restored supplier usable across own branches');
  perform pg_temp.supplier_assert(exists(select 1 from public.activity_logs where target_id=v_id and action='supplier.created' and actor_id=auth.uid() and actor_role='owner'),'actor audit from session');
  perform pg_temp.supplier_assert(exists(select 1 from public.activity_logs where target_id=v_id and action='supplier.updated' and data->'after'->>'payment_terms'='15 days'),'audit before/after fields');
  perform pg_temp.supplier_assert(exists(select 1 from public.activity_logs where target_id=v_id and action='supplier.archived'),'archive audited');
  perform pg_temp.supplier_assert(exists(select 1 from public.activity_logs where target_id=v_id and action='supplier.restored'),'restore audited');
end; $$;

-- Cross-tenant defenses also apply to a user who belongs to BOTH businesses.
select public.create_supplier_manual('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000032','Foreign supplier');
select pg_temp.supplier_throws($q$update public.suppliers set business_id='00000000-0000-4000-8000-000000000012' where id='00000000-0000-4000-8000-000000000031'$q$,'immutable');
select pg_temp.supplier_throws($q$select public.update_supplier_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000032',now(),'Foreign edit')$q$,'supplier_not_found');
select pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000032','Foreign supplier')$q$,'supplier_request_conflict');
select pg_temp.supplier_throws($q$insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000032',current_date,10)$q$,'supplier_inactive_or_unavailable');
select pg_temp.supplier_throws($q$insert into public.activity_logs(business_id,action,summary) values('00000000-0000-4000-8000-000000000011','forged','forged')$q$,'row-level security');
select pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),' ')$q$,'invalid_supplier');
select pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),repeat('x',201))$q$,'invalid_supplier');
select pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'Bad email',p_email=>'a@b')$q$,'invalid_supplier');
select pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'Bad phone',p_phone=>'javascript:123')$q$,'invalid_supplier');
select pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'Too long',p_notes=>repeat('x',4001))$q$,'invalid_supplier');

-- Admin/manager write. Reader, inactive and absent actors never gain write access.
do $$ declare v_actor text; begin
  foreach v_actor in array array['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'] loop
    perform set_config('request.jwt.claim.sub',v_actor,true);
    perform public.create_supplier_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'Allowed role');
    perform pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000012',gen_random_uuid(),'Foreign')$q$,'supplier_forbidden');
    perform pg_temp.supplier_assert(not exists(select 1 from public.suppliers where business_id='00000000-0000-4000-8000-000000000012'),'RLS hides foreign suppliers');
  end loop;
  foreach v_actor in array array['00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006',''] loop
    perform set_config('request.jwt.claim.sub',v_actor,true);
    perform pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'Forbidden')$q$,'supplier_forbidden');
    perform pg_temp.supplier_throws($q$select public.update_supplier_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',now(),'Forbidden')$q$,'supplier_forbidden');
    perform pg_temp.supplier_throws($q$select public.set_supplier_active_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',now(),false)$q$,'supplier_forbidden');
  end loop;
end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.supplier_assert(exists(select 1 from public.suppliers where id='00000000-0000-4000-8000-000000000031'),'viewer still reads supplier');
update public.suppliers set name='Forbidden direct update' where id='00000000-0000-4000-8000-000000000031';
select pg_temp.supplier_assert((select name from public.suppliers where id='00000000-0000-4000-8000-000000000031')='Supplier Edited','viewer direct update affects no row');

-- Disabled owners cannot bypass manual RPC checks through Data API writes.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select pg_temp.supplier_throws($q$update public.suppliers set active=false where id='00000000-0000-4000-8000-000000000031'$q$,'supplier_actor_inactive');
select pg_temp.supplier_throws($q$insert into public.suppliers(business_id,name) values('00000000-0000-4000-8000-000000000011','Inactive attempt')$q$,'supplier_actor_inactive');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.supplier_throws($q$delete from public.suppliers where id='00000000-0000-4000-8000-000000000031'$q$,'supplier_archive_required');
select pg_temp.supplier_assert(exists(select 1 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000031' and action='supplier.created' and data->>'source'='manual' and data->>'result'='success'),'manual source and confirmed outcome audited');

-- Audit failure aborts the entire create/edit/archive transaction, including CAS.
reset role;
create function pg_temp.supplier_fail_audit() returns trigger language plpgsql as $$ begin
  if new.target_type='suppliers' then raise exception 'forced_supplier_audit_failure'; end if;
  return new;
end; $$;
create trigger supplier_test_fail_audit before insert on public.activity_logs for each row execute function pg_temp.supplier_fail_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare v_before jsonb; v_logs bigint; v_token timestamptz; begin
  select to_jsonb(s),updated_at into v_before,v_token from public.suppliers s where id='00000000-0000-4000-8000-000000000031';
  select count(*) into v_logs from public.activity_logs;
  perform pg_temp.supplier_throws($q$select public.create_supplier_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000099','Must roll back')$q$,'forced_supplier_audit_failure');
  perform pg_temp.supplier_assert(not exists(select 1 from public.suppliers where id='00000000-0000-4000-8000-000000000099'),'audit failure rolls back create');
  perform pg_temp.supplier_throws(format('select public.update_supplier_manual(%L,%L,%L,%L)','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',v_token,'Must roll back'),'forced_supplier_audit_failure');
  perform pg_temp.supplier_throws(format('select public.set_supplier_active_manual(%L,%L,%L,false)','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',v_token),'forced_supplier_audit_failure');
  perform pg_temp.supplier_assert((select to_jsonb(s) from public.suppliers s where id='00000000-0000-4000-8000-000000000031')=v_before,'audit failure preserves entire row and version');
  perform pg_temp.supplier_assert((select count(*) from public.activity_logs)=v_logs,'failed operations add no audit');
end; $$;
rollback;
