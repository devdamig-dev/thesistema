-- Keep the persisted module enum aligned with the modules that are already
-- implemented and guarded by the application sidebar/middleware.
--
-- `debts` and `balances` existed in the application permission model but could
-- not be persisted in business_modules because the database enum was missing
-- both values.

alter type public.module_key add value if not exists 'debts';
alter type public.module_key add value if not exists 'balances';
