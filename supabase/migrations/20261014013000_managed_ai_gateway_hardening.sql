-- Follow-up for environments where the initial managed AI migration was applied before review.
-- New businesses must get a plan even when authenticated users cannot write ai_business_plans,
-- and repeated request IDs must never trigger a second provider call silently.

create or replace function public.ensure_ai_business_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.ai_business_plans (business_id)
  values (new.id)
  on conflict (business_id) do nothing;
  return new;
end;
$$;
revoke all on function public.ensure_ai_business_plan() from public, anon, authenticated;

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
      'credits',v_existing.credits,
      'existing',true
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
      'ok',true,'allowed',false,'usage_id',v_id,'status','rejected','existing',false,
      'error','quota_exceeded','used_credits',v_used,'monthly_credits',v_plan.monthly_credits
    );
  end if;

  insert into public.ai_usage_events(
    request_id,business_id,actor_id,task_type,source,provider,model,credits,status,metadata
  ) values (
    p_request_id,p_business_id,p_actor_id,p_task_type,p_source,p_provider,p_model,p_credits,'reserved',coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object(
    'ok',true,'allowed',true,'usage_id',v_id,'status','reserved','existing',false,
    'used_credits',v_used,'monthly_credits',v_plan.monthly_credits
  );
end;
$$;

revoke all on function public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,integer,jsonb)
  from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(uuid,uuid,uuid,text,text,text,text,integer,jsonb)
  to service_role;
