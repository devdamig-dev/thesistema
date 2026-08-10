-- Harden recalc_ingredient_cost against cross-tenant execution.
-- The previous SECURITY DEFINER version bypassed RLS while accepting an arbitrary
-- ingredient UUID from any authenticated caller. SECURITY INVOKER keeps the
-- existing RLS boundary for authenticated users, while service_role remains
-- explicitly allowed for trusted server-side flows.

create or replace function public.recalc_ingredient_cost(p_ingredient_id uuid)
returns numeric
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_avg numeric(12,2);
begin
  select coalesce(
    case
      when sum(qty) > 0 then sum(unit_price * qty) / sum(qty)
      else null
    end,
    (select avg_unit_cost from ingredients where id = p_ingredient_id)
  )
  into v_avg
  from (
    select pi.unit_price, pi.qty
    from purchase_items pi
    where pi.ingredient_id = p_ingredient_id
    order by pi.created_at desc
    limit 5
  ) recent;

  update ingredients
     set avg_unit_cost = coalesce(v_avg, avg_unit_cost)
   where id = p_ingredient_id;

  return v_avg;
end;
$$;

revoke execute on function public.recalc_ingredient_cost(uuid) from public, anon;
grant execute on function public.recalc_ingredient_cost(uuid) to authenticated, service_role;
