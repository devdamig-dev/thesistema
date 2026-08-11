-- 0021_server_owned_auxiliary_write_protection.sql
--
-- Auxiliary/provenance tables below are written only by server-side helpers and
-- invoice actions using the Supabase service-role client. Historical member-wide
-- write policies let authenticated business members bypass the application
-- permission matrix through the Data API and forge audit/notification records or
-- mutate invoice-derived rows.
--
-- Keep the reads users legitimately need, scoped to the tenant/branch, but remove
-- direct user writes. service_role continues to bypass RLS for trusted backend
-- operations.

-- activity_logs --------------------------------------------------------------
drop policy if exists "activity_logs write" on public.activity_logs;
drop policy if exists "activity_logs read" on public.activity_logs;
create policy "activity_logs read" on public.activity_logs
for select to authenticated
using (public.is_member_of_business(business_id));

-- notifications --------------------------------------------------------------
-- Notifications are created by createNotification() with the admin client.
-- End users may only read and mark their own/shared notifications as read.
drop policy if exists "notifications insert" on public.notifications;
drop policy if exists "notifications read" on public.notifications;
drop policy if exists "notifications mark read" on public.notifications;

create policy "notifications read" on public.notifications
for select to authenticated
using (
  public.is_member_of_business(business_id)
  and (recipient_id is null or recipient_id = auth.uid())
);

create policy "notifications mark read" on public.notifications
for update to authenticated
using (
  public.is_member_of_business(business_id)
  and (recipient_id is null or recipient_id = auth.uid())
)
with check (
  public.is_member_of_business(business_id)
  and (recipient_id is null or recipient_id = auth.uid())
);

-- invoice_items --------------------------------------------------------------
-- Invoice items are OCR/AI-derived and written from server-side invoice actions.
-- Read access follows the branch-scoped parent invoice.
drop policy if exists "invoice_items rw" on public.invoice_items;
drop policy if exists "invoice_items read" on public.invoice_items;
create policy "invoice_items read" on public.invoice_items
for select to authenticated
using (
  exists (
    select 1
    from public.invoices i
    where i.id = invoice_items.invoice_id
      and public.can_access_business_branch(i.business_id, i.branch_id)
  )
);

-- invoice_processing_logs ----------------------------------------------------
-- Pipeline logs are system provenance and must never be user-writable.
-- Read access follows the branch-scoped parent invoice.
drop policy if exists "invoice_processing_logs rw" on public.invoice_processing_logs;
drop policy if exists "invoice_processing_logs read" on public.invoice_processing_logs;
create policy "invoice_processing_logs read" on public.invoice_processing_logs
for select to authenticated
using (
  exists (
    select 1
    from public.invoices i
    where i.id = invoice_processing_logs.invoice_id
      and public.can_access_business_branch(i.business_id, i.branch_id)
  )
);
