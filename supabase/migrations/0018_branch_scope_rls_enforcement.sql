-- Enforce branch-scoped access in RLS, not only in the application data layer.
--
-- Roles without branch restriction keep access to all branches in their business:
--   owner, admin, manager, accountant.
-- Restricted roles may only access explicitly assigned branches. For records with
-- branch_id IS NULL (business-level/shared records), a restricted role must have at
-- least one valid branch assignment in that business. This mirrors lib/data/auth.ts.

create or replace function public.can_access_business_branch(
  p_business uuid,
  p_branch uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.business_members bm
    where bm.business_id = p_business
      and bm.user_id = auth.uid()
      and (
        bm.role in ('owner', 'admin', 'manager', 'accountant')
        or (
          p_branch is null
          and exists (
            select 1
            from public.branch_assignments ba
            join public.branches b on b.id = ba.branch_id
            where ba.business_member_id = bm.id
              and b.business_id = p_business
          )
        )
        or (
          p_branch is not null
          and exists (
            select 1
            from public.branch_assignments ba
            join public.branches b on b.id = ba.branch_id
            where ba.business_member_id = bm.id
              and ba.branch_id = p_branch
              and b.business_id = p_business
          )
        )
      )
  );
$$;

revoke execute on function public.can_access_business_branch(uuid, uuid) from public, anon;
grant execute on function public.can_access_business_branch(uuid, uuid) to authenticated, service_role;

-- Tables with business_id + branch_id.
drop policy if exists "sales rw" on public.sales;
create policy "sales branch scoped rw" on public.sales
  for all to authenticated
  using (public.can_access_business_branch(business_id, branch_id))
  with check (public.can_access_business_branch(business_id, branch_id));

drop policy if exists "daily_closures rw" on public.daily_closures;
create policy "daily_closures branch scoped rw" on public.daily_closures
  for all to authenticated
  using (public.can_access_business_branch(business_id, branch_id))
  with check (public.can_access_business_branch(business_id, branch_id));

drop policy if exists "invoices rw" on public.invoices;
create policy "invoices branch scoped rw" on public.invoices
  for all to authenticated
  using (public.can_access_business_branch(business_id, branch_id))
  with check (public.can_access_business_branch(business_id, branch_id));

drop policy if exists "whatsapp rw" on public.whatsapp_messages;
create policy "whatsapp branch scoped rw" on public.whatsapp_messages
  for all to authenticated
  using (public.can_access_business_branch(business_id, branch_id))
  with check (public.can_access_business_branch(business_id, branch_id));

-- Tables that derive their business through branch_id.
drop policy if exists "stock_items rw" on public.stock_items;
create policy "stock_items branch scoped rw" on public.stock_items
  for all to authenticated
  using (
    exists (
      select 1 from public.branches b
      where b.id = stock_items.branch_id
        and public.can_access_business_branch(b.business_id, stock_items.branch_id)
    )
  )
  with check (
    exists (
      select 1 from public.branches b
      where b.id = stock_items.branch_id
        and public.can_access_business_branch(b.business_id, stock_items.branch_id)
    )
  );

drop policy if exists "stock_movements rw" on public.stock_movements;
create policy "stock_movements branch scoped rw" on public.stock_movements
  for all to authenticated
  using (
    exists (
      select 1 from public.branches b
      where b.id = stock_movements.branch_id
        and public.can_access_business_branch(b.business_id, stock_movements.branch_id)
    )
  )
  with check (
    exists (
      select 1 from public.branches b
      where b.id = stock_movements.branch_id
        and public.can_access_business_branch(b.business_id, stock_movements.branch_id)
    )
  );

-- Shifts must match the employee business and an accessible branch in that business.
drop policy if exists "shifts rw" on public.shifts;
create policy "shifts branch scoped rw" on public.shifts
  for all to authenticated
  using (
    exists (
      select 1
      from public.employees e
      join public.branches b on b.id = shifts.branch_id and b.business_id = e.business_id
      where e.id = shifts.employee_id
        and public.can_access_business_branch(e.business_id, shifts.branch_id)
    )
  )
  with check (
    exists (
      select 1
      from public.employees e
      join public.branches b on b.id = shifts.branch_id and b.business_id = e.business_id
      where e.id = shifts.employee_id
        and public.can_access_business_branch(e.business_id, shifts.branch_id)
    )
  );

-- AI extractions inherit tenant/branch scope from the source WhatsApp message.
drop policy if exists "ai_extractions rw" on public.ai_extractions;
create policy "ai_extractions branch scoped rw" on public.ai_extractions
  for all to authenticated
  using (
    exists (
      select 1
      from public.whatsapp_messages m
      where m.id = ai_extractions.message_id
        and (ai_extractions.business_id is null or ai_extractions.business_id = m.business_id)
        and public.can_access_business_branch(
          coalesce(ai_extractions.business_id, m.business_id),
          coalesce(ai_extractions.branch_id, m.branch_id)
        )
    )
  )
  with check (
    exists (
      select 1
      from public.whatsapp_messages m
      where m.id = ai_extractions.message_id
        and (ai_extractions.business_id is null or ai_extractions.business_id = m.business_id)
        and public.can_access_business_branch(
          coalesce(ai_extractions.business_id, m.business_id),
          coalesce(ai_extractions.branch_id, m.branch_id)
        )
    )
  );
