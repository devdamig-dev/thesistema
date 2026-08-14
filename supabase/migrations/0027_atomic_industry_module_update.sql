-- Keep business.industry and business_modules.suggested in sync.
-- A single RPC means PostgreSQL rolls the whole operation back if any
-- statement fails (RLS, enum cast, constraint, etc.).

create or replace function public.set_business_industry(
  p_business_id uuid,
  p_industry text,
  p_suggested_modules text[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.businesses
  set industry = p_industry::public.industry
  where id = p_business_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception 'business not found or not writable';
  end if;

  update public.business_modules
  set suggested = false
  where business_id = p_business_id;

  if coalesce(array_length(p_suggested_modules, 1), 0) > 0 then
    insert into public.business_modules (
      business_id,
      module_key,
      enabled,
      suggested
    )
    select
      p_business_id,
      module_name::public.module_key,
      true,
      true
    from unnest(p_suggested_modules) as suggested(module_name)
    on conflict (business_id, module_key)
    do update set
      enabled = true,
      suggested = true;
  end if;
end;
$$;

revoke all on function public.set_business_industry(uuid, text, text[]) from public;
grant execute on function public.set_business_industry(uuid, text, text[]) to authenticated;
