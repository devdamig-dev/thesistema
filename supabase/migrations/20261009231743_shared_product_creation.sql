-- Manual and WhatsApp creation share one strict, invoker domain operation.
-- Preserve unknown historical provenance; no synthetic actor/source backfill.
alter table public.products
  add column created_by uuid references public.profiles(id),
  add column source text,
  add constraint products_creation_source_check check (
    (source is null and created_by is null)
    or (source is not null and source in ('manual','whatsapp') and created_by is not null)
  );

create function public.catalog_guard_product_creation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_role text;
begin
  if tg_op = 'UPDATE' then
    if (new.created_by,new.source) is distinct from (old.created_by,old.source) then
      raise exception 'product_creation_origin_immutable' using errcode='42501';
    end if;
    return new;
  end if;
  if current_user::text = 'authenticated' then
    if (new.created_by is not null and new.created_by is distinct from auth.uid())
      or (new.source is not null and new.source <> 'manual') then
      raise exception 'product_actor_forbidden' using errcode='42501';
    end if;
    new.created_by := auth.uid(); new.source := 'manual';
  elsif current_user::text = 'service_role' and new.source = 'whatsapp' then
    perform 1 from public.business_modules where business_id=new.business_id
      and module_key='products' and enabled for share;
    if not found then
      raise exception 'product_module_disabled' using errcode='42501';
    end if;
  elsif new.created_by is not null or new.source is not null then
    raise exception 'product_actor_forbidden' using errcode='42501';
  else
    -- Existing internal system imports retain unknown provenance; they cannot
    -- claim to be an authenticated user or WhatsApp operation.
    return new;
  end if;
  select m.role::text into v_role from public.business_members m
    join public.profiles p on p.id=m.user_id
    where m.business_id=new.business_id and m.user_id=new.created_by and p.active
    for share of m,p;
  if v_role is null or v_role not in ('owner','admin') then
    raise exception 'product_actor_forbidden' using errcode='42501';
  end if;
  return new;
end;
$$;
create trigger catalog_product_creation_guard before insert or update on public.products
  for each row execute function public.catalog_guard_product_creation();
revoke all on function public.catalog_guard_product_creation() from public,anon,authenticated,service_role;

create function public.create_product_atomic(p_business_id uuid, p_input jsonb, p_actor_id uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_actor uuid; v_source text; v_id uuid;
begin
  if current_user::text = 'authenticated' then
    if auth.uid() is null or p_actor_id is not null then
      raise exception 'product_actor_forbidden' using errcode='42501';
    end if;
    v_actor := auth.uid(); v_source := 'manual';
  elsif current_user::text = 'service_role' and p_actor_id is not null then
    v_actor := p_actor_id; v_source := 'whatsapp';
  else raise exception 'product_actor_forbidden' using errcode='42501';
  end if;
  if p_business_id is null or jsonb_typeof(p_input) is distinct from 'object' then
    raise exception 'invalid_product' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','category','price','cost','active'))
    or jsonb_typeof(p_input->'name') is distinct from 'string'
    or jsonb_typeof(p_input->'category') is distinct from 'string'
    or jsonb_typeof(p_input->'price') is distinct from 'number'
    or jsonb_typeof(p_input->'cost') is distinct from 'number'
    or jsonb_typeof(p_input->'active') is distinct from 'boolean' then
    raise exception 'invalid_product_fields' using errcode='22023';
  end if;
  if length(btrim(p_input->>'name')) < 1 or length(p_input->>'name') > 200
    or length(btrim(p_input->>'category')) < 1 or length(p_input->>'category') > 100
    or (p_input->>'price')::numeric not between 0 and 9999999999.99
    or (p_input->>'cost')::numeric not between 0 and 9999999999.99 then
    raise exception 'invalid_product_fields' using errcode='22023';
  end if;
  -- Both callers hit identical catalog, tenant, role and atomic-audit triggers.
  insert into public.products(business_id,name,category,price,cost,active,created_by,source)
    values(p_business_id,btrim(p_input->>'name'),btrim(p_input->>'category'),
      (p_input->>'price')::numeric,(p_input->>'cost')::numeric,(p_input->>'active')::boolean,v_actor,v_source)
    returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id,'actor_id',v_actor,'source',v_source);
end;
$$;
revoke all on function public.create_product_atomic(uuid,jsonb,uuid) from public,anon;
grant execute on function public.create_product_atomic(uuid,jsonb,uuid) to authenticated,service_role;

-- Creation audit uses persisted provenance checked by the invoker trigger.
-- Subsequent changes still derive the acting user from the live session; the
-- creator never gets attributed edits performed later by another user/system.
create or replace function catalog_private.audit_catalog_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb; v_business uuid; v_actor uuid := auth.uid(); v_name text; v_role text;
  v_branch uuid; v_action text; v_source text;
begin
  if tg_op = 'DELETE' then v_row := to_jsonb(old); else v_row := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then return null; end if;
  if tg_table_name in ('ingredients','products') then v_business := (v_row->>'business_id')::uuid;
  elsif tg_table_name = 'recipes' then
    select p.business_id into v_business from public.products p where p.id=(v_row->>'product_id')::uuid;
  elsif tg_table_name = 'recipe_items' then
    select p.business_id into v_business from public.recipes r join public.products p on p.id=r.product_id
      where r.id=(v_row->>'recipe_id')::uuid;
  elsif tg_table_name = 'stock_items' then
    if tg_op = 'UPDATE' and new.min is not distinct from old.min then return null; end if;
    v_branch := (v_row->>'branch_id')::uuid;
    select b.business_id into v_business from public.branches b where b.id=v_branch;
  end if;
  if v_business is null then return null; end if;
  if tg_table_name='products' and tg_op='INSERT' and v_row->>'source' is not null then
    v_actor := (v_row->>'created_by')::uuid; v_source := v_row->>'source';
  else v_source := case when v_actor is null then 'system' else 'manual' end;
  end if;
  select p.full_name,m.role::text into v_name,v_role from public.profiles p
    join public.business_members m on m.user_id=p.id
    where p.id=v_actor and m.business_id=v_business;
  v_action := 'catalog.' || tg_table_name || '.' || lower(tg_op);
  insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
    values(v_business,v_actor,v_name,v_role,v_action,tg_table_name,(v_row->>'id')::uuid,
      v_action || coalesce(': ' || (v_row->>'name'),''),
      jsonb_build_object('source',v_source,'result','success','business_id',v_business,'branch_id',v_branch,
        'before',case when tg_op='INSERT' then null else to_jsonb(old)-'updated_at' end,
        'after',case when tg_op='DELETE' then null else to_jsonb(new)-'updated_at' end));
  return null;
end;
$$;
revoke all on function catalog_private.audit_catalog_change() from public,anon,authenticated,service_role;
