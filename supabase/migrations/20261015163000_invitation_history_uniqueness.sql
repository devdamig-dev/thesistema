-- Backport the invitation fix independently of assistant/account-deletion work.
-- Historical statuses are not unique: revoked/expired tokens must remain as
-- history while a fresh invitation can be created and revoked for the same email.
-- Preserve all invitation IDs, tokens, statuses, memberships and RLS policies.
alter table public.user_invitations
  drop constraint if exists user_invitations_business_id_email_status_key;

create unique index if not exists user_invitations_one_pending_email_idx
  on public.user_invitations (business_id, lower(email))
  where status = 'pending';
