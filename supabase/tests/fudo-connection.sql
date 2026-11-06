-- Fudo O1: isolated SQL regressions for atomic lifecycle fencing, grants and stale run recovery.
-- Fixture-only fake ciphertext; no Fudo calls or production data. Transaction rolls back.
begin;

create function pg_temp.fudo_assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FUDO ASSERTION FAILED: %', message; end if; end $$;

insert into auth.users(id,email) values
('00000000-0000-4000-8000-000000008001','fudo-owner-a@example.invalid'),
('00000000-0000-4000-8000-000000008002','fudo-owner-b@example.invalid'),
('00000000-0000-4000-8000-000000008003','fudo-manager-a@example.invalid'),
('00000000-0000-4000-8000-000000008004','fudo-inactive-a@example.invalid'),
('00000000-0000-4000-8000-000000008005','fudo-outsider@example.invalid');
insert into public.organizations(id,name) values
('00000000-0000-4000-8000-000000008000','Fudo QA organization');
insert into public.businesses(id,organization_id,name) values
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008000','Fudo business A'),
('00000000-0000-4000-8000-000000008020','00000000-0000-4000-8000-000000008000','Fudo business B');

-- Explicit memberships: service-role lifecycle functions must no longer trust
-- a caller-supplied actor ID without locking its current tenant role/profile.
insert into public.profiles (id, full_name, active) values
('00000000-0000-4000-8000-000000008001','Fudo owner A',true),
('00000000-0000-4000-8000-000000008002','Fudo owner B',true),
('00000000-0000-4000-8000-000000008003','Fudo manager A',true),
('00000000-0000-4000-8000-000000008004','Fudo inactive admin A',false),
('00000000-0000-4000-8000-000000008005','Fudo outsider',true)
on conflict (id) do update set active = excluded.active;
insert into public.business_members (business_id,user_id,role) values
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008001','owner'),
('00000000-0000-4000-8000-000000008020','00000000-0000-4000-8000-000000008002','owner'),
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008003','manager'),
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008004','admin')
on conflict (business_id,user_id) do update set role = excluded.role;

select pg_temp.fudo_assert(
  not has_table_privilege('authenticated','public.fudo_connections','select')
  and not has_table_privilege('authenticated','public.fudo_external_records','select')
  and not has_table_privilege('authenticated','public.fudo_sync_runs','insert'),
  'credentials and imported payload inaccessible to authenticated browser roles');
select pg_temp.fudo_assert(
  not has_function_privilege('authenticated','public.fudo_replace_connection(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.fudo_begin_sync(uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.fudo_disconnect_connection(uuid,uuid)','execute')
  and to_regprocedure('public.fudo_disconnect_connection(uuid)') is null,
  'privileged lifecycle RPCs are service-role only');

set local role service_role;

do $$
declare
  a uuid := '00000000-0000-4000-8000-000000008010';
  b uuid := '00000000-0000-4000-8000-000000008020';
  owner_a uuid := '00000000-0000-4000-8000-000000008001';
  owner_b uuid := '00000000-0000-4000-8000-000000008002';
  manager_a uuid := '00000000-0000-4000-8000-000000008003';
  inactive_a uuid := '00000000-0000-4000-8000-000000008004';
  outsider uuid := '00000000-0000-4000-8000-000000008005';
  cipher text := repeat('x',100);
  generation_a uuid;
  generation_b uuid;
  start_result jsonb;
  run_id uuid;
begin
  -- Denied actors cannot create a connection even through service_role.
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,owner_b,cipher)='forbidden',
    'business B owner denied for A');
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,manager_a,cipher)='forbidden',
    'manager denied for A');
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,inactive_a,cipher)='forbidden',
    'inactive admin denied for A');
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,outsider,cipher)='forbidden',
    'nonmember denied for A');
  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(a,owner_b)='forbidden',
    'other tenant cannot disconnect A');
  perform pg_temp.fudo_assert((select count(*)=0 from public.fudo_connections),
    'denied operations never persist credentials');

  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,owner_a,cipher)='connected',
    'first connection succeeds');
  select connection_generation into generation_a from public.fudo_connections where business_id=a;
  perform pg_temp.fudo_assert(generation_a is not null, 'new connection has generation');
  perform pg_temp.fudo_assert(public.fudo_replace_connection(b,owner_b,cipher)='connected',
    'second tenant connection is separate');
  select connection_generation into generation_b from public.fudo_connections where business_id=b;
  perform pg_temp.fudo_assert(generation_a<>generation_b,'generations distinct');

  perform pg_temp.fudo_assert(public.fudo_begin_sync(a,generation_a,owner_b)->>'code'='forbidden',
    'other tenant cannot start sync');
  perform pg_temp.fudo_assert(public.fudo_begin_sync(a,generation_a,manager_a)->>'code'='forbidden',
    'manager cannot start sync');
  perform pg_temp.fudo_assert(public.fudo_begin_sync(a,generation_a,inactive_a)->>'code'='forbidden',
    'inactive admin cannot start sync');
  perform pg_temp.fudo_assert((select count(*)=0 from public.fudo_sync_runs),
    'denied starts do not produce runs');
  start_result := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(start_result->>'code'='started','first sync starts');
  run_id := (start_result->>'run_id')::uuid;
  perform pg_temp.fudo_assert(run_id is not null,'run receives id');
  perform pg_temp.fudo_assert(public.fudo_begin_sync(a,generation_a,owner_a)->>'code'='sync_running',
    'second sync cannot start');
  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(a,owner_a)='sync_running',
    'disconnect prohibited while sync active');
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,owner_a,cipher)='sync_running',
    'rotation prohibited while sync active');
  perform pg_temp.fudo_assert(public.fudo_begin_sync(b,generation_a,owner_b)->>'code'='connection_changed',
    'tenant B cannot claim tenant A generation');

  update public.fudo_sync_runs set status='completed',finished_at=now() where id=run_id;

  -- Revocation after a successful connection cannot overwrite ciphertext,
  -- start a new run or disconnect the existing connection.
  update public.business_members set role='manager'
    where business_id=a and user_id=owner_a;
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,owner_a,repeat('y',100))='forbidden',
    'revoked owner cannot rotate stored credentials');
  perform pg_temp.fudo_assert(
    (select credentials_ciphertext=cipher from public.fudo_connections where business_id=a),
    'denied rotation preserves existing ciphertext');
  perform pg_temp.fudo_assert(public.fudo_begin_sync(a,generation_a,owner_a)->>'code'='forbidden',
    'revoked owner cannot start another sync');
  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(a,owner_a)='forbidden',
    'revoked owner cannot delete connection');
  perform pg_temp.fudo_assert(
    (select count(*)=1 from public.fudo_connections where business_id=a),
    'connection remains after denied disconnect');
  update public.business_members set role='owner'
    where business_id=a and user_id=owner_a;
  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(a,owner_a)='disconnected',
    'disconnect after completed run succeeds');
  perform pg_temp.fudo_assert(
    (select count(*)=0 from public.fudo_connections where business_id=a),
    'disconnect removes encrypted credentials');
  perform pg_temp.fudo_assert(public.fudo_begin_sync(a,generation_a,owner_a)->>'code'='connection_changed',
    'disconnected connection cannot start a sync');

  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,owner_a,cipher)='connected',
    'reconnect succeeds');
  perform pg_temp.fudo_assert((select connection_generation<>generation_a from public.fudo_connections where business_id=a),
    'reconnecting creates new generation');
  select connection_generation into generation_a from public.fudo_connections where business_id=a;
  start_result:=public.fudo_begin_sync(a,generation_a,owner_a);
  run_id:=(start_result->>'run_id')::uuid;
  update public.fudo_sync_runs set started_at=now()-interval '11 minutes' where id=run_id;
  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(a,owner_a)='disconnected',
    'stale abandoned run does not lock out disconnection');
  perform pg_temp.fudo_assert(
    (select status='failed' and error_code='interrupted' from public.fudo_sync_runs where id=run_id),
    'stale run marked failed for audit');

  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(b,owner_b)='disconnected',
    'other tenant remains independently manageable');
end $$;

-- A full second cycle retains historical IDs; only the stable cycle UUID
-- identifies records seen again. This does not depend on server clocks.
insert into public.fudo_sync_progress (
  business_id,connection_generation,resource_type,next_page,cycle_id,cycle_started_at,last_complete_at
) values
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008111','products',0,'00000000-0000-4000-8000-000000008311','2026-11-03T09:00:00Z','2026-11-03T09:03:00Z'),
('00000000-0000-4000-8000-000000008020','00000000-0000-4000-8000-000000008222','products',2,'00000000-0000-4000-8000-000000008322','2026-11-03T09:00:00Z',null),
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008111','ingredients',1,null,null,null);
insert into public.fudo_external_records (
  business_id,connection_generation,resource_type,external_id,payload,content_hash,last_seen_cycle_id,last_seen_at
) values
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008111','products','seen-again','{"id":"seen-again"}',repeat('a',64),'00000000-0000-4000-8000-000000008311','2026-11-03T09:02:00Z'),
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008111','products','historical-only','{"id":"historical-only"}',repeat('a',64),'00000000-0000-4000-8000-000000008301','2026-11-03T09:04:00Z'),
('00000000-0000-4000-8000-000000008020','00000000-0000-4000-8000-000000008222','products','other-business','{"id":"other-business"}',repeat('a',64),'00000000-0000-4000-8000-000000008322','2026-11-03T09:02:00Z');

select pg_temp.fudo_assert(
  (select count(*)=2 from public.fudo_external_records
   where business_id='00000000-0000-4000-8000-000000008010'
     and connection_generation='00000000-0000-4000-8000-000000008111'
     and resource_type='products')
  and
  (select count(*)=1 from public.fudo_external_records
   where business_id='00000000-0000-4000-8000-000000008010'
     and connection_generation='00000000-0000-4000-8000-000000008111'
     and resource_type='products'
     and last_seen_cycle_id='00000000-0000-4000-8000-000000008311'),
  'second scan retains historical records but only one belongs to this cycle');

select pg_temp.fudo_assert(
  (select count(*)=1 from public.fudo_external_records
   where business_id='00000000-0000-4000-8000-000000008020'
     and connection_generation='00000000-0000-4000-8000-000000008222'
     and resource_type='products'
     and last_seen_cycle_id='00000000-0000-4000-8000-000000008322')
  and
  (select cycle_id is null from public.fudo_sync_progress
   where business_id='00000000-0000-4000-8000-000000008010'
     and resource_type='ingredients'),
  'tenant counts stay separate; legacy cycle stays unknown');

rollback;
