-- Purchases are operational records and must never float at business level:
-- every write is attributed to a concrete branch and RLS derives item access
-- from that branch-scoped parent.
alter table public.purchases
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

create index if not exists purchases_business_branch_date_idx
  on public.purchases (business_id, branch_id, purchased_at desc);

create or replace function public.enforce_purchase_branch()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.branch_id is null and new.invoice_id is not null then
    select invoice.branch_id
      into new.branch_id
    from public.invoices invoice
    where invoice.id = new.invoice_id
      and invoice.business_id = new.business_id;
  end if;

  if new.branch_id is null then
    raise exception 'purchase_branch_required' using errcode = '23502';
  end if;

  if not exists (
    select 1
    from public.branches branch
    where branch.id = new.branch_id
      and branch.business_id = new.business_id
  ) then
    raise exception 'purchase_branch_business_mismatch' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_enforce_purchase_branch on public.purchases;
create trigger trg_enforce_purchase_branch
before insert or update of business_id, branch_id, invoice_id on public.purchases
for each row execute function public.enforce_purchase_branch();

-- Production was verified empty before this migration. Keep this guard so a
-- drifted environment fails visibly instead of preserving ambiguous rows.
do $$
begin
  if exists (select 1 from public.purchases where branch_id is null) then
    raise exception 'cannot enforce purchase branch: unscoped purchases exist';
  end if;
end;
$$;

alter table public.purchases alter column branch_id set not null;

drop policy if exists "purchases read" on public.purchases;
drop policy if exists "purchases write manager" on public.purchases;
create policy "purchases read branch" on public.purchases for select to authenticated
using (public.can_access_business_branch(business_id, branch_id));
create policy "purchases write manager branch" on public.purchases for all to authenticated
using (
  public.has_business_write_role(business_id, array['owner','admin','manager'])
  and public.can_access_business_branch(business_id, branch_id)
)
with check (
  public.has_business_write_role(business_id, array['owner','admin','manager'])
  and public.can_access_business_branch(business_id, branch_id)
);

drop policy if exists "purchase_items read" on public.purchase_items;
drop policy if exists "purchase_items write manager" on public.purchase_items;
create policy "purchase_items read branch" on public.purchase_items for select to authenticated
using (exists (
  select 1 from public.purchases purchase
  where purchase.id = purchase_items.purchase_id
    and public.can_access_business_branch(purchase.business_id, purchase.branch_id)
));
create policy "purchase_items write manager branch" on public.purchase_items for all to authenticated
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
