alter table public.debts add column if not exists branch_id uuid;

-- Existing debts can only be attributed automatically when their business has
-- exactly one branch. Never guess a branch for a multi-branch business.
with unique_business_branch as (
  select business_id, (array_agg(id order by created_at))[1] as branch_id
  from public.branches
  group by business_id
  having count(*) = 1
)
update public.debts debt
set branch_id = branch.branch_id
from unique_business_branch branch
where debt.branch_id is null and branch.business_id = debt.business_id;

do $$
begin
  if exists (select 1 from public.debts where branch_id is null) then
    raise exception 'Cannot enable debt branch isolation: debts without an unambiguous branch remain';
  end if;
end;
$$;

alter table public.debts alter column branch_id set not null;
alter table public.debts
  drop constraint if exists debts_branch_id_fkey,
  add constraint debts_branch_id_fkey foreign key (branch_id) references public.branches(id) on delete restrict;

create or replace function public.enforce_debt_branch_business()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.branches branch
    where branch.id = new.branch_id and branch.business_id = new.business_id
  ) then
    raise exception 'debt_branch_business_mismatch' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_debts_branch_business on public.debts;
create trigger trg_debts_branch_business
before insert or update of business_id, branch_id on public.debts
for each row execute function public.enforce_debt_branch_business();

create index if not exists debts_business_branch_status_due_idx
  on public.debts(business_id, branch_id, status, due_date);

drop policy if exists "debts read" on public.debts;
drop policy if exists "debts write manager" on public.debts;
create policy "debts branch scoped read" on public.debts for select to authenticated
  using (public.can_access_business_branch(business_id, branch_id));
create policy "debts branch scoped write manager" on public.debts for all to authenticated
  using (
    public.can_access_business_branch(business_id, branch_id)
    and public.has_business_write_role(business_id, array['owner','admin','manager'])
  )
  with check (
    public.can_access_business_branch(business_id, branch_id)
    and public.has_business_write_role(business_id, array['owner','admin','manager'])
  );

drop policy if exists "debt_payments read" on public.debt_payments;
drop policy if exists "debt_payments write manager" on public.debt_payments;
create policy "debt_payments branch scoped read" on public.debt_payments for select to authenticated
  using (exists (
    select 1 from public.debts debt where debt.id = debt_payments.debt_id
      and public.can_access_business_branch(debt.business_id, debt.branch_id)
  ));
create policy "debt_payments branch scoped write manager" on public.debt_payments for all to authenticated
  using (exists (
    select 1 from public.debts debt where debt.id = debt_payments.debt_id
      and public.can_access_business_branch(debt.business_id, debt.branch_id)
      and public.has_business_write_role(debt.business_id, array['owner','admin','manager'])
  ))
  with check (exists (
    select 1 from public.debts debt where debt.id = debt_payments.debt_id
      and public.can_access_business_branch(debt.business_id, debt.branch_id)
      and public.has_business_write_role(debt.business_id, array['owner','admin','manager'])
  ));
