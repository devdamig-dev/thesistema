-- Typed catalog composition. Historical qty text remains untouched and is never parsed.
-- Existing table grants and RLS remain authoritative; catalog RPCs are invokers.
alter table public.recipe_items
  add column quantity numeric,
  add column unit text,
  add constraint recipe_items_typed_quantity_check check (
    (quantity is null and unit is null) or
    (quantity is not null and unit is not null and quantity > 0
     and quantity::text not in ('NaN', 'Infinity', '-Infinity')
     and unit in ('unit', 'kg', 'g', 'l', 'ml'))
  );
-- Costs per g/ml need sub-cent precision; only final product cost is rounded.
alter table public.ingredients alter column avg_unit_cost type numeric(18,6);
alter table public.recipe_items alter column unit_cost type numeric(18,6);
alter table public.ingredients
  add column active boolean not null default true,
  add column preferred_supplier_id uuid references public.suppliers(id) on delete set null;
create index ingredients_preferred_supplier_idx on public.ingredients(preferred_supplier_id)
  where preferred_supplier_id is not null;
create index if not exists recipe_items_recipe_idx on public.recipe_items(recipe_id);
create index if not exists recipe_items_ingredient_idx on public.recipe_items(ingredient_id);

-- Last-five purchase average expressed in the ingredient's BASE unit. An input
-- in grams cannot silently become a cost per kilogram; invalid units abort the
-- caller transaction rather than publishing a misleading product cost.
create or replace function public.recalc_ingredient_cost(p_ingredient_id uuid)
returns numeric language plpgsql security invoker set search_path = '' as $$
declare
  v_ingredient public.ingredients%rowtype;
  v_count integer; v_valid boolean; v_avg numeric(18,6);
begin
  select * into v_ingredient from public.ingredients where id=p_ingredient_id for update;
  if not found then raise exception 'ingredient_not_found_or_forbidden' using errcode='P0002'; end if;
  select count(*),bool_and(qty>0 and qty::text not in ('NaN','Infinity','-Infinity')
    and unit_price>=0 and unit_price::text not in ('NaN','Infinity','-Infinity')
    and factor is not null),
    sum(unit_price*qty)/nullif(sum(qty*factor),0)
    into v_count,v_valid,v_avg
  from (
    select pi.qty,pi.unit_price,public.catalog_unit_factor(pi.unit,v_ingredient.unit) as factor
    from public.purchase_items pi join public.purchases p on p.id=pi.purchase_id
    where pi.ingredient_id=p_ingredient_id and p.business_id=v_ingredient.business_id
    order by pi.created_at desc,pi.id desc limit 5
  ) recent;
  if v_count=0 then return v_ingredient.avg_unit_cost; end if;
  if v_valid is not true or v_avg is null or v_avg::text in ('NaN','Infinity','-Infinity') then
    raise exception 'purchase_cost_unit_or_quantity_invalid' using errcode='23514';
  end if;
  update public.ingredients set avg_unit_cost=v_avg where id=p_ingredient_id;
  return v_avg;
end;
$$;

create function public.catalog_normalize_unit(p_unit text)
returns text language sql immutable security invoker set search_path = '' as $$
  select case lower(btrim(p_unit))
    when 'u' then 'unit' when 'unidad' then 'unit' when 'unidades' then 'unit'
    when 'unit' then 'unit' when 'kg' then 'kg' when 'g' then 'g'
    when 'l' then 'l' when 'ml' then 'ml' else null end;
$$;
create function public.catalog_unit_factor(p_from text, p_to text)
returns numeric language sql immutable security invoker set search_path = '' as $$
  select case
    when f is null or t is null then null
    when f = t then 1::numeric
    when (f, t) in (('kg','g'), ('l','ml')) then 1000::numeric
    when (f, t) in (('g','kg'), ('ml','l')) then 0.001::numeric
    else null end
  from (select public.catalog_normalize_unit(p_from) f,
               public.catalog_normalize_unit(p_to) t) units;
$$;

-- NULL deliberately means incomplete, incompatible, or empty, never zero cost.
create function public.catalog_recipe_cost(p_product_id uuid)
returns numeric language sql stable security invoker set search_path = '' as $$
  select case when count(*) > 0 and bool_and(
    ri.quantity is not null and ri.unit is not null and ri.quantity > 0
    and ri.quantity::text not in ('NaN', 'Infinity', '-Infinity')
    and i.id is not null and i.business_id = p.business_id
    and i.avg_unit_cost >= 0 and i.avg_unit_cost::text not in ('NaN', 'Infinity', '-Infinity')
    and public.catalog_unit_factor(ri.unit, i.unit) is not null
  ) then round(sum(ri.quantity * i.avg_unit_cost * public.catalog_unit_factor(ri.unit, i.unit)), 2)
  else null end
  from public.products p
  join public.recipes r on r.product_id = p.id
  join public.recipe_items ri on ri.recipe_id = r.id
  left join public.ingredients i on i.id = ri.ingredient_id
  where p.id = p_product_id;
$$;

-- RPCs check active profiles, and direct Data API writes must do the same.
-- Existing role/tenant policies remain unchanged. Trusted internal service-role
-- flows retain their own actor validation; this guard adds no table privileges.
create function public.catalog_require_active_actor()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user::text = 'authenticated' and not exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.active
  ) then raise exception 'catalog_actor_inactive' using errcode='42501'; end if;
  return coalesce(new,old);
end;
$$;
create trigger catalog_active_product before insert or update or delete on public.products
  for each row execute function public.catalog_require_active_actor();
create trigger catalog_active_ingredient before insert or update or delete on public.ingredients
  for each row execute function public.catalog_require_active_actor();
create trigger catalog_active_recipe before insert or update or delete on public.recipes
  for each row execute function public.catalog_require_active_actor();
create trigger catalog_active_recipe_item before insert or update or delete on public.recipe_items
  for each row execute function public.catalog_require_active_actor();
revoke all on function public.catalog_require_active_actor() from public,anon,authenticated,service_role;

create function public.catalog_guard_tenant()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.business_id is distinct from old.business_id then
    raise exception 'catalog_business_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger catalog_ingredient_tenant before update of business_id on public.ingredients
  for each row execute function public.catalog_guard_tenant();
create trigger catalog_product_tenant before update of business_id on public.products
  for each row execute function public.catalog_guard_tenant();
-- Prevent moving the referenced parent to another tenant after child validation.
create trigger catalog_supplier_tenant before update of business_id on public.suppliers
  for each row execute function public.catalog_guard_tenant();
create trigger catalog_branch_tenant before update of business_id on public.branches
  for each row execute function public.catalog_guard_tenant();

create function public.catalog_guard_ingredient()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_unit text;
begin
  if length(btrim(new.name)) not between 1 and 200 or new.avg_unit_cost < 0
     or new.avg_unit_cost::text in ('NaN','Infinity','-Infinity') then
    raise exception 'invalid_ingredient' using errcode = '23514';
  end if;
  v_unit := public.catalog_normalize_unit(new.unit);
  if tg_op = 'INSERT' or new.unit is distinct from old.unit then
    if v_unit is null then
      raise exception 'unsupported_ingredient_unit' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and v_unit is distinct from public.catalog_normalize_unit(old.unit)
       and (exists (select 1 from public.stock_items s where s.ingredient_id = old.id)
         or exists (select 1 from public.recipe_items ri where ri.ingredient_id = old.id)) then
      raise exception 'ingredient_unit_in_use' using errcode = '23514';
    end if;
    new.unit := v_unit;
  end if;
  if new.preferred_supplier_id is not null and not exists (
    select 1 from public.suppliers s
    where s.id = new.preferred_supplier_id and s.business_id = new.business_id
  ) then
    raise exception 'supplier_not_found_or_forbidden' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger catalog_ingredient_guard before insert or update on public.ingredients
  for each row execute function public.catalog_guard_ingredient();

create function public.catalog_guard_stock()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.ingredients i join public.branches b on b.business_id = i.business_id
    where i.id = new.ingredient_id and b.id = new.branch_id
  ) then
    raise exception 'stock_ingredient_business_mismatch' using errcode = '23514';
  end if;
  if new.min < 0 or new.min::text in ('NaN','Infinity','-Infinity') then
    raise exception 'invalid_stock_minimum' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger catalog_stock_guard before insert or update on public.stock_items
  for each row execute function public.catalog_guard_stock();

create function public.catalog_guard_recipe_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_ingredient public.ingredients%rowtype; v_business uuid;
begin
  select p.business_id into v_business from public.recipes r
    join public.products p on p.id = r.product_id where r.id = new.recipe_id;
  if v_business is null then
    raise exception 'recipe_not_found_or_forbidden' using errcode = '23514';
  end if;
  if new.ingredient_id is not null then
    select * into v_ingredient from public.ingredients i where i.id = new.ingredient_id for share;
    if not found or v_ingredient.business_id <> v_business then
      raise exception 'recipe_ingredient_business_mismatch' using errcode = '23514';
    end if;
    if not v_ingredient.active and (tg_op = 'INSERT' or new.ingredient_id is distinct from old.ingredient_id) then
      raise exception 'ingredient_inactive' using errcode = '23514';
    end if;
  end if;
  if new.quantity is not null or new.unit is not null then
    new.unit := public.catalog_normalize_unit(new.unit);
    if new.ingredient_id is null or new.quantity is null or new.unit is null
       or public.catalog_unit_factor(new.unit, v_ingredient.unit) is null then
      raise exception 'invalid_recipe_unit_or_ingredient' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger catalog_recipe_item_guard before insert or update on public.recipe_items
  for each row execute function public.catalog_guard_recipe_item();

-- A recipe cannot be reassigned to bypass tenant checks or the product CAS lock.
create function public.catalog_guard_recipe()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.product_id is distinct from old.product_id then
    raise exception 'recipe_product_immutable' using errcode = '23514';
  end if;
  -- now() is transaction-stable. clock_timestamp + monotonic floor ensures two
  -- writes in one transaction still produce distinct optimistic-lock tokens.
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
drop trigger trg_recipes_updated on public.recipes;
create trigger catalog_recipe_updated before update on public.recipes
  for each row execute function public.catalog_guard_recipe();

create function public.catalog_guard_product_cost()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_cost numeric;
begin
  if new.price < 0 or new.cost < 0 or new.price::text in ('NaN','Infinity','-Infinity')
     or new.cost::text in ('NaN','Infinity','-Infinity') then
    raise exception 'invalid_product_price_or_cost' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    v_cost := public.catalog_recipe_cost(old.id);
    if v_cost is not null then
      new.cost := v_cost;
    elsif exists (select 1 from public.recipes r join public.recipe_items ri on ri.recipe_id = r.id
                  where r.product_id = old.id) then
      -- Legacy recipes need manual repair; editing a product never overwrites
      -- their last known cost with either a guess or a partial calculation.
      new.cost := old.cost;
    end if;
  end if;
  return new;
end;
$$;
create trigger catalog_product_cost before insert or update on public.products
  for each row execute function public.catalog_guard_product_cost();

create function public.recalc_product_recipe_cost(p_business_id uuid, p_product_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_product public.products%rowtype; v_cost numeric; v_changed boolean;
begin
  if current_user::text <> 'service_role' and (auth.uid() is null or not exists (
    select 1 from public.business_members m join public.profiles p on p.id = m.user_id
    where m.business_id = p_business_id and m.user_id = auth.uid() and p.active
      and m.role::text in ('owner','admin')
  )) then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:' || p_business_id::text, 0));
  select * into v_product from public.products p
    where p.id = p_product_id and p.business_id = p_business_id for update;
  if not found then return jsonb_build_object('ok',false,'error','product_not_found'); end if;
  perform 1 from public.recipes r where r.product_id = p_product_id for update;
  if not exists (select 1 from public.recipes r join public.recipe_items ri on ri.recipe_id = r.id
                 where r.product_id = p_product_id) then
    return jsonb_build_object('ok',false,'error','recipe_empty');
  end if;
  v_cost := public.catalog_recipe_cost(p_product_id);
  if v_cost is null then return jsonb_build_object('ok',false,'error','recipe_incomplete'); end if;
  v_changed := v_product.cost is distinct from v_cost;
  if v_changed then update public.products set cost = v_cost where id = p_product_id; end if;
  return jsonb_build_object('ok',true,'product_id',p_product_id,'product_name',v_product.name,
    'old_cost',v_product.cost,'new_cost',v_cost,'price',v_product.price,'updated',v_changed);
end;
$$;

-- Invoker trigger preserves existing invoice/purchase RLS. A caller without
-- product-write permission cannot escalate through ingredient-cost changes.
create function public.catalog_recalc_ingredient_products()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_product_id uuid; v_cost numeric;
begin
  if new.avg_unit_cost is not distinct from old.avg_unit_cost and new.unit is not distinct from old.unit then
    return new;
  end if;
  for v_product_id in
    select distinct p.id from public.products p
    join public.recipes r on r.product_id = p.id
    join public.recipe_items ri on ri.recipe_id = r.id
    where ri.ingredient_id = new.id and p.business_id = new.business_id order by p.id
  loop
    perform 1 from public.products p where p.id = v_product_id for update;
    v_cost := public.catalog_recipe_cost(v_product_id);
    if v_cost is not null then
      update public.products set cost = v_cost where id = v_product_id and cost is distinct from v_cost;
    end if;
  end loop;
  return new;
end;
$$;
create trigger catalog_ingredient_recalc after update of avg_unit_cost, unit on public.ingredients
  for each row execute function public.catalog_recalc_ingredient_products();

-- Direct authorized row edits also invalidate CAS and recalculate typed costs.
create function public.catalog_sync_recipe_item()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_recipe_id uuid; v_product_id uuid; v_cost numeric;
begin
  for v_recipe_id in select distinct x from unnest(array[
    case when tg_op <> 'INSERT' then old.recipe_id end,
    case when tg_op <> 'DELETE' then new.recipe_id end
  ]) x where x is not null loop
    update public.recipes set updated_at = clock_timestamp() where id = v_recipe_id
      returning product_id into v_product_id;
    if found then
      v_cost := public.catalog_recipe_cost(v_product_id);
      if v_cost is not null then
        update public.products set cost = v_cost where id = v_product_id and cost is distinct from v_cost;
      end if;
    end if;
  end loop;
  return null;
end;
$$;
create trigger catalog_sync_recipe_item after insert or update or delete on public.recipe_items
  for each row execute function public.catalog_sync_recipe_item();

create function public.save_recipe_atomic(
  p_business_id uuid, p_product_id uuid, p_expected_updated_at timestamptz, p_items jsonb
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_product public.products%rowtype; v_recipe public.recipes%rowtype;
  v_item jsonb; v_ingredient public.ingredients%rowtype; v_ingredient_id uuid;
  v_quantity numeric; v_unit text; v_cost numeric := 0; v_factor numeric;
  v_validated jsonb := '[]'; v_seen uuid[] := '{}'; v_timestamp timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1 from public.business_members m join public.profiles p on p.id = m.user_id
    where m.business_id = p_business_id and m.user_id = auth.uid() and p.active
      and m.role::text in ('owner','admin')
  ) then return jsonb_build_object('ok',false,'error','permission_denied'); end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 200 then
    return jsonb_build_object('ok',false,'error','invalid_recipe_items');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:' || p_business_id::text, 0));
  select * into v_product from public.products p
    where p.id = p_product_id and p.business_id = p_business_id for update;
  if not found then return jsonb_build_object('ok',false,'error','product_not_found'); end if;
  select * into v_recipe from public.recipes r where r.product_id = p_product_id for update;
  if v_recipe.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('ok',false,'error','recipe_conflict');
  end if;
  -- Validate and lock every referenced ingredient before deleting anything.
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'quantity') is distinct from 'number' then
      return jsonb_build_object('ok',false,'error','invalid_recipe_item');
    end if;
    v_ingredient_id := (v_item->>'ingredientId')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit := public.catalog_normalize_unit(v_item->>'unit');
    if v_ingredient_id is null or v_quantity <= 0 or v_quantity::text in ('NaN','Infinity','-Infinity')
       or v_unit is null or v_ingredient_id = any(v_seen) then
      return jsonb_build_object('ok',false,'error','invalid_recipe_item');
    end if;
    select * into v_ingredient from public.ingredients i
      where i.id = v_ingredient_id and i.business_id = p_business_id for share;
    if not found then return jsonb_build_object('ok',false,'error','ingredient_not_found'); end if;
    if not v_ingredient.active then return jsonb_build_object('ok',false,'error','ingredient_inactive'); end if;
    v_factor := public.catalog_unit_factor(v_unit, v_ingredient.unit);
    if v_factor is null then return jsonb_build_object('ok',false,'error','incompatible_units'); end if;
    if v_ingredient.avg_unit_cost < 0 or v_ingredient.avg_unit_cost::text in ('NaN','Infinity','-Infinity') then
      return jsonb_build_object('ok',false,'error','invalid_ingredient_cost');
    end if;
    v_cost := v_cost + v_quantity * v_ingredient.avg_unit_cost * v_factor;
    v_seen := array_append(v_seen, v_ingredient_id);
    v_validated := v_validated || jsonb_build_array(jsonb_build_object(
      'ingredientId',v_ingredient_id,'quantity',v_quantity,'unit',v_unit,
      'name',v_ingredient.name,'unitCost',v_ingredient.avg_unit_cost * v_factor));
  end loop;
  if v_recipe.id is null then
    insert into public.recipes(product_id) values (p_product_id) returning * into v_recipe;
  end if;
  delete from public.recipe_items where recipe_id = v_recipe.id;
  insert into public.recipe_items(recipe_id,ingredient_id,name,qty,quantity,unit,unit_cost,share)
    select v_recipe.id,(j->>'ingredientId')::uuid,j->>'name',
      (j->>'quantity') || ' ' || (j->>'unit'),(j->>'quantity')::numeric,j->>'unit',
      (j->>'unitCost')::numeric,
      case when v_cost > 0 then round((j->>'quantity')::numeric*(j->>'unitCost')::numeric / v_cost * 100,2) else 0 end
    from jsonb_array_elements(v_validated) j;
  update public.recipes set updated_at = clock_timestamp() where id = v_recipe.id returning updated_at into v_timestamp;
  if jsonb_array_length(p_items) = 0 then v_cost := v_product.cost; else v_cost := round(v_cost,2); end if;
  update public.products set cost = v_cost where id = p_product_id returning cost into v_cost;
  return jsonb_build_object('ok',true,'cost',v_cost,'updated_at',v_timestamp,'recipe_id',v_recipe.id);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'error','invalid_recipe_item');
end;
$$;

create function public.save_ingredient_atomic(p_business_id uuid, p_ingredient_id uuid, p_input jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid; v_name text; v_unit text; v_cost numeric; v_active boolean; v_supplier uuid;
  v_minimums jsonb; v_item jsonb; v_branch uuid; v_min numeric; v_seen uuid[] := '{}';
begin
  if auth.uid() is null or not exists (
    select 1 from public.business_members m join public.profiles p on p.id = m.user_id
    where m.business_id = p_business_id and m.user_id = auth.uid() and p.active
      and m.role::text in ('owner','admin')
  ) then return jsonb_build_object('ok',false,'error','permission_denied'); end if;
  if jsonb_typeof(p_input) is distinct from 'object' or jsonb_typeof(p_input->'name') is distinct from 'string'
     or jsonb_typeof(p_input->'unitCost') is distinct from 'number'
     or jsonb_typeof(p_input->'active') is distinct from 'boolean' then
    return jsonb_build_object('ok',false,'error','invalid_ingredient');
  end if;
  v_name := btrim(p_input->>'name'); v_unit := public.catalog_normalize_unit(p_input->>'unit');
  v_cost := (p_input->>'unitCost')::numeric; v_active := (p_input->>'active')::boolean;
  v_supplier := (p_input->>'supplierId')::uuid; v_minimums := coalesce(p_input->'minimums','[]'::jsonb);
  if length(v_name) not between 1 and 200 or v_unit is null or v_cost < 0
     or v_cost::text in ('NaN','Infinity','-Infinity') or jsonb_typeof(v_minimums) is distinct from 'array'
     or jsonb_array_length(v_minimums) > 200 then
    return jsonb_build_object('ok',false,'error','invalid_ingredient');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('catalog:' || p_business_id::text, 0));
  if p_ingredient_id is not null then
    select id into v_id from public.ingredients where id = p_ingredient_id and business_id = p_business_id for update;
    if not found then return jsonb_build_object('ok',false,'error','ingredient_not_found'); end if;
  end if;
  if v_supplier is not null and not exists (
    select 1 from public.suppliers s where s.id = v_supplier and s.business_id = p_business_id
  ) then return jsonb_build_object('ok',false,'error','supplier_not_found'); end if;
  for v_item in select value from jsonb_array_elements(v_minimums) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'minimum') is distinct from 'number' then
      return jsonb_build_object('ok',false,'error','invalid_minimum');
    end if;
    v_branch := (v_item->>'branchId')::uuid; v_min := (v_item->>'minimum')::numeric;
    if v_branch is null or v_min < 0 or v_min::text in ('NaN','Infinity','-Infinity') or v_branch = any(v_seen) then
      return jsonb_build_object('ok',false,'error','invalid_minimum');
    end if;
    if not exists (select 1 from public.branches b where b.id = v_branch and b.business_id = p_business_id
                   and public.can_access_business_branch(p_business_id,b.id)) then
      return jsonb_build_object('ok',false,'error','branch_not_found');
    end if;
    v_seen := array_append(v_seen,v_branch);
  end loop;
  if p_ingredient_id is null then
    insert into public.ingredients(business_id,name,unit,avg_unit_cost,active,preferred_supplier_id)
      values(p_business_id,v_name,v_unit,v_cost,v_active,v_supplier) returning id into v_id;
  else
    update public.ingredients set name=v_name,unit=v_unit,avg_unit_cost=v_cost,active=v_active,preferred_supplier_id=v_supplier
      where id=v_id;
  end if;
  -- Omitted branches retain their minimum. Existing current balances are never touched.
  insert into public.stock_items(ingredient_id,branch_id,min)
    select v_id,(j->>'branchId')::uuid,(j->>'minimum')::numeric from jsonb_array_elements(v_minimums) j
    on conflict (ingredient_id,branch_id) do update set min=excluded.min;
  return jsonb_build_object('ok',true,'id',v_id);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok',false,'error','invalid_ingredient');
end;
$$;

-- The only privileged function is a trigger-only audit sink. It accepts no
-- caller-supplied actor/action/tenant, exposes no RPC, and cannot perform catalog
-- writes. Its insert is in the same transaction as the mutation being audited.
create schema if not exists catalog_private;
revoke all on schema catalog_private from public, anon, authenticated;
create function catalog_private.audit_catalog_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb; v_business uuid; v_actor uuid := auth.uid(); v_name text; v_role text;
  v_branch uuid; v_action text;
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
  -- Cascades whose parent was deleted are covered by that parent's audit event.
  if v_business is null then return null; end if;
  select p.full_name,m.role::text into v_name,v_role from public.profiles p
    join public.business_members m on m.user_id=p.id
    where p.id=v_actor and m.business_id=v_business;
  v_action := 'catalog.' || tg_table_name || '.' || lower(tg_op);
  insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
    values(v_business,v_actor,v_name,v_role,v_action,tg_table_name,(v_row->>'id')::uuid,
      v_action || coalesce(': ' || (v_row->>'name'),''),
      jsonb_build_object('source',case when v_actor is null then 'system' else 'manual' end,
        'result','success','business_id',v_business,'branch_id',v_branch,
        'before',case when tg_op='INSERT' then null else to_jsonb(old)-'updated_at' end,
        'after',case when tg_op='DELETE' then null else to_jsonb(new)-'updated_at' end));
  return null;
end;
$$;
revoke all on function catalog_private.audit_catalog_change() from public, anon, authenticated, service_role;
create trigger catalog_audit_ingredients after insert or update or delete on public.ingredients
  for each row execute function catalog_private.audit_catalog_change();
create trigger catalog_audit_products after insert or update or delete on public.products
  for each row execute function catalog_private.audit_catalog_change();
create trigger catalog_audit_recipes after insert or update or delete on public.recipes
  for each row execute function catalog_private.audit_catalog_change();
create trigger catalog_audit_recipe_items after insert or update or delete on public.recipe_items
  for each row execute function catalog_private.audit_catalog_change();
create trigger catalog_audit_stock_minimums after insert or update on public.stock_items
  for each row execute function catalog_private.audit_catalog_change();

revoke all on function public.catalog_normalize_unit(text), public.catalog_unit_factor(text,text),
  public.catalog_recipe_cost(uuid), public.recalc_product_recipe_cost(uuid,uuid),
  public.save_recipe_atomic(uuid,uuid,timestamptz,jsonb), public.save_ingredient_atomic(uuid,uuid,jsonb)
  from public, anon;
grant execute on function public.catalog_normalize_unit(text), public.catalog_unit_factor(text,text),
  public.catalog_recipe_cost(uuid), public.recalc_product_recipe_cost(uuid,uuid),
  public.save_recipe_atomic(uuid,uuid,timestamptz,jsonb), public.save_ingredient_atomic(uuid,uuid,jsonb)
  to authenticated, service_role;
revoke all on function public.catalog_guard_tenant(), public.catalog_guard_ingredient(),
  public.catalog_guard_stock(), public.catalog_guard_recipe_item(), public.catalog_guard_recipe(),
  public.catalog_guard_product_cost(), public.catalog_recalc_ingredient_products(), public.catalog_sync_recipe_item()
  from public, anon, authenticated, service_role;
