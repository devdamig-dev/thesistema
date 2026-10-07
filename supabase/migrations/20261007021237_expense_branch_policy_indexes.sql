drop index if exists public.expenses_business_branch_due_idx;
create index if not exists expenses_branch_business_due_idx
  on public.expenses(branch_id, business_id, due_date);

drop policy if exists "expenses branch scoped write manager" on public.expenses;
create policy "expenses branch scoped insert manager" on public.expenses for insert to authenticated
  with check (
    public.can_access_business_branch(business_id, branch_id)
    and public.has_business_write_role(business_id, array['owner','admin','manager'])
  );
create policy "expenses branch scoped update manager" on public.expenses for update to authenticated
  using (
    public.can_access_business_branch(business_id, branch_id)
    and public.has_business_write_role(business_id, array['owner','admin','manager'])
  )
  with check (
    public.can_access_business_branch(business_id, branch_id)
    and public.has_business_write_role(business_id, array['owner','admin','manager'])
  );
create policy "expenses branch scoped delete manager" on public.expenses for delete to authenticated
  using (
    public.can_access_business_branch(business_id, branch_id)
    and public.has_business_write_role(business_id, array['owner','admin','manager'])
  );
