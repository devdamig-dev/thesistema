-- Serialize invitation acceptance per user as well as per invitation.
-- Two distinct invitations for the same user must not both observe zero
-- memberships and create access to different businesses concurrently.
create or replace function public.accept_user_invitation(
  p_token text,
  p_user_id uuid,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.user_invitations%rowtype;
  v_membership_count integer;
  v_member_id uuid;
begin
  if nullif(trim(p_token), '') is null then
    return jsonb_build_object('ok', false, 'error', 'no_token');
  end if;
  if p_user_id is null or nullif(trim(p_email), '') is null then
    return jsonb_build_object('ok', false, 'error', 'requires_auth');
  end if;

  -- Transaction-scoped and deterministic: different invitation rows for the
  -- same authenticated user cannot pass the membership check concurrently.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  select * into v_inv
  from public.user_invitations
  where token = p_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invitation_not_found');
  end if;
  if v_inv.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'invitation_' || v_inv.status::text);
  end if;
  if v_inv.expires_at < now() then
    update public.user_invitations
    set status = 'expired'
    where id = v_inv.id and status = 'pending';
    return jsonb_build_object('ok', false, 'error', 'invitation_expired');
  end if;
  if lower(trim(v_inv.email)) <> lower(trim(p_email)) then
    return jsonb_build_object('ok', false, 'error', 'invitation_email_mismatch');
  end if;

  select count(*) into v_membership_count
  from public.business_members
  where user_id = p_user_id;

  if exists (
    select 1 from public.business_members
    where user_id = p_user_id and business_id = v_inv.business_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_member');
  end if;
  if v_membership_count > 0 then
    return jsonb_build_object('ok', false, 'error', 'business_already_assigned');
  end if;

  insert into public.business_members (business_id, user_id, role)
  values (v_inv.business_id, p_user_id, v_inv.role)
  returning id into v_member_id;

  update public.user_invitations
  set status = 'accepted', accepted_at = now()
  where id = v_inv.id and status = 'pending';

  if not found then
    raise exception 'invitation_accept_race';
  end if;

  return jsonb_build_object(
    'ok', true,
    'business_id', v_inv.business_id,
    'invitation_id', v_inv.id,
    'member_id', v_member_id,
    'role', v_inv.role
  );
end;
$$;

revoke execute on function public.accept_user_invitation(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.accept_user_invitation(text, uuid, text)
  to service_role;
