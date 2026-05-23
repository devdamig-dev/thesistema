-- =============================================================================
-- Sprint 3 · Deudas + Balances
-- =============================================================================

-- Estado de la deuda. El "vencida" se calcula on-the-fly pero lo dejamos
-- como valor explícito por si querés marcar manualmente algo que se
-- pasó la fecha sin renegociarse.
do $$ begin
  create type debt_status as enum ('active', 'overdue', 'settled');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- DEBTS
-- =============================================================================
create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  creditor text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  concept text,
  original_amount numeric(12,2) not null,
  pending_amount numeric(12,2) not null,
  interest_rate numeric(5,2),               -- % mensual, opcional
  due_date date,
  status debt_status not null default 'active',
  taken_at date not null default current_date,
  settled_at date,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_debts_updated before update on debts
  for each row execute function set_updated_at();
create index if not exists debts_business_idx on debts(business_id, status, due_date);

-- =============================================================================
-- DEBT_PAYMENTS
-- =============================================================================
create table if not exists debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references debts(id) on delete cascade,
  amount numeric(12,2) not null,
  paid_at date not null default current_date,
  payment_method text not null default 'Transferencia',
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_debt_payments_updated before update on debt_payments
  for each row execute function set_updated_at();
create index if not exists debt_payments_debt_idx on debt_payments(debt_id, paid_at desc);

-- =============================================================================
-- TRIGGER: actualizar pending_amount y status cuando entra un pago
-- =============================================================================
create or replace function recalc_debt_after_payment()
returns trigger
language plpgsql
as $$
declare
  v_paid numeric(12,2);
  v_debt debts;
begin
  select * into v_debt from debts where id = new.debt_id;
  select coalesce(sum(amount), 0) into v_paid
    from debt_payments where debt_id = new.debt_id;

  update debts
     set pending_amount = greatest(v_debt.original_amount - v_paid, 0),
         status = case
           when v_debt.original_amount - v_paid <= 0 then 'settled'::debt_status
           else v_debt.status
         end,
         settled_at = case
           when v_debt.original_amount - v_paid <= 0 and settled_at is null
             then current_date
           else settled_at
         end
   where id = new.debt_id;

  return new;
end;
$$;

drop trigger if exists trg_debt_payments_recalc on debt_payments;
create trigger trg_debt_payments_recalc
  after insert or update or delete on debt_payments
  for each row execute function recalc_debt_after_payment();

-- =============================================================================
-- BALANCE SNAPSHOTS (opcional, para histórico mensual rápido)
-- =============================================================================
create table if not exists balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  period_month date not null,   -- YYYY-MM-01
  sales_total numeric(14,2) not null default 0,
  purchases_total numeric(14,2) not null default 0,
  expenses_total numeric(14,2) not null default 0,
  payroll_total numeric(14,2) not null default 0,
  withdrawals_total numeric(14,2) not null default 0,
  debt_payments_total numeric(14,2) not null default 0,
  debts_pending numeric(14,2) not null default 0,
  stock_valued numeric(14,2) not null default 0,
  cash_estimated numeric(14,2) not null default 0,
  gross_margin_pct numeric(5,2),
  operating_result numeric(14,2),
  net_result numeric(14,2),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, period_month)
);
create trigger trg_balance_snapshots_updated before update on balance_snapshots
  for each row execute function set_updated_at();

-- =============================================================================
-- RLS
-- =============================================================================
alter table debts enable row level security;
alter table debt_payments enable row level security;
alter table balance_snapshots enable row level security;

drop policy if exists "debts rw" on debts;
create policy "debts rw" on debts
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "debt_payments rw" on debt_payments;
create policy "debt_payments rw" on debt_payments
  for all using (
    exists (
      select 1 from debts d
      where d.id = debt_payments.debt_id
        and is_member_of_business(d.business_id)
    )
  )
  with check (
    exists (
      select 1 from debts d
      where d.id = debt_payments.debt_id
        and is_member_of_business(d.business_id)
    )
  );

drop policy if exists "balance_snapshots rw" on balance_snapshots;
create policy "balance_snapshots rw" on balance_snapshots
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));
