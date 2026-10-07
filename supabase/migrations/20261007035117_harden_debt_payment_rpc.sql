-- The atomic RPC performs explicit actor/business/role checks and all of its
-- callers already have the row permissions needed for the operation. Keep it
-- invoker-scoped so authenticated calls never gain the function owner's rights.
alter function public.register_debt_payment_atomic(
  uuid, uuid, uuid, numeric, text, date, text
) security invoker;
