-- Isolated payment verification rehearsal. No RPC below changes a plan or grants real AI credits.
create table public.ai_billing_orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  actor_id uuid not null references public.profiles(id),
  request_id uuid not null,
  mode text not null default 'sandbox' check(mode='sandbox'),
  product_code text not null,
  title text not null,
  credit_amount integer not null check(credit_amount>0),
  amount_minor bigint not null check(amount_minor between 100 and 100000000),
  currency text not null default 'ARS' check(currency='ARS'),
  collector_id text not null check(collector_id ~ '^[1-9][0-9]{0,29}$'),
  status text not null default 'creating' check(status in ('creating','ready','provider_error','pending','approved','rejected','cancelled','refunded','charged_back','review')),
  preference_id text unique,
  checkout_url text,
  approved_payment_id text unique,
  expires_at timestamptz not null default now()+interval '1 hour',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(business_id,request_id)
);
create index ai_billing_orders_business_created on public.ai_billing_orders(business_id,created_at desc);
create table public.ai_billing_payments (
  payment_id text primary key check(payment_id ~ '^[1-9][0-9]{0,29}$'),
  order_id uuid not null references public.ai_billing_orders(id),
  status text not null,
  refunded_minor bigint not null check(refunded_minor>=0),
  provider_updated_at timestamptz not null,
  verified_at timestamptz not null default now()
);
alter table public.ai_billing_orders enable row level security;
alter table public.ai_billing_payments enable row level security;
revoke all on public.ai_billing_orders,public.ai_billing_payments from public,anon,authenticated;
grant all on public.ai_billing_orders,public.ai_billing_payments to service_role;

create function public.ai_billing_create_sandbox_order(
  p_business_id uuid,p_actor_id uuid,p_request_id uuid,p_product_code text,p_amount_minor bigint,p_collector_id text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.ai_billing_orders%rowtype; v_title text; v_credits integer; v_count integer;
begin
  if p_request_id is null or p_amount_minor is null or p_amount_minor not between 100 and 100000000
    or p_collector_id is null or p_collector_id !~ '^[1-9][0-9]{0,29}$' then raise exception 'billing_invalid_order'; end if;
  if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=p_business_id and m.user_id=p_actor_id and m.role in ('owner','admin') and p.active=true)
    then raise exception 'billing_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-billing:'||p_business_id::text,0));
  select * into v_order from public.ai_billing_orders where business_id=p_business_id and request_id=p_request_id;
  if found then
    if v_order.product_code<>p_product_code or v_order.amount_minor<>p_amount_minor or v_order.collector_id<>p_collector_id
      then raise exception 'billing_request_conflict'; end if;
    return jsonb_build_object('created',false,'order',to_jsonb(v_order));
  end if;
  select count(*) into v_count from public.ai_billing_orders where business_id=p_business_id and created_at>now()-interval '1 hour';
  if v_count>=10 then raise exception 'billing_rate_limited'; end if;
  select name,monthly_credits into v_title,v_credits from public.ai_plan_catalog
    where code=p_product_code and active=true and price_usd_cents>0;
  if not found then
    select name,credits into v_title,v_credits from public.ai_credit_packs where code=p_product_code and active=true;
  end if;
  if v_title is null or v_credits is null or v_credits<=0 then raise exception 'billing_invalid_product'; end if;
  insert into public.ai_billing_orders(business_id,actor_id,request_id,product_code,title,credit_amount,amount_minor,collector_id)
    values(p_business_id,p_actor_id,p_request_id,p_product_code,v_title,v_credits,p_amount_minor,p_collector_id) returning * into v_order;
  return jsonb_build_object('created',true,'order',to_jsonb(v_order));
end;
$$;
create function public.ai_billing_attach_sandbox_preference(
  p_business_id uuid,p_actor_id uuid,p_order_id uuid,p_preference_id text,p_checkout_url text
) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=p_business_id and m.user_id=p_actor_id and m.role in ('owner','admin') and p.active=true)
    then raise exception 'billing_forbidden'; end if;
  if p_preference_id is null or p_preference_id !~ '^[a-zA-Z0-9-]{1,160}$'
    or p_checkout_url is null or p_checkout_url not like 'https://sandbox.mercadopago.com.ar/checkout/v1/redirect?%'
    then raise exception 'billing_invalid_preference'; end if;
  update public.ai_billing_orders set preference_id=p_preference_id,checkout_url=p_checkout_url,status='ready',updated_at=now()
    where id=p_order_id and business_id=p_business_id and actor_id=p_actor_id and status='creating' and preference_id is null and expires_at>now();
  return found;
end;
$$;
create function public.ai_billing_record_sandbox_payment(
  p_order_id uuid,p_payment_id text,p_collector_id text,p_amount_minor bigint,p_currency text,
  p_status text,p_updated_at timestamptz,p_live_mode boolean,p_refunded_minor bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.ai_billing_orders%rowtype; v_previous public.ai_billing_payments%rowtype; v_status text;
begin
  if p_live_mode is distinct from false or p_payment_id is null or p_payment_id !~ '^[1-9][0-9]{0,29}$'
    or p_status is null or p_status not in ('pending','in_process','authorized','approved','rejected','cancelled','refunded','charged_back','in_mediation')
    or p_updated_at is null or not isfinite(p_updated_at) or p_updated_at>now()+interval '10 minutes'
    or p_refunded_minor is null or p_refunded_minor<0 then raise exception 'billing_invalid_payment'; end if;
  -- Provider-ID lock also serializes attempts to attach one payment to two orders/businesses.
  perform pg_advisory_xact_lock(hashtextextended('mp-payment:'||p_payment_id,0));
  select * into v_order from public.ai_billing_orders where id=p_order_id for update;
  if not found or p_collector_id is distinct from v_order.collector_id or p_amount_minor is distinct from v_order.amount_minor
    or p_currency is distinct from v_order.currency or p_refunded_minor>v_order.amount_minor then raise exception 'billing_payment_mismatch'; end if;
  select * into v_previous from public.ai_billing_payments where payment_id=p_payment_id;
  if found then
    if v_previous.order_id<>p_order_id then raise exception 'billing_payment_mismatch'; end if;
    if p_updated_at<v_previous.provider_updated_at then return jsonb_build_object('recorded',false,'stale',true); end if;
    if p_updated_at=v_previous.provider_updated_at then
      if p_status<>v_previous.status or p_refunded_minor<>v_previous.refunded_minor then raise exception 'billing_payment_conflict'; end if;
      return jsonb_build_object('recorded',false,'idempotent',true);
    end if;
    if p_refunded_minor<v_previous.refunded_minor then raise exception 'billing_refund_regression'; end if;
    if v_previous.status in ('refunded','charged_back') and p_status<>v_previous.status then raise exception 'billing_terminal_payment'; end if;
  end if;
  insert into public.ai_billing_payments(payment_id,order_id,status,refunded_minor,provider_updated_at)
    values(p_payment_id,p_order_id,p_status,p_refunded_minor,p_updated_at)
    on conflict(payment_id) do update set status=excluded.status,refunded_minor=excluded.refunded_minor,provider_updated_at=excluded.provider_updated_at,verified_at=now();
  v_status := v_order.status;
  if p_status='approved' and p_refunded_minor=0 then
    if v_order.approved_payment_id is not null and v_order.approved_payment_id<>p_payment_id then v_status:='review';
    elsif v_status<>'review' then v_status:='approved'; end if;
    update public.ai_billing_orders set approved_payment_id=coalesce(approved_payment_id,p_payment_id) where id=p_order_id;
  elsif v_order.approved_payment_id=p_payment_id or v_order.approved_payment_id is null then
    v_status := case when p_status='charged_back' then 'charged_back'
      when p_status='refunded' or p_refunded_minor=v_order.amount_minor then 'refunded'
      when p_refunded_minor>0 or p_status='in_mediation' then 'review'
      when p_status in ('cancelled','rejected') then p_status else 'pending' end;
  end if;
  if v_order.status='review' then v_status:='review'; end if;
  update public.ai_billing_orders set status=v_status,updated_at=now() where id=p_order_id;
  -- Deliberately NO writes to ai_business_plans or ai_business_credit_grants.
  return jsonb_build_object('recorded',true,'sandbox',true,'status',v_status,'credits_activated',false);
end;
$$;
revoke all on function public.ai_billing_create_sandbox_order(uuid,uuid,uuid,text,bigint,text),
  public.ai_billing_attach_sandbox_preference(uuid,uuid,uuid,text,text),
  public.ai_billing_record_sandbox_payment(uuid,text,text,bigint,text,text,timestamptz,boolean,bigint) from public,anon,authenticated;
grant execute on function public.ai_billing_create_sandbox_order(uuid,uuid,uuid,text,bigint,text),
  public.ai_billing_attach_sandbox_preference(uuid,uuid,uuid,text,text),
  public.ai_billing_record_sandbox_payment(uuid,text,text,bigint,text,text,timestamptz,boolean,bigint) to service_role;
