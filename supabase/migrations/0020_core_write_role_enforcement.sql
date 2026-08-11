-- 0020_core_write_role_enforcement.sql
--
-- Non branch-scoped tables historically used broad ALL policies guarded only
-- by business membership. That allowed read-only roles (notably viewer) to
-- mutate core business data directly through the Supabase Data API.
--
-- Keep member reads, but require write-capable roles that match the app matrix.

-- products -------------------------------------------------------------------
drop policy if exists "products rw" on public.products;
create policy "products read" on public.products for select to authenticated
using (public.is_member_of_business(business_id));
create policy "products write admin" on public.products for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin']))
with check (public.has_business_write_role(business_id, array['owner','admin']));

-- ingredients ----------------------------------------------------------------
drop policy if exists "ingredients rw" on public.ingredients;
create policy "ingredients read" on public.ingredients for select to authenticated
using (public.is_member_of_business(business_id));
create policy "ingredients write admin" on public.ingredients for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin']))
with check (public.has_business_write_role(business_id, array['owner','admin']));

-- recipes + recipe_items -----------------------------------------------------
drop policy if exists "recipes rw" on public.recipes;
create policy "recipes read" on public.recipes for select to authenticated
using (exists (select 1 from public.products p where p.id = recipes.product_id and public.is_member_of_business(p.business_id)));
create policy "recipes write admin" on public.recipes for all to authenticated
using (exists (select 1 from public.products p where p.id = recipes.product_id and public.has_business_write_role(p.business_id, array['owner','admin'])))
with check (exists (select 1 from public.products p where p.id = recipes.product_id and public.has_business_write_role(p.business_id, array['owner','admin'])));

drop policy if exists "recipe_items rw" on public.recipe_items;
create policy "recipe_items read" on public.recipe_items for select to authenticated
using (exists (
  select 1 from public.recipes r join public.products p on p.id = r.product_id
  where r.id = recipe_items.recipe_id and public.is_member_of_business(p.business_id)
));
create policy "recipe_items write admin" on public.recipe_items for all to authenticated
using (exists (
  select 1 from public.recipes r join public.products p on p.id = r.product_id
  where r.id = recipe_items.recipe_id and public.has_business_write_role(p.business_id, array['owner','admin'])
))
with check (exists (
  select 1 from public.recipes r join public.products p on p.id = r.product_id
  where r.id = recipe_items.recipe_id and public.has_business_write_role(p.business_id, array['owner','admin'])
));

-- purchases + purchase_items + suppliers ------------------------------------
drop policy if exists "purchases rw" on public.purchases;
create policy "purchases read" on public.purchases for select to authenticated
using (public.is_member_of_business(business_id));
create policy "purchases write manager" on public.purchases for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin','manager']))
with check (public.has_business_write_role(business_id, array['owner','admin','manager']));

drop policy if exists "purchase_items rw" on public.purchase_items;
create policy "purchase_items read" on public.purchase_items for select to authenticated
using (exists (select 1 from public.purchases p where p.id = purchase_items.purchase_id and public.is_member_of_business(p.business_id)));
create policy "purchase_items write manager" on public.purchase_items for all to authenticated
using (exists (select 1 from public.purchases p where p.id = purchase_items.purchase_id and public.has_business_write_role(p.business_id, array['owner','admin','manager'])))
with check (exists (select 1 from public.purchases p where p.id = purchase_items.purchase_id and public.has_business_write_role(p.business_id, array['owner','admin','manager'])));

drop policy if exists "suppliers rw" on public.suppliers;
create policy "suppliers read" on public.suppliers for select to authenticated
using (public.is_member_of_business(business_id));
create policy "suppliers write manager" on public.suppliers for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin','manager']))
with check (public.has_business_write_role(business_id, array['owner','admin','manager']));

-- expenses -------------------------------------------------------------------
drop policy if exists "expenses rw" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated
using (public.is_member_of_business(business_id));
create policy "expenses write manager" on public.expenses for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin','manager']))
with check (public.has_business_write_role(business_id, array['owner','admin','manager']));

-- debts + debt_payments ------------------------------------------------------
drop policy if exists "debts rw" on public.debts;
create policy "debts read" on public.debts for select to authenticated
using (public.is_member_of_business(business_id));
create policy "debts write manager" on public.debts for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin','manager']))
with check (public.has_business_write_role(business_id, array['owner','admin','manager']));

drop policy if exists "debt_payments rw" on public.debt_payments;
create policy "debt_payments read" on public.debt_payments for select to authenticated
using (exists (select 1 from public.debts d where d.id = debt_payments.debt_id and public.is_member_of_business(d.business_id)));
create policy "debt_payments write manager" on public.debt_payments for all to authenticated
using (exists (select 1 from public.debts d where d.id = debt_payments.debt_id and public.has_business_write_role(d.business_id, array['owner','admin','manager'])))
with check (exists (select 1 from public.debts d where d.id = debt_payments.debt_id and public.has_business_write_role(d.business_id, array['owner','admin','manager'])));

-- employees + advances ------------------------------------------------------
drop policy if exists "employees rw" on public.employees;
create policy "employees read" on public.employees for select to authenticated
using (public.is_member_of_business(business_id));
create policy "employees write admin" on public.employees for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin']))
with check (public.has_business_write_role(business_id, array['owner','admin']));

drop policy if exists "advance_payments rw" on public.advance_payments;
create policy "advance_payments read" on public.advance_payments for select to authenticated
using (exists (select 1 from public.employees e where e.id = advance_payments.employee_id and public.is_member_of_business(e.business_id)));
create policy "advance_payments write admin" on public.advance_payments for all to authenticated
using (exists (select 1 from public.employees e where e.id = advance_payments.employee_id and public.has_business_write_role(e.business_id, array['owner','admin'])))
with check (exists (select 1 from public.employees e where e.id = advance_payments.employee_id and public.has_business_write_role(e.business_id, array['owner','admin'])));

-- customers + campaigns -----------------------------------------------------
drop policy if exists "customers rw" on public.customers;
create policy "customers read" on public.customers for select to authenticated
using (public.is_member_of_business(business_id));
create policy "customers write manager marketing" on public.customers for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin','manager','marketing']))
with check (public.has_business_write_role(business_id, array['owner','admin','manager','marketing']));

drop policy if exists "campaigns rw" on public.campaigns;
create policy "campaigns read" on public.campaigns for select to authenticated
using (public.is_member_of_business(business_id));
create policy "campaigns write admin marketing" on public.campaigns for all to authenticated
using (public.has_business_write_role(business_id, array['owner','admin','marketing']))
with check (public.has_business_write_role(business_id, array['owner','admin','marketing']));
