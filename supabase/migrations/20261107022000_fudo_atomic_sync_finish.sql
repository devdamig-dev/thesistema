-- O1: finish one bounded read-only Fudo sync and connection health atomically.
-- All arguments come from an authenticated server action; EXECUTE service_role only.
-- Failure audit closure is allowed after membership revocation but cannot update
-- connection health. This does not mutate the Fudo API or native business records.
create or replace function public.fudo_finish_sync(
  p_business_id uuid,
  p_expected_generation uuid,
  p_actor_id uuid,
  p_run_id uuid,
  p_status text,
  p_counts jsonb,
  p_error_code text,
  p_update_connection boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_connection_updated boolean := false;
begin
  if p_business_id is null or p_expected_generation is null
     or p_actor_id is null or p_run_id is null
     or p_status is null or p_status not in ('partial','completed','failed')
     or p_update_connection is null
     or p_counts is null or jsonb_typeof(p_counts) <> 'object'
     or length(p_counts::text) > 2048
     or (p_error_code is not null and p_error_code !~ '^[a-z][a-z0-9_]{0,63}$')
     or (p_status <> 'failed' and
         (p_error_code is not null or p_update_connection is not true))
  then return jsonb_build_object('code','invalid_input'); end if;

  -- Lock order consistent with begin_sync/page_commit/connection rotation.
  perform 1 from public.businesses where id=p_business_id for update;
  if not found then return jsonb_build_object('code','not_found'); end if;

  if not exists (
    select 1 from public.fudo_sync_runs
    where id=p_run_id and business_id=p_business_id
      and connection_generation=p_expected_generation
      and started_by=p_actor_id and status='running'
    for update
  ) then return jsonb_build_object('code','run_changed'); end if;

  select true into v_allowed
    from public.business_members m
    join public.profiles p on p.id=m.user_id
   where m.business_id=p_business_id and m.user_id=p_actor_id
     and m.role::text in ('owner','admin') and p.active is true
   for share of m,p;

  -- An unauthorized actor may only close its own already-running audit run
  -- as failed, with NO connection metadata changes.
  if p_status <> 'failed' and v_allowed is distinct from true
  then return jsonb_build_object('code','forbidden'); end if;

  if p_status <> 'failed' and not exists (
    select 1 from public.fudo_connections
     where business_id=p_business_id
       and connection_generation=p_expected_generation and status='connected'
  ) then return jsonb_build_object('code','connection_changed'); end if;

  update public.fudo_sync_runs
     set status=p_status, counts=p_counts,
         error_code=p_error_code, finished_at=now()
   where id=p_run_id;

  -- Both updates commit together. A revoked/rotated actor cannot mark the
  -- connection healthy, nor overwrite the status of a newer generation.
  if v_allowed is true and p_update_connection then
    update public.fudo_connections
       set status=case when p_status='failed' then status else 'connected' end,
           last_sync_status=p_status,
           last_synced_at=case when p_status='failed' then last_synced_at else now() end,
           last_error_code=p_error_code
     where business_id=p_business_id
       and connection_generation=p_expected_generation and status='connected';
    v_connection_updated := found;
    if p_status <> 'failed' and not v_connection_updated
    then raise exception 'fudo_connection_changed_during_finish'; end if;
  end if;

  return jsonb_build_object('code','finished','connection_updated',v_connection_updated);
end;
$$;

revoke all on function public.fudo_finish_sync(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)
  from public,anon,authenticated;
grant execute on function public.fudo_finish_sync(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)
  to service_role;

-- Rollout: apply SQL before backend, retaining old schema/columns.
-- Rollback: revert backend; keep this unused additive RPC until reviewed cleanup.
