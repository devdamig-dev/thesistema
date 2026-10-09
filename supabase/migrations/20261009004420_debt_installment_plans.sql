-- Debt installment plans extend the existing debt/payment ledger. No accounting
-- expense entries or invented amortization. Unknown historical values stay NULL.
create schema if not exists debt_private;
revoke all on schema debt_private from public, anon;
grant usage on schema debt_private to authenticated, service_role;

alter table public.debts
  add column mode text not null default 'single' check (mode in ('single','installments')),
  add column currency text check (currency ~ '^[A-Z]{3}$'),
  add column creditor_type text check (creditor_type in ('supplier','bank','card','government','person','other')),
  alter column category drop not null,
  add column reference text,
  add column origin text check (origin in ('manual','whatsapp','purchase','invoice','api','system')),
  add column expected_payment_method text,
  add column total_financed_amount numeric(12,2),
  add column down_payment_amount numeric(12,2),
  add column total_obligation_amount numeric(12,2),
  add column installment_count integer,
  add column periodicity text,
  add column monthly_anchor_day integer,
  add column plan_version bigint not null default 0 check (plan_version between 0 and 9007199254740991),
  add column plan_definition jsonb,
  add column mutation_request_id uuid,
  add column plan_request_id uuid,
  add column plan_request_payload jsonb,
  add constraint debts_plan_identity unique (id,business_id,branch_id),
  add constraint debts_plan_request unique (business_id,plan_request_id),
  add constraint debts_plan_money check (plan_definition is null or (
    original_amount > 0 and total_financed_amount > 0 and pending_amount >= 0
    and pending_amount <= total_financed_amount and currency is not null
    and installment_count between 1 and 1200
    and (down_payment_amount is null or down_payment_amount between 0 and original_amount)
    and ((down_payment_amount is null and total_obligation_amount is null)
      or total_obligation_amount = total_financed_amount + down_payment_amount)));

alter table public.debt_payments
  add column business_id uuid,
  add column branch_id uuid,
  add column currency text,
  add column origin text,
  add column reference text,
  add column allocation_rule text,
  add column selected_installment_id uuid,
  add column request_id uuid,
  add column request_payload jsonb,
  add column voided_at timestamptz,
  add column voided_on date,
  add column voided_by uuid references public.profiles(id),
  add column void_reason text,
  add column void_request_id uuid,
  add column void_request_payload jsonb,
  add constraint debt_payments_scope_identity unique (id,debt_id,business_id,branch_id),
  add constraint debt_payments_request unique (debt_id,request_id),
  add constraint debt_payments_void_request unique (debt_id,void_request_id),
  add constraint debt_payments_plan_scope foreign key (debt_id,business_id,branch_id)
    references public.debts(id,business_id,branch_id) on delete cascade,
  add constraint debt_payments_void_complete check (
    (voided_at is null and voided_on is null and voided_by is null and void_reason is null and void_request_id is null)
    or (voided_at is not null and voided_on is not null and voided_by is not null and length(btrim(void_reason)) between 1 and 1000 and void_request_id is not null));
-- Historical payment scope is factual and can be backfilled; currency/origin cannot.
update public.debt_payments p set business_id=d.business_id,branch_id=d.branch_id from public.debts d where d.id=p.debt_id;

create table public.debt_installments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null,
  debt_id uuid not null,
  mutation_request_id uuid,
  installment_number integer not null check (installment_number between 1 and 1200),
  due_date date,
  capital_amount numeric(12,2) check (capital_amount >= 0),
  interest_amount numeric(12,2) check (interest_amount >= 0),
  fees_amount numeric(12,2) check (fees_amount >= 0),
  total_amount numeric(12,2) not null check (total_amount > 0),
  notes text check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(debt_id,installment_number),
  unique(id,debt_id,business_id,branch_id),
  foreign key (debt_id,business_id,branch_id) references public.debts(id,business_id,branch_id) on delete restrict,
  check (coalesce(capital_amount,0)+coalesce(interest_amount,0)+coalesce(fees_amount,0) <= total_amount),
  check (capital_amount is null or interest_amount is null or fees_amount is null or capital_amount+interest_amount+fees_amount=total_amount)
);
alter table public.debt_payments add constraint debt_payments_selected_scope
  foreign key (selected_installment_id,debt_id,business_id,branch_id)
  references public.debt_installments(id,debt_id,business_id,branch_id);
create table public.debt_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  branch_id uuid not null,
  debt_id uuid not null,
  payment_id uuid not null,
  installment_id uuid not null,
  amount numeric(12,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(payment_id,installment_id),
  foreign key (payment_id,debt_id,business_id,branch_id) references public.debt_payments(id,debt_id,business_id,branch_id) on delete restrict,
  foreign key (installment_id,debt_id,business_id,branch_id) references public.debt_installments(id,debt_id,business_id,branch_id) on delete restrict
);
create index debt_installments_due_idx on public.debt_installments(business_id,branch_id,due_date,debt_id);
create index debt_allocations_installment_idx on public.debt_payment_allocations(installment_id,payment_id);
create index debt_allocations_debt_idx on public.debt_payment_allocations(debt_id,payment_id);

-- Mutation receipts are written only by the private audit trigger. They record
-- real committed edits and make retries safe even after subsequent edits.
create table public.debt_plan_mutations (
 debt_id uuid not null,
 business_id uuid not null,
 branch_id uuid not null,
 request_id uuid not null,
 actor_id uuid not null references public.profiles(id),
 operation text not null check(operation in ('installment.edit','debt.notes')),
 payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(debt_id,request_id),
 foreign key(debt_id,business_id,branch_id) references public.debts(id,business_id,branch_id)
);
alter table public.debt_plan_mutations enable row level security;
revoke all on public.debt_plan_mutations from public,anon,authenticated,service_role;
grant select on public.debt_plan_mutations to authenticated,service_role;
create policy mutations_read on public.debt_plan_mutations for select to authenticated using(public.can_access_business_branch(business_id,branch_id));

-- Explicit server actor context is usable only by the service_role. A normal
-- client cannot elevate itself by setting a custom GUC or passing p_actor_id.
create function debt_private.actor_id() returns uuid
language sql stable security invoker set search_path='' as $$
 select case when current_setting('role',true)='service_role' or session_user='service_role'
   then coalesce(nullif(current_setting('debt.actor_id',true),'')::uuid,auth.uid()) else auth.uid() end
$$;
revoke all on function debt_private.actor_id() from public,anon;
grant execute on function debt_private.actor_id() to authenticated,service_role;
create function debt_private.set_actor(p_actor uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare actor uuid; is_service boolean:=current_setting('role',true)='service_role' or session_user='service_role';
begin
 if p_actor is not null and not is_service and p_actor is distinct from auth.uid() then raise exception 'actor_mismatch'; end if;
 actor:=case when is_service then coalesce(p_actor,auth.uid()) else auth.uid() end;
 if actor is null then raise exception 'actor_required'; end if;
 if not exists(select 1 from public.profiles p where p.id=actor and p.active) then raise exception 'permission_denied'; end if;
 if is_service then perform set_config('debt.actor_id',actor::text,true); end if;
 return actor;
end $$;
revoke all on function debt_private.set_actor(uuid) from public,anon;
grant execute on function debt_private.set_actor(uuid) to authenticated,service_role;
-- Write roles are business-wide in the existing branch model. Membership and
-- active profile are always rechecked for the resolved actor, including servers.
create function debt_private.can_write(p_business uuid,p_branch uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select debt_private.actor_id() is not null and exists (
   select 1 from public.business_members m join public.profiles p on p.id=m.user_id
   where m.business_id=p_business and m.user_id=debt_private.actor_id() and p.active
     and m.role in ('owner','admin','manager'))
 and (current_setting('role',true)='service_role' or session_user='service_role' or public.can_access_business_branch(p_business,p_branch))
$$;
revoke all on function debt_private.can_write(uuid,uuid) from public,anon;
grant execute on function debt_private.can_write(uuid,uuid) to authenticated,service_role;
alter table public.debt_installments enable row level security;
alter table public.debt_payment_allocations enable row level security;
create policy installments_read on public.debt_installments for select to authenticated using(public.can_access_business_branch(business_id,branch_id));
create policy installments_write on public.debt_installments for all to authenticated using(debt_private.can_write(business_id,branch_id)) with check(debt_private.can_write(business_id,branch_id));
create policy allocations_read on public.debt_payment_allocations for select to authenticated using(public.can_access_business_branch(business_id,branch_id));
create policy allocations_write on public.debt_payment_allocations for all to authenticated using(debt_private.can_write(business_id,branch_id)) with check(debt_private.can_write(business_id,branch_id));
-- Restrictive policies also protect direct writes to old ledger tables.
create policy debts_active_write on public.debts as restrictive for all to authenticated
 using (exists(select 1 from public.profiles where id=auth.uid() and active))
 with check(debt_private.can_write(business_id,branch_id));
create policy payments_active_write on public.debt_payments as restrictive for all to authenticated
 using (exists(select 1 from public.profiles where id=auth.uid() and active))
 with check(exists(select 1 from public.debts d where d.id=debt_id and debt_private.can_write(d.business_id,d.branch_id)));
grant select,insert,update,delete on public.debt_installments,public.debt_payment_allocations to authenticated,service_role;
-- A disabled profile loses every ledger read, including permissive ALL policies.
create policy installments_active_read on public.debt_installments as restrictive for select to authenticated
 using(exists(select 1 from public.profiles where id=auth.uid() and active));
create policy allocations_active_read on public.debt_payment_allocations as restrictive for select to authenticated
 using(exists(select 1 from public.profiles where id=auth.uid() and active));
create policy mutations_active_read on public.debt_plan_mutations as restrictive for select to authenticated
 using(exists(select 1 from public.profiles where id=auth.uid() and active));

-- No API writer (even service_role) can forge an audit scope receipt. Unlike a
-- raw JSON branch_id, this survives deletion with trustworthy original scope.
create table debt_private.audit_scopes (
 activity_log_id uuid primary key references public.activity_logs(id) on delete cascade,
 business_id uuid not null,
 branch_id uuid,
 debt_id uuid not null,
 created_at timestamptz not null default now()
);
revoke all on debt_private.audit_scopes from public,anon,authenticated,service_role;
create function debt_private.can_read_audit_scope(p_log uuid,p_business uuid) returns boolean
language sql stable security definer set search_path='' as $$
 -- NULL means no receipt (legacy fallback allowed); FALSE means a receipt exists
 -- but denies this reader/scope. Current parent movement must not override it.
 select case when exists(select 1 from debt_private.audit_scopes where activity_log_id=p_log) then
   auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active)
   and exists(select 1 from debt_private.audit_scopes s where s.activity_log_id=p_log and s.business_id=p_business
     and public.can_access_business_branch(s.business_id,s.branch_id))
 else null end
$$;
revoke all on function debt_private.can_read_audit_scope(uuid,uuid) from public,anon,service_role;
grant execute on function debt_private.can_read_audit_scope(uuid,uuid) to authenticated;


-- Civil dates follow the configured business timezone; timestamps remain UTC.
create function debt_private.business_date(p_business uuid) returns date
language sql stable security invoker set search_path='' as $$
 select (now() at time zone b.timezone)::date from public.businesses b where b.id=p_business
$$;
revoke all on function debt_private.business_date(uuid) from public,anon;
grant execute on function debt_private.business_date(uuid) to authenticated,service_role;

create function debt_private.cents(p jsonb) returns numeric
language plpgsql immutable security invoker set search_path='' as $$
declare n numeric;
begin
 if jsonb_typeof(p) is distinct from 'number' or (p#>>'{}') !~ '^[0-9]+(\.0+)?$' then raise exception 'invalid_integer_money'; end if;
 n:=(p#>>'{}')::numeric;
 if n<0 or n>999999999999 then raise exception 'invalid_integer_money'; end if;
 return n;
end $$;
create function debt_private.civil_date(p text) returns date
language plpgsql immutable security invoker set search_path='' as $$
declare d date;
begin
 if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(p,4)='0000' then raise exception 'invalid_date'; end if;
 d:=p::date;
 if to_char(d,'YYYY-MM-DD')<>p then raise exception 'invalid_date'; end if;
 return d;
end $$;
create function debt_private.keys(p jsonb,allowed text[]) returns void
language plpgsql immutable security invoker set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where not(k=any(allowed))) then raise exception 'invalid_object_or_unknown_field'; end if;
end $$;

-- Revalidate the pure domain output. The SQL boundary accepts no trusted totals,
-- dates, component allocation, JSON money strings, or hidden amortization.
create function debt_private.validate_plan(p jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare
 c int; n int:=0; total numeric; original numeric; regular numeric; amount numeric;
 part jsonb; cb jsonb; rate jsonb; first_date date; dd date; previous_date date;
 known numeric; totals numeric[]; remain numeric[]; mask int; demand numeric; capacity numeric;
 keys text[]:=array['capitalAmountCents','interestAmountCents','feesAmountCents']; k int; expected numeric;
begin
 perform debt_private.keys(p,array['mode','currency','originalAmountCents','totalFinancedCents','downPaymentCents','totalObligationCents','regularInstallmentAmountCents','installmentCount','periodicity','monthlyAnchorDay','amountSource','confirmedBalance','interestRate','installments']);
 if p->>'mode' is null or p->>'mode' not in ('single','installments') or coalesce(p->>'currency','') !~ '^[A-Z]{3}$'
 or p->>'amountSource' is null or p->>'amountSource' not in ('explicit_total','explicit_installment','confirmed_balance') then raise exception 'invalid_plan'; end if;
 original:=debt_private.cents(p->'originalAmountCents'); total:=debt_private.cents(p->'totalFinancedCents');
 c:=debt_private.cents(p->'installmentCount')::int; regular:=debt_private.cents(p->'regularInstallmentAmountCents');
 if original<=0 or total<=0 or c not between 1 and 1200 or total<c or regular<>floor(total/c)
 or jsonb_typeof(p->'installments') is distinct from 'array' or jsonb_array_length(p->'installments')<>c then raise exception 'installment_total_mismatch'; end if;
 if p->>'amountSource'='explicit_installment' and mod(total,c)<>0 then raise exception 'inconsistent_financing'; end if;
 if p->>'mode'='single' and (c<>1 or p->>'periodicity' is not null or p->>'monthlyAnchorDay' is not null) then raise exception 'invalid_single_plan'; end if;
 if p->>'mode'='installments' and (p->>'periodicity' is null or p->>'periodicity' not in ('weekly','fortnightly','monthly','custom')) then raise exception 'invalid_periodicity'; end if;
 cb:=p->'confirmedBalance';
 if cb is not null and cb<>'null'::jsonb then
   perform debt_private.keys(cb,array['confirmed','downPaymentCents','interestCents','feesCents']);
   if cb->'confirmed' is distinct from 'true'::jsonb then raise exception 'balance_not_confirmed'; end if;
   totals:=array[original-debt_private.cents(cb->'downPaymentCents'),debt_private.cents(cb->'interestCents'),debt_private.cents(cb->'feesCents')]; remain:=totals;
   if totals[1]<0 or totals[1]+totals[2]+totals[3]<>total
   or debt_private.cents(p->'downPaymentCents')<>debt_private.cents(cb->'downPaymentCents')
   or debt_private.cents(p->'totalObligationCents')<>total+debt_private.cents(cb->'downPaymentCents') then raise exception 'inconsistent_financing'; end if;
 else
   if p->>'downPaymentCents' is not null or p->>'totalObligationCents' is not null or p->>'amountSource'='confirmed_balance' then raise exception 'balance_not_confirmed'; end if;
 end if;
 rate:=p->'interestRate';
 if rate is not null and rate<>'null'::jsonb then
   perform debt_private.keys(rate,array['value','period']);
   if jsonb_typeof(rate->'value') is distinct from 'string' or coalesce(rate->>'value','') !~ '^(0|[1-9][0-9]{0,5})(\.[0-9]{1,6})?$'
   or rate->>'period' is null or rate->>'period' not in ('weekly','fortnightly','monthly','annual','one_time','unspecified') then raise exception 'invalid_interest_rate'; end if;
 end if;
 for part in select value from jsonb_array_elements(p->'installments') loop
   n:=n+1; perform debt_private.keys(part,array['installmentNumber','dueDate','totalAmountCents','capitalAmountCents','interestAmountCents','feesAmountCents']);
   amount:=debt_private.cents(part->'totalAmountCents'); expected:=case when n=c then total-regular*(c-1) else regular end;
   if debt_private.cents(part->'installmentNumber')<>n or amount<>expected or amount<=0 then raise exception 'installment_total_mismatch'; end if;
   dd:=case when part->>'dueDate' is null then null else debt_private.civil_date(part->>'dueDate') end;
   if p->>'mode'='installments' then
     if dd is null or (previous_date is not null and dd<=previous_date) then raise exception 'dates_not_increasing'; end if;
     if n=1 then first_date:=dd; end if;
     if p->>'periodicity'='weekly' and dd<>first_date+7*(n-1) or p->>'periodicity'='fortnightly' and dd<>first_date+15*(n-1)
     or p->>'periodicity'='monthly' and dd<>(first_date+make_interval(months=>n-1))::date then raise exception 'invalid_schedule'; end if;
   end if;
   previous_date:=dd; known:=0;
   for k in 1..3 loop
     if part->>keys[k] is not null then known:=known+debt_private.cents(part->keys[k]); if remain is not null then remain[k]:=remain[k]-debt_private.cents(part->keys[k]); end if; end if;
   end loop;
   if known>amount or (part->>keys[1] is not null and part->>keys[2] is not null and part->>keys[3] is not null and known<>amount) then raise exception 'inconsistent_components'; end if;
 end loop;
 if p->>'periodicity'='monthly' then
   if debt_private.cents(p->'monthlyAnchorDay')<>extract(day from first_date) then raise exception 'invalid_monthly_anchor'; end if;
 elsif p->>'monthlyAnchorDay' is not null then raise exception 'invalid_monthly_anchor'; end if;
 if remain is not null then
   if remain[1]<0 or remain[2]<0 or remain[3]<0 then raise exception 'inconsistent_components'; end if;
   -- All seven component-subset capacity checks match the pure domain validator.
   for mask in 1..7 loop
     demand:=0; capacity:=0;
     for k in 1..3 loop if (mask & (1<<(k-1)))<>0 then demand:=demand+remain[k]; end if; end loop;
     for part in select value from jsonb_array_elements(p->'installments') loop
       known:=coalesce((part->>keys[1])::numeric,0)+coalesce((part->>keys[2])::numeric,0)+coalesce((part->>keys[3])::numeric,0);
       if exists(select 1 from generate_series(1,3) j where (mask & (1<<(j-1)))<>0 and part->>keys[j] is null) then capacity:=capacity+(part->>'totalAmountCents')::numeric-known; end if;
     end loop;
     if demand>capacity then raise exception 'inconsistent_components'; end if;
   end loop;
 end if;
end $$;
revoke all on function debt_private.cents(jsonb),debt_private.civil_date(text),debt_private.keys(jsonb,text[]),debt_private.validate_plan(jsonb) from public,anon;
grant execute on function debt_private.cents(jsonb),debt_private.civil_date(text),debt_private.keys(jsonb,text[]),debt_private.validate_plan(jsonb) to authenticated,service_role;

create function debt_private.guard_debt() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb; payload jsonb; key text; paid numeric; next_due date;
begin
 if tg_op='DELETE' then
   if old.plan_definition is not null then raise exception 'plan_history_immutable'; end if;
   return old;
 end if;
 if tg_op='UPDATE' and old.plan_definition is not null then
   if (to_jsonb(new)-array['pending_amount','status','settled_at','due_date','notes','updated_at','plan_version','mutation_request_id'])
     is distinct from (to_jsonb(old)-array['pending_amount','status','settled_at','due_date','notes','updated_at','plan_version','mutation_request_id']) then raise exception 'plan_financial_terms_immutable'; end if;
   select coalesce(sum(amount),0) into paid from public.debt_payments where debt_id=new.id and voided_at is null;
   select min(i.due_date) into next_due from public.debt_installments i where i.debt_id=new.id
     and i.total_amount>coalesce((select sum(a.amount) from public.debt_payment_allocations a join public.debt_payments pay on pay.id=a.payment_id where a.installment_id=i.id and pay.voided_at is null),0);
   new.pending_amount:=new.total_financed_amount-paid;
   new.due_date:=next_due;
   new.status:=case when new.pending_amount=0 then 'settled'::public.debt_status when next_due<debt_private.business_date(new.business_id) then 'overdue'::public.debt_status else 'active'::public.debt_status end;
   new.settled_at:=case when new.pending_amount=0 then coalesce(old.settled_at,debt_private.business_date(new.business_id)) else null end;
   new.plan_version:=old.plan_version+1;
 elsif new.plan_definition is not null then
   if tg_op<>'INSERT' then raise exception 'existing_debt_conversion_not_supported'; end if;
   if not debt_private.can_write(new.business_id,new.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
   perform debt_private.validate_plan(new.plan_definition); p:=new.plan_definition;
   -- Direct Data API callers must also bind the retry receipt to actual data.
   new.creditor:=btrim(new.creditor); new.concept:=nullif(btrim(new.concept),''); new.notes:=nullif(btrim(new.notes),'');
   new.reference:=nullif(btrim(new.reference),''); new.expected_payment_method:=nullif(btrim(new.expected_payment_method),'');
   if nullif(new.creditor,'') is null or length(new.creditor)>200 or length(new.concept)>1000 or length(new.notes)>1000
     or length(new.reference)>200 or length(new.expected_payment_method)>80 or new.origin is null then raise exception 'invalid_debt_metadata'; end if;
   if new.supplier_id is not null and not exists(select 1 from public.suppliers s where s.id=new.supplier_id and s.business_id=new.business_id) then raise exception 'supplier_business_mismatch'; end if;
   payload:=coalesce(new.plan_request_payload,jsonb_build_object('business_id',new.business_id,'branch_id',new.branch_id,'creditor',new.creditor,
     'creditor_type',new.creditor_type,'concept',new.concept,'taken_at',new.taken_at,'category',new.category,'reference',new.reference,
     'notes',new.notes,'origin',new.origin,'expected_payment_method',new.expected_payment_method,'plan',new.plan_definition));
   perform debt_private.keys(payload,array['business_id','branch_id','creditor','creditor_type','concept','taken_at','category','reference','notes','origin','expected_payment_method','plan']);
   foreach key in array array['business_id','branch_id','creditor','creditor_type','concept','taken_at','category','reference','notes','origin','expected_payment_method'] loop
     if payload->key is not null and payload->key<>'null'::jsonb and jsonb_typeof(payload->key)<>'string' then raise exception 'invalid_debt_metadata'; end if;
   end loop;
   if (payload->>'business_id')::uuid is distinct from new.business_id or (payload->>'branch_id')::uuid is distinct from new.branch_id
     or btrim(payload->>'creditor') is distinct from new.creditor or payload->>'creditor_type' is distinct from new.creditor_type
     or nullif(btrim(payload->>'concept'),'') is distinct from new.concept or debt_private.civil_date(payload->>'taken_at') is distinct from new.taken_at
     or payload->>'category' is distinct from new.category::text or nullif(btrim(payload->>'reference'),'') is distinct from new.reference
     or nullif(btrim(payload->>'notes'),'') is distinct from new.notes or payload->>'origin' is distinct from new.origin
     or nullif(btrim(payload->>'expected_payment_method'),'') is distinct from new.expected_payment_method
     or payload->'plan' is distinct from new.plan_definition then raise exception 'request_payload_mismatch'; end if;
   new.plan_request_payload:=payload; new.created_at:=now();

   if new.plan_request_id is null then raise exception 'request_id_required'; end if;
   new.mode:=p->>'mode'; new.currency:=p->>'currency'; new.original_amount:=debt_private.cents(p->'originalAmountCents')/100;
   new.total_financed_amount:=debt_private.cents(p->'totalFinancedCents')/100;
   new.down_payment_amount:=(p->>'downPaymentCents')::numeric/100;
   new.total_obligation_amount:=(p->>'totalObligationCents')::numeric/100;
   new.pending_amount:=new.total_financed_amount; new.installment_count:=(p->>'installmentCount')::int;
   new.periodicity:=p->>'periodicity'; new.monthly_anchor_day:=(p->>'monthlyAnchorDay')::int;
   new.due_date:=(p->'installments'->0->>'dueDate')::date; new.plan_version:=0;
   new.status:=case when new.due_date<debt_private.business_date(new.business_id) then 'overdue'::public.debt_status else 'active'::public.debt_status end;
   new.settled_at:=null; new.created_by:=debt_private.actor_id(); new.interest_rate:=null;
 elsif new.mode<>'single' or new.total_financed_amount is not null or new.plan_request_id is not null then
   raise exception 'plan_definition_required';
 elsif tg_op='UPDATE' then
   if new.id<>old.id or new.business_id<>old.business_id then raise exception 'debt_identity_immutable'; end if;
   select coalesce(sum(amount),0) into paid from public.debt_payments where debt_id=new.id and voided_at is null;
   if new.original_amount<=0 or new.original_amount<paid then raise exception 'original_below_paid'; end if;
   new.pending_amount:=new.original_amount-paid;
   new.status:=case when new.pending_amount=0 then 'settled'::public.debt_status when new.due_date<debt_private.business_date(new.business_id) then 'overdue'::public.debt_status else 'active'::public.debt_status end;
   new.settled_at:=case when new.pending_amount=0 then coalesce(old.settled_at,debt_private.business_date(new.business_id)) else null end;
 end if;
 return new;
end $$;
create trigger debt_plan_guard before insert or update or delete on public.debts for each row execute function debt_private.guard_debt();

create function debt_private.create_installments() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.plan_definition is not null then
   insert into public.debt_installments(business_id,branch_id,debt_id,installment_number,due_date,capital_amount,interest_amount,fees_amount,total_amount)
   select new.business_id,new.branch_id,new.id,(p->>'installmentNumber')::int,(p->>'dueDate')::date,
     (p->>'capitalAmountCents')::numeric/100,(p->>'interestAmountCents')::numeric/100,(p->>'feesAmountCents')::numeric/100,(p->>'totalAmountCents')::numeric/100
   from jsonb_array_elements(new.plan_definition->'installments') p;
 end if;
 return new;
end $$;
create trigger debt_plan_installments after insert on public.debts for each row execute function debt_private.create_installments();

create function debt_private.guard_installment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype;
begin
 if tg_op='DELETE' then raise exception 'plan_history_immutable'; end if;
 select * into d from public.debts where id=new.debt_id for update;
 if not found or d.plan_definition is null then raise exception 'plan_not_found'; end if;
 if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
 if tg_op='INSERT' then
   if pg_trigger_depth()<2 then raise exception 'installments_generated_from_plan_only'; end if;
 else
   if (to_jsonb(new)-array['due_date','notes','updated_at','mutation_request_id']) is distinct from (to_jsonb(old)-array['due_date','notes','updated_at','mutation_request_id']) then raise exception 'installment_financial_terms_immutable'; end if;
   if new.due_date<date '0001-01-01' or new.due_date>date '9999-12-31' then raise exception 'invalid_date'; end if;
   if d.mode='installments' and new.due_date is null then raise exception 'installment_date_required'; end if;
   if exists(select 1 from public.debt_installments i where i.debt_id=d.id and i.id<>new.id
      and ((i.installment_number<new.installment_number and i.due_date>=new.due_date) or (i.installment_number>new.installment_number and i.due_date<=new.due_date))) then raise exception 'dates_not_increasing'; end if;
   new.updated_at:=now();
 end if;
 return new;
end $$;
create trigger installment_guard before insert or update or delete on public.debt_installments for each row execute function debt_private.guard_installment();
create function debt_private.refresh_installment_debt() returns trigger
language plpgsql security invoker set search_path='' as $$
begin update public.debts set plan_version=plan_version where id=new.debt_id; return new; end $$;
create trigger installment_refresh after update on public.debt_installments for each row execute function debt_private.refresh_installment_debt();

-- Parent row is locked before validating any amount, including direct Data API
-- INSERTs. A plan payment's principal/identity never changes; reversal is a void.
create or replace function public.enforce_debt_payment_balance() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; paid numeric; remaining numeric; payload jsonb; choice jsonb; key text;
begin
 select * into d from public.debts where id=case when tg_op='DELETE' then old.debt_id else new.debt_id end for update;
 if not found then
   if tg_op='DELETE' and pg_trigger_depth()>1 and old.allocation_rule is null then
     -- Legacy parent deletion was authorized/audited before the cascade. Plans
     -- cannot reach this path: their parent BEFORE DELETE guard always rejects.
     return old;
   end if;
   raise exception 'debt_not_found';
 end if;
 if tg_op='DELETE' then
   if d.plan_definition is not null then raise exception 'plan_payment_delete_forbidden'; end if;
   return old;
 end if;
 if new.amount is null or new.amount<=0 or new.amount>9999999999.99 then raise exception 'invalid_debt_payment_amount'; end if;
 if tg_op='UPDATE' and new.debt_id<>old.debt_id then raise exception 'debt_payment_reassignment_forbidden'; end if;
 if d.plan_definition is not null then
   if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
   if tg_op='UPDATE' then
     if (to_jsonb(new)-array['voided_at','voided_on','voided_by','void_reason','void_request_id','void_request_payload','updated_at']) is distinct from
       (to_jsonb(old)-array['voided_at','voided_on','voided_by','void_reason','void_request_id','void_request_payload','updated_at']) then raise exception 'plan_payment_immutable'; end if;
     if old.voided_at is not null or new.voided_at is null or new.void_request_id is null or nullif(btrim(new.void_reason),'') is null then raise exception 'invalid_payment_void'; end if;
     if new.paid_at>debt_private.business_date(d.business_id) then raise exception 'void_before_payment'; end if;
     new.voided_at:=now(); new.voided_on:=debt_private.business_date(d.business_id); new.voided_by:=debt_private.actor_id();
     new.void_reason:=btrim(new.void_reason);
     payload:=jsonb_build_object('payment_id',new.id,'reason',new.void_reason);
     if new.void_request_payload is not null and new.void_request_payload is distinct from payload then raise exception 'request_payload_mismatch'; end if;
     new.void_request_payload:=payload;
   else
     if new.business_id is distinct from d.business_id or new.branch_id is distinct from d.branch_id or new.currency is distinct from d.currency then raise exception 'payment_scope_mismatch'; end if;
     if (select count(*) from public.debt_payments where debt_id=d.id)>=100000 then raise exception 'payment_history_limit'; end if;
     if new.request_id is null or new.voided_at is not null then raise exception 'invalid_payment_request'; end if;
     if new.allocation_rule is null or new.allocation_rule not in ('selected_installment','oldest_due') then raise exception 'allocation_rule_required'; end if;
     if new.allocation_rule='selected_installment' then
       select i.total_amount-coalesce((select sum(a.amount) from public.debt_payment_allocations a join public.debt_payments p on p.id=a.payment_id where a.installment_id=i.id and p.voided_at is null),0)
       into remaining from public.debt_installments i where i.id=new.selected_installment_id and i.debt_id=d.id;
       if not found then raise exception 'installment_not_found'; end if;
       if new.amount>remaining then raise exception 'amount_exceeds_installment_pending'; end if;
     elsif new.selected_installment_id is not null then raise exception 'invalid_allocation_choice'; end if;
     new.created_by:=debt_private.actor_id();
     new.payment_method:=btrim(new.payment_method); new.reference:=nullif(btrim(new.reference),''); new.notes:=nullif(btrim(new.notes),'');
     choice:=case when new.allocation_rule='oldest_due' then jsonb_build_object('rule','oldest_due') else jsonb_build_object('rule','selected_installment','installmentId',new.selected_installment_id) end;
     payload:=coalesce(new.request_payload,jsonb_strip_nulls(jsonb_build_object('amountCents',new.amount*100,'paidAt',new.paid_at,'paymentMethod',new.payment_method,
       'origin',new.origin,'reference',new.reference,'notes',new.notes,'allocation',choice)));
     perform debt_private.keys(payload,array['amountCents','paidAt','paymentMethod','origin','reference','notes','allocation']);
     foreach key in array array['paidAt','paymentMethod','origin','reference','notes'] loop
       if payload->key is not null and payload->key<>'null'::jsonb and jsonb_typeof(payload->key)<>'string' then raise exception 'invalid_payment_metadata'; end if;
     end loop;
     if debt_private.cents(payload->'amountCents')<>new.amount*100 or debt_private.civil_date(payload->>'paidAt') is distinct from new.paid_at
       or btrim(payload->>'paymentMethod') is distinct from new.payment_method or payload->>'origin' is distinct from new.origin
       or nullif(btrim(payload->>'reference'),'') is distinct from new.reference or nullif(btrim(payload->>'notes'),'') is distinct from new.notes
       or payload->'allocation' is distinct from choice then raise exception 'request_payload_mismatch'; end if;
     new.request_payload:=payload; new.created_at:=now();

   end if;
   if new.origin is null or new.origin not in ('manual','whatsapp','purchase','invoice','api','system')
     or nullif(btrim(new.payment_method),'') is null or length(new.payment_method)>80 or length(new.reference)>200 or length(new.notes)>1000
     or new.paid_at is null or new.paid_at<date '0001-01-01' or new.paid_at>debt_private.business_date(d.business_id) then raise exception 'invalid_payment_metadata'; end if;
 else
   if new.allocation_rule is not null or new.voided_at is not null then raise exception 'plan_required'; end if;
   new.business_id:=d.business_id; new.branch_id:=d.branch_id;
   if tg_op='INSERT' and auth.uid() is not null then new.created_by:=debt_private.actor_id(); end if;
 end if;
 select coalesce(sum(amount),0) into paid from public.debt_payments where debt_id=d.id and id<>new.id and voided_at is null;
 if paid+(case when new.voided_at is null then new.amount else 0 end)>coalesce(d.total_financed_amount,d.original_amount) then raise exception 'amount_exceeds_pending' using errcode='23514'; end if;
 return new;
end $$;
drop trigger trg_debt_payments_balance on public.debt_payments;
create trigger trg_debt_payments_balance before insert or update or delete on public.debt_payments for each row execute function public.enforce_debt_payment_balance();

create function debt_private.guard_allocation() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op<>'INSERT' or pg_trigger_depth()<2 then raise exception 'allocations_immutable'; end if;
 return new;
end $$;
create trigger allocation_guard before insert or update or delete on public.debt_payment_allocations for each row execute function debt_private.guard_allocation();
create function debt_private.allocate_payment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare i record; remaining numeric:=new.amount; allocated numeric;
begin
 if new.allocation_rule is null then return new; end if;
 -- The BEFORE payment trigger already holds the parent lock.
 for i in select x.*,x.total_amount-coalesce((select sum(a.amount) from public.debt_payment_allocations a join public.debt_payments p on p.id=a.payment_id where a.installment_id=x.id and p.voided_at is null),0) as balance
   from public.debt_installments x where x.debt_id=new.debt_id and (new.allocation_rule='oldest_due' or x.id=new.selected_installment_id)
   order by x.due_date nulls last,x.installment_number loop
   allocated:=least(remaining,i.balance);
   if allocated>0 then
     insert into public.debt_payment_allocations(business_id,branch_id,debt_id,payment_id,installment_id,amount)
     values(new.business_id,new.branch_id,new.debt_id,new.id,i.id,allocated);
     remaining:=remaining-allocated;
   end if;
   exit when remaining=0;
 end loop;
 if remaining<>0 then raise exception 'allocation_total_mismatch'; end if;
 return new;
end $$;
create trigger debt_payment_allocate after insert on public.debt_payments for each row execute function debt_private.allocate_payment();

create or replace function public.recalc_debt_after_payment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; paid numeric;
begin
 select * into d from public.debts where id=coalesce(new.debt_id,old.debt_id) for update;
 if not found then return coalesce(new,old); end if;
 select coalesce(sum(amount),0) into paid from public.debt_payments where debt_id=d.id and voided_at is null;
 update public.debts set pending_amount=coalesce(d.total_financed_amount,d.original_amount)-paid,
   status=case when coalesce(d.total_financed_amount,d.original_amount)=paid then 'settled'::public.debt_status when d.due_date<current_date then 'overdue'::public.debt_status else 'active'::public.debt_status end,
   settled_at=case when coalesce(d.total_financed_amount,d.original_amount)=paid then coalesce(d.settled_at,current_date) else null end where id=d.id;
 return coalesce(new,old);
end $$;

-- This non-exposed audit trigger is privileged; write RPCs never bypass RLS.
-- EXECUTE is revoked even from authenticated; it cannot be called as an RPC.
-- The separate private read helper exposes only an authorized scope boolean.
create function debt_private.audit_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare d public.debts%rowtype; actor public.profiles%rowtype; actor_id uuid; role_name text; action_name text; row_data jsonb; log_id uuid;
 is_service boolean:=current_setting('role',true)='service_role' or session_user='service_role';
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='debts' then d:=case when tg_op='DELETE' then old else new end; else select * into d from public.debts where id=(row_data->>'debt_id')::uuid; end if;
 if d.id is null then return coalesce(new,old); end if;
 -- A legacy business-wide cascade also removes its activity feed. There is no
 -- remaining business FK under which a new child audit row could be stored.
 if tg_op='DELETE' and not exists(select 1 from public.businesses where id=d.business_id) then return coalesce(new,old); end if;
 actor_id:=debt_private.actor_id();
 -- INSERT created_by can be an explicit server-supplied creation actor. It is
 -- never evidence of who performed a later UPDATE/DELETE. Background service
 -- work with no bound actor is honestly system/NULL, including overdue cron.
 if actor_id is null and is_service and tg_op='INSERT' then actor_id:=(row_data->>'created_by')::uuid; end if;
 if actor_id is null and is_service then
   role_name:='system';
 else
   select * into actor from public.profiles where id=actor_id and active;
   select role::text into role_name from public.business_members where business_id=d.business_id and user_id=actor_id;
   if actor.id is null or role_name is null or role_name not in ('owner','admin','manager') then raise exception 'audit_actor_forbidden'; end if;
 end if;
 if tg_table_name='debts' then
   if tg_op='UPDATE' and (to_jsonb(new)-array['updated_at','plan_version']) is not distinct from (to_jsonb(old)-array['updated_at','plan_version']) then return new; end if;
   action_name:=case when tg_op='DELETE' then 'debt.deleted' when tg_op='INSERT' then case when d.plan_definition is null then 'debt.created' else 'debt.plan.created' end
     when new.status='settled' and old.status<>'settled' then 'debt.closed' when old.status='settled' and new.status<>'settled' then 'debt.reopened'
     when new.due_date is distinct from old.due_date then 'debt.due_date.updated' when new.notes is distinct from old.notes then 'debt.notes.updated' else 'debt.updated' end;
 elsif tg_table_name='debt_installments' then action_name:='debt.installment.updated';
 else action_name:=case when tg_op='INSERT' then 'debt.payment.registered' when tg_op='DELETE' then 'debt.payment.deleted'
     when new.voided_at is not null then 'debt.payment.voided' else 'debt.payment.updated' end;
 end if;
 if tg_op='UPDATE' and tg_table_name in ('debts','debt_installments') then
   if new.mutation_request_id is not null and new.mutation_request_id is distinct from old.mutation_request_id then
     if actor.id is null then raise exception 'audit_actor_required_for_request'; end if;
     insert into public.debt_plan_mutations(debt_id,business_id,branch_id,request_id,actor_id,operation,payload,result)
     values(d.id,d.business_id,d.branch_id,new.mutation_request_id,actor.id,
       case when tg_table_name='debts' then 'debt.notes' else 'installment.edit' end,
       case when tg_table_name='debts' then jsonb_build_object('notes',new.notes)
         else jsonb_build_object('installment_id',new.id,'due_date',new.due_date,'notes',new.notes) end,
       jsonb_build_object('ok',true,'debt_id',d.id,'version',d.plan_version,'pending_amount',d.pending_amount,
         'installment_id',case when tg_table_name='debt_installments' then new.id else null end));
   end if;
 end if;
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 values(d.business_id,actor.id,case when role_name='system' then 'Sistema' else actor.full_name end,role_name,action_name,'debts',d.id,action_name,
   jsonb_build_object('actor_kind',case when role_name='system' then 'system' else 'user' end,'debt_id',d.id,'branch_id',d.branch_id,'pending_amount',d.pending_amount,'version',d.plan_version,'status',d.status,
     'before',case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,'after',case when tg_op='DELETE' then null else to_jsonb(new) end,
     'allocations',case when tg_table_name='debt_payments' then (select jsonb_agg(to_jsonb(a)) from public.debt_payment_allocations a where a.payment_id=(row_data->>'id')::uuid) else null end,
     'related_payments',case when tg_table_name='debts' and tg_op='DELETE' then (select jsonb_agg(to_jsonb(p)) from public.debt_payments p where p.debt_id=d.id) else null end)) returning id into log_id;
 insert into debt_private.audit_scopes(activity_log_id,business_id,branch_id,debt_id) values(log_id,d.business_id,d.branch_id,d.id);
 return coalesce(new,old);
end $$;
revoke all on function debt_private.audit_change() from public,anon,authenticated,service_role;
create trigger zz_debt_plan_audit after insert or update on public.debts for each row execute function debt_private.audit_change();
create trigger zz_debt_delete_audit before delete on public.debts for each row execute function debt_private.audit_change();
create trigger zz_installment_audit after update on public.debt_installments for each row execute function debt_private.audit_change();
create trigger zz_payment_audit after insert or update or delete on public.debt_payments for each row execute function debt_private.audit_change();
-- Other trigger functions are not application APIs either.
revoke all on function debt_private.guard_debt(),debt_private.create_installments(),debt_private.guard_installment(),debt_private.refresh_installment_debt(),debt_private.guard_allocation(),debt_private.allocate_payment() from public,anon,authenticated,service_role;

create function public.create_debt_installment_plan(p_plan jsonb,p_idempotency_key uuid,p_actor_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; b uuid; branch uuid; p jsonb;
begin
 perform debt_private.set_actor(p_actor_id);
 perform debt_private.keys(p_plan,array['business_id','branch_id','creditor','creditor_type','concept','taken_at','category','reference','notes','origin','expected_payment_method','plan']);
 b:=(p_plan->>'business_id')::uuid; branch:=(p_plan->>'branch_id')::uuid;
 if p_idempotency_key is null or b is null or branch is null then raise exception 'invalid_arguments'; end if;
 if not debt_private.can_write(b,branch) then raise exception 'permission_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(b::text||':'||p_idempotency_key::text,0));
 select * into d from public.debts where business_id=b and plan_request_id=p_idempotency_key for update;
 if found then
   if d.plan_request_payload is distinct from p_plan or d.created_by is distinct from debt_private.actor_id() then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('ok',true,'debt_id',d.id,'version',d.plan_version,'pending_amount',d.pending_amount,'idempotent',true);
 end if;
 if nullif(btrim(p_plan->>'creditor'),'') is null or length(p_plan->>'creditor')>200
 or length(p_plan->>'concept')>1000 or length(p_plan->>'notes')>1000 or length(p_plan->>'reference')>200
 or length(p_plan->>'category')>120 or length(p_plan->>'expected_payment_method')>80
 or p_plan->>'origin' is null or p_plan->>'origin' not in ('manual','whatsapp','purchase','invoice','api','system') then raise exception 'invalid_debt_metadata'; end if;
 p:=p_plan->'plan'; perform debt_private.validate_plan(p);
 insert into public.debts(business_id,branch_id,creditor,creditor_type,concept,taken_at,category,reference,notes,origin,expected_payment_method,
   original_amount,pending_amount,plan_definition,plan_request_id,plan_request_payload,created_by)
 values(b,branch,btrim(p_plan->>'creditor'),p_plan->>'creditor_type',nullif(btrim(p_plan->>'concept'),''),debt_private.civil_date(p_plan->>'taken_at'),
   nullif(btrim(p_plan->>'category'),'')::public.debt_category,nullif(btrim(p_plan->>'reference'),''),nullif(btrim(p_plan->>'notes'),''),p_plan->>'origin',
   nullif(btrim(p_plan->>'expected_payment_method'),''),0,0,p,p_idempotency_key,p_plan,debt_private.actor_id()) returning * into d;
 return jsonb_build_object('ok',true,'debt_id',d.id,'version',d.plan_version,'pending_amount',d.pending_amount);
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;

create function public.register_debt_plan_payment(p_debt_id uuid,p_expected_version bigint,p_payment jsonb,p_idempotency_key uuid,p_actor_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; pay public.debt_payments%rowtype; amount numeric; choice jsonb;
begin
 perform debt_private.set_actor(p_actor_id);
 if p_debt_id is null or p_idempotency_key is null or p_expected_version is null then raise exception 'invalid_arguments'; end if;
 select * into d from public.debts where id=p_debt_id for update;
 if not found then raise exception 'debt_not_found'; end if;
 if d.plan_definition is null then raise exception 'plan_required'; end if;
 if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
 select * into pay from public.debt_payments where debt_id=d.id and request_id=p_idempotency_key;
 if found then
   if pay.request_payload is distinct from p_payment or pay.created_by is distinct from debt_private.actor_id() then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('ok',true,'debt_id',d.id,'payment_id',pay.id,'version',d.plan_version,'pending_amount',d.pending_amount,'idempotent',true);
 end if;
 if d.plan_version<>p_expected_version then raise exception 'stale_version'; end if;
 perform debt_private.keys(p_payment,array['amountCents','paidAt','paymentMethod','origin','reference','notes','allocation']);
 amount:=debt_private.cents(p_payment->'amountCents')/100;
 choice:=p_payment->'allocation'; perform debt_private.keys(choice,array['rule','installmentId']);
 if choice->>'rule' is null or choice->>'rule' not in ('selected_installment','oldest_due') then raise exception 'allocation_rule_required'; end if;
 if choice->>'rule'='oldest_due' and choice ? 'installmentId' then raise exception 'invalid_allocation_choice'; end if;
 insert into public.debt_payments(debt_id,business_id,branch_id,currency,amount,paid_at,payment_method,origin,reference,notes,
   allocation_rule,selected_installment_id,request_id,request_payload,created_by)
 values(d.id,d.business_id,d.branch_id,d.currency,amount,debt_private.civil_date(p_payment->>'paidAt'),btrim(p_payment->>'paymentMethod'),p_payment->>'origin',
   nullif(btrim(p_payment->>'reference'),''),nullif(btrim(p_payment->>'notes'),''),choice->>'rule',(choice->>'installmentId')::uuid,p_idempotency_key,p_payment,debt_private.actor_id()) returning * into pay;
 select * into d from public.debts where id=p_debt_id;
 return jsonb_build_object('ok',true,'debt_id',d.id,'payment_id',pay.id,'version',d.plan_version,'pending_amount',d.pending_amount);
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;

create function public.void_debt_plan_payment(p_debt_id uuid,p_payment_id uuid,p_expected_version bigint,p_reason text,p_idempotency_key uuid,p_actor_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; pay public.debt_payments%rowtype; payload jsonb;
begin
 perform debt_private.set_actor(p_actor_id);
 if p_debt_id is null or p_payment_id is null or p_idempotency_key is null or p_expected_version is null or nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'invalid_arguments'; end if;
 select * into d from public.debts where id=p_debt_id for update;
 if not found then raise exception 'debt_not_found'; end if;
 if d.plan_definition is null then raise exception 'plan_required'; end if;
 if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
 payload:=jsonb_build_object('payment_id',p_payment_id,'reason',btrim(p_reason));
 select * into pay from public.debt_payments where debt_id=d.id and void_request_id=p_idempotency_key;
 if found then
   if pay.void_request_payload is distinct from payload or pay.voided_by is distinct from debt_private.actor_id() then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('ok',true,'debt_id',d.id,'payment_id',pay.id,'version',d.plan_version,'pending_amount',d.pending_amount,'idempotent',true);
 end if;
 if d.plan_version<>p_expected_version then raise exception 'stale_version'; end if;
 select * into pay from public.debt_payments where id=p_payment_id and debt_id=d.id for update;
 if not found then raise exception 'payment_not_found'; end if;
 if pay.voided_at is not null then raise exception 'payment_already_voided'; end if;
 update public.debt_payments set voided_at=now(),voided_by=debt_private.actor_id(),void_reason=btrim(p_reason),void_request_id=p_idempotency_key,void_request_payload=payload where id=pay.id;
 select * into d from public.debts where id=p_debt_id;
 return jsonb_build_object('ok',true,'debt_id',d.id,'payment_id',pay.id,'version',d.plan_version,'pending_amount',d.pending_amount);
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;
revoke all on function public.create_debt_installment_plan(jsonb,uuid,uuid),public.register_debt_plan_payment(uuid,bigint,jsonb,uuid,uuid),public.void_debt_plan_payment(uuid,uuid,bigint,text,uuid,uuid) from public,anon;
grant execute on function public.create_debt_installment_plan(jsonb,uuid,uuid),public.register_debt_plan_payment(uuid,bigint,jsonb,uuid,uuid),public.void_debt_plan_payment(uuid,uuid,bigint,text,uuid,uuid) to authenticated,service_role;

-- Keep legacy debt APIs; planned debts require explicit allocation.
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

  if not found or v_member.role not in ('owner', 'admin', 'manager') or not exists(select 1 from public.profiles where id=v_actor_id and active) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  perform set_config('debt.actor_id',v_actor_id::text,true);

  select debt.* into v_debt
  from public.debts debt
  where debt.id = p_debt_id
    and debt.business_id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'debt_not_found');
  end if;
  if v_debt.plan_definition is not null then
    return jsonb_build_object('ok', false, 'error', 'allocation_rule_required');
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

  perform set_config('debt.actor_id',v_actor_id::text,true);

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

-- Keep legacy debt APIs; planned debts require explicit allocation.
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

  if not found or v_member.role not in ('owner', 'admin', 'manager') or not exists(select 1 from public.profiles where id=v_actor_id and active) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  perform set_config('debt.actor_id',v_actor_id::text,true);

  select debt.* into v_debt
  from public.debts debt
  where debt.id = p_debt_id
    and debt.business_id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'debt_not_found');
  end if;
  if v_debt.plan_definition is not null then
    return jsonb_build_object('ok', false, 'error', 'allocation_rule_required');
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

-- Both modern debt targets and legacy payment targets are financial audit.
-- Deleted targets require a private trigger-produced scope receipt; raw JSON
-- branch/debt IDs cannot turn a missing parent into a business-shared record.
drop policy "activity_logs read" on public.activity_logs;
create policy "activity_logs read" on public.activity_logs for select to authenticated using (
 public.is_member_of_business(business_id) and (
   target_type is null or target_type not in ('debts','debt_payments') or (
     exists(select 1 from public.profiles where id=auth.uid() and active) and coalesce(
       debt_private.can_read_audit_scope(id,business_id),
       (target_type='debts' and exists (
         select 1 from public.debts d where d.id=target_id and d.business_id=activity_logs.business_id
           and (data->>'debt_id' is null or data->>'debt_id'=d.id::text)
           and (data->>'branch_id' is null or data->>'branch_id'=d.branch_id::text)
           and public.can_access_business_branch(d.business_id,d.branch_id)))
       or (target_type='debt_payments' and exists (
         select 1 from public.debt_payments p join public.debts d on d.id=p.debt_id
         where p.id=target_id and d.business_id=activity_logs.business_id
           and (data->>'payment_id' is null or data->>'payment_id'=p.id::text)
           and (data->>'business_id' is null or data->>'business_id'=d.business_id::text)
           and (data->>'debt_id' is null or data->>'debt_id'=d.id::text)
           and (data->>'branch_id' is null or data->>'branch_id'=d.branch_id::text)
           and public.can_access_business_branch(d.business_id,d.branch_id)))
     )
   )
 )
);

create function public.edit_debt_installment(
 p_debt_id uuid,p_installment_id uuid,p_expected_version bigint,p_due_date date,p_notes text,p_idempotency_key uuid,p_actor_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; receipt public.debt_plan_mutations%rowtype; payload jsonb;
begin
 perform debt_private.set_actor(p_actor_id);
 if p_debt_id is null or p_installment_id is null or p_expected_version is null or p_idempotency_key is null or length(p_notes)>1000 then raise exception 'invalid_arguments'; end if;
 select * into d from public.debts where id=p_debt_id for update;
 if not found then raise exception 'debt_not_found'; end if;
 if d.plan_definition is null then raise exception 'plan_required'; end if;
 if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied'; end if;
 payload:=jsonb_build_object('installment_id',p_installment_id,'due_date',p_due_date,'notes',nullif(btrim(p_notes),''));
 select * into receipt from public.debt_plan_mutations where debt_id=d.id and request_id=p_idempotency_key;
 if found then
   if receipt.operation<>'installment.edit' or receipt.payload is distinct from payload or receipt.actor_id<>debt_private.actor_id() then raise exception 'idempotency_conflict'; end if;
   return receipt.result||jsonb_build_object('idempotent',true,'version',d.plan_version,'pending_amount',d.pending_amount);
 end if;
 if d.plan_version<>p_expected_version then raise exception 'stale_version'; end if;
 update public.debt_installments set due_date=p_due_date,notes=nullif(btrim(p_notes),''),mutation_request_id=p_idempotency_key where id=p_installment_id and debt_id=d.id;
 if not found then raise exception 'installment_not_found'; end if;
 select * into receipt from public.debt_plan_mutations where debt_id=d.id and request_id=p_idempotency_key;
 if not found then raise exception 'mutation_audit_missing'; end if;
 return receipt.result;
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;

create function public.update_debt_plan_notes(
 p_debt_id uuid,p_expected_version bigint,p_notes text,p_idempotency_key uuid,p_actor_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; receipt public.debt_plan_mutations%rowtype; payload jsonb;
begin
 perform debt_private.set_actor(p_actor_id);
 if p_debt_id is null or p_expected_version is null or p_idempotency_key is null or length(p_notes)>1000 then raise exception 'invalid_arguments'; end if;
 select * into d from public.debts where id=p_debt_id for update;
 if not found then raise exception 'debt_not_found'; end if;
 if d.plan_definition is null then raise exception 'plan_required'; end if;
 if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied'; end if;
 payload:=jsonb_build_object('notes',nullif(btrim(p_notes),''));
 select * into receipt from public.debt_plan_mutations where debt_id=d.id and request_id=p_idempotency_key;
 if found then
   if receipt.operation<>'debt.notes' or receipt.payload is distinct from payload or receipt.actor_id<>debt_private.actor_id() then raise exception 'idempotency_conflict'; end if;
   return receipt.result||jsonb_build_object('idempotent',true,'version',d.plan_version,'pending_amount',d.pending_amount);
 end if;
 if d.plan_version<>p_expected_version then raise exception 'stale_version'; end if;
 update public.debts set notes=nullif(btrim(p_notes),''),mutation_request_id=p_idempotency_key where id=d.id;
 select * into receipt from public.debt_plan_mutations where debt_id=d.id and request_id=p_idempotency_key;
 if not found then raise exception 'mutation_audit_missing'; end if;
 return receipt.result;
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;
revoke all on function public.edit_debt_installment(uuid,uuid,bigint,date,text,uuid,uuid),public.update_debt_plan_notes(uuid,bigint,text,uuid,uuid) from public,anon;
grant execute on function public.edit_debt_installment(uuid,uuid,bigint,date,text,uuid,uuid),public.update_debt_plan_notes(uuid,bigint,text,uuid,uuid) to authenticated,service_role;

-- A read-only recovery lookup never treats absence as proof that an in-flight
-- operation rolled back. It only reveals committed receipts belonging to actor.
create function public.get_debt_operation_result(
 p_operation text,p_idempotency_key uuid,p_debt_id uuid default null,p_actor_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; ids uuid[]; debt_id uuid; payment_id uuid; d public.debts%rowtype;
begin
 actor:=debt_private.set_actor(p_actor_id);
 if p_idempotency_key is null or p_operation is null or p_operation not in ('create','pay','void','edit_installment','edit_notes')
   or (p_operation<>'create' and p_debt_id is null) then raise exception 'invalid_arguments'; end if;
 if p_operation='create' then
   select array_agg(x.id) into ids from (select id from public.debts where plan_request_id=p_idempotency_key and created_by=actor
     and (p_debt_id is null or id=p_debt_id) limit 2) x;
   if cardinality(ids)>1 then raise exception 'ambiguous_request'; end if;
   debt_id:=ids[1];
 elsif p_operation='pay' then
   select p.debt_id,p.id into debt_id,payment_id from public.debt_payments p where p.debt_id=p_debt_id and p.request_id=p_idempotency_key and p.created_by=actor;
 elsif p_operation='void' then
   select p.debt_id,p.id into debt_id,payment_id from public.debt_payments p where p.debt_id=p_debt_id and p.void_request_id=p_idempotency_key and p.voided_by=actor;
 else
   select m.debt_id into debt_id from public.debt_plan_mutations m where m.debt_id=p_debt_id and m.request_id=p_idempotency_key and m.actor_id=actor
     and m.operation=case when p_operation='edit_installment' then 'installment.edit' else 'debt.notes' end;
 end if;
 if debt_id is null then return jsonb_build_object('ok',true,'found',false); end if;
 select * into d from public.debts where id=debt_id;
 if not found then return jsonb_build_object('ok',true,'found',false); end if;
 -- RLS already scopes authenticated reads; explicitly mirror it for the verified
 -- server actor because service_role bypasses table RLS by design.
 if not exists(select 1 from public.business_members m where m.business_id=d.business_id and m.user_id=actor
   and (m.role in ('owner','admin','manager','accountant') or exists (
     select 1 from public.branch_assignments a join public.branches b on b.id=a.branch_id
     where a.business_member_id=m.id and b.business_id=d.business_id and (d.branch_id is null or b.id=d.branch_id)))) then
   return jsonb_build_object('ok',true,'found',false);
 end if;
 return jsonb_strip_nulls(jsonb_build_object('ok',true,'found',true,'debt_id',d.id,'version',d.plan_version,'pending_amount',d.pending_amount,'payment_id',payment_id));
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;
revoke all on function public.get_debt_operation_result(text,uuid,uuid,uuid) from public,anon;
grant execute on function public.get_debt_operation_result(text,uuid,uuid,uuid) to authenticated,service_role;
