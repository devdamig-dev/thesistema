-- O1 Fudo: enforce live tenant membership inside the same database transaction
-- that rotates credentials, disconnects, or begins an import. No provider writes.
-- Callers must still derive p_actor_id and p_business_id from the authenticated
-- server session; service_role RPC parameters are NOT proof of identity.
--
-- Rollout: deploy this migration before app code using the 2-argument
-- disconnect RPC; it disables the legacy unscoped disconnect. The pilot has
-- no connected Fudo accounts at authoring time. Reversible via a separately
-- reviewed restoring migration, NOT by dropping this protection.

create or replace function public.fudo_replace_connection(
  p_business_id uuid, p_actor_id uuid, p_ciphertext text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_business_id is null or p_actor_id is null or
     p_ciphertext is null or length(p_ciphertext) not between 50 and 16384
  then return 'invalid_input'; end if;

  -- Lock tenant first, matching other Fudo lifecycle operations.
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then return 'not_found'; end if;

  -- A membership revocation/role change or profile deactivation cannot
  -- commit between this check and the connection update in this transaction.
  select true into v_allowed
    from public.business_members as m
    join public.profiles as p on p.id = m.user_id
   where m.business_id = p_business_id
     and m.user_id = p_actor_id
     and m.role::text in ('owner', 'admin')
     and p.active is true
   for share of m, p;
  if v_allowed is distinct from true then return 'forbidden'; end if;

  perform public.fudo_recover_stale_runs(p_business_id);
  if exists (select 1 from public.fudo_sync_runs
             where business_id = p_business_id and status = 'running')
  then return 'sync_running'; end if;

  insert into public.fudo_connections (
    business_id, connection_generation, credentials_ciphertext, status,
    last_synced_at, last_sync_status, last_tested_at, last_error_code, updated_by, updated_at
  ) values (
    p_business_id, gen_random_uuid(), p_ciphertext, 'connected',
    null, null, now(), null, p_actor_id, now()
  )
  on conflict (business_id) do update
    set connection_generation = excluded.connection_generation,
        credentials_ciphertext = excluded.credentials_ciphertext,
        status = 'connected',
        last_synced_at = null,
        last_sync_status = null,
        last_tested_at = now(),
        last_error_code = null,
        updated_by = excluded.updated_by,
        updated_at = now();
  return 'connected';
end;
$$;

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
begin
  if p_business_id is null or p_expected_generation is null or p_actor_id is null
  then return jsonb_build_object('code', 'invalid_input'); end if;

  perform 1 from public.businesses where id = p_business_id for update;
  if not found then return jsonb_build_object('code', 'not_found'); end if;

  select true into v_allowed
    from public.business_members as m
    join public.profiles as p on p.id = m.user_id
   where m.business_id = p_business_id
     and m.user_id = p_actor_id
     and m.role::text in ('owner', 'admin')
     and p.active is true
   for share of m, p;
  if v_allowed is distinct from true
  then return jsonb_build_object('code', 'forbidden'); end if;

  perform public.fudo_recover_stale_runs(p_business_id);
  if not exists (select 1 from public.fudo_connections
                 where business_id = p_business_id
                   and connection_generation = p_expected_generation
                   and status = 'connected')
  then return jsonb_build_object('code', 'connection_changed'); end if;
  if exists (select 1 from public.fudo_sync_runs
             where business_id = p_business_id and status = 'running')
  then return jsonb_build_object('code', 'sync_running'); end if;

  insert into public.fudo_sync_runs (business_id, connection_generation, status, started_by)
    values (p_business_id, p_expected_generation, 'running', p_actor_id)
    returning id into v_run_id;
  return jsonb_build_object('code', 'started', 'run_id', v_run_id);
end;
$$;

-- The old (uuid) disconnect RPC lacked an actor parameter. A second
-- signature and removal of the legacy function prevent an authorization
-- bypass by privileged application code that sends only a business_id.
create or replace function public.fudo_disconnect_connection(
  p_business_id uuid, p_actor_id uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  if p_business_id is null or p_actor_id is null then return 'invalid_input'; end if;
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then return 'not_found'; end if;

  select true into v_allowed
    from public.business_members as m
    join public.profiles as p on p.id = m.user_id
   where m.business_id = p_business_id
     and m.user_id = p_actor_id
     and m.role::text in ('owner', 'admin')
     and p.active is true
   for share of m, p;
  if v_allowed is distinct from true then return 'forbidden'; end if;

  perform public.fudo_recover_stale_runs(p_business_id);
  if exists (select 1 from public.fudo_sync_runs
             where business_id = p_business_id and status = 'running')
  then return 'sync_running'; end if;
  delete from public.fudo_connections where business_id = p_business_id;
  return 'disconnected';
end;
$$;

revoke all on function public.fudo_disconnect_connection(uuid,uuid) from public, anon, authenticated;
grant execute on function public.fudo_disconnect_connection(uuid,uuid) to service_role;
-- No legacy one-argument entrypoint may remain callable by service_role.
drop function public.fudo_disconnect_connection(uuid);

-- Explicit grants for the replaced functions remain service_role only.
revoke all on function public.fudo_replace_connection(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.fudo_begin_sync(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.fudo_replace_connection(uuid,uuid,text) to service_role;
grant execute on function public.fudo_begin_sync(uuid,uuid,uuid) to service_role;
