-- 0023_notification_column_write_boundary.sql
--
-- Migration 0021 removed direct user INSERT policies for notifications and kept
-- only the lifecycle UPDATE policy used by the UI. However, the historical
-- table grants still gave anon/authenticated full INSERT/UPDATE/DELETE privileges.
-- RLS limits which rows can be touched, but a row that passes the policy could
-- still have server-owned content/tenant fields rewritten directly through the
-- Data API.
--
-- User sessions only need to mark notifications read or archived. Everything
-- else remains backend-owned and is written with service_role.

revoke insert, update, delete, truncate, trigger, references
  on table public.notifications
  from anon;

revoke insert, update, delete, truncate, trigger, references
  on table public.notifications
  from authenticated;

grant update (read_at, archived_at)
  on table public.notifications
  to authenticated;
