create index if not exists purchases_branch_idx on public.purchases (branch_id);

drop policy if exists "purchases write manager branch" on public.purchases;
create policy "purchases insert manager branch" on public.purchases for insert to authenticated
with check (
  public.has_business_write_role(business_id, array['owner','admin','manager'])
  and public.can_access_business_branch(business_id, branch_id)
);
create policy "purchases update manager branch" on public.purchases for update to authenticated
using (
  public.has_business_write_role(business_id, array['owner','admin','manager'])
  and public.can_access_business_branch(business_id, branch_id)
)
with check (
  public.has_business_write_role(business_id, array['owner','admin','manager'])
  and public.can_access_business_branch(business_id, branch_id)
);
create policy "purchases delete manager branch" on public.purchases for delete to authenticated
using (
  public.has_business_write_role(business_id, array['owner','admin','manager'])
  and public.can_access_business_branch(business_id, branch_id)
);

drop policy if exists "purchase_items write manager branch" on public.purchase_items;
create policy "purchase_items insert manager branch" on public.purchase_items for insert to authenticated
with check (exists (
  select 1 from public.purchases purchase
  where purchase.id = purchase_items.purchase_id
    and public.has_business_write_role(purchase.business_id, array['owner','admin','manager'])
    and public.can_access_business_branch(purchase.business_id, purchase.branch_id)
));
create policy "purchase_items update manager branch" on public.purchase_items for update to authenticated
using (exists (
  select 1 from public.purchases purchase
  where purchase.id = purchase_items.purchase_id
    and public.has_business_write_role(purchase.business_id, array['owner','admin','manager'])
    and public.can_access_business_branch(purchase.business_id, purchase.branch_id)
))
with check (exists (
  select 1 from public.purchases purchase
  where purchase.id = purchase_items.purchase_id
    and public.has_business_write_role(purchase.business_id, array['owner','admin','manager'])
    and public.can_access_business_branch(purchase.business_id, purchase.branch_id)
));
create policy "purchase_items delete manager branch" on public.purchase_items for delete to authenticated
using (exists (
  select 1 from public.purchases purchase
  where purchase.id = purchase_items.purchase_id
    and public.has_business_write_role(purchase.business_id, array['owner','admin','manager'])
    and public.can_access_business_branch(purchase.business_id, purchase.branch_id)
));
