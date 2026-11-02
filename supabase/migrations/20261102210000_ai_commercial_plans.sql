-- Commercial AI plans for GastroPilot.
-- Customer-visible balance is expressed in GastroPilot credits.
-- Raw provider cost remains internal and is not exposed through authenticated RLS.

create table if not exists public.ai_plan_catalog (
  code text primary key,
  name text not null,
  price_usd_cents integer not null check (price_usd_cents >= 0),
  monthly_credits integer not null check (monthly_credits >= 0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ai_plan_catalog (code,name,price_usd_cents,monthly_credits,active,sort_order)
values
  ('free','Sin IA',0,0,true,0),
  ('starter','Starter',1000,5000,true,10),
  ('growth','Growth',2500,15000,true,20),
  ('pro','Pro',4900,35000,true,30),
  ('business','Business',9900,80000,true,40)
on conflict (code) do update
set name=excluded.name,
    price_usd_cents=excluded.price_usd_cents,
    monthly_credits=excluded.monthly_credits,
    active=excluded.active,
    sort_order=excluded.sort_order,
    updated_at=now();

create table if not exists public.ai_credit_packs (
  code text primary key,
  name text not null,
  price_usd_cents integer not null check (price_usd_cents > 0),
  credits integer not null check (credits > 0),
  validity_days integer not null default 90 check (validity_days between 1 and 3650),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ai_credit_packs (code,name,price_usd_cents,credits,validity_days,active,sort_order)
values
  ('pack_5k','Pack 5K',1000,5000,90,true,10),
  ('pack_15k','Pack 15K',2500,15000,90,true,20),
  ('pack_40k','Pack 40K',5000,40000,90,true,30)
on conflict (code) do update
set name=excluded.name,
    price_usd_cents=excluded.price_usd_cents,
    credits=excluded.credits,
    validity_days=excluded.validity_days,
    active=excluded.active,
    sort_order=excluded.sort_order,
    updated_at=now();

create table if not exists public.ai_business_credit_grants (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source_type text not null check (source_type in ('pack','manual','promotion')),
  source_code text,
  credits integer not null check (credits > 0),
  consumed_credits integer not null default 0 check (consumed_credits >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (consumed_credits <= credits)
);

create index if not exists ai_business_credit_grants_business_expiry_idx
  on public.ai_business_credit_grants (business_id, expires_at, created_at);

alter table public.ai_plan_catalog enable row level security;
alter table public.ai_credit_packs enable row level security;
alter table public.ai_business_credit_grants enable row level security;

drop policy if exists "ai plan catalog readable" on public.ai_plan_catalog;
create policy "ai plan catalog readable"
on public.ai_plan_catalog for select
to authenticated
using (active = true);

drop policy if exists "ai credit packs readable" on public.ai_credit_packs;
create policy "ai credit packs readable"
on public.ai_credit_packs for select
to authenticated
using (active = true);

drop policy if exists "ai grants read by member" on public.ai_business_credit_grants;
create policy "ai grants read by member"
on public.ai_business_credit_grants for select
to authenticated
using (
  exists (
    select 1 from public.business_members m
    where m.business_id = ai_business_credit_grants.business_id
      and m.user_id = auth.uid()
  )
);

grant select on public.ai_plan_catalog, public.ai_credit_packs, public.ai_business_credit_grants to authenticated;
revoke insert, update, delete, truncate on public.ai_plan_catalog, public.ai_credit_packs, public.ai_business_credit_grants
  from public, anon, authenticated;

alter table public.ai_business_plans
  add column if not exists renewal_anchor_day integer not null default 1 check (renewal_anchor_day between 1 and 28),
  add column if not exists selected_at timestamptz not null default now();

update public.ai_business_plans p
set monthly_credits = c.monthly_credits
from public.ai_plan_catalog c
where p.plan_code = c.code;

-- New businesses default to no paid AI until a plan is selected/activated.
alter table public.ai_business_plans alter column plan_code set default 'free';
alter table public.ai_business_plans alter column monthly_credits set default 0;

create or replace function public.ai_business_available_credits(p_business_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (
    select monthly_credits
    from public.ai_business_plans
    where business_id = p_business_id
  ),
  monthly_used as (
    select coalesce(sum(credits),0)::bigint as used
    from public.ai_usage_events
    where business_id = p_business_id
      and reserved_at >= date_trunc('month', now())
      and status in ('reserved','completed')
  ),
  extra as (
    select coalesce(sum(credits-consumed_credits),0)::bigint as available
    from public.ai_business_credit_grants
    where business_id = p_business_id
      and (expires_at is null or expires_at > now())
  )
  select greatest(0, coalesce((select monthly_credits from plan),0) - coalesce((select used from monthly_used),0))
       + coalesce((select available from extra),0);
$$;

revoke all on function public.ai_business_available_credits(uuid) from public, anon, authenticated;
grant execute on function public.ai_business_available_credits(uuid) to service_role;


-- Customer-safe usage summary. Raw ai_usage_events includes provider token counts
-- and internal cost, therefore authenticated users must not select it directly.
revoke select on public.ai_usage_events from authenticated;

create or replace function public.get_my_ai_usage_overview()
returns table (
  business_id uuid,
  used_credits bigint,
  request_count bigint,
  latest_completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.business_id,
    coalesce(sum(e.credits) filter (where e.status in ('reserved','completed')),0)::bigint as used_credits,
    count(e.id) filter (where e.status in ('reserved','completed'))::bigint as request_count,
    max(e.completed_at) filter (where e.status = 'completed') as latest_completed_at
  from public.ai_business_plans p
  left join public.ai_usage_events e
    on e.business_id = p.business_id
   and e.reserved_at >= date_trunc('month', now())
  where exists (
    select 1
    from public.business_members m
    where m.business_id = p.business_id
      and m.user_id = auth.uid()
  )
  group by p.business_id;
$$;

revoke all on function public.get_my_ai_usage_overview() from public, anon;
grant execute on function public.get_my_ai_usage_overview() to authenticated;
