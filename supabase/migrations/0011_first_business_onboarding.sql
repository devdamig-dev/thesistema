-- Bootstrap transaccional e idempotente del primer negocio de un usuario.
-- SECURITY DEFINER es necesario para romper el ciclo de RLS: todavía no hay
-- membership, por lo que el usuario no podría insertar su primer business.
create or replace function public.bootstrap_first_business(
  p_name text,
  p_industry industry,
  p_tax_id text default null,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_modules module_key[] default '{}'::module_key[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_business_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Serializa reintentos concurrentes (doble click/dos pestañas).
  perform 1 from profiles where id = v_user_id for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  select organization_id into v_org_id from profiles where id = v_user_id;
  if v_org_id is null then
    insert into organizations (name, owner_id)
    values (p_name, v_user_id)
    returning id into v_org_id;

    update profiles set organization_id = v_org_id where id = v_user_id;
  end if;

  select bm.business_id into v_business_id
  from business_members bm
  where bm.user_id = v_user_id
  order by bm.created_at
  limit 1;

  if v_business_id is null then
    select b.id into v_business_id
    from businesses b
    join organizations o on o.id = b.organization_id
    where b.organization_id = v_org_id
      and o.owner_id = v_user_id
      and not exists (select 1 from business_members bm where bm.business_id = b.id)
    order by b.created_at
    limit 1;
  end if;

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
  values (v_business_id, v_user_id, 'owner')
  on conflict (business_id, user_id) do update set role = 'owner';

  if not exists (select 1 from branches where business_id = v_business_id and is_main) then
    insert into branches (business_id, name, is_main)
    values (v_business_id, 'Principal', true);
  end if;

  insert into business_modules (business_id, module_key, enabled, suggested)
  select v_business_id, module_key, true, true from unnest(p_modules) module_key
  on conflict (business_id, module_key)
  do update set enabled = true, suggested = true;

  update businesses set onboarding_step = greatest(onboarding_step, 1)
  where id = v_business_id;

  return v_business_id;
end;
$$;

revoke all on function public.bootstrap_first_business(text, industry, text, text, module_key[]) from public;
grant execute on function public.bootstrap_first_business(text, industry, text, text, module_key[]) to authenticated;
