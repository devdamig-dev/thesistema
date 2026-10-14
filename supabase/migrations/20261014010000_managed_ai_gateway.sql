-- Managed AI gateway: business plans, atomic credit reservations and immutable usage ledger.
-- AI writes are server-owned. Authenticated users may only read usage for businesses they belong to.

create table if not exists public.ai_business_plans (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  plan_code text not null default 'pilot',
  monthly_credits integer not null default 5000 check (monthly_credits between 0 and 100000000),
  hard_limit boolean not null default true,
  overage_enabled boolean not null default false,
  provider text not null default 'openai' check (provider in ('openai')),
  routing_policy text not null default 'managed_auto' check (routing_policy in ('managed_auto')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ai_business_plans (business_id)
select id from public.businesses
on conflict (business_id) do nothing;

create or replace function public.ensure_ai_business_plan()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.ai_business_plans (business_id)
  values (new.id)
  on conflict (business_id) do nothing;
  return new;
end;
$$;

drop trigger if exists ensure_ai_business_plan_after_business on public.businesses;
create trigger ensure_ai_business_plan_after_business
after insert on public.businesses
for each row execute function public.ensure_ai_business_plan();

create table if not exists public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null,
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  task_type text not null check (task_type in (
    'tool_interpretation','message_extraction','invoice_extraction',
    'business_query','purchase_suggestion','recommendation','business_analysis'
  )),
  source text not null check (source in ('whatsapp','web','inbox','ocr','automation','system')),
  provider text not null default 'openai' check (provider in ('openai')),
  model text not null,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  cached_input_tokens integer not null default 0 check (cached_input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_usd_micros bigint not null default 0 check (cost_usd_micros >= 0),
  credits integer not null check (credits > 0),
  status text not null check (status in ('reserved','completed','failed','rejected','cancelled')),
  error_code text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  reserved_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (business_id, request_id)
);

create index if not exists ai_usage_events_business_month_idx
  on public.ai_usage_events (business_id, reserved_at desc);
create index if not exists ai_usage_events_business_task_idx
  on public.ai_usage_events (business_id, task_type, reserved_at desc);
create index if not exists ai_usage_events_actor_idx
  on public.ai_usage_events (actor_id, reserved_at desc)
  where actor_id is not null;

alter table public.ai_business_plans enable row level security;
alter table public.ai_usage_events enable row level security;

drop policy if exists "ai plans read by member" on public.ai_business_plans;
create policy "ai plans read by member"
on public.ai_business_plans for select
to authenticated
using (
  exists (
    select 1 from public.business_members m
    where m.business_id = ai_business_plans.business_id
      and m.user_id = auth.uid()
  )
);

drop policy if exists "ai usage read by member" on public.ai_usage_events;
create policy "ai usage read by member"
on public.ai_usage_events for select
to authenticated
using (
  exists (
    select 1 from public.business_members m
    where m.business_id = ai_usage_events.business_id
      and m.user_id = auth.uid()
  )
);

revoke insert, update, delete, truncate on public.ai_business_plans from public, anon, authenticated;
revoke insert, update, delete, truncate on public.ai_usage_events from public, anon, authenticated;
grant select on public.ai_business_plans, public.ai_usage_events to authenticated;

create or replace function public.reserve_ai_usage(
  p_business_id uuid,
  p_request_id uuid,
  p_actor_id uuid,
  p_task_type text,
  p_source text,
  p_provider text,
  p_model text,
  p_credits integer,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.ai_business_plans%rowtype;
  v_existing public.ai_usage_events%rowtype;
  v_used bigint;
  v_period_start timestamptz := date_trunc('month', now());
  v_id uuid;
begin
  if p_business_id is null or p_request_id is null or p_credits is null or p_credits <= 0
     or p_task_type not in ('tool_interpretation','message_extraction','invoice_extraction','business_query','purchase_suggestion','recommendation','business_analysis')
     or p_source not in ('whatsapp','web','inbox','ocr','automation','system')
     or p_provider <> 'openai'
     or nullif(btrim(p_model),'') is null
     or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok',false,'allowed',false,'error','invalid_ai_reservation');
  end if;

  select * into v_existing
  from public.ai_usage_events
  where business_id=p_business_id and request_id=p_request_id;
  if found then
    return jsonb_build_object(
      'ok',true,
      'allowed',v_existing.status in ('reserved','completed'),
      'usage_id',v_existing.id,
      'status',v_existing.status,
      'credits',v_existing.credits
    );
  end if;

  insert into public.ai_business_plans (business_id)
  values (p_business_id)
  on conflict (business_id) do nothing;

  select * into v_plan
  from public.ai_business_plans
  where business_id=p_business_id
  for update;

  select coalesce(sum(credits),0) into v_used
  from public.ai_usage_events
  where business_id=p_business_id
    and reserved_at >= v_period_start
    and status in ('reserved','completed');

  if v_plan.hard_limit and not v_plan.overage_enabled
     and v_used + p_credits > v_plan.monthly_credits then
    insert into public.ai_usage_events(
      request_id,business_id,actor_id,task_type,source,provider,model,credits,status,error_code,metadata
    ) values (
      p_request_id,p_business_id,p_actor_id,p_task_type,p_source,p_provider,p_model,p_credits,'rejected','quota_exceeded',coalesce(p_metadata,'{}'::jsonb)
    ) returning id into v_id;
    return jsonb_build_object(
      'ok',true,'allowed',false,'usage_id',v_id,'status','rejected',
      'error','quota_exceeded','used_credits',v_used,'monthly_credits',v_plan.monthly_credits
    );
  end if;

  insert into public.ai_usage_events(
    request_id,business_id,actor_id,task_type,source,provider,model,credits,status,metadata
  ) values (
    p_request_id,p_business_id,p_actor_id,p_task_type,p_source,p_provider,p_model,p_credits,'reserved',coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object(
    'ok',true,'allowed',true,'usage_id',v_id,'status','reserved',
    'used_credits',v_used,'monthly_credits',v_plan.monthly_credits
  );
end;
$$;

create or replace function public.finalize_ai_usage(
  p_business_id uuid,
  p_usage_id uuid,
  p_status text,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd_micros bigint,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.ai_usage_events%rowtype;
begin
  if p_status not in ('completed','failed','cancelled')
     or coalesce(p_input_tokens,-1) < 0
     or coalesce(p_cached_input_tokens,-1) < 0
     or coalesce(p_output_tokens,-1) < 0
     or coalesce(p_cost_usd_micros,-1) < 0 then
    return jsonb_build_object('ok',false,'error','invalid_ai_finalization');
  end if;

  select * into v_row
  from public.ai_usage_events
  where id=p_usage_id and business_id=p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','usage_not_found');
  end if;
  if v_row.status = 'completed' then
    return jsonb_build_object('ok',true,'status','completed','idempotent',true);
  end if;
  if v_row.status <> 'reserved' then
    return jsonb_build_object('ok',false,'error','usage_not_reservable','status',v_row.status);
  end if;

  update public.ai_usage_events
  set status=p_status,
      input_tokens=p_input_tokens,
      cached_input_tokens=least(p_cached_input_tokens,p_input_tokens),
      output_tokens=p_output_tokens,
      cost_usd_micros=p_cost_usd_micros,
      error_code=nullif(p_error_code,''),
      completed_at=now()
  where id=v_row.id;

  return jsonb_build_object('ok',true,'status',p_status);
end;
$$;

revoke all on function public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.finalize_ai_usage(uuid,uuid,text,integer,integer,integer,bigint,text)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,integer,jsonb)
  to service_role;
grant execute on function public.finalize_ai_usage(uuid,uuid,text,integer,integer,integer,bigint,text)
  to service_role;
