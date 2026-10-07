-- Only non-secret status columns may be read by an authenticated business admin.
-- No table-level SELECT grant: SELECT * and access_token remain forbidden.
revoke select on public.whatsapp_integrations from anon, authenticated;
grant select (business_id, phone_number_id, display_phone_number, status, connected_at, token_expires_at)
  on public.whatsapp_integrations to authenticated;
drop policy if exists "whatsapp integration admin status" on public.whatsapp_integrations;
create policy "whatsapp integration admin status" on public.whatsapp_integrations
  for select to authenticated
  using (public.is_admin_of_business(business_id));
