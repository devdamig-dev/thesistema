alter table public.expenses add column if not exists branch_id uuid;

-- Only backfill when attribution is unambiguous. Never guess a branch for a
-- business that operates more than one location.
with unique_business_branch as (
  select business_id, min(id::text)::uuid as branch_id
  from public.branches
  group by business_id
  having count(*) = 1
)
update public.expenses expense
set branch_id = branch.branch_id
from unique_business_branch branch
where expense.branch_id is null and branch.business_id = expense.business_id;

do $$
begin
  if exists (select 1 from public.expenses where branch_id is null) then
    raise exception 'expense_branch_backfill_required';
  end if;
end $$;

alter table public.expenses
  alter column branch_id set not null,
  drop constraint if exists expenses_branch_id_fkey,
  add constraint expenses_branch_id_fkey foreign key (branch_id) references public.branches(id) on delete restrict;

create or replace function public.enforce_expense_branch_business()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.branches branch
    where branch.id = new.branch_id and branch.business_id = new.business_id
  ) then
    raise exception 'expense_branch_business_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_expense_branch_business() from public, anon, authenticated;
grant execute on function public.enforce_expense_branch_business() to service_role;

drop trigger if exists trg_expenses_branch_business on public.expenses;
create trigger trg_expenses_branch_business
before insert or update of business_id, branch_id on public.expenses
for each row execute function public.enforce_expense_branch_business();

create index if not exists expenses_business_branch_due_idx
  on public.expenses(business_id, branch_id, due_date);

drop policy if exists "expenses read" on public.expenses;
drop policy if exists "expenses write manager" on public.expenses;
create policy "expenses branch scoped read" on public.expenses for select to authenticated
  using (public.can_access_business_branch(business_id, branch_id));
create policy "expenses branch scoped write manager" on public.expenses for all to authenticated
  using (
    public.can_access_business_branch(business_id, branch_id)
    and public.has_business_write_role(business_id, array['owner','admin','manager'])
  )
  with check (
    public.can_access_business_branch(business_id, branch_id)
    and public.has_business_write_role(business_id, array['owner','admin','manager'])
  );
