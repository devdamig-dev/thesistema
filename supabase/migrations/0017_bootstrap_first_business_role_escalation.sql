-- Prevent privilege escalation through bootstrap_first_business.
--
-- Previously any authenticated user who already had a business membership could
-- call this SECURITY DEFINER RPC. The function selected the caller's first
-- membership and then upserted that membership with role='owner', silently
-- promoting viewers/employees/etc. to owner.
--
-- The hardened flow:
--   * callers with memberships may only resume exactly one incomplete business
--     where they are already owner;
--   * existing memberships are never rewritten/promoted by this RPC;
--   * callers with zero memberships may bootstrap a first business and become
--     owner of that newly-created/unclaimed business;
--   * if profile.organization_id points at an organization the caller does not
--     own, a fresh organization is created instead of reusing it.

create or replace function public.bootstrap_first_business(
  p_name text,
  p_industry industry,
  p_tax_id text default null,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_modules module_key[] default '{}'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_org_owner_id uuid;
  v_business_id uuid;
  v_membership_count integer := 0;
  v_candidates uuid[];
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  perform 1 from profiles where id = v_user_id for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  select count(*) into v_membership_count
  from business_members
  where user_id = v_user_id;

  if v_membership_count > 0 then
    select array_agg(b.id order by b.created_at)
      into v_candidates
    from business_members bm
    join businesses b on b.id = bm.business_id
    where bm.user_id = v_user_id
      and bm.role = 'owner'
      and not coalesce(b.onboarding_completed, false);

    if coalesce(cardinality(v_candidates), 0) <> 1 then
      raise exception 'business_already_assigned';
    end if;

    v_business_id := v_candidates[1];

    update businesses
    set name = p_name,
        industry = p_industry,
        tax_id = nullif(p_tax_id, ''),
        timezone = p_timezone,
        onboarding_step = greatest(onboarding_step, 1)
    where id = v_business_id;

    insert into business_modules (business_id, module_key, enabled, suggested)
    select v_business_id, module_key, true, true from unnest(p_modules) module_key
    on conflict (business_id, module_key)
    do update set enabled = true, suggested = true;

    return v_business_id;
  end if;

  select organization_id into v_org_id
  from profiles
  where id = v_user_id;

  if v_org_id is not null then
    select owner_id into v_org_owner_id
    from organizations
    where id = v_org_id;
  end if;

  if v_org_id is null or v_org_owner_id is distinct from v_user_id then
    insert into organizations (name, owner_id)
    values (p_name, v_user_id)
    returning id into v_org_id;

    update profiles
    set organization_id = v_org_id
    where id = v_user_id;
  end if;

  select b.id into v_business_id
  from businesses b
  where b.organization_id = v_org_id
    and not exists (
      select 1 from business_members bm where bm.business_id = b.id
    )
  order by b.created_at
  limit 1;

  if v_business_id is null then
    insert into businesses (organization_id, name, industry, tax_id, timezone)
    values (v_org_id, p_name, p_industry, nullif(p_tax_id, ''), p_timezone)
    returning id into v_business_id;
  else
    update businesses
    set name = p_name,
        industry = p_industry,
        tax_id = nullif(p_tax_id, ''),
        timezone = p_timezone
    where id = v_business_id;
  end if;

  insert into business_members (business_id, user_id, role)
  values (v_business_id, v_user_id, 'owner');

  if not exists (select 1 from branches where business_id = v_business_id and is_main) then
    insert into branches (business_id, name, is_main)
    values (v_business_id, 'Principal', true);
  end if;

  insert into business_modules (business_id, module_key, enabled, suggested)
  select v_business_id, module_key, true, true from unnest(p_modules) module_key
  on conflict (business_id, module_key)
  do update set enabled = true, suggested = true;

  update businesses
  set onboarding_step = greatest(onboarding_step, 1)
  where id = v_business_id;

  return v_business_id;
end;
$$;

revoke execute on function public.bootstrap_first_business(text, industry, text, text, module_key[])
  from public, anon;
grant execute on function public.bootstrap_first_business(text, industry, text, text, module_key[])
  to authenticated, service_role;
