-- Product creation may include its initial recipe in the same transaction.
-- This prevents an incomplete product from surviving when recipe validation fails.
create function public.create_product_with_recipe_atomic(
  p_business_id uuid,
  p_input jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
  v_recipe jsonb;
  v_name text;
  v_category text;
  v_price numeric;
  v_cost numeric;
  v_active boolean;
begin
  if auth.uid() is null or not exists (
    select 1
    from public.business_members m
    join public.profiles p on p.id = m.user_id
    where m.business_id = p_business_id
      and m.user_id = auth.uid()
      and p.active
      and m.role::text in ('owner','admin')
  ) then
    raise exception 'product_actor_forbidden' using errcode='42501';
  end if;

  if p_business_id is null
     or jsonb_typeof(p_input) is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('name','category','price','cost','active'))
     or jsonb_typeof(p_input->'name') is distinct from 'string'
     or jsonb_typeof(p_input->'category') is distinct from 'string'
     or jsonb_typeof(p_input->'price') is distinct from 'number'
     or jsonb_typeof(p_input->'cost') is distinct from 'number'
     or jsonb_typeof(p_input->'active') is distinct from 'boolean'
     or jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid_product_recipe' using errcode='22023';
  end if;

  v_name := btrim(p_input->>'name');
  v_category := btrim(p_input->>'category');
  v_price := (p_input->>'price')::numeric;
  v_cost := (p_input->>'cost')::numeric;
  v_active := (p_input->>'active')::boolean;

  if length(v_name) not between 1 and 200
     or length(v_category) not between 1 and 100
     or v_price < 0 or v_price > 9999999999.99
     or v_cost < 0 or v_cost > 9999999999.99
     or v_price::text in ('NaN','Infinity','-Infinity')
     or v_cost::text in ('NaN','Infinity','-Infinity') then
    raise exception 'invalid_product_fields' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('catalog:' || p_business_id::text, 0));

  insert into public.products(business_id,name,category,price,cost,active)
  values(p_business_id,v_name,v_category,v_price,v_cost,v_active)
  returning id into v_id;

  v_recipe := public.save_recipe_atomic(p_business_id,v_id,null,p_items);
  if coalesce((v_recipe->>'ok')::boolean,false) is distinct from true then
    raise exception 'product_recipe_%',coalesce(v_recipe->>'error','failed') using errcode='P0001';
  end if;

  return jsonb_build_object(
    'ok',true,
    'id',v_id,
    'recipe_id',v_recipe->>'recipe_id',
    'cost',(v_recipe->>'cost')::numeric
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'invalid_product_recipe' using errcode='22023';
end;
$$;

revoke all on function public.create_product_with_recipe_atomic(uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.create_product_with_recipe_atomic(uuid,jsonb,jsonb) to authenticated;
