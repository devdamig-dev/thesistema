-- Spendable extra credits. Serialize reserve/finalize on the same business-plan row.
-- Historical reservations were monthly-only; preserve that attribution explicitly.
alter table public.ai_usage_events
  add column monthly_credits_reserved integer not null default 0;
update public.ai_usage_events set monthly_credits_reserved = credits;
alter table public.ai_usage_events add constraint ai_usage_monthly_allocation_check
  check (monthly_credits_reserved between 0 and credits);

alter table public.ai_business_credit_grants
  add column reserved_credits integer not null default 0 check (reserved_credits >= 0);
alter table public.ai_business_credit_grants add constraint ai_grant_available_check
  check (consumed_credits + reserved_credits <= credits);
create table public.ai_credit_allocations (
  usage_id uuid not null references public.ai_usage_events(id) on delete cascade,
  grant_id uuid not null references public.ai_business_credit_grants(id) on delete no action deferrable initially deferred,
  credits integer not null check (credits > 0),
  primary key (usage_id, grant_id)
);
alter table public.ai_credit_allocations enable row level security;
revoke all on public.ai_credit_allocations from public, anon, authenticated;
grant all on public.ai_credit_allocations to service_role;

create or replace function public.reserve_ai_usage(
  p_business_id uuid, p_request_id uuid, p_actor_id uuid, p_task_type text,
  p_source text, p_provider text, p_model text, p_credits integer,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_plan public.ai_business_plans%rowtype;
  v_existing public.ai_usage_events%rowtype;
  v_grant public.ai_business_credit_grants%rowtype;
  v_used bigint; v_extra bigint; v_monthly integer; v_need integer; v_take integer; v_id uuid;
  v_period timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
begin
  if p_business_id is null or p_request_id is null or p_credits is null or p_credits <= 0
    or p_credits > 100000000
    or p_task_type is null or p_task_type not in ('tool_interpretation','message_extraction','invoice_extraction','business_query','purchase_suggestion','recommendation','business_analysis')
    or p_source is null or p_source not in ('whatsapp','web','inbox','ocr','automation','system')
    or p_provider is distinct from 'openai' or nullif(btrim(p_model),'') is null
    or jsonb_typeof(coalesce(p_metadata,'{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok',false,'allowed',false,'error','invalid_ai_reservation');
  end if;
  insert into public.ai_business_plans(business_id) values(p_business_id) on conflict do nothing;
  select * into v_plan from public.ai_business_plans where business_id=p_business_id for update;
  -- Deduplication must happen AFTER acquiring the lock, including concurrent identical requests.
  select * into v_existing from public.ai_usage_events where business_id=p_business_id and request_id=p_request_id;
  if found then
    return jsonb_build_object('ok',true,'allowed',v_existing.status in ('reserved','completed'),
      'usage_id',v_existing.id,'status',v_existing.status,'credits',v_existing.credits,'existing',true,'error',v_existing.error_code);
  end if;
  select coalesce(sum(monthly_credits_reserved),0) into v_used from public.ai_usage_events
    where business_id=p_business_id and reserved_at>=v_period and status in ('reserved','completed');
  select coalesce(sum(credits-consumed_credits-reserved_credits),0) into v_extra
    from public.ai_business_credit_grants where business_id=p_business_id and (expires_at is null or expires_at>now());
  if v_plan.hard_limit and not v_plan.overage_enabled and p_credits>greatest(0,v_plan.monthly_credits-v_used)+v_extra then
    insert into public.ai_usage_events(request_id,business_id,actor_id,task_type,source,provider,model,credits,status,error_code,metadata)
      values(p_request_id,p_business_id,p_actor_id,p_task_type,p_source,p_provider,p_model,p_credits,'rejected','quota_exceeded',coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
    return jsonb_build_object('ok',true,'allowed',false,'usage_id',v_id,'status','rejected','error','quota_exceeded');
  end if;
  v_monthly := case when not v_plan.hard_limit or v_plan.overage_enabled then p_credits
    else least(p_credits,greatest(0,v_plan.monthly_credits-v_used))::integer end;
  v_need := p_credits-v_monthly;
  insert into public.ai_usage_events(request_id,business_id,actor_id,task_type,source,provider,model,credits,monthly_credits_reserved,status,metadata)
    values(p_request_id,p_business_id,p_actor_id,p_task_type,p_source,p_provider,p_model,p_credits,v_monthly,'reserved',coalesce(p_metadata,'{}'::jsonb)) returning id into v_id;
  for v_grant in select * from public.ai_business_credit_grants
    where business_id=p_business_id and (expires_at is null or expires_at>now()) and credits>consumed_credits+reserved_credits
    order by expires_at asc nulls last,created_at,id for update loop
    exit when v_need=0;
    v_take := least(v_need,v_grant.credits-v_grant.consumed_credits-v_grant.reserved_credits);
    update public.ai_business_credit_grants set reserved_credits=reserved_credits+v_take where id=v_grant.id;
    insert into public.ai_credit_allocations(usage_id,grant_id,credits) values(v_id,v_grant.id,v_take);
    v_need := v_need-v_take;
  end loop;
  if v_need<>0 then raise exception 'ai_credit_allocation_conflict'; end if;
  return jsonb_build_object('ok',true,'allowed',true,'usage_id',v_id,'status','reserved','existing',false,
    'used_credits',v_used,'monthly_credits',v_plan.monthly_credits);
end;
$$;

create or replace function public.finalize_ai_usage(
  p_business_id uuid,p_usage_id uuid,p_status text,p_input_tokens integer,
  p_cached_input_tokens integer,p_output_tokens integer,p_cost_usd_micros bigint,p_error_code text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_row public.ai_usage_events%rowtype; v_allocation record;
begin
  if p_status is null or p_status not in ('completed','failed','cancelled')
    or coalesce(p_input_tokens,-1)<0 or coalesce(p_cached_input_tokens,-1)<0
    or coalesce(p_output_tokens,-1)<0 or coalesce(p_cost_usd_micros,-1)<0 then
    return jsonb_build_object('ok',false,'error','invalid_ai_finalization');
  end if;
  perform 1 from public.ai_business_plans where business_id=p_business_id for update;
  select * into v_row from public.ai_usage_events where id=p_usage_id and business_id=p_business_id for update;
  if not found then return jsonb_build_object('ok',false,'error','usage_not_found'); end if;
  if v_row.status=p_status or v_row.status='completed' then
    return jsonb_build_object('ok',true,'status',v_row.status,'idempotent',true);
  end if;
  if v_row.status<>'reserved' then return jsonb_build_object('ok',false,'error','usage_not_reservable','status',v_row.status); end if;
  -- Expiry prevents NEW reservations, not settlement/refund of an existing hold.
  for v_allocation in select * from public.ai_credit_allocations where usage_id=v_row.id order by grant_id loop
    update public.ai_business_credit_grants
      set reserved_credits=reserved_credits-v_allocation.credits,
          consumed_credits=consumed_credits+case when p_status='completed' then v_allocation.credits else 0 end
      where id=v_allocation.grant_id and business_id=p_business_id and reserved_credits>=v_allocation.credits;
    if not found then raise exception 'ai_credit_allocation_conflict'; end if;
  end loop;
  update public.ai_usage_events set status=p_status,input_tokens=p_input_tokens,
    cached_input_tokens=least(p_cached_input_tokens,p_input_tokens),output_tokens=p_output_tokens,
    cost_usd_micros=p_cost_usd_micros,error_code=left(nullif(p_error_code,''),100),completed_at=now() where id=v_row.id;
  return jsonb_build_object('ok',true,'status',p_status);
end;
$$;

create or replace function public.ai_business_available_credits(p_business_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select greatest(0,coalesce((select monthly_credits from public.ai_business_plans where business_id=p_business_id),0)
    - coalesce((select sum(monthly_credits_reserved) from public.ai_usage_events where business_id=p_business_id
      and reserved_at >= (date_trunc('month',now() at time zone 'UTC') at time zone 'UTC') and status in ('reserved','completed')),0))
    + coalesce((select sum(credits-consumed_credits-reserved_credits) from public.ai_business_credit_grants
      where business_id=p_business_id and (expires_at is null or expires_at>now())),0);
$$;
create function public.get_my_ai_credit_balance()
returns table(business_id uuid,available_credits bigint)
language sql stable security definer set search_path = '' as $$
  select p.business_id,public.ai_business_available_credits(p.business_id)
    from public.ai_business_plans p where exists (
      select 1 from public.business_members m join public.profiles u on u.id=m.user_id
      where m.business_id=p.business_id and m.user_id=auth.uid() and u.active=true
    );
$$;
revoke all on function public.get_my_ai_credit_balance() from public,anon;
grant execute on function public.get_my_ai_credit_balance() to authenticated;
revoke all on function public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,integer,jsonb),
  public.finalize_ai_usage(uuid,uuid,text,integer,integer,integer,bigint,text),
  public.ai_business_available_credits(uuid) from public,anon,authenticated;
grant execute on function public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,integer,jsonb),
  public.finalize_ai_usage(uuid,uuid,text,integer,integer,integer,bigint,text),
  public.ai_business_available_credits(uuid) to service_role;
