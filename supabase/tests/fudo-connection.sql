-- Fudo O1: isolated SQL regressions for atomic lifecycle fencing, grants and stale run recovery.
-- Fixture-only fake ciphertext; no Fudo calls or production data. Transaction rolls back.
begin;

create function pg_temp.fudo_assert(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FUDO ASSERTION FAILED: %', message; end if; end $$;

insert into auth.users(id,email) values
('00000000-0000-4000-8000-000000008001','fudo-owner-a@example.invalid'),
('00000000-0000-4000-8000-000000008002','fudo-owner-b@example.invalid');
insert into public.organizations(id,name) values
('00000000-0000-4000-8000-000000008000','Fudo QA organization');
insert into public.businesses(id,organization_id,name) values
('00000000-0000-4000-8000-000000008010','00000000-0000-4000-8000-000000008000','Fudo business A'),
('00000000-0000-4000-8000-000000008020','00000000-0000-4000-8000-000000008000','Fudo business B');

select pg_temp.fudo_assert(
  not has_table_privilege('authenticated','public.fudo_connections','select')
  and not has_table_privilege('authenticated','public.fudo_external_records','select')
  and not has_table_privilege('authenticated','public.fudo_sync_runs','insert'),
  'credentials and imported payload inaccessible to authenticated browser roles');
select pg_temp.fudo_assert(
  not has_function_privilege('authenticated','public.fudo_replace_connection(uuid,uuid,text)','execute')
  and not has_function_privilege('anon','public.fudo_begin_sync(uuid,uuid,uuid)','execute')
  and not has_function_privilege('authenticated','public.fudo_disconnect_connection(uuid)','execute'),
  'privileged lifecycle RPCs are service-role only');

set local role service_role;

do $$
declare
  a uuid := '00000000-0000-4000-8000-000000008010';
  b uuid := '00000000-0000-4000-8000-000000008020';
  owner_a uuid := '00000000-0000-4000-8000-000000008001';
  owner_b uuid := '00000000-0000-4000-8000-000000008002';
  cipher text := repeat('x',100);
  generation_a uuid;
  generation_b uuid;
  start_result jsonb;
  run_id uuid;
begin
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,owner_a,cipher)='connected',
    'first connection succeeds');
  select connection_generation into generation_a from public.fudo_connections where business_id=a;
  perform pg_temp.fudo_assert(generation_a is not null, 'new connection has generation');
  perform pg_temp.fudo_assert(public.fudo_replace_connection(b,owner_b,cipher)='connected',
    'second tenant connection is separate');
  select connection_generation into generation_b from public.fudo_connections where business_id=b;
  perform pg_temp.fudo_assert(generation_a<>generation_b,'generations distinct');

  start_result := public.fudo_begin_sync(a,generation_a,owner_a);
  perform pg_temp.fudo_assert(start_result->>'code'='started','first sync starts');
  run_id := (start_result->>'run_id')::uuid;
  perform pg_temp.fudo_assert(run_id is not null,'run receives id');
  perform pg_temp.fudo_assert(public.fudo_begin_sync(a,generation_a,owner_a)->>'code'='sync_running',
    'second sync cannot start');
  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(a)='sync_running',
    'disconnect prohibited while sync active');
  perform pg_temp.fudo_assert(public.fudo_replace_connection(a,owner_a,cipher)='sync_running',
    'rotation prohibited while sync active');
  perform pg_temp.fudo_assert(public.fudo_begin_sync(b,generation_a,owner_b)->>'code'='connection_changed',
    'tenant B cannot claim tenant A generation');

  update public.fudo_sync_runs set status='completed',finished_at=now() where id=run_id;
  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(a)='disconnected',
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
  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(a)='disconnected',
    'stale abandoned run does not lock out disconnection');
  perform pg_temp.fudo_assert(
    (select status='failed' and error_code='interrupted' from public.fudo_sync_runs where id=run_id),
    'stale run marked failed for audit');

  perform pg_temp.fudo_assert(public.fudo_disconnect_connection(b)='disconnected',
    'other tenant remains independently manageable');
end $$;
rollback;
