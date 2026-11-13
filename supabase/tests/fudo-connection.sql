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


-- Atomic page RPC: SQL rejects stale/foreign actors and commits staging+cursor
-- together. Fixture-only data; whole suite rolled back.
select pg_temp.fudo_assert(
  not has_function_privilege('authenticated',
    'public.fudo_commit_sync_page(uuid,uuid,uuid,uuid,text,integer,integer,uuid,timestamptz,jsonb)','execute')
  and not has_function_privilege('anon',
    'public.fudo_commit_sync_page(uuid,uuid,uuid,uuid,text,integer,integer,uuid,timestamptz,jsonb)','execute'),
  'browser roles cannot call page commit');

do $fudo$
declare
  a uuid := '00000000-0000-4000-8000-000000008010';
  b uuid := '00000000-0000-4000-8000-000000008020';
  owner_a uuid := '00000000-0000-4000-8000-000000008001';
  owner_b uuid := '00000000-0000-4000-8000-000000008002';
  generation_a uuid;
  run_a uuid;
  cycle uuid := '00000000-0000-4000-8000-000000008399';
  cycle_start timestamptz := '2026-11-06T20:00:00Z';
  first_row jsonb := jsonb_build_array(jsonb_build_object(
    'external_id','page-fixture-a','payload',jsonb_build_object('id','page-fixture-a'),
    'content_hash',repeat('a',64),'source_updated_at',null));
  second_row jsonb := jsonb_build_array(jsonb_build_object(
    'external_id','page-fixture-b','payload',jsonb_build_object('id','page-fixture-b','version',2),
    'content_hash',repeat('b',64),'source_updated_at',null));
  result jsonb;
begin
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,owner_a,repeat('s',100))='connected',
    'owner can connect fixture A');
  select connection_generation into generation_a from public.fudo_connections where business_id=a;
  result := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(result->>'code'='started','page fixture starts run');
  run_a := (result->>'run_id')::uuid;

  result := public.fudo_commit_sync_page(a,generation_a,owner_b,run_a,
    'products',1,2,cycle,cycle_start,first_row);
  perform pg_temp.fudo_assert(result->>'code'='forbidden','B owner cannot stage into A');

  result := public.fudo_commit_sync_page(a,generation_a,owner_a,run_a,
    'products',1,2,cycle,cycle_start,first_row);
  perform pg_temp.fudo_assert(result->>'code'='saved','page one is atomically committed');
  perform pg_temp.fudo_assert(
    (select count(*)=1 from public.fudo_external_records
       where business_id=a and connection_generation=generation_a and external_id='page-fixture-a')
    and (select next_page=2 and cycle_id=cycle
         from public.fudo_sync_progress where business_id=a
           and connection_generation=generation_a and resource_type='products'),
    'snapshot and cursor both stored');

  result := public.fudo_commit_sync_page(a,generation_a,owner_a,run_a,
    'products',1,2,cycle,cycle_start,first_row);
  perform pg_temp.fudo_assert(result->>'code'='stale_page','stale page cannot rewrite cursor');

  update public.business_members set role='manager' where business_id=a and user_id=owner_a;
  result := public.fudo_commit_sync_page(a,generation_a,owner_a,run_a,
    'products',2,0,cycle,cycle_start,second_row);
  perform pg_temp.fudo_assert(result->>'code'='forbidden','revoked actor blocked in SQL transaction');
  perform pg_temp.fudo_assert(
    (select next_page=2 from public.fudo_sync_progress where business_id=a
      and connection_generation=generation_a and resource_type='products')
    and (select content_hash=repeat('a',64) from public.fudo_external_records
      where business_id=a and connection_generation=generation_a and external_id='page-fixture-a'),
    'revoked attempt changes neither cursor nor snapshot');
  update public.business_members set role='owner' where business_id=a and user_id=owner_a;

  result := public.fudo_commit_sync_page(a,generation_a,owner_a,run_a,
    'products',2,0,'00000000-0000-4000-8000-000000008398',cycle_start,second_row);
  perform pg_temp.fudo_assert(result->>'code'='cycle_changed','resumed page must preserve cycle UUID');

  result := public.fudo_commit_sync_page(a,generation_a,owner_a,run_a,
    'products',2,0,cycle,cycle_start,
    jsonb_build_array(jsonb_build_object('external_id','bad','payload',jsonb_build_object('id','bad'),
      'content_hash','bad-hash')));
  perform pg_temp.fudo_assert(result->>'code'='invalid_input','malformed record rejected before writing');

  -- A provider returning the same external ID on two different pages of
  -- ONE cycle must fail: upsert would hide an overlapping/inconsistent scan.
  result := public.fudo_commit_sync_page(a,generation_a,owner_a,run_a,
    'products',2,0,cycle,cycle_start,first_row);
  perform pg_temp.fudo_assert(result->>'code'='duplicate_in_cycle',
    'overlapping provider pages must not certify the cycle');
  perform pg_temp.fudo_assert(
    (select next_page=2 from public.fudo_sync_progress
      where business_id=a and connection_generation=generation_a and resource_type='products')
    and (select content_hash=repeat('a',64) from public.fudo_external_records
      where business_id=a and connection_generation=generation_a and resource_type='products'
        and external_id='page-fixture-a'),
    'duplicate does not change staging, provenance or cursor');

  result := public.fudo_commit_sync_page(a,generation_a,owner_a,run_a,
    'products',2,0,cycle,cycle_start,second_row);
  perform pg_temp.fudo_assert(result->>'code'='saved','distinct page two completes the import');
  perform pg_temp.fudo_assert(
    (select next_page=0 and last_complete_at is not null from public.fudo_sync_progress
      where business_id=a and connection_generation=generation_a and resource_type='products')
    and (select content_hash=repeat('a',64) from public.fudo_external_records
      where business_id=a and connection_generation=generation_a and external_id='page-fixture-a')
    and (select content_hash=repeat('b',64) from public.fudo_external_records
      where business_id=a and connection_generation=generation_a and external_id='page-fixture-b')
    and (select count(*)=2 from public.fudo_external_records
      where business_id=a and connection_generation=generation_a and resource_type='products'),
    'distinct source IDs on subsequent pages stay mapped without duplication');

  update public.fudo_sync_runs set status='completed',finished_at=now() where id=run_a;
  result := public.fudo_commit_sync_page(a,generation_a,owner_a,run_a,
    'ingredients',1,0,cycle,cycle_start,'[]'::jsonb);
  perform pg_temp.fudo_assert(result->>'code'='run_changed','closed run cannot append snapshots');

  perform pg_temp.fudo_assert(
    (select count(*)=0 from public.fudo_external_records where business_id=b
      and external_id='page-fixture-a'),
    'no cross-tenant staging');
end $fudo$;


-- Read-only Fudo rescan reset is atomic with authorized run start.
-- Synthetic fixtures; this entire test transaction rolls back.
do $cycle$
declare
  a uuid := '00000000-0000-4000-8000-000000008010';
  b uuid := '00000000-0000-4000-8000-000000008020';
  owner_a uuid := '00000000-0000-4000-8000-000000008001';
  generation_a uuid;
  started jsonb;
  staging_before integer;
  b_before integer;
begin
  select connection_generation into generation_a from public.fudo_connections where business_id=a;
  perform pg_temp.fudo_assert(generation_a is not null,'rescan fixture connection exists');
  -- Existing product cursor is 0; others missing: an incomplete scan resumes.
  started := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(started->>'code'='started','incomplete scan resumes');
  perform pg_temp.fudo_assert(
    (select count(*)=1 from public.fudo_sync_progress where business_id=a
     and connection_generation=generation_a and resource_type='products' and next_page=0),
    'incomplete scan retains completed resource');
  update public.fudo_sync_runs set status='partial',finished_at=now()
    where id=(started->>'run_id')::uuid;

  insert into public.fudo_sync_progress
    (business_id,connection_generation,resource_type,next_page,cycle_id,cycle_started_at,last_complete_at)
  select a,generation_a,r,0,gen_random_uuid(),now(),now()
    from unnest(array['ingredients','providers','orders','sales']) as r
  on conflict (business_id,connection_generation,resource_type)
    do update set next_page=0,last_complete_at=now();
  select count(*) into staging_before from public.fudo_external_records
    where business_id=a and connection_generation=generation_a;
  select count(*) into b_before from public.fudo_sync_progress where business_id=b;

  -- A post-run revocation must preserve all five completed cursors.
  update public.business_members set role='manager' where business_id=a and user_id=owner_a;
  started := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(started->>'code'='forbidden','revoked actor denied reset');
  perform pg_temp.fudo_assert(
    (select count(*)=5 from public.fudo_sync_progress where business_id=a
      and connection_generation=generation_a and next_page=0),
    'denied reset keeps complete cursors');
  update public.business_members set role='owner' where business_id=a and user_id=owner_a;

  started := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(started->>'code'='started','authorized rescan starts');
  perform pg_temp.fudo_assert(
    (select count(*)=0 from public.fudo_sync_progress where business_id=a
      and connection_generation=generation_a),
    'authorized begin resets five cursors atomically');
  perform pg_temp.fudo_assert(
    (select count(*)=staging_before from public.fudo_external_records
     where business_id=a and connection_generation=generation_a)
    and (select count(*)=b_before from public.fudo_sync_progress where business_id=b),
    'historical snapshots and other tenant unchanged');
  -- The same external ID is legitimate in a NEW full-scan cycle; this
  -- guard must not reject normal idempotent rescans of historical staging.
  perform pg_temp.fudo_assert(
    (select count(*)=2 from public.fudo_external_records
      where business_id=a and connection_generation=generation_a and resource_type='products'),
    'rescan preserves prior product staging');
  perform pg_temp.fudo_assert(
    (public.fudo_commit_sync_page(a,generation_a,owner_a,
       (started->>'run_id')::uuid,'products',1,0,
       '00000000-0000-4000-8000-000000008377'::uuid,now(),
       jsonb_build_array(jsonb_build_object(
         'external_id','page-fixture-a','payload',jsonb_build_object('id','page-fixture-a','rescan',true),
         'content_hash',repeat('c',64),'source_updated_at',null))) ->> 'code')='saved',
    'same ID is accepted in new cycle');
  perform pg_temp.fudo_assert(
    (select count(*)=2 from public.fudo_external_records
      where business_id=a and connection_generation=generation_a and resource_type='products')
    and (select content_hash=repeat('c',64)
        and last_seen_cycle_id='00000000-0000-4000-8000-000000008377'::uuid
        from public.fudo_external_records where business_id=a
          and connection_generation=generation_a and resource_type='products'
          and external_id='page-fixture-a'),
    'rescan updates provenance of old ID without creating a duplicate row');
  update public.fudo_sync_runs set status='completed',finished_at=now()
    where id=(started->>'run_id')::uuid;
end $cycle$;


-- O1: finalization must close the audit run and update connection health
-- atomically, while a revoked owner can only mark their own run as failed.
select pg_temp.fudo_assert(
  not has_function_privilege('authenticated',
    'public.fudo_finish_sync(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)','execute')
  and not has_function_privilege('anon',
    'public.fudo_finish_sync(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)','execute'),
  'finish-sync is service-role only');

do $finish$
declare
  a uuid := '00000000-0000-4000-8000-000000008010';
  owner_a uuid := '00000000-0000-4000-8000-000000008001';
  owner_b uuid := '00000000-0000-4000-8000-000000008002';
  generation_a uuid;
  started jsonb;
  run_a uuid;
  result jsonb;
  original_health text;
  original_synced timestamptz;
begin
  select connection_generation,last_sync_status,last_synced_at
    into generation_a,original_health,original_synced
    from public.fudo_connections where business_id=a;
  perform pg_temp.fudo_assert(generation_a is not null,'finish fixture connection exists');
  started := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(started->>'code'='started','finish fixture run starts');
  run_a := (started->>'run_id')::uuid;

  result := public.fudo_finish_sync(a,generation_a,owner_b,run_a,
    'completed','{}'::jsonb,null,true);
  perform pg_temp.fudo_assert(result->>'code'='run_changed',
    'B owner cannot finish a run owned by A');

  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'completed','[]'::jsonb,null,true);
  perform pg_temp.fudo_assert(result->>'code'='invalid_input',
    'malformed counts rejected');
  perform pg_temp.fudo_assert(
    (select status='running' from public.fudo_sync_runs where id=run_a),
    'invalid finish never closes run');

  update public.business_members set role='manager'
    where business_id=a and user_id=owner_a;
  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'completed','{}'::jsonb,null,true);
  perform pg_temp.fudo_assert(result->>'code'='forbidden',
    'revoked owner cannot finish successfully');
  perform pg_temp.fudo_assert(
    (select status='running' from public.fudo_sync_runs where id=run_a)
    and (select last_sync_status is not distinct from original_health
      and last_synced_at is not distinct from original_synced
      from public.fudo_connections where business_id=a),
    'denied finish never changes run or connection health');

  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'failed',jsonb_build_object('products',1),'forbidden',false);
  perform pg_temp.fudo_assert(result->>'code'='finished',
    'revoked actor can close its own failed audit run');
  perform pg_temp.fudo_assert(
    (select status='failed' and error_code='forbidden'
      from public.fudo_sync_runs where id=run_a)
    and (select last_sync_status is not distinct from original_health
      and last_synced_at is not distinct from original_synced
      from public.fudo_connections where business_id=a),
    'failed audit close cannot rewrite connection on revocation');

  update public.business_members set role='owner'
    where business_id=a and user_id=owner_a;
  started := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(started->>'code'='started','next run starts');
  run_a := (started->>'run_id')::uuid;
  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'partial',jsonb_build_object('products',2),null,true);
  perform pg_temp.fudo_assert(result->>'code'='finished'
    and (result->>'connection_updated')::boolean,
    'authorized finish updates both rows');
  perform pg_temp.fudo_assert(
    (select status='partial' and counts->>'products'='2'
      from public.fudo_sync_runs where id=run_a)
    and (select last_sync_status='partial' and last_error_code is null
      and last_synced_at is not null
      from public.fudo_connections where business_id=a),
    'run and connection health finish consistently');
  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'partial','{}'::jsonb,null,true);
  perform pg_temp.fudo_assert(result->>'code'='run_changed',
    'already closed run cannot be rewritten');
end $finish$;

-- A false completed status is a correctness fault even if the server action
-- reports it: all FIVE durable per-resource cursor commits are required.
-- These service-role fixtures are rolled back at the end of this file.
do $complete_guard$
declare
  a uuid := '00000000-0000-4000-8000-000000008010';
  owner_a uuid := '00000000-0000-4000-8000-000000008001';
  generation_a uuid;
  started jsonb;
  run_a uuid;
  result jsonb;
begin
  select connection_generation into generation_a from public.fudo_connections where business_id=a;
  started := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(started->>'code'='started','completion guard run starts');
  run_a := (started->>'run_id')::uuid;

  -- A completed claim without committed resource pages must not close the run
  -- or publish a healthy connection status.
  delete from public.fudo_sync_progress
   where business_id=a and connection_generation=generation_a;
  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'completed','{}'::jsonb,null,true);
  perform pg_temp.fudo_assert(result->>'code'='incomplete_cycle',
    'no cursor cannot be reported complete');
  perform pg_temp.fudo_assert(
    (select status='running' and finished_at is null from public.fudo_sync_runs where id=run_a),
    'rejected completion leaves run running');

  -- Four resources completed is still a partial scan, including empty tables.
  insert into public.fudo_sync_progress
    (business_id,connection_generation,resource_type,next_page,cycle_id,cycle_started_at,last_complete_at)
  select a,generation_a,r,0,gen_random_uuid(),now(),now()
    from unnest(array['products','ingredients','providers','orders']) as r;
  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'completed','{}'::jsonb,null,true);
  perform pg_temp.fudo_assert(result->>'code'='incomplete_cycle',
    'four completed resources cannot certify five');
  insert into public.fudo_sync_progress
    (business_id,connection_generation,resource_type,next_page,cycle_id,cycle_started_at,last_complete_at)
  values (a,generation_a,'sales',0,null,now(),now());
  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'completed','{}'::jsonb,null,true);
  perform pg_temp.fudo_assert(result->>'code'='incomplete_cycle',
    'legacy cursor without a cycle UUID cannot certify completion');

  update public.fudo_sync_progress set cycle_id=gen_random_uuid()
    where business_id=a and connection_generation=generation_a and resource_type='sales';
  result := public.fudo_finish_sync(a,generation_a,owner_a,run_a,
    'completed','{}'::jsonb,null,true);
  perform pg_temp.fudo_assert(result->>'code'='finished',
    'five committed identifiable resource cycles can complete');
  perform pg_temp.fudo_assert(
    (select status='completed' from public.fudo_sync_runs where id=run_a)
    and (select last_sync_status='completed' from public.fudo_connections where business_id=a),
    'run and connection health finalize together only after five cursors');
end $complete_guard$;


-- O1 retest health is an authorized transaction, not a service-role UPDATE.
-- All data here is synthetic and the enclosing fixture transaction rolls back.
select pg_temp.fudo_assert(
  has_function_privilege('service_role',
    'public.fudo_record_connection_test(uuid,uuid,uuid,timestamptz,text,text)','execute')
  and not has_function_privilege('authenticated',
    'public.fudo_record_connection_test(uuid,uuid,uuid,timestamptz,text,text)','execute')
  and not has_function_privilege('anon',
    'public.fudo_record_connection_test(uuid,uuid,uuid,timestamptz,text,text)','execute'),
  'retest RPC only callable by service_role');

do $retest$
declare
  a uuid := '00000000-0000-4000-8000-000000008010';
  owner_a uuid := '00000000-0000-4000-8000-000000008001';
  owner_b uuid := '00000000-0000-4000-8000-000000008002';
  manager_a uuid := '00000000-0000-4000-8000-000000008003';
  inactive_a uuid := '00000000-0000-4000-8000-000000008004';
  generation_a uuid;
  previous timestamptz;
  newest timestamptz;
  result text;
begin
  select connection_generation,last_tested_at into generation_a,previous
    from public.fudo_connections where business_id=a;
  perform pg_temp.fudo_assert(generation_a is not null,
    'retest fixture has a connection');

  result := public.fudo_record_connection_test(a,generation_a,owner_b,
    previous,'error','forbidden');
  perform pg_temp.fudo_assert(result='forbidden','other tenant cannot retest A');
  result := public.fudo_record_connection_test(a,generation_a,manager_a,
    previous,'error','forbidden');
  perform pg_temp.fudo_assert(result='forbidden','manager cannot retest');
  result := public.fudo_record_connection_test(a,generation_a,inactive_a,
    previous,'error','forbidden');
  perform pg_temp.fudo_assert(result='forbidden','inactive admin cannot retest');

  result := public.fudo_record_connection_test(a,generation_a,owner_a,
    previous,'connected',null);
  perform pg_temp.fudo_assert(result='recorded','owner can record successful retest');
  select last_tested_at into newest from public.fudo_connections where business_id=a;
  perform pg_temp.fudo_assert(newest > previous,'retest timestamp advances');

  result := public.fudo_record_connection_test(a,generation_a,owner_a,
    previous,'error','forbidden');
  perform pg_temp.fudo_assert(result='connection_changed',
    'late provider failure cannot clobber a newer retest');
  perform pg_temp.fudo_assert(
    (select status='connected' and last_error_code is null
     and last_tested_at=newest from public.fudo_connections where business_id=a),
    'stale CAS leaves connection health intact');

  update public.business_members set role='manager' where business_id=a and user_id=owner_a;
  result := public.fudo_record_connection_test(a,generation_a,owner_a,
    newest,'error','forbidden');
  perform pg_temp.fudo_assert(result='forbidden',
    'transaction-time revocation cannot write health');
  perform pg_temp.fudo_assert(
    (select status='connected' and last_tested_at=newest
     from public.fudo_connections where business_id=a),
    'denied actor leaves test metadata intact');
  update public.business_members set role='owner' where business_id=a and user_id=owner_a;

  result := public.fudo_record_connection_test(a,generation_a,owner_a,
    newest,'error','forbidden');
  perform pg_temp.fudo_assert(result='recorded',
    'authorized retest may record a sanitized failure');
  perform pg_temp.fudo_assert(
    (select status='error' and last_error_code='forbidden'
      from public.fudo_connections where business_id=a),
    'only sanitized provider failure code stored');

  -- A skewed server clock must never let CAS revisions repeat.
  update public.fudo_connections set last_tested_at=now()+interval '1 hour'
    where business_id=a;
  select last_tested_at into previous from public.fudo_connections where business_id=a;
  result := public.fudo_record_connection_test(a,generation_a,owner_a,
    previous,'connected',null);
  select last_tested_at into newest from public.fudo_connections where business_id=a;
  perform pg_temp.fudo_assert(result='recorded' and newest>previous,
    'retest revision advances even when DB timestamp was in the future');

  result := public.fudo_record_connection_test(a,generation_a,owner_a,
    newest,'error','PRIVATE_PAYLOAD');
  perform pg_temp.fudo_assert(result='invalid_input',
    'non-sanitized error codes cannot reach persistent health');

  perform pg_temp.fudo_assert(
    public.fudo_replace_connection(a,owner_a,repeat('r',100))='connected',
    'rotation can invalidate a prior probe');
  result := public.fudo_record_connection_test(a,generation_a,owner_a,
    newest,'error','forbidden');
  perform pg_temp.fudo_assert(result='connection_changed',
    'old generation cannot overwrite a rotated connection');
end $retest$;


-- O1: a stale UI or a slow provider probe cannot restore/overwrite a newer
-- connection. These are transaction-level compare-and-swap fixtures.
select pg_temp.fudo_assert(
  has_function_privilege('service_role',
    'public.fudo_replace_connection_guarded(uuid,uuid,text,uuid,timestamptz)','execute')
  and not has_function_privilege('anon',
    'public.fudo_replace_connection_guarded(uuid,uuid,text,uuid,timestamptz)','execute')
  and not has_function_privilege('authenticated',
    'public.fudo_replace_connection_guarded(uuid,uuid,text,uuid,timestamptz)','execute'),
  'guarded rotation RPC only executable by service_role');

do $rotation_guard$
declare
  a uuid := '00000000-0000-4000-8000-000000008010';
  b uuid := '00000000-0000-4000-8000-000000008020';
  owner_a uuid := '00000000-0000-4000-8000-000000008001';
  owner_b uuid := '00000000-0000-4000-8000-000000008002';
  generation uuid;
  tested timestamptz;
  fresh_generation uuid;
  fresh_tested timestamptz;
begin
  -- The disconnected form observed NULL/NULL. It can create one connection,
  -- but cannot overwrite credentials added by another admin afterward.
  perform pg_temp.fudo_assert(
    public.fudo_replace_connection_guarded(b,owner_b,repeat('x',100),null,null)='connected',
    'disconnected form can create first connection');
  perform pg_temp.fudo_assert(
    public.fudo_replace_connection_guarded(b,owner_b,repeat('y',100),null,null)='connection_changed',
    'stale disconnected form cannot overwrite an existing connection');
  perform pg_temp.fudo_assert(
    (select credentials_ciphertext=repeat('x',100) from public.fudo_connections where business_id=b),
    'stale initial form preserves newer ciphertext');

  select connection_generation,last_tested_at into generation,tested
    from public.fudo_connections where business_id=b;
  perform pg_temp.fudo_assert(
    public.fudo_replace_connection_guarded(b,owner_a,repeat('z',100),generation,tested)='forbidden',
    'wrong tenant cannot rotate via guarded RPC');
  perform pg_temp.fudo_assert(
    public.fudo_replace_connection_guarded(b,owner_b,repeat('r',100),generation,tested)='connected',
    'fresh owner can rotate');
  select connection_generation,last_tested_at into fresh_generation,fresh_tested
    from public.fudo_connections where business_id=b;
  perform pg_temp.fudo_assert(fresh_generation<>generation,
    'successful rotation advances credential generation');
  perform pg_temp.fudo_assert(
    public.fudo_replace_connection_guarded(b,owner_b,repeat('s',100),generation,tested)='connection_changed',
    'late completed old probe cannot overwrite newer rotation');
  perform pg_temp.fudo_assert(
    (select credentials_ciphertext=repeat('r',100) from public.fudo_connections where business_id=b),
    'late provider probe leaves rotated credentials unchanged');

  perform pg_temp.fudo_assert(
    public.fudo_record_connection_test(b,fresh_generation,owner_b,fresh_tested,'error','forbidden')='recorded',
    'fixture can retest without rotating credentials');
  perform pg_temp.fudo_assert(
    public.fudo_replace_connection_guarded(b,owner_b,repeat('t',100),fresh_generation,fresh_tested)='connection_changed',
    'late rotation cannot ignore a newer credential retest');
  perform pg_temp.fudo_assert(
    public.fudo_disconnect_connection(b,owner_b)='disconnected',
    'disconnect works after guarded rotation');
  perform pg_temp.fudo_assert(
    public.fudo_replace_connection_guarded(b,owner_b,repeat('u',100),fresh_generation,fresh_tested)='connection_changed',
    'late rotation cannot resurrect a disconnected connection');
end $rotation_guard$;

rollback;
