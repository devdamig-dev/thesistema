-- All reporting inputs share the calling statement's MVCC snapshot. In
-- particular, an owner refresh cannot pair an old product cost with a newly
-- cleared purchase warning. A scalar JSON result avoids Data API row limits
-- and application pagination opening additional snapshots.
create function public.read_product_catalog_snapshot(p_business_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_role text; v_products jsonb; v_pending boolean;
begin
  if current_user::text = 'authenticated' then
    if auth.uid() is null or p_business_id is null then
      raise exception 'catalog_actor_forbidden' using errcode='42501';
    end if;
    select m.role::text into v_role
    from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=p_business_id and m.user_id=auth.uid() and p.active;
    if v_role is null or v_role not in ('owner','admin','manager','employee','kitchen','cashier','waiter','delivery','viewer') then
      raise exception 'catalog_actor_forbidden' using errcode='42501';
    end if;
  elsif current_user::text = 'service_role' and p_business_id is not null then
    -- Existing trusted background margin checks have no user actor. This
    -- read-only path still requires an explicit business and enabled module.
    v_role := 'service_role';
  else
    raise exception 'catalog_actor_forbidden' using errcode='42501';
  end if;
  if not exists(select 1 from public.business_modules m
    where m.business_id=p_business_id and m.module_key='products' and m.enabled) then
    raise exception 'catalog_module_disabled' using errcode='42501';
  end if;

  -- Purchases are branch scoped, but ingredient/product costs are business
  -- wide. Restricted readers must never certify hidden branch receipts.
  v_pending := v_role not in ('owner','admin','manager','service_role') or exists(
    select 1 from public.purchases p where p.business_id=p_business_id and p.cost_refresh_pending
  );
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'name',p.name,'category',p.category,'price',p.price,'cost',p.cost,'active',p.active,
      'recipeId',r.id,'ingredientCount',coalesce(items.item_count,0),
      'recipeNeedsReview',coalesce(items.item_count,0)>0 and public.catalog_recipe_cost(p.id) is null
    ) order by p.active desc,p.name,p.id),'[]'::jsonb)
  into v_products
  from (select * from public.products where business_id=p_business_id
    order by active desc,name,id limit 50001) p
  left join public.recipes r on r.product_id=p.id
  left join lateral (
    select count(*) as item_count
    from public.recipe_items ri where ri.recipe_id=r.id
  ) items on true;
  if jsonb_array_length(v_products)>50000 then
    raise exception 'catalog_too_large' using errcode='54000';
  end if;
  return jsonb_build_object('businessId',p_business_id,'products',v_products,'costRefreshPending',v_pending);
end;
$$;
revoke all on function public.read_product_catalog_snapshot(uuid) from public,anon,service_role;
grant execute on function public.read_product_catalog_snapshot(uuid) to authenticated,service_role;
