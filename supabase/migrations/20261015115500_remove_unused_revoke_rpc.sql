-- Invitation revocation is performed through tenant-scoped RLS updates in the server action.
-- Remove the temporary RPC to keep the exposed mutation surface minimal.
drop function if exists public.revoke_user_invitation(uuid,uuid);
