-- 0030_manual_stock_adjustment.sql
-- Movimiento manual de stock atómico y auditable.
-- La función corre como SECURITY INVOKER: respeta RLS y permisos de la sesión.

create or replace function public.adjust_stock_manual(
  p_ingredient_id uuid,
  p_branch_id uuid,
  p_operation text,
  p_quantity numeric
)
returns table (
  stock_item_id uuid,
  new_current numeric,
  delta numeric
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_branch_business uuid;
  v_ingredient_business uuid;
  v_stock public.stock_items%rowtype;
  v_delta numeric;
  v_new_current numeric;
begin
  if p_operation not in ('in', 'out', 'set') then
    raise exception 'invalid_stock_operation' using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity < 0 or (p_operation <> 'set' and p_quantity <= 0) then
    raise exception 'invalid_stock_quantity' using errcode = '22023';
  end if;

  select b.business_id
    into v_branch_business
  from public.branches b
  where b.id = p_branch_id;

  if v_branch_business is null then
    raise exception 'branch_not_found_or_forbidden' using errcode = 'P0002';
  end if;

  select i.business_id
    into v_ingredient_business
  from public.ingredients i
  where i.id = p_ingredient_id;

  if v_ingredient_business is null or v_ingredient_business <> v_branch_business then
    raise exception 'ingredient_not_found_or_forbidden' using errcode = 'P0002';
  end if;

  -- Crea el registro base si todavía no existe. La policy de INSERT valida
  -- acceso a la sucursal y rol de escritura.
  insert into public.stock_items (ingredient_id, branch_id, current, min)
  values (p_ingredient_id, p_branch_id, 0, 0)
  on conflict (ingredient_id, branch_id) do nothing;

  select *
    into v_stock
  from public.stock_items
  where ingredient_id = p_ingredient_id
    and branch_id = p_branch_id
  for update;

  if not found then
    raise exception 'stock_item_not_found_or_forbidden' using errcode = 'P0002';
  end if;

  if p_operation = 'in' then
    v_delta := p_quantity;
    v_new_current := v_stock.current + p_quantity;
  elsif p_operation = 'out' then
    v_delta := -p_quantity;
    v_new_current := v_stock.current - p_quantity;
  else
    v_new_current := p_quantity;
    v_delta := p_quantity - v_stock.current;
  end if;

  if v_new_current < 0 then
    raise exception 'insufficient_stock' using errcode = '22003';
  end if;

  update public.stock_items
  set current = v_new_current
  where id = v_stock.id;

  -- La cantidad firmada preserva el sentido del movimiento para auditoría.
  insert into public.stock_movements (
    ingredient_id,
    branch_id,
    reason,
    qty,
    ref_type,
    ref_id
  ) values (
    p_ingredient_id,
    p_branch_id,
    'manual_adjust',
    v_delta,
    'stock_item',
    v_stock.id
  );

  stock_item_id := v_stock.id;
  new_current := v_new_current;
  delta := v_delta;
  return next;
end;
$$;

revoke all on function public.adjust_stock_manual(uuid, uuid, text, numeric) from public;
revoke all on function public.adjust_stock_manual(uuid, uuid, text, numeric) from anon;
grant execute on function public.adjust_stock_manual(uuid, uuid, text, numeric) to authenticated, service_role;
