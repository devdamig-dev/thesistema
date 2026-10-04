-- Replace a restricted member's complete branch scope atomically.
-- SECURITY INVOKER preserves the existing business_members, branches and
-- branch_assignments RLS policies for the authenticated owner/admin caller.
create or replace function public.replace_member_branch_assignments(
  p_member_id uuid,
  p_business_id uuid,
  p_branch_ids uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_member public.business_members%rowtype;
  v_requested_count integer;
  v_valid_count integer;
begin
  v_requested_count := coalesce(cardinality(p_branch_ids), 0);
  if p_member_id is null
    or p_business_id is null
    or v_requested_count = 0
    or v_requested_count > 50
    or array_position(p_branch_ids, null) is not null then
    return jsonb_build_object('ok', false, 'error', 'invalid_branches');
  end if;

  if (select count(distinct branch_id) from unnest(p_branch_ids) as branch_id) <> v_requested_count then
    return jsonb_build_object('ok', false, 'error', 'invalid_branches');
  end if;

  select * into v_member
  from public.business_members
  where id = p_member_id
    and business_id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_member.role in ('owner', 'admin', 'manager', 'accountant') then
    return jsonb_build_object('ok', false, 'error', 'business_wide_role');
  end if;

  select count(*) into v_valid_count
  from public.branches
  where business_id = p_business_id
    and id = any(p_branch_ids);

  if v_valid_count <> v_requested_count then
    return jsonb_build_object('ok', false, 'error', 'invalid_branch_scope');
  end if;

  delete from public.branch_assignments
  where business_member_id = v_member.id;

  insert into public.branch_assignments (business_member_id, branch_id)
  select v_member.id, branch_id
  from unnest(p_branch_ids) as branch_id;

  return jsonb_build_object(
    'ok', true,
    'member_id', v_member.id,
    'business_id', v_member.business_id,
    'branch_count', v_requested_count
  );
end;
$$;

revoke execute on function public.replace_member_branch_assignments(uuid, uuid, uuid[])
  from public, anon, service_role;
grant execute on function public.replace_member_branch_assignments(uuid, uuid, uuid[])
  to authenticated;
