-- O1 Fudo: reject an obsolete credential form or a late provider probe.
-- The browser never receives the raw connection generation. The server
-- resolves the rendered opaque revision to this expected server-side snapshot.
-- Additive RPC: deploy SQL before deploying the application that calls it.
-- No Fudo writes, native sales/stock edits or credential contents in logs.
-- Rollback: restore the previous server caller; leave this unused RPC in place
-- until a separate reviewed database cleanup.
create or replace function public.fudo_replace_connection_guarded(
  p_business_id uuid, p_actor_id uuid, p_ciphertext text,
  p_expected_generation uuid, p_expected_last_tested_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation uuid;
  v_last_tested_at timestamptz;
  v_exists boolean;
begin
  if p_business_id is null or p_actor_id is null
     or p_ciphertext is null or length(p_ciphertext) not between 50 and 16384
  then return 'invalid_input'; end if;

  -- Serialize with disconnect, retest, sync and the legacy lifecycle RPC.
  perform 1 from public.businesses where id=p_business_id for update;
  if not found then return 'not_found'; end if;

  select connection_generation, last_tested_at
    into v_generation, v_last_tested_at
    from public.fudo_connections where business_id=p_business_id
    for update;
  v_exists := found;

  -- NULL/NULL represents an explicitly observed disconnected form. It must
  -- NOT create a connection after someone else connected or rotated first.
  if (v_exists and (p_expected_generation is null
      or v_generation is distinct from p_expected_generation
      or v_last_tested_at is distinct from p_expected_last_tested_at))
     or (not v_exists and (p_expected_generation is not null
      or p_expected_last_tested_at is not null))
  then return 'connection_changed'; end if;

  -- Nested RPC retains the membership/profile lock, running-run checks,
  -- encrypted ciphertext storage and business lock within THIS transaction.
  return public.fudo_replace_connection(p_business_id,p_actor_id,p_ciphertext);
end;
$$;

revoke all on function public.fudo_replace_connection_guarded(
  uuid,uuid,text,uuid,timestamptz
) from public,anon,authenticated;
grant execute on function public.fudo_replace_connection_guarded(
  uuid,uuid,text,uuid,timestamptz
) to service_role;
