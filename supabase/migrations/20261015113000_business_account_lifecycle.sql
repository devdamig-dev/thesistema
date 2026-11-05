-- Business/account lifecycle and invitation revoke hardening.

-- Allow an address to be invited again after an earlier invitation was revoked
-- or expired. Only one pending invitation per business/email is allowed.
alter table public.user_invitations
  drop constraint if exists user_invitations_business_id_email_status_key;

create unique index if not exists user_invitations_one_pending_email_idx
  on public.user_invitations (business_id, lower(email))
  where status = 'pending';

-- Preserve audit history when a user deletes their account.
alter table public.debt_plan_mutations
  alter column actor_id drop not null;
alter table public.debt_plan_mutations
  drop constraint if exists debt_plan_mutations_actor_id_fkey;
alter table public.debt_plan_mutations
  add constraint debt_plan_mutations_actor_id_fkey
  foreign key (actor_id) references public.profiles(id) on delete set null;

alter table public.debt_payments
  drop constraint if exists debt_payments_voided_by_fkey;
alter table public.debt_payments
  add constraint debt_payments_voided_by_fkey
  foreign key (voided_by) references public.profiles(id) on delete set null;

create or replace function public.revoke_user_invitation(
  p_business_id uuid,
  p_invitation_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_row public.user_invitations%rowtype;
begin
  select role::text into v_role
  from public.business_members
  where business_id = p_business_id and user_id = p_actor_id;

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

revoke all on function public.revoke_user_invitation(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.revoke_user_invitation(uuid,uuid,uuid) to service_role;

create or replace function public.delete_owned_business(
  p_business_id uuid,
  p_actor_id uuid,
  p_confirmation_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses%rowtype;
  v_role text;
  v_owner_count integer;
  v_member_count integer;
begin
  select * into v_business
  from public.businesses
  where id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','not_found');
  end if;

  select role::text into v_role
  from public.business_members
  where business_id = p_business_id and user_id = p_actor_id;

  if v_role <> 'owner' then
    return jsonb_build_object('ok',false,'error','owner_required');
  end if;

  if btrim(coalesce(p_confirmation_name,'')) <> btrim(v_business.name) then
    return jsonb_build_object('ok',false,'error','confirmation_mismatch');
  end if;

  select count(*) into v_owner_count
  from public.business_members
  where business_id = p_business_id and role = 'owner';

  select count(*) into v_member_count
  from public.business_members
  where business_id = p_business_id;

  if v_owner_count <> 1 then
    return jsonb_build_object('ok',false,'error','shared_ownership');
  end if;
  if v_member_count <> 1 then
    return jsonb_build_object('ok',false,'error','business_has_members');
  end if;

  -- Delete rows that have RESTRICT/NO ACTION paths to the business/branches.
  delete from public.advance_payments where business_id = p_business_id;
  delete from public.stock_movements where business_id = p_business_id;
  delete from public.whatsapp_authorized_conversations where business_id = p_business_id;
  delete from public.user_invitations where business_id = p_business_id;
  delete from public.purchases where business_id = p_business_id;
  delete from public.expenses where business_id = p_business_id;
  delete from public.employees where business_id = p_business_id;
  delete from public.debts where business_id = p_business_id;

  delete from public.businesses where id = p_business_id;

  return jsonb_build_object('ok',true,'business_id',p_business_id);
end;
$$;

revoke all on function public.delete_owned_business(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.delete_owned_business(uuid,uuid,text) to service_role;
