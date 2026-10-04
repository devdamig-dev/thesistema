-- Keep role changes and the minimum branch scope in the same transaction.
-- SECURITY INVOKER preserves RLS: only an authenticated owner/admin of the
-- target business can update the member and insert a branch assignment.
create or replace function public.update_member_role_with_branch(
  p_member_id uuid,
  p_business_id uuid,
  p_role public.role_key
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member public.business_members%rowtype;
  v_branch_id uuid;
  v_assignment_count integer := 0;
begin
  if p_member_id is null or p_business_id is null or p_role is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  select * into v_member
  from public.business_members
  where id = p_member_id
    and business_id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Ownership transfer is a separate sensitive workflow. This editor may not
  -- demote the current owner or promote another member to owner.
  if v_member.role = 'owner' or p_role = 'owner' then
    return jsonb_build_object('ok', false, 'error', 'owner_immutable');
  end if;

  if p_role not in ('owner', 'admin', 'manager', 'accountant') then
    select assignment.branch_id into v_branch_id
    from public.branch_assignments assignment
    join public.branches branch on branch.id = assignment.branch_id
    where assignment.business_member_id = v_member.id
      and branch.business_id = v_member.business_id
    order by assignment.created_at
    limit 1;

    if v_branch_id is null then
      select branch.id into v_branch_id
      from public.branches branch
      where branch.business_id = v_member.business_id
      order by branch.is_main desc, branch.created_at, branch.id
      limit 1;
    end if;

    if v_branch_id is null then
      return jsonb_build_object('ok', false, 'error', 'branch_required');
    end if;

    insert into public.branch_assignments (business_member_id, branch_id)
    values (v_member.id, v_branch_id)
    on conflict (business_member_id, branch_id) do nothing;
    get diagnostics v_assignment_count = row_count;
  end if;

  update public.business_members
  set role = p_role
  where id = v_member.id
    and business_id = v_member.business_id;

  if not found then
    raise exception 'member_role_update_race';
  end if;

  return jsonb_build_object(
    'ok', true,
    'member_id', v_member.id,
    'business_id', v_member.business_id,
    'old_role', v_member.role,
    'role', p_role,
    'branch_id', v_branch_id,
    'branch_assigned', v_assignment_count > 0
  );
end;
$$;

revoke execute on function public.update_member_role_with_branch(uuid, uuid, public.role_key)
  from public, anon, service_role;
grant execute on function public.update_member_role_with_branch(uuid, uuid, public.role_key)
  to authenticated;
