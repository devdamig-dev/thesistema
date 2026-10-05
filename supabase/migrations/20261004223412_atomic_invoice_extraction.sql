-- Finalize OCR/AI extraction as one transaction. The service-role caller is
-- not trusted for tenant or actor authorization: both are revalidated here.
create or replace function public.finalize_invoice_extraction_atomic(
  p_invoice_id uuid,
  p_business_id uuid,
  p_actor_id uuid,
  p_invoice_data jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_roles public.role_key[];
  v_invoice public.invoices%rowtype;
  v_supplier_id uuid;
  v_supplier_name text := nullif(btrim(p_invoice_data->>'supplier'), '');
  v_tax_id text := nullif(btrim(p_invoice_data->>'tax_id'), '');
  v_payment_method text := coalesce(nullif(btrim(p_invoice_data->>'payment_method'), ''), 'Pendiente');
  v_invoice_type text := coalesce(nullif(p_invoice_data->>'invoice_type', ''), 'B');
  v_invoice_number text := nullif(btrim(p_invoice_data->>'invoice_number'), '');
  v_invoice_date date;
  v_due_date date;
  v_subtotal numeric;
  v_tax numeric;
  v_total numeric;
  v_confidence numeric;
  v_source text := p_invoice_data->>'source';
  v_status public.invoice_lifecycle;
  v_item_count integer;
  v_matched_count integer;
  v_ambiguous_count integer;
begin
  if p_invoice_id is null
    or p_business_id is null
    or p_actor_id is null
    or jsonb_typeof(p_invoice_data) <> 'object'
    or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_arguments');
  end if;

  select array_agg(member.role)
    into v_roles
  from public.business_members member
  join public.profiles profile
    on profile.id = member.user_id
   and profile.active = true
  where member.business_id = p_business_id
    and member.user_id = p_actor_id;

  if coalesce(cardinality(v_roles), 0) <> 1 then
    return jsonb_build_object('ok', false, 'error', 'membership_not_found');
  end if;
  if v_roles[1] not in ('owner', 'admin', 'manager') then
    return jsonb_build_object('ok', false, 'error', 'permission_denied');
  end if;

  select invoice.*
    into v_invoice
  from public.invoices invoice
  where invoice.id = p_invoice_id
    and invoice.business_id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invoice_not_found');
  end if;

  if v_invoice.status in ('extracted', 'needs_review') and exists (
    select 1
    from public.invoice_processing_logs log
    where log.invoice_id = v_invoice.id
      and log.stage = 'matching'
      and log.ok = true
      and coalesce((log.data->>'atomic')::boolean, false) = true
  ) then
    select count(*) into v_item_count
    from public.invoice_items item
    where item.invoice_id = v_invoice.id;
    return jsonb_build_object(
      'ok', true,
      'already_finalized', true,
      'invoice_id', v_invoice.id,
      'supplier_id', v_invoice.supplier_id,
      'status', v_invoice.status,
      'item_count', v_item_count
    );
  end if;

  if v_invoice.status not in ('uploaded', 'processing', 'failed') then
    return jsonb_build_object('ok', false, 'error', 'invoice_not_finalizable');
  end if;

  if v_invoice_type not in ('A', 'B', 'C')
    or v_source not in ('claude', 'heuristic')
    or v_invoice_number is null
    or length(v_invoice_number) > 120
    or (v_supplier_name is not null and length(v_supplier_name) > 200)
    or (v_tax_id is not null and length(v_tax_id) > 32)
    or length(v_payment_method) > 100
    or coalesce(jsonb_array_length(p_items), 0) > 500 then
    return jsonb_build_object('ok', false, 'error', 'invalid_extraction');
  end if;

  begin
    v_invoice_date := (p_invoice_data->>'invoice_date')::date;
    v_due_date := nullif(p_invoice_data->>'due_date', '')::date;
    v_subtotal := coalesce((p_invoice_data->>'subtotal')::numeric, 0);
    v_tax := coalesce((p_invoice_data->>'tax')::numeric, 0);
    v_total := coalesce((p_invoice_data->>'total')::numeric, 0);
    v_confidence := (p_invoice_data->>'confidence')::numeric;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_extraction');
  end;

  if v_invoice_date is null
    or v_confidence is null
    or v_subtotal < 0 or v_subtotal > 1000000000000000
    or v_tax < 0 or v_tax > 1000000000000000
    or v_total < 0 or v_total > 1000000000000000
    or v_confidence < 0 or v_confidence > 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_extraction');
  end if;

  begin
    if exists (
      select 1
      from jsonb_array_elements(p_items) as entry(item)
      where jsonb_typeof(item) <> 'object'
        or nullif(btrim(item->>'description'), '') is null
        or length(item->>'description') > 500
        or nullif(btrim(item->>'unit'), '') is null
        or length(item->>'unit') > 20
        or nullif(item->>'qty', '') is null
        or (item->>'qty')::numeric <= 0
        or (item->>'qty')::numeric > 1000000000
        or nullif(item->>'unit_price', '') is null
        or (item->>'unit_price')::numeric < 0
        or (item->>'unit_price')::numeric > 1000000000000000
        or nullif(item->>'total', '') is null
        or (item->>'total')::numeric < 0
        or (item->>'total')::numeric > 1000000000000000
        or coalesce(item->>'match_status', '') not in ('matched', 'ambiguous', 'unmatched')
        or (
          item->>'match_status' = 'matched'
          and nullif(item->>'matched_ingredient_id', '') is null
        )
    ) then
      return jsonb_build_object('ok', false, 'error', 'invalid_invoice_item');
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_items) as entry(item)
      where coalesce(
        nullif(item->>'matched_ingredient_id', '')::uuid,
        nullif(item->>'suggested_ingredient_id', '')::uuid
      ) is not null
      and not exists (
        select 1
        from public.ingredients ingredient
        where ingredient.id = coalesce(
          nullif(item->>'matched_ingredient_id', '')::uuid,
          nullif(item->>'suggested_ingredient_id', '')::uuid
        )
          and ingredient.business_id = p_business_id
      )
    ) then
      return jsonb_build_object('ok', false, 'error', 'invalid_ingredient');
    end if;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_invoice_item');
  end;

  if v_supplier_name is not null then
    -- Serialize supplier lookup/creation for this tenant/name pair so two
    -- concurrent OCR jobs cannot create duplicate suppliers.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_business_id::text || ':' || lower(v_supplier_name), 0)
    );

    select supplier.id
      into v_supplier_id
    from public.suppliers supplier
    where supplier.business_id = p_business_id
      and lower(btrim(supplier.name)) = lower(v_supplier_name)
    order by supplier.created_at, supplier.id
    limit 1;

    if v_supplier_id is null then
      insert into public.suppliers (business_id, name, tax_id)
      values (p_business_id, v_supplier_name, v_tax_id)
      returning id into v_supplier_id;
    end if;
  end if;

  delete from public.invoice_items item
  where item.invoice_id = v_invoice.id;

  insert into public.invoice_items (
    invoice_id,
    description,
    qty,
    qty_numeric,
    unit,
    unit_price,
    total,
    match_status,
    match_score,
    suggested_ingredient_id,
    matched_ingredient_id
  )
  select
    v_invoice.id,
    item->>'description',
    item->>'qty',
    (item->>'qty')::numeric,
    item->>'unit',
    (item->>'unit_price')::numeric,
    (item->>'total')::numeric,
    (item->>'match_status')::public.item_match_status,
    nullif(item->>'match_score', '')::numeric,
    nullif(item->>'suggested_ingredient_id', '')::uuid,
    nullif(item->>'matched_ingredient_id', '')::uuid
  from jsonb_array_elements(p_items) as entry(item);
  get diagnostics v_item_count = row_count;

  select
    count(*) filter (where item->>'match_status' = 'matched'),
    count(*) filter (where item->>'match_status' = 'ambiguous')
  into v_matched_count, v_ambiguous_count
  from jsonb_array_elements(p_items) as entry(item);

  v_status := case
    when v_confidence >= 0.7 then 'extracted'::public.invoice_lifecycle
    else 'needs_review'::public.invoice_lifecycle
  end;

  update public.invoices
  set supplier_id = v_supplier_id,
      number = v_invoice_number,
      type = v_invoice_type::public.invoice_type,
      tax_id = v_tax_id,
      invoice_date = v_invoice_date,
      due_date = v_due_date,
      payment_method = v_payment_method,
      subtotal = v_subtotal,
      tax = v_tax,
      total = v_total,
      confidence = v_confidence,
      ai_provider = v_source,
      status = v_status,
      processing_completed_at = pg_catalog.now(),
      processing_error = null
  where id = v_invoice.id
    and business_id = p_business_id;

  if not found then
    raise exception 'invoice_update_race';
  end if;

  insert into public.invoice_processing_logs (invoice_id, stage, ok, data)
  values
    (
      v_invoice.id,
      'ai',
      true,
      jsonb_build_object(
        'source', v_source,
        'items', v_item_count,
        'confidence', v_confidence,
        'atomic', true
      )
    ),
    (
      v_invoice.id,
      'matching',
      true,
      jsonb_build_object(
        'items', v_item_count,
        'matched', v_matched_count,
        'ambiguous', v_ambiguous_count,
        'unmatched', v_item_count - v_matched_count - v_ambiguous_count,
        'atomic', true
      )
    );

  return jsonb_build_object(
    'ok', true,
    'already_finalized', false,
    'invoice_id', v_invoice.id,
    'supplier_id', v_supplier_id,
    'status', v_status,
    'item_count', v_item_count
  );
end;
$$;

revoke execute on function public.finalize_invoice_extraction_atomic(uuid, uuid, uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_invoice_extraction_atomic(uuid, uuid, uuid, jsonb, jsonb)
  to service_role;
