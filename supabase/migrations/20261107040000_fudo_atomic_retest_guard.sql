-- O1 Fudo read-only: record a credential retest only while the actor is
-- STILL owner/admin and the exact connection + previous test revision exist.
-- Replaces a privileged PostgREST UPDATE that had a check/write race after
-- the app's membership recheck. No HTTP writes to Fudo, no native data writes.
--
-- Rollout: apply migration before deploying the backend that calls this RPC.
-- Rollback: revert backend; leave this additive function in place until a
-- separately reviewed database cleanup. Never log credentials or payloads.

create or replace function public.fudo_record_connection_test(
  p_business_id uuid,
  p_expected_generation uuid,
  p_actor_id uuid,
  p_expected_last_tested_at timestamptz,
  p_status text,
  p_error_code text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_last_tested_at timestamptz;
begin
  if p_business_id is null or p_expected_generation is null or p_actor_id is null
    or p_status is null or p_status not in ('connected', 'error')
    or (p_status = 'connected' and p_error_code is not null)
    or (p_status = 'error' and (p_error_code is null or
       p_error_code !~ '^[a-z][a-z0-9_]{0,63}$'))
  then return 'invalid_input'; end if;

  -- Match the lock order used by rotation, disconnect and sync entrypoints.
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then return 'not_found'; end if;

  -- Row locks prevent a concurrent role change, membership removal or profile
  -- deactivation from committing between authorization and the test update.
  select true into v_allowed
    from public.business_members as m
    join public.profiles as p on p.id = m.user_id
   where m.business_id = p_business_id and m.user_id = p_actor_id
     and m.role::text in ('owner','admin') and p.active is true
   for share of m, p;
  if v_allowed is distinct from true then return 'forbidden'; end if;

  select last_tested_at into v_last_tested_at
    from public.fudo_connections
   where business_id = p_business_id
     and connection_generation = p_expected_generation
   for update;
  if not found then return 'connection_changed'; end if;

  -- Two owners can probe the same generation concurrently. The slower GET
  -- must not overwrite a newer result, even when credentials did not rotate.
  if v_last_tested_at is distinct from p_expected_last_tested_at
  then return 'connection_changed'; end if;

  update public.fudo_connections
     set status = p_status,
         last_error_code = p_error_code,
         last_tested_at = greatest(
           clock_timestamp(),
           coalesce(v_last_tested_at + interval '1 millisecond', clock_timestamp())
         ),
         updated_by = p_actor_id,
         updated_at = clock_timestamp()
   where business_id = p_business_id
     and connection_generation = p_expected_generation;
  return 'recorded';
end;
$$;

revoke all on function public.fudo_record_connection_test(
  uuid,uuid,uuid,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.fudo_record_connection_test(
  uuid,uuid,uuid,timestamptz,text,text) to service_role;
