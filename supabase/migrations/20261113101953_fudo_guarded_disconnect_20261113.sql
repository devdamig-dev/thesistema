-- O1 Fudo: a stale UI must never delete newly rotated/retested credentials.
-- Deploy this additive RPC BEFORE deploying the runtime that calls it.
-- No HTTP requests to Fudo and no writes to native business operations.
-- Rollback: revert runtime first; keep the unused RPC until separately reviewed.
create or replace function public.fudo_disconnect_connection_guarded(
  p_business_id uuid, p_actor_id uuid,
  p_expected_generation uuid, p_expected_last_tested_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation uuid;
  v_tested_at timestamptz;
begin
  if p_business_id is null or p_actor_id is null
     or p_expected_generation is null
  then return 'invalid_input'; end if;

  -- This business lock serializes with rotation, retest and sync startup.
  perform 1 from public.businesses where id=p_business_id for update;
  if not found then return 'not_found'; end if;
  select connection_generation,last_tested_at
    into v_generation,v_tested_at
    from public.fudo_connections
    where business_id=p_business_id for update;
  if not found or v_generation is distinct from p_expected_generation
     or v_tested_at is distinct from p_expected_last_tested_at
  then return 'connection_changed'; end if;

  -- The existing RPC rechecks live owner/admin membership, active profile,
  -- stale runs and in-progress synchronization inside this transaction.
  return public.fudo_disconnect_connection(p_business_id,p_actor_id);
end;
$$;

revoke all on function public.fudo_disconnect_connection_guarded(
  uuid,uuid,uuid,timestamptz
) from public,anon,authenticated;
grant execute on function public.fudo_disconnect_connection_guarded(
  uuid,uuid,uuid,timestamptz
) to service_role;
