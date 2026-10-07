-- Manual settlement is an explicit ledger adjustment, never a direct rewrite
-- of the debt balance. The row lock serializes it with normal payments.
create or replace function public.settle_debt_atomic(
  p_debt_id uuid,
  p_business_id uuid,
  p_actor_id uuid default null,
  p_paid_at date default current_date,
  p_notes text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_member public.business_members%rowtype;
  v_debt public.debts%rowtype;
  v_paid numeric(12,2);
  v_adjustment numeric(12,2);
  v_payment_id uuid;
begin
  if p_debt_id is null or p_business_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  if p_actor_id is not null and auth.role() <> 'service_role' and p_actor_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'actor_mismatch');
  end if;
  v_actor_id := coalesce(p_actor_id, auth.uid());
  if v_actor_id is null then
    return jsonb_build_object('ok', false, 'error', 'actor_required');
  end if;

  select member.* into v_member
  from public.business_members member
  where member.business_id = p_business_id
    and member.user_id = v_actor_id;

  if not found or v_member.role not in ('owner', 'admin', 'manager') then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  select debt.* into v_debt
  from public.debts debt
  where debt.id = p_debt_id
    and debt.business_id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'debt_not_found');
  end if;
  if p_paid_at < date '2000-01-01' or p_paid_at > current_date + 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_paid_at');
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'notes_too_long');
  end if;

  select coalesce(sum(payment.amount), 0) into v_paid
  from public.debt_payments payment
  where payment.debt_id = v_debt.id;
  v_adjustment := v_debt.original_amount - v_paid;

  if v_adjustment <= 0 then
    return jsonb_build_object('ok', false, 'error', 'debt_already_settled');
  end if;

  insert into public.debt_payments (
    debt_id, amount, payment_method, paid_at, notes, created_by
  ) values (
    v_debt.id,
    v_adjustment,
    'Ajuste manual',
    p_paid_at,
    coalesce(nullif(btrim(p_notes), ''), 'Cancelación manual confirmada desde Deudas'),
    v_actor_id
  )
  returning id into v_payment_id;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'debt_id', v_debt.id,
    'creditor', v_debt.creditor,
    'amount', v_adjustment,
    'pending_amount', 0,
    'status', 'settled',
    'payment_method', 'Ajuste manual'
  );
exception
  when check_violation then
    return jsonb_build_object('ok', false, 'error', 'concurrent_payment');
end;
$$;

revoke all on function public.settle_debt_atomic(uuid, uuid, uuid, date, text) from public, anon;
grant execute on function public.settle_debt_atomic(uuid, uuid, uuid, date, text) to authenticated, service_role;

-- Preserve the meaning of historical manual settlements while restoring the
-- invariant original_amount = payment history + pending_amount.
insert into public.debt_payments (
  debt_id, amount, payment_method, paid_at, notes, created_by
)
select
  debt.id,
  debt.original_amount - coalesce(sum(payment.amount), 0),
  'Ajuste manual',
  coalesce(debt.settled_at, debt.updated_at::date, current_date),
  'Regularización de una cancelación manual anterior',
  debt.created_by
from public.debts debt
left join public.debt_payments payment on payment.debt_id = debt.id
where debt.status = 'settled'
group by debt.id
having debt.original_amount - coalesce(sum(payment.amount), 0) > 0;
