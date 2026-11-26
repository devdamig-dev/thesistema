-- O1 Fudo: begin a fresh complete five-resource scan atomically with its run.
-- No Fudo API writes, no deletes of historical fudo_external_records.
-- The same tenant row lock and live owner/admin check fence cycle reset.
-- Additive replacement of the existing function signature; apply before the
-- Next.js version that no longer deletes fudo_sync_progress directly.
create or replace function public.fudo_begin_sync(
  p_business_id uuid, p_expected_generation uuid, p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
  v_allowed boolean;
  v_complete_resources integer;
begin
  if p_business_id is null or p_expected_generation is null or p_actor_id is null
  then return jsonb_build_object('code', 'invalid_input'); end if;

  perform 1 from public.businesses where id=p_business_id for update;
  if not found then return jsonb_build_object('code','not_found'); end if;

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

  perform public.fudo_recover_stale_runs(p_business_id);
  if not exists (
    select 1 from public.fudo_connections
    where business_id=p_business_id
      and connection_generation=p_expected_generation and status='connected'
  ) then return jsonb_build_object('code','connection_changed'); end if;
  if exists (
    select 1 from public.fudo_sync_runs
    where business_id=p_business_id and status='running'
  ) then return jsonb_build_object('code','sync_running'); end if;

  -- Only a truly completed five-resource scan can be restarted.
  -- Reset progress under the same tenant lock and authorization as run start.
  -- Missing rows, legacy partial scans or a running import do not qualify.
  select count(*) into v_complete_resources
    from public.fudo_sync_progress
   where business_id=p_business_id
     and connection_generation=p_expected_generation
     and next_page=0
     and resource_type in ('products','ingredients','providers','orders','sales');
  if v_complete_resources=5 then
    delete from public.fudo_sync_progress
     where business_id=p_business_id
       and connection_generation=p_expected_generation;
  end if;

  insert into public.fudo_sync_runs
    (business_id,connection_generation,status,started_by)
  values (p_business_id,p_expected_generation,'running',p_actor_id)
  returning id into v_run_id;

  return jsonb_build_object('code','started','run_id',v_run_id);
end;
$$;

revoke all on function public.fudo_begin_sync(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.fudo_begin_sync(uuid,uuid,uuid)
  to service_role;

-- Rollout: apply migration first (signature compatible), then release app.
-- Rollback: revert app if needed. Restoring the prior SQL implementation
-- requires a separately reviewed migration; never restore unguarded deletes.
