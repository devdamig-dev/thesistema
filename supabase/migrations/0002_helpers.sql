-- =============================================================================
-- GastroPilot AI · Helpers de seguridad
-- =============================================================================
-- Funciones reutilizadas por las policies de RLS para resolver la
-- organization y los businesses a los que pertenece el usuario actual.

-- organization actual del usuario logueado
create or replace function user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select organization_id
  from profiles
  where id = auth.uid()
  limit 1;
$$;

-- ¿el usuario es miembro de este business?
create or replace function is_member_of_business(business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from business_members
    where business_id = business
      and user_id = auth.uid()
  );
$$;

-- ¿el usuario es owner/admin de este business?
create or replace function is_admin_of_business(business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from business_members
    where business_id = business
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

-- Trigger: cuando se crea un usuario en auth.users, le creamos su profile
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();
