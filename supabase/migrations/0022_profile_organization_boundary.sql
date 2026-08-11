-- 0022_profile_organization_boundary.sql
--
-- `profiles.organization_id` participates in tenant-scoped read policies through
-- user_organization_id(). The historical self-update policy allowed an authenticated
-- user to update any column on their own profile, including organization_id. If a
-- foreign organization UUID were known, that could pivot user_organization_id() and
-- widen reads of organization-scoped profiles/businesses.
--
-- Keep self-service profile editing for presentation/contact fields only. Tenant
-- binding and account state remain server-owned. service_role keeps its existing
-- table-level UPDATE grant and can still perform trusted onboarding/admin writes.

revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;

grant update (full_name, email, phone, avatar_url)
  on table public.profiles
  to authenticated;

-- Keep the row-level self-update boundary. Column grants above are the critical
-- enforcement preventing organization_id/active/id mutation via the Data API.
drop policy if exists "profiles self update" on public.profiles;
create policy "profiles self update" on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);
