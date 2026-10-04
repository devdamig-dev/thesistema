-- Approve one invoice exactly once. PostgreSQL functions run in the caller's
-- transaction, so purchase, items, stock, status and audit either all commit
-- or all roll back together.

create unique index if not exists purchases_invoice_id_unique
  on public.purchases(invoice_id)
  where invoice_id is not null;

create or replace function public.approve_invoice_atomic(
  p_invoice_id uuid,
  p_business_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_roles public.role_key[];
  v_role public.role_key;
  v_actor_name text;
  v_invoice public.invoices%rowtype;
  v_purchase_id uuid;
  v_stock_branch_id uuid;
  v_ingredient_ids uuid[] := array[]::uuid[];
  v_ingredient_id uuid;
  v_item_count integer := 0;
  v_stock_count integer := 0;
begin
  if p_invoice_id is null or p_business_id is null or p_actor_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  select array_agg(member.role)
    into v_roles
  from public.business_members member
  where member.business_id = p_business_id
    and member.user_id = p_actor_id;

  if coalesce(cardinality(v_roles), 0) <> 1 then
    return jsonb_build_object('ok', false, 'error', 'membership_not_found');
  end if;

  v_role := v_roles[1];
  if v_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  select profile.full_name
    into v_actor_name
  from public.profiles profile
  where profile.id = p_actor_id;

  select invoice.*
    into v_invoice
  from public.invoices invoice
  where invoice.id = p_invoice_id
    and invoice.business_id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invoice_not_found');
  end if;

  if v_invoice.status in ('approved', 'sent_to_accountant') then
    select purchase.id
      into v_purchase_id
    from public.purchases purchase
    where purchase.invoice_id = v_invoice.id;

    if v_purchase_id is null then
      return jsonb_build_object('ok', false, 'error', 'approval_inconsistent');
    end if;

    return jsonb_build_object(
      'ok', true,
      'already_approved', true,
      'invoice_id', v_invoice.id,
      'purchase_id', v_purchase_id,
      'invoice_number', v_invoice.number,
      'item_count', 0,
      'stock_count', 0,
      'ingredient_ids', jsonb_build_array()
    );
  end if;

  if v_invoice.status not in ('extracted', 'needs_review', 'rejected') then
    return jsonb_build_object('ok', false, 'error', 'invoice_not_approvable');
  end if;

  if v_invoice.supplier_id is not null and not exists (
    select 1 from public.suppliers supplier
    where supplier.id = v_invoice.supplier_id
      and supplier.business_id = p_business_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_supplier');
  end if;

  if v_invoice.branch_id is not null and not exists (
    select 1 from public.branches branch
    where branch.id = v_invoice.branch_id
      and branch.business_id = p_business_id
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_branch');
  end if;

  select count(*)
    into v_item_count
  from public.invoice_items item
  where item.invoice_id = v_invoice.id;

  if v_item_count = 0 then
    return jsonb_build_object('ok', false, 'error', 'invoice_items_required');
  end if;

  if exists (
    select 1
    from public.invoice_items item
    where item.invoice_id = v_invoice.id
      and (
        coalesce(item.qty_numeric, 0) < 0
        or item.unit_price < 0
        or item.total < 0
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_invoice_item');
  end if;

  if exists (
    select 1
    from public.invoice_items item
    where item.invoice_id = v_invoice.id
      and coalesce(item.matched_ingredient_id, item.suggested_ingredient_id) is not null
      and not exists (
        select 1 from public.ingredients ingredient
        where ingredient.id = coalesce(item.matched_ingredient_id, item.suggested_ingredient_id)
          and ingredient.business_id = p_business_id
      )
  ) then
    return jsonb_build_object('ok', false, 'error', 'invalid_ingredient');
  end if;

  select coalesce(
    array_agg(distinct coalesce(item.matched_ingredient_id, item.suggested_ingredient_id))
      filter (where coalesce(item.matched_ingredient_id, item.suggested_ingredient_id) is not null),
    array[]::uuid[]
  )
    into v_ingredient_ids
  from public.invoice_items item
  where item.invoice_id = v_invoice.id;

  v_stock_branch_id := v_invoice.branch_id;
  if cardinality(v_ingredient_ids) > 0 and v_stock_branch_id is null then
    select branch.id
      into v_stock_branch_id
    from public.branches branch
    where branch.business_id = p_business_id
    order by branch.is_main desc, branch.created_at, branch.id
    limit 1;
  end if;

  if cardinality(v_ingredient_ids) > 0 and v_stock_branch_id is null then
    return jsonb_build_object('ok', false, 'error', 'stock_branch_not_found');
  end if;

  insert into public.purchases (
    business_id,
    supplier_id,
    purchased_at,
    total,
    payment_method,
    invoice_id,
    created_by
  ) values (
    p_business_id,
    v_invoice.supplier_id,
    v_invoice.invoice_date,
    v_invoice.total,
    v_invoice.payment_method,
    v_invoice.id,
    p_actor_id
  )
  returning id into v_purchase_id;

  insert into public.purchase_items (
    purchase_id,
    ingredient_id,
    description,
    qty,
    unit,
    unit_price,
    total
  )
  select
    v_purchase_id,
    coalesce(item.matched_ingredient_id, item.suggested_ingredient_id),
    item.description,
    coalesce(item.qty_numeric, 0),
    item.unit,
    item.unit_price,
    item.total
  from public.invoice_items item
  where item.invoice_id = v_invoice.id;

  if cardinality(v_ingredient_ids) > 0 then
    insert into public.stock_movements (
      ingredient_id,
      branch_id,
      reason,
      qty,
      ref_type,
      ref_id
    )
    select
      coalesce(item.matched_ingredient_id, item.suggested_ingredient_id),
      v_stock_branch_id,
      'purchase',
      coalesce(item.qty_numeric, 0),
      'purchase',
      v_purchase_id
    from public.invoice_items item
    where item.invoice_id = v_invoice.id
      and coalesce(item.matched_ingredient_id, item.suggested_ingredient_id) is not null;
    get diagnostics v_stock_count = row_count;

    foreach v_ingredient_id in array v_ingredient_ids loop
      perform public.recalc_ingredient_cost(v_ingredient_id);
    end loop;
  end if;

  update public.invoices
  set status = 'approved'
  where id = v_invoice.id
    and business_id = p_business_id;

  if not found then
    raise exception 'invoice_update_race';
  end if;

  insert into public.invoice_processing_logs (invoice_id, stage, ok, data)
  values (
    v_invoice.id,
    'approval',
    true,
    jsonb_build_object('purchase_id', v_purchase_id, 'atomic', true)
  );

  insert into public.activity_logs (
    business_id,
    actor_id,
    actor_name,
    actor_role,
    action,
    target_type,
    target_id,
    summary,
    data
  ) values (
    p_business_id,
    p_actor_id,
    coalesce(v_actor_name, 'Usuario'),
    v_role::text,
    'invoice.approved',
    'invoices',
    v_invoice.id,
    format('Factura %s aprobada · %s ítems · compra creada.', v_invoice.number, v_item_count),
    jsonb_build_object(
      'invoice_id', v_invoice.id,
      'purchase_id', v_purchase_id,
      'ingredients_affected', cardinality(v_ingredient_ids),
      'atomic', true
    )
  );

  insert into public.notifications (
    business_id,
    tone,
    priority,
    category,
    title,
    detail,
    href,
    source
  ) values (
    p_business_id,
    'success',
    'medium',
    'system',
    'Factura aprobada e imputada',
    format('%s · %s ítems · stock actualizado.', v_invoice.number, v_item_count),
    '/facturas',
    'invoices'
  );

  return jsonb_build_object(
    'ok', true,
    'already_approved', false,
    'invoice_id', v_invoice.id,
    'purchase_id', v_purchase_id,
    'invoice_number', v_invoice.number,
    'item_count', v_item_count,
    'stock_count', v_stock_count,
    'ingredient_ids', to_jsonb(v_ingredient_ids)
  );
end;
$$;

revoke execute on function public.approve_invoice_atomic(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.approve_invoice_atomic(uuid, uuid, uuid)
  to service_role;
