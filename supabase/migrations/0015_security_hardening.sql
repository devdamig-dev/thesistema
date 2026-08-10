-- Pilot security hardening
-- 1) Trigger/policy helpers use a fixed search_path.
-- 2) SECURITY DEFINER functions are not executable by anonymous callers.
-- 3) Trigger-only SECURITY DEFINER functions are not directly executable by app users.

alter function public.set_updated_at()
  set search_path = public, pg_temp;

alter function public._policy_business_read_member(uuid)
  set search_path = public, pg_temp;

alter function public.recalc_debt_after_payment()
  set search_path = public, pg_temp;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Remove that
-- blanket grant before assigning only the roles that actually need RPC access.
revoke execute on function public.bootstrap_first_business(text, public.industry, text, text, public.module_key[]) from public, anon;
revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;
revoke execute on function public.is_admin_of_business(uuid) from public, anon;
revoke execute on function public.is_member_of_business(uuid) from public, anon;
revoke execute on function public.notify_critical_stock() from public, anon, authenticated;
revoke execute on function public.recalc_ingredient_cost(uuid) from public, anon;
revoke execute on function public.user_organization_id() from public, anon;

-- These functions are intentionally callable in authenticated flows / RLS.
grant execute on function public.bootstrap_first_business(text, public.industry, text, text, public.module_key[]) to authenticated;
grant execute on function public.is_admin_of_business(uuid) to authenticated;
grant execute on function public.is_member_of_business(uuid) to authenticated;
grant execute on function public.recalc_ingredient_cost(uuid) to authenticated;
grant execute on function public.user_organization_id() to authenticated;
