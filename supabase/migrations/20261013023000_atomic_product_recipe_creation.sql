-- Create a product and its initial recipe in one transaction.
-- Manual UI only: WhatsApp product creation keeps its existing explicit contract.
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
  v_product jsonb;
  v_recipe jsonb;
  v_product_id uuid;
begin
  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid_product_recipe' using errcode='22023';
  end if;

  -- create_product_atomic derives the manual actor from auth.uid(), validates
  -- tenant/role/module and records the product audit in this same transaction.
  v_product := public.create_product_atomic(p_business_id, p_input, null);
  if coalesce((v_product->>'ok')::boolean, false) is distinct from true then
    raise exception 'product_create_failed' using errcode='P0001';
  end if;
  v_product_id := (v_product->>'id')::uuid;

  -- save_recipe_atomic validates every ingredient against the same business,
  -- locks the catalog scope, calculates the real recipe cost and updates the
  -- product. Returning ok=false must abort the outer transaction so a product
  -- is never left behind without the recipe the user submitted.
  v_recipe := public.save_recipe_atomic(
    p_business_id,
    v_product_id,
    null,
    p_items
  );
  if coalesce((v_recipe->>'ok')::boolean, false) is distinct from true then
    raise exception 'product_recipe_%', coalesce(v_recipe->>'error','failed') using errcode='P0001';
  end if;

  return v_product || jsonb_build_object(
    'recipe_id', v_recipe->>'recipe_id',
    'cost', (v_recipe->>'cost')::numeric
  );
end;
$$;

revoke all on function public.create_product_with_recipe_atomic(uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.create_product_with_recipe_atomic(uuid,jsonb,jsonb) to authenticated;
