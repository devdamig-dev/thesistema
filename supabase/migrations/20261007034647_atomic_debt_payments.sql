-- Serialize every debt payment against its debt row. This protects all write
-- paths (UI, Inbox, WhatsApp and direct Data API clients) from concurrent
-- overpayments, not only callers that pre-read pending_amount.
create or replace function public.enforce_debt_payment_balance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_debt public.debts%rowtype;
  v_other_payments numeric(12,2);
begin
  if new.amount is null or new.amount <= 0 or new.amount > 9999999999.99 then
    raise exception 'invalid_debt_payment_amount' using errcode = '22003';
  end if;

  select debt.*
    into v_debt
  from public.debts debt
  where debt.id = new.debt_id
  for update;

  if not found then
    raise exception 'debt_not_found' using errcode = 'P0002';
  end if;

  select coalesce(sum(payment.amount), 0)
    into v_other_payments
  from public.debt_payments payment
  where payment.debt_id = new.debt_id
    and (tg_op = 'INSERT' or payment.id <> new.id);

  if v_other_payments + new.amount > v_debt.original_amount then
    raise exception 'debt_payment_exceeds_pending' using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_debt_payments_balance on public.debt_payments;
create trigger trg_debt_payments_balance
before insert or update of debt_id, amount on public.debt_payments
for each row execute function public.enforce_debt_payment_balance();

-- The original trigger referenced NEW on DELETE and retained "settled" after a
-- payment was reduced/deleted. Recalculate from the affected debt in all cases.
create or replace function public.recalc_debt_after_payment()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_debt_id uuid := coalesce(new.debt_id, old.debt_id);
  v_paid numeric(12,2);
  v_debt public.debts%rowtype;
begin
  select debt.* into v_debt
  from public.debts debt
  where debt.id = v_debt_id
  for update;

  if not found then
    return coalesce(new, old);
  end if;

  select coalesce(sum(payment.amount), 0) into v_paid
  from public.debt_payments payment
  where payment.debt_id = v_debt_id;

  update public.debts
  set pending_amount = greatest(v_debt.original_amount - v_paid, 0),
      status = case
        when v_debt.original_amount - v_paid <= 0 then 'settled'::public.debt_status
        when v_debt.due_date is not null and v_debt.due_date < current_date then 'overdue'::public.debt_status
        else 'active'::public.debt_status
      end,
      settled_at = case
        when v_debt.original_amount - v_paid <= 0 then coalesce(v_debt.settled_at, current_date)
        else null
      end
  where id = v_debt_id;

  return coalesce(new, old);
end;
$$;

create or replace function public.register_debt_payment_atomic(
  p_debt_id uuid,
  p_business_id uuid,
  p_actor_id uuid default null,
  p_amount numeric default null,
  p_payment_method text default 'Transferencia',
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
  v_payment_id uuid;
begin
  if p_debt_id is null or p_business_id is null or p_amount is null then
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
  if p_amount <= 0 or p_amount > 9999999999.99 then
    return jsonb_build_object('ok', false, 'error', 'invalid_amount');
  end if;
  if v_debt.status = 'settled' or v_debt.pending_amount <= 0 then
    return jsonb_build_object('ok', false, 'error', 'debt_already_settled');
  end if;
  if p_amount > v_debt.pending_amount then
    return jsonb_build_object('ok', false, 'error', 'amount_exceeds_pending');
  end if;
  if nullif(btrim(p_payment_method), '') is null or length(p_payment_method) > 80 then
    return jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  end if;
  if p_paid_at < date '2000-01-01' or p_paid_at > current_date + 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_paid_at');
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    return jsonb_build_object('ok', false, 'error', 'notes_too_long');
  end if;

  insert into public.debt_payments (
    debt_id, amount, payment_method, paid_at, notes, created_by
  ) values (
    v_debt.id, p_amount, btrim(p_payment_method), p_paid_at,
    nullif(btrim(p_notes), ''), v_actor_id
  )
  returning id into v_payment_id;

  select debt.* into v_debt
  from public.debts debt
  where debt.id = p_debt_id;

  return jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'debt_id', v_debt.id,
    'creditor', v_debt.creditor,
    'pending_amount', v_debt.pending_amount,
    'status', v_debt.status
  );
exception
  when check_violation then
    return jsonb_build_object('ok', false, 'error', 'amount_exceeds_pending');
end;
$$;

revoke all on function public.register_debt_payment_atomic(uuid, uuid, uuid, numeric, text, date, text) from public, anon;
grant execute on function public.register_debt_payment_atomic(uuid, uuid, uuid, numeric, text, date, text) to authenticated, service_role;
