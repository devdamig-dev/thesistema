-- Make invitation revocation callable through the authenticated server session
-- while still deriving the actor from auth.uid() inside the database boundary.

drop function if exists public.revoke_user_invitation(uuid,uuid,uuid);

create or replace function public.revoke_user_invitation(
  p_business_id uuid,
  p_invitation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_role text;
  v_row public.user_invitations%rowtype;
begin
  if v_actor is null then
    return jsonb_build_object('ok',false,'error','requires_auth');
  end if;

  select role::text into v_role
  from public.business_members
  where business_id = p_business_id and user_id = v_actor;

  if v_role not in ('owner','admin') then
    return jsonb_build_object('ok',false,'error','forbidden');
  end if;

  select * into v_row
  from public.user_invitations
  where id = p_invitation_id and business_id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','not_found');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('ok',false,'error','not_pending');
  end if;

  update public.user_invitations
  set status = 'revoked'
  where id = v_row.id;

  return jsonb_build_object('ok',true,'invitation_id',v_row.id,'email',v_row.email);
end;
$$;

revoke all on function public.revoke_user_invitation(uuid,uuid) from public,anon;
grant execute on function public.revoke_user_invitation(uuid,uuid) to authenticated,service_role;
