-- Commit the enum value in its own migration before any constraint or function uses it.
alter type public.debt_status add value if not exists 'cancelled';
