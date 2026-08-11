-- 0019_branch_write_permission_enforcement.sql
--
-- PR #52 enforced branch visibility at the database boundary, but its ALL
-- policies used the same predicate for reads and writes. That meant any
-- branch-authorized role (including viewer/accountant where applicable)
-- could mutate branch-scoped rows directly through the Supabase Data API,
-- bypassing the application permission matrix.
--
-- Split read and write policies and require an explicit write-capable role.

create or replace function public.has_business_write_role(
  p_business uuid,
  p_roles text[]
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
      and bm.role::text = any (p_roles)
  );
$$;

revoke all on function public.has_business_write_role(uuid, text[]) from public;
revoke all on function public.has_business_write_role(uuid, text[]) from anon;
grant execute on function public.has_business_write_role(uuid, text[]) to authenticated, service_role;

-- sales ---------------------------------------------------------------------
drop policy if exists "sales branch scoped rw" on public.sales;
drop policy if exists "sales branch scoped select" on public.sales;
drop policy if exists "sales branch scoped insert" on public.sales;
drop policy if exists "sales branch scoped update" on public.sales;
drop policy if exists "sales branch scoped delete" on public.sales;

create policy "sales branch scoped select" on public.sales
for select to authenticated
using (public.can_access_business_branch(business_id, branch_id));

create policy "sales branch scoped insert" on public.sales
for insert to authenticated
with check (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
);

create policy "sales branch scoped update" on public.sales
for update to authenticated
using (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
)
with check (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
);

create policy "sales branch scoped delete" on public.sales
for delete to authenticated
using (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
);

-- daily_closures -------------------------------------------------------------
drop policy if exists "daily_closures branch scoped rw" on public.daily_closures;
drop policy if exists "daily_closures branch scoped select" on public.daily_closures;
drop policy if exists "daily_closures branch scoped insert" on public.daily_closures;
drop policy if exists "daily_closures branch scoped update" on public.daily_closures;
drop policy if exists "daily_closures branch scoped delete" on public.daily_closures;

create policy "daily_closures branch scoped select" on public.daily_closures
for select to authenticated
using (public.can_access_business_branch(business_id, branch_id));

create policy "daily_closures branch scoped insert" on public.daily_closures
for insert to authenticated
with check (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
);

create policy "daily_closures branch scoped update" on public.daily_closures
for update to authenticated
using (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
)
with check (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
);

create policy "daily_closures branch scoped delete" on public.daily_closures
for delete to authenticated
using (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
);

-- invoices ------------------------------------------------------------------
drop policy if exists "invoices branch scoped rw" on public.invoices;
drop policy if exists "invoices branch scoped select" on public.invoices;
drop policy if exists "invoices branch scoped insert" on public.invoices;
drop policy if exists "invoices branch scoped update" on public.invoices;
drop policy if exists "invoices branch scoped delete" on public.invoices;

create policy "invoices branch scoped select" on public.invoices
for select to authenticated
using (public.can_access_business_branch(business_id, branch_id));

create policy "invoices branch scoped insert" on public.invoices
for insert to authenticated
with check (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager'])
);

create policy "invoices branch scoped update" on public.invoices
for update to authenticated
using (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','accountant'])
)
with check (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','accountant'])
);

create policy "invoices branch scoped delete" on public.invoices
for delete to authenticated
using (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin'])
);

-- whatsapp_messages ----------------------------------------------------------
drop policy if exists "whatsapp branch scoped rw" on public.whatsapp_messages;
drop policy if exists "whatsapp branch scoped select" on public.whatsapp_messages;
drop policy if exists "whatsapp branch scoped insert" on public.whatsapp_messages;
drop policy if exists "whatsapp branch scoped update" on public.whatsapp_messages;
drop policy if exists "whatsapp branch scoped delete" on public.whatsapp_messages;

create policy "whatsapp branch scoped select" on public.whatsapp_messages
for select to authenticated
using (public.can_access_business_branch(business_id, branch_id));

create policy "whatsapp branch scoped insert" on public.whatsapp_messages
for insert to authenticated
with check (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
);

create policy "whatsapp branch scoped update" on public.whatsapp_messages
for update to authenticated
using (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
)
with check (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
);

create policy "whatsapp branch scoped delete" on public.whatsapp_messages
for delete to authenticated
using (
  public.can_access_business_branch(business_id, branch_id)
  and public.has_business_write_role(business_id, array['owner','admin','manager'])
);

-- stock_items ----------------------------------------------------------------
drop policy if exists "stock_items branch scoped rw" on public.stock_items;
drop policy if exists "stock_items branch scoped select" on public.stock_items;
drop policy if exists "stock_items branch scoped insert" on public.stock_items;
drop policy if exists "stock_items branch scoped update" on public.stock_items;
drop policy if exists "stock_items branch scoped delete" on public.stock_items;

create policy "stock_items branch scoped select" on public.stock_items
for select to authenticated
using (
  exists (
    select 1 from public.branches b
    where b.id = stock_items.branch_id
      and public.can_access_business_branch(b.business_id, stock_items.branch_id)
  )
);

create policy "stock_items branch scoped insert" on public.stock_items
for insert to authenticated
with check (
  exists (
    select 1 from public.branches b
    where b.id = stock_items.branch_id
      and public.can_access_business_branch(b.business_id, stock_items.branch_id)
      and public.has_business_write_role(b.business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
);

create policy "stock_items branch scoped update" on public.stock_items
for update to authenticated
using (
  exists (
    select 1 from public.branches b
    where b.id = stock_items.branch_id
      and public.can_access_business_branch(b.business_id, stock_items.branch_id)
      and public.has_business_write_role(b.business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
)
with check (
  exists (
    select 1 from public.branches b
    where b.id = stock_items.branch_id
      and public.can_access_business_branch(b.business_id, stock_items.branch_id)
      and public.has_business_write_role(b.business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
);

create policy "stock_items branch scoped delete" on public.stock_items
for delete to authenticated
using (
  exists (
    select 1 from public.branches b
    where b.id = stock_items.branch_id
      and public.can_access_business_branch(b.business_id, stock_items.branch_id)
      and public.has_business_write_role(b.business_id, array['owner','admin','manager'])
  )
);

-- stock_movements ------------------------------------------------------------
drop policy if exists "stock_movements branch scoped rw" on public.stock_movements;
drop policy if exists "stock_movements branch scoped select" on public.stock_movements;
drop policy if exists "stock_movements branch scoped insert" on public.stock_movements;
drop policy if exists "stock_movements branch scoped update" on public.stock_movements;
drop policy if exists "stock_movements branch scoped delete" on public.stock_movements;

create policy "stock_movements branch scoped select" on public.stock_movements
for select to authenticated
using (
  exists (
    select 1 from public.branches b
    where b.id = stock_movements.branch_id
      and public.can_access_business_branch(b.business_id, stock_movements.branch_id)
  )
);

create policy "stock_movements branch scoped insert" on public.stock_movements
for insert to authenticated
with check (
  exists (
    select 1 from public.branches b
    where b.id = stock_movements.branch_id
      and public.can_access_business_branch(b.business_id, stock_movements.branch_id)
      and public.has_business_write_role(b.business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
);

create policy "stock_movements branch scoped update" on public.stock_movements
for update to authenticated
using (
  exists (
    select 1 from public.branches b
    where b.id = stock_movements.branch_id
      and public.can_access_business_branch(b.business_id, stock_movements.branch_id)
      and public.has_business_write_role(b.business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
)
with check (
  exists (
    select 1 from public.branches b
    where b.id = stock_movements.branch_id
      and public.can_access_business_branch(b.business_id, stock_movements.branch_id)
      and public.has_business_write_role(b.business_id, array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
);

create policy "stock_movements branch scoped delete" on public.stock_movements
for delete to authenticated
using (
  exists (
    select 1 from public.branches b
    where b.id = stock_movements.branch_id
      and public.can_access_business_branch(b.business_id, stock_movements.branch_id)
      and public.has_business_write_role(b.business_id, array['owner','admin','manager'])
  )
);

-- shifts --------------------------------------------------------------------
drop policy if exists "shifts branch scoped rw" on public.shifts;
drop policy if exists "shifts branch scoped select" on public.shifts;
drop policy if exists "shifts branch scoped insert" on public.shifts;
drop policy if exists "shifts branch scoped update" on public.shifts;
drop policy if exists "shifts branch scoped delete" on public.shifts;

create policy "shifts branch scoped select" on public.shifts
for select to authenticated
using (
  exists (
    select 1
    from public.employees e
    join public.branches b on b.id = shifts.branch_id and b.business_id = e.business_id
    where e.id = shifts.employee_id
      and public.can_access_business_branch(e.business_id, shifts.branch_id)
  )
);

create policy "shifts branch scoped insert" on public.shifts
for insert to authenticated
with check (
  exists (
    select 1
    from public.employees e
    join public.branches b on b.id = shifts.branch_id and b.business_id = e.business_id
    where e.id = shifts.employee_id
      and public.can_access_business_branch(e.business_id, shifts.branch_id)
      and public.has_business_write_role(e.business_id, array['owner','admin'])
  )
);

create policy "shifts branch scoped update" on public.shifts
for update to authenticated
using (
  exists (
    select 1
    from public.employees e
    join public.branches b on b.id = shifts.branch_id and b.business_id = e.business_id
    where e.id = shifts.employee_id
      and public.can_access_business_branch(e.business_id, shifts.branch_id)
      and public.has_business_write_role(e.business_id, array['owner','admin'])
  )
)
with check (
  exists (
    select 1
    from public.employees e
    join public.branches b on b.id = shifts.branch_id and b.business_id = e.business_id
    where e.id = shifts.employee_id
      and public.can_access_business_branch(e.business_id, shifts.branch_id)
      and public.has_business_write_role(e.business_id, array['owner','admin'])
  )
);

create policy "shifts branch scoped delete" on public.shifts
for delete to authenticated
using (
  exists (
    select 1
    from public.employees e
    join public.branches b on b.id = shifts.branch_id and b.business_id = e.business_id
    where e.id = shifts.employee_id
      and public.can_access_business_branch(e.business_id, shifts.branch_id)
      and public.has_business_write_role(e.business_id, array['owner','admin'])
  )
);

-- ai_extractions -------------------------------------------------------------
drop policy if exists "ai_extractions branch scoped rw" on public.ai_extractions;
drop policy if exists "ai_extractions branch scoped select" on public.ai_extractions;
drop policy if exists "ai_extractions branch scoped insert" on public.ai_extractions;
drop policy if exists "ai_extractions branch scoped update" on public.ai_extractions;
drop policy if exists "ai_extractions branch scoped delete" on public.ai_extractions;

create policy "ai_extractions branch scoped select" on public.ai_extractions
for select to authenticated
using (
  exists (
    select 1 from public.whatsapp_messages m
    where m.id = ai_extractions.message_id
      and (ai_extractions.business_id is null or ai_extractions.business_id = m.business_id)
      and public.can_access_business_branch(coalesce(ai_extractions.business_id, m.business_id), coalesce(ai_extractions.branch_id, m.branch_id))
  )
);

create policy "ai_extractions branch scoped insert" on public.ai_extractions
for insert to authenticated
with check (
  exists (
    select 1 from public.whatsapp_messages m
    where m.id = ai_extractions.message_id
      and (ai_extractions.business_id is null or ai_extractions.business_id = m.business_id)
      and public.can_access_business_branch(coalesce(ai_extractions.business_id, m.business_id), coalesce(ai_extractions.branch_id, m.branch_id))
      and public.has_business_write_role(coalesce(ai_extractions.business_id, m.business_id), array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
);

create policy "ai_extractions branch scoped update" on public.ai_extractions
for update to authenticated
using (
  exists (
    select 1 from public.whatsapp_messages m
    where m.id = ai_extractions.message_id
      and (ai_extractions.business_id is null or ai_extractions.business_id = m.business_id)
      and public.can_access_business_branch(coalesce(ai_extractions.business_id, m.business_id), coalesce(ai_extractions.branch_id, m.branch_id))
      and public.has_business_write_role(coalesce(ai_extractions.business_id, m.business_id), array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
)
with check (
  exists (
    select 1 from public.whatsapp_messages m
    where m.id = ai_extractions.message_id
      and (ai_extractions.business_id is null or ai_extractions.business_id = m.business_id)
      and public.can_access_business_branch(coalesce(ai_extractions.business_id, m.business_id), coalesce(ai_extractions.branch_id, m.branch_id))
      and public.has_business_write_role(coalesce(ai_extractions.business_id, m.business_id), array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery'])
  )
);

create policy "ai_extractions branch scoped delete" on public.ai_extractions
for delete to authenticated
using (
  exists (
    select 1 from public.whatsapp_messages m
    where m.id = ai_extractions.message_id
      and (ai_extractions.business_id is null or ai_extractions.business_id = m.business_id)
      and public.can_access_business_branch(coalesce(ai_extractions.business_id, m.business_id), coalesce(ai_extractions.branch_id, m.branch_id))
      and public.has_business_write_role(coalesce(ai_extractions.business_id, m.business_id), array['owner','admin','manager'])
  )
);

-- branch_assignments ---------------------------------------------------------
-- The previous ALL policy used member access for USING and admin access only
-- for WITH CHECK. PostgreSQL does not evaluate WITH CHECK on DELETE, so any
-- member could delete branch assignments. Split the policy by command.
drop policy if exists "branch_assignments rw" on public.branch_assignments;
drop policy if exists "branch_assignments select" on public.branch_assignments;
drop policy if exists "branch_assignments insert admin" on public.branch_assignments;
drop policy if exists "branch_assignments update admin" on public.branch_assignments;
drop policy if exists "branch_assignments delete admin" on public.branch_assignments;

create policy "branch_assignments select" on public.branch_assignments
for select to authenticated
using (
  exists (
    select 1 from public.business_members bm
    where bm.id = branch_assignments.business_member_id
      and public.is_member_of_business(bm.business_id)
  )
);

create policy "branch_assignments insert admin" on public.branch_assignments
for insert to authenticated
with check (
  exists (
    select 1 from public.business_members bm
    where bm.id = branch_assignments.business_member_id
      and public.is_admin_of_business(bm.business_id)
  )
);

create policy "branch_assignments update admin" on public.branch_assignments
for update to authenticated
using (
  exists (
    select 1 from public.business_members bm
    where bm.id = branch_assignments.business_member_id
      and public.is_admin_of_business(bm.business_id)
  )
)
with check (
  exists (
    select 1 from public.business_members bm
    where bm.id = branch_assignments.business_member_id
      and public.is_admin_of_business(bm.business_id)
  )
);

create policy "branch_assignments delete admin" on public.branch_assignments
for delete to authenticated
using (
  exists (
    select 1 from public.business_members bm
    where bm.id = branch_assignments.business_member_id
      and public.is_admin_of_business(bm.business_id)
  )
);
