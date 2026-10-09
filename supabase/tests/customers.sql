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
-- Force a future token to prove updates stay monotonic even if wall clocks move.
alter table public.customers disable trigger trg_customers_write;
update public.customers set updated_at=clock_timestamp()+interval '1 day'
 where id='00000000-0000-4000-8000-000000000031';
alter table public.customers enable trigger trg_customers_write;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.customer_assert(not (select prosecdef from pg_proc where oid='public.save_customer_atomic(uuid,jsonb)'::regprocedure),'RPC is invoker');
select pg_temp.customer_assert(not has_function_privilege('anon','public.save_customer_atomic(uuid,jsonb)','execute'),'anonymous RPC revoked');
select pg_temp.customer_assert(not has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='customers_private' and p.proname='audit_customer_change'),'execute'),'audit sink not callable');
select pg_temp.customer_assert((select relrowsecurity from pg_class where oid='public.customers'::regclass),'customer RLS enabled');
select pg_temp.customer_assert((select count(*) from pg_policies where tablename='customers')=2,'no broadened customer policies');

do $$
declare
  b uuid := '00000000-0000-4000-8000-000000000011';
  c uuid := '00000000-0000-4000-8000-000000000031';
  p jsonb := '{"id":null,"expectedUpdatedAt":null,"name":" New customer ","phone":"+54 11 1234","email":"test@example.invalid","channel":"Local","notes":"Contact notes","active":true}';
  r jsonb; v_id uuid; v_token timestamptz; v_token2 timestamptz; logs bigint; invalid jsonb; who text;
begin
  r := public.save_customer_atomic(b,p);
  perform pg_temp.customer_assert((r->>'ok')::boolean,'create persisted'); v_id := (r->>'id')::uuid;
  perform pg_temp.customer_assert((select name='New customer' and visits=0 and total_spend=0 and last_visit_at is null from public.customers where id=v_id),'create never invents historical metrics');
  perform pg_temp.customer_assert((select count(*) from public.activity_logs where target_id=v_id and actor_id=auth.uid() and actor_role='owner' and data->>'source'='manual' and data->>'result'='success' and data->'branch_id'='null'::jsonb)=1,'atomic audit with actual actor/role/source');
  select updated_at into v_token from public.customers where id=c;
  p := p || jsonb_build_object('id',c,'expectedUpdatedAt',v_token,'name','Revised A');
  r := public.save_customer_atomic(b,p);
  perform pg_temp.customer_assert((r->>'ok')::boolean,'update success');
  perform pg_temp.customer_assert((select name='Revised A' and visits=2 and total_spend=100 and last_visit_at='2025-01-01Z'::timestamptz from public.customers where id=c),'update preserves historical aggregates');
  select updated_at into v_token2 from public.customers where id=c;
  perform pg_temp.customer_assert(v_token2>v_token,'CAS token advances');
  perform pg_temp.customer_assert(public.save_customer_atomic(b,p)->>'error'='customer_conflict','stale edit rejected');
  p := p || jsonb_build_object('expectedUpdatedAt',v_token2,'active',false);
  r := public.save_customer_atomic(b,p);
  perform pg_temp.customer_assert((r->>'ok')::boolean and (select not active from public.customers where id=c),'archive retains row');
  perform pg_temp.customer_assert((select count(*) from public.activity_logs where target_id=c and action='customer.archived')=1,'archive audit recorded');
  select updated_at into v_token from public.customers where id=c;
  p := p || jsonb_build_object('expectedUpdatedAt',v_token,'active',true);
  perform pg_temp.customer_assert((public.save_customer_atomic(b,p)->>'ok')::boolean,'restore success');
  perform pg_temp.customer_assert((select count(*) from public.activity_logs where target_id=c and action='customer.restored')=1,'restore audit recorded');
  perform pg_temp.customer_throws('delete from public.customers where id=''' || c || '''','customer_archive_required');
  perform pg_temp.customer_throws('update public.customers set business_id=''00000000-0000-4000-8000-000000000012'' where id=''' || c || '''','customer_tenant_immutable');
  perform pg_temp.customer_assert(public.save_customer_atomic(b,p || '{"id":"00000000-0000-4000-8000-000000000032"}')->>'error'='customer_not_found','even dual owner cannot cross tenant in RPC');
  select updated_at into v_token from public.customers where id=c;
  p := p || jsonb_build_object('expectedUpdatedAt',v_token);
  select count(*) into logs from public.activity_logs;
  for invalid in select value from jsonb_array_elements('[{"name":[]},{"name":""},{"name":"   "},{"email":"bad"},{"email":false},{"phone":"bad phone"},{"notes":{}},{"channel":12},{"active":"false"},{"id":"bad"},{"expectedUpdatedAt":"yesterday"},{"expectedUpdatedAt":null},{"business_id":"00000000-0000-4000-8000-000000000012"},{"actor_id":"00000000-0000-4000-8000-000000000002"},{"visits":99},{"source":"whatsapp"}]') loop
    r := public.save_customer_atomic(b,p || invalid);
    perform pg_temp.customer_assert(r->>'error'='invalid_customer','strict RPC input ' || invalid::text);
  end loop;
  perform pg_temp.customer_assert(public.save_customer_atomic(b,p || jsonb_build_object('notes',repeat('a',2001)))->>'error'='invalid_customer','notes limit');
  perform pg_temp.customer_assert(public.save_customer_atomic(b,p || jsonb_build_object('name',repeat('a',201)))->>'error'='invalid_customer','name limit');
  perform pg_temp.customer_assert((select count(*) from public.activity_logs)=logs,'invalid writes leave no audit or mutation');
  perform pg_temp.customer_assert((select updated_at from public.customers where id=c)=v_token,'invalid writes preserve token');
  update public.customers set channel='Phone' where id=c;
  perform pg_temp.customer_assert((select data->>'source' from public.activity_logs where target_id=c order by created_at desc,id desc limit 1) is not null,'direct write also audited');
  perform pg_temp.customer_assert(exists (select 1 from public.activity_logs where target_id=c and data->>'source'='api'),'RPC resets source after manual write');

  -- Branch-scoped marketing still manages the existing business-wide directory;
  -- this is not permission to read foreign tenant/branch transactions.
  foreach who in array array['00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'] loop
    perform set_config('request.jwt.claim.sub',who,true);
    r := public.save_customer_atomic(b,jsonb_build_object('id',null,'expectedUpdatedAt',null,'name','Role allowed ' || who,'phone',null,'email',null,'channel',null,'notes',null,'active',true));
    perform pg_temp.customer_assert((r->>'ok')::boolean,'admin manager marketing accepted');
    perform pg_temp.customer_assert((select count(*) from public.customers where business_id='00000000-0000-4000-8000-000000000012')=0,'foreign tenant hidden by RLS');
    perform pg_temp.customer_assert(public.save_customer_atomic('00000000-0000-4000-8000-000000000012',p)->>'error'='permission_denied','foreign tenant RPC denied');
  end loop;
  foreach who in array array['00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008'] loop
    perform set_config('request.jwt.claim.sub',who,true);
    perform pg_temp.customer_assert(public.save_customer_atomic(b,p)->>'error'='permission_denied','viewer employee inactive stranger denied');
  end loop;
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
  perform pg_temp.customer_throws('insert into public.customers(business_id,name) values(''' || b || ''',''Forbidden'')','permission_denied');
  update public.customers set name='Forged' where id=c;
  perform pg_temp.customer_assert((select name from public.customers where id=c)='Revised A','viewer direct update changes no row');
  perform pg_temp.customer_throws('insert into public.activity_logs(business_id,action,summary) values(''' || b || ''',''forged'',''forged'')','row-level security');
  perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000007',true);
  perform pg_temp.customer_throws('update public.customers set name=''Inactive'' where id=''' || c || '''','permission_denied');
end;
$$;

-- The audit insert and customer mutation must roll back together on sink error.
reset role;
create function pg_temp.fail_customer_audit() returns trigger language plpgsql as $$ begin
 if new.target_type='customers' then raise exception 'audit_sink_unavailable'; end if; return new; end; $$;
create trigger test_fail_customer_audit before insert on public.activity_logs for each row execute function pg_temp.fail_customer_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.customer_throws($query$select public.save_customer_atomic('00000000-0000-4000-8000-000000000011',
 '{"id":null,"expectedUpdatedAt":null,"name":"Must roll back","phone":null,"email":null,"channel":null,"notes":null,"active":true}')$query$,'audit_sink_unavailable');
select pg_temp.customer_assert(not exists(select 1 from public.customers where name='Must roll back'),'audit failure rolls back insert');
select pg_temp.customer_throws('update public.customers set name=''Must roll back'' where id=''00000000-0000-4000-8000-000000000031''','audit_sink_unavailable');
select pg_temp.customer_assert((select name from public.customers where id='00000000-0000-4000-8000-000000000031')='Revised A','audit failure rolls back update');
reset role;
drop trigger test_fail_customer_audit on public.activity_logs;
-- Business-level cascades can run after memberships have already been removed.
delete from public.business_members where business_id='00000000-0000-4000-8000-000000000012';
delete from public.businesses where id='00000000-0000-4000-8000-000000000012';
select pg_temp.customer_assert(not exists(select 1 from public.customers where id='00000000-0000-4000-8000-000000000032'),'business cascade preserves existing lifecycle');
rollback;
