-- O1 Fudo: additive, server-only transaction fence for ONE read-only import page.
-- No native orders/sales/stock mutation and no HTTP writes to Fudo.
-- Not effective until the Next.js adapter invokes this RPC. Roll out SQL first.
create or replace function public.fudo_commit_sync_page(
  p_business_id uuid, p_expected_generation uuid, p_actor_id uuid,
  p_run_id uuid, p_resource_type text, p_expected_page integer,
  p_next_page integer, p_cycle_id uuid, p_cycle_started_at timestamptz,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_page integer;
  v_cycle uuid;
  v_cycle_started timestamptz;
  v_record record;
  v_seen_at timestamptz := now();
begin
  if p_business_id is null or p_expected_generation is null
     or p_actor_id is null or p_run_id is null
     or p_resource_type is null or p_resource_type not in ('products','ingredients','providers','orders','sales')
     or p_expected_page is null or p_expected_page not between 1 and 100000
     or p_next_page is null or p_next_page not between 0 and 100000
     or (p_next_page <> 0 and p_next_page <> p_expected_page + 1)
     or p_rows is null or jsonb_typeof(p_rows) <> 'array'
     or jsonb_array_length(p_rows) > 100
  then return jsonb_build_object('code','invalid_input'); end if;
  -- Keep the same tenant serialization lock ordering as the lifecycle RPCs.
  perform 1 from public.businesses where id=p_business_id for update;
  if not found then return jsonb_build_object('code','not_found'); end if;

  -- The profile and membership row locks prevent revocation committing
  -- between authorization and the page+cursor transaction commit.
  select true into v_allowed
    from public.business_members m
    join public.profiles p on p.id=m.user_id
   where m.business_id=p_business_id
     and m.user_id=p_actor_id
     and m.role::text in ('owner','admin')
     and p.active is true
   for share of m,p;
  if v_allowed is distinct from true
  then return jsonb_build_object('code','forbidden'); end if;

  perform 1 from public.fudo_connections
   where business_id=p_business_id
     and connection_generation=p_expected_generation
     and status='connected'
   for share;
  if not found then return jsonb_build_object('code','connection_changed'); end if;
  perform 1 from public.fudo_sync_runs
   where id=p_run_id and business_id=p_business_id
     and connection_generation=p_expected_generation
     and started_by=p_actor_id and status='running'
   for update;
  if not found then return jsonb_build_object('code','run_changed'); end if;

  select next_page,cycle_id,cycle_started_at
    into v_page,v_cycle,v_cycle_started
    from public.fudo_sync_progress
   where business_id=p_business_id
     and connection_generation=p_expected_generation
     and resource_type=p_resource_type
   for update;
  if not found then
    v_page:=1;
    v_cycle:=null;
    v_cycle_started:=null;
  end if;
  if v_page<>p_expected_page
  then return jsonb_build_object('code','stale_page'); end if;
  -- A resumed page cannot change the identity of its already-started cycle.
  if p_expected_page>1
     and (v_cycle is distinct from p_cycle_id
          or v_cycle_started is distinct from p_cycle_started_at)
  then return jsonb_build_object('code','cycle_changed'); end if;
  if p_expected_page=1 and (p_cycle_id is null or p_cycle_started_at is null)
  then return jsonb_build_object('code','invalid_input'); end if;

  -- Validate every JSON object before writing any row. If a constraint or
  -- cast fails, PostgreSQL rolls back the entire RPC (including cursor).
  for v_record in
    select * from jsonb_to_recordset(p_rows) as r(
      external_id text, payload jsonb, content_hash text,
      source_updated_at timestamptz)
  loop
    if v_record.external_id is null or length(v_record.external_id) not between 1 and 256
       or v_record.payload is null or jsonb_typeof(v_record.payload)<>'object'
       or v_record.content_hash is null
       or v_record.content_hash !~ '^[a-f0-9]{64}$'
    then return jsonb_build_object('code','invalid_input'); end if;
  end loop;
  insert into public.fudo_external_records (
    business_id,connection_generation,provider,resource_type,
    external_id,payload,content_hash,source_updated_at,
    last_seen_cycle_id,last_seen_at
  )
  select p_business_id,p_expected_generation,'fudo',p_resource_type,
         r.external_id,r.payload,r.content_hash,r.source_updated_at,
         p_cycle_id,v_seen_at
    from jsonb_to_recordset(p_rows) as r(
      external_id text,payload jsonb,content_hash text,
      source_updated_at timestamptz)
  on conflict (business_id,connection_generation,resource_type,external_id)
  do update set payload=excluded.payload,content_hash=excluded.content_hash,
     source_updated_at=excluded.source_updated_at,
     last_seen_cycle_id=excluded.last_seen_cycle_id,last_seen_at=excluded.last_seen_at;
  insert into public.fudo_sync_progress (
    business_id,connection_generation,resource_type,next_page,
    cycle_id,cycle_started_at,last_complete_at,updated_at
  )
  values (p_business_id,p_expected_generation,p_resource_type,p_next_page,
          p_cycle_id,p_cycle_started_at,
          case when p_next_page=0 then v_seen_at else null end,v_seen_at)
  on conflict (business_id,connection_generation,resource_type)
  do update set next_page=excluded.next_page,cycle_id=excluded.cycle_id,
     cycle_started_at=excluded.cycle_started_at,
     last_complete_at=excluded.last_complete_at,updated_at=excluded.updated_at;
  return jsonb_build_object('code','saved');
end;
$$;
revoke all on function public.fudo_commit_sync_page(
  uuid,uuid,uuid,uuid,text,integer,integer,uuid,timestamptz,jsonb
) from public,anon,authenticated;
grant execute on function public.fudo_commit_sync_page(
  uuid,uuid,uuid,uuid,text,integer,integer,uuid,timestamptz,jsonb
) to service_role;
