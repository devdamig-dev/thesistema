-- E1: extend the existing business-wide customers entity. No branch relation or
-- transactional sales history exists yet; do not invent either. Existing RLS
-- from 0020 remains unchanged (owner/admin/manager/marketing writes).
alter table public.customers add column if not exists active boolean not null default true;
alter table public.customers add column if not exists notes text;

-- Enforce immutability, archive-only lifecycle and validation on direct Data API
-- writes too. Existing historical values are not rewritten by the migration.
create function public.guard_customer_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- A business cascade may already have removed both business and membership.
  if tg_op='DELETE' and not exists (select 1 from public.businesses where id=old.business_id) then
    return old;
  end if;
  if auth.uid() is not null and not exists (
    select 1 from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=case when tg_op='DELETE' then old.business_id else new.business_id end
      and m.user_id=auth.uid() and p.active and m.role::text in ('owner','admin','manager','marketing')
  ) then raise exception 'permission_denied' using errcode='42501'; end if;
  if tg_op = 'DELETE' then
    -- Preserve the existing business cascade when the parent itself is removed.
    if exists (select 1 from public.businesses where id = old.business_id) then
      raise exception 'customer_archive_required' using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.id <> old.id or new.business_id <> old.business_id) then
    raise exception 'customer_tenant_immutable' using errcode = '23514';
  end if;
  new.name := btrim(new.name);
  new.phone := nullif(btrim(new.phone),''); new.email := nullif(btrim(new.email),'');
  new.channel := nullif(btrim(new.channel),''); new.notes := nullif(btrim(new.notes),'');
  if new.name is null or length(new.name) not between 1 and 200 or new.name ~ '[[:cntrl:]]'
     or (new.phone is not null and (length(new.phone) > 40 or new.phone !~ '^[+0-9() .#xX-]+$' or new.phone !~ '[0-9]'))
     or (new.email is not null and (length(new.email) > 254 or new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or new.email ~ '[[:cntrl:]]'))
     or (new.channel is not null and (length(new.channel) > 80 or new.channel ~ '[[:cntrl:]]'))
     or (new.notes is not null and (length(new.notes) > 2000 or translate(new.notes,E'\n\r\t','') ~ '[[:cntrl:]]')) then
    raise exception 'invalid_customer' using errcode = '23514';
  end if;
  new.updated_at := case when tg_op='UPDATE' then greatest(clock_timestamp(),old.updated_at + interval '1 microsecond') else clock_timestamp() end;
  return new;
end;
$$;
drop trigger trg_customers_updated on public.customers;
create trigger trg_customers_write before insert or update or delete on public.customers
  for each row execute function public.guard_customer_write();
revoke all on function public.guard_customer_write() from public, anon, authenticated, service_role;

create function public.save_customer_atomic(p_business_id uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid; v_expected timestamptz; v_customer public.customers%rowtype;
  v_key text; v_source text;
begin
  -- Revalidate live membership/active profile in SQL. The browser never supplies
  -- actor, role, tenant or origin to the Server Action.
  if auth.uid() is null or not exists (
    select 1 from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=p_business_id and m.user_id=auth.uid() and p.active
      and m.role::text in ('owner','admin','manager','marketing')
  ) then return jsonb_build_object('ok',false,'error','permission_denied'); end if;
  if jsonb_typeof(p_input) is distinct from 'object' then
    return jsonb_build_object('ok',false,'error','invalid_customer');
  end if;
  if (select count(*) from jsonb_object_keys(p_input)) <> 8
     or exists (select 1 from jsonb_object_keys(p_input) k where k not in ('id','expectedUpdatedAt','name','phone','email','channel','notes','active'))
     or jsonb_typeof(p_input->'name') is distinct from 'string'
     or jsonb_typeof(p_input->'active') is distinct from 'boolean'
     or jsonb_typeof(p_input->'id') not in ('string','null')
     or jsonb_typeof(p_input->'expectedUpdatedAt') not in ('string','null') then
    return jsonb_build_object('ok',false,'error','invalid_customer');
  end if;
  foreach v_key in array array['phone','email','channel','notes'] loop
    if jsonb_typeof(p_input->v_key) not in ('string','null') then
      return jsonb_build_object('ok',false,'error','invalid_customer');
    end if;
  end loop;
  if (p_input->>'id' is not null and p_input->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or (p_input->>'expectedUpdatedAt' is not null and p_input->>'expectedUpdatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$') then
    return jsonb_build_object('ok',false,'error','invalid_customer');
  end if;
  v_id := (p_input->>'id')::uuid; v_expected := (p_input->>'expectedUpdatedAt')::timestamptz;
  if v_id is null then
    if v_expected is not null or not (p_input->>'active')::boolean then
      return jsonb_build_object('ok',false,'error','invalid_customer');
    end if;
  else
    if v_expected is null or not isfinite(v_expected) then return jsonb_build_object('ok',false,'error','invalid_customer'); end if;
    select * into v_customer from public.customers c where c.id=v_id and c.business_id=p_business_id for update;
    if not found then return jsonb_build_object('ok',false,'error','customer_not_found'); end if;
    if v_customer.updated_at is distinct from v_expected then
      return jsonb_build_object('ok',false,'error','customer_conflict');
    end if;
  end if;
  v_source := current_setting('app.customer_source',true);
  perform set_config('app.customer_source','manual',true);
  if v_id is null then
    insert into public.customers(business_id,name,phone,email,channel,notes,active)
      values(p_business_id,p_input->>'name',p_input->>'phone',p_input->>'email',p_input->>'channel',p_input->>'notes',true)
      returning id into v_id;
  else
    update public.customers set name=p_input->>'name',phone=p_input->>'phone',email=p_input->>'email',
      channel=p_input->>'channel',notes=p_input->>'notes',active=(p_input->>'active')::boolean
      where id=v_id and business_id=p_business_id;
  end if;
  perform set_config('app.customer_source',coalesce(v_source,''),true);
  return jsonb_build_object('ok',true,'id',v_id);
exception
  when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or check_violation then
    return jsonb_build_object('ok',false,'error','invalid_customer');
end;
$$;
revoke all on function public.save_customer_atomic(uuid,jsonb) from public, anon;
grant execute on function public.save_customer_atomic(uuid,jsonb) to authenticated;

-- A trigger-only privileged sink is necessary because activity_logs forbids
-- caller inserts. It never mutates customers and accepts no supplied identity.
create schema if not exists customers_private;
revoke all on schema customers_private from public, anon, authenticated;
create function customers_private.audit_customer_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_name text; v_role text; v_action text; v_source text;
begin
  if tg_op='UPDATE' and to_jsonb(new)-'updated_at'=to_jsonb(old)-'updated_at' then return null; end if;
  select p.full_name,m.role::text into v_name,v_role from public.profiles p
    join public.business_members m on m.user_id=p.id
    where p.id=v_actor and m.business_id=new.business_id;
  v_action := case when tg_op='INSERT' then 'customer.created'
    when old.active and not new.active then 'customer.archived'
    when not old.active and new.active then 'customer.restored' else 'customer.updated' end;
  v_source := case when v_actor is null then 'system'
    when current_setting('app.customer_source',true)='manual' then 'manual' else 'api' end;
  insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
    values(new.business_id,v_actor,v_name,v_role,v_action,'customers',new.id,v_action || ': ' || new.name,
      jsonb_build_object('source',v_source,'result','success','business_id',new.business_id,'branch_id',null,
        'before',case when tg_op='INSERT' then null else to_jsonb(old)-'updated_at' end,
        'after',to_jsonb(new)-'updated_at'));
  return null;
end;
$$;
revoke all on function customers_private.audit_customer_change() from public, anon, authenticated, service_role;
create trigger customers_audit after insert or update on public.customers
  for each row execute function customers_private.audit_customer_change();
