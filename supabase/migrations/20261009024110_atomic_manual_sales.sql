-- C: retain sales as the accounting source; old rows are UNKNOWN detail/origin.
-- No historical quantities, tickets, currency or stock movements are backfilled.
alter table public.sales
 add column status text not null default 'active' check(status in ('active','voided')),
 add column sale_kind text not null default 'legacy' check(sale_kind in ('legacy','detailed','summary')),
 add column source text check(source in ('manual','whatsapp','inbox','api','system')),
 add column payment_method text,
 add column customer_id uuid references public.customers(id) on delete restrict,
 add column notes text,
 add column currency text,
 add column version integer not null default 0 check(version>=0),
 add column void_reason text,
 add column voided_at timestamptz,
 add column voided_by uuid,
 add column created_by uuid,
 add constraint sales_scope_identity unique(id,business_id),
 add constraint sales_void_complete check((status='active' and void_reason is null and voided_at is null and voided_by is null)
   or (status='voided' and length(btrim(void_reason)) between 1 and 1000 and voided_at is not null and voided_by is not null));
create index sales_active_period_idx on public.sales(business_id,branch_id,occurred_at,id) where status='active';
alter table public.balance_snapshots add column sales_data_stale boolean not null default false;
create index sales_customer_idx on public.sales(customer_id) where customer_id is not null;
create table public.sale_items (
 id uuid primary key default gen_random_uuid(), sale_id uuid not null, business_id uuid not null,
 position integer not null check(position between 1 and 100), product_id uuid references public.products(id) on delete restrict,
 description text not null, quantity numeric(18,6) not null check(quantity>0), unit_price numeric(12,2) not null check(unit_price>=0),
 total numeric(12,2) not null check(total>=0), recipe_snapshot jsonb,
 created_at timestamptz not null default now(), unique(sale_id,position),
 foreign key(sale_id,business_id) references public.sales(id,business_id) on delete restrict
);
create index sale_items_product_idx on public.sale_items(product_id) where product_id is not null;
-- Receipts survive later edits/voids. Before/after captures include the original
-- item quantities and BOM used for each revision, not the current recipe.
create table public.sale_mutations (
 request_id uuid not null, business_id uuid not null, branch_id uuid, sale_id uuid not null,
 actor_id uuid not null, actor_role text not null, source text not null, operation text not null,
 payload jsonb not null, result jsonb not null, before_snapshot jsonb, after_snapshot jsonb not null,
 activity_log_id uuid not null references public.activity_logs(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(business_id,request_id),
 foreign key(sale_id,business_id) references public.sales(id,business_id) on delete restrict
);
create index sale_mutations_history_idx on public.sale_mutations(sale_id,created_at,request_id);
create index sale_mutations_activity_idx on public.sale_mutations(activity_log_id);
alter table public.sale_items enable row level security;
alter table public.sale_mutations enable row level security;
-- Direct Data API writes are intentionally unavailable, including service_role.
-- Only narrowly authorized private mutation functions may write sales/history.
revoke all on public.sale_items,public.sale_mutations from public,anon,authenticated,service_role;
grant select on public.sale_items,public.sale_mutations to authenticated,service_role;
revoke insert,update,delete,truncate,references,trigger on public.sales from anon,authenticated,service_role;
create policy sales_active_profile on public.sales as restrictive for select to authenticated
 using(exists(select 1 from public.profiles where id=auth.uid() and active));
create policy sale_items_read on public.sale_items for select to authenticated using(exists(
 select 1 from public.sales s where s.id=sale_id and s.business_id=sale_items.business_id));
create policy sale_mutations_read on public.sale_mutations for select to authenticated using(
 public.can_access_business_branch(business_id,branch_id) and exists(select 1 from public.profiles where id=auth.uid() and active));
create schema sales_private;
revoke all on schema sales_private from public,anon;
grant usage on schema sales_private to authenticated,service_role;

-- Audit reads must respect the ORIGINAL branch even when an edit moves a sale.
create function sales_private.can_read_log(p_log uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare m public.sale_mutations%rowtype;
begin
 select * into m from public.sale_mutations where activity_log_id=p_log;
 if not found then return true; end if;
 return auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active)
   and public.can_access_business_branch(m.business_id,m.branch_id)
   and (m.before_snapshot is null or public.can_access_business_branch(m.business_id,(m.before_snapshot->'sale'->>'branch_id')::uuid));
end $$;
revoke all on function sales_private.can_read_log(uuid) from public,anon,service_role;
grant execute on function sales_private.can_read_log(uuid) to authenticated;
create policy sales_log_scope on public.activity_logs as restrictive for select to authenticated using(sales_private.can_read_log(id));
-- The mutation receipt itself contains both branches; require both.
create policy sale_mutations_before_scope on public.sale_mutations as restrictive for select to authenticated using(
 before_snapshot is null or public.can_access_business_branch(business_id,(before_snapshot->'sale'->>'branch_id')::uuid));

create function sales_private.require_keys(p jsonb,allowed text[]) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>cardinality(allowed)
  or exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed)) then raise exception 'sale_invalid_input'; end if;
end $$;
create function sales_private.actor_role(p_business uuid,p_branch uuid,p_actor uuid,p_allow_null_branch boolean default false)
returns text language plpgsql set search_path='' as $$
declare m public.business_members%rowtype;
begin
 if p_actor is null then raise exception 'sale_permission_denied' using errcode='42501'; end if;
 perform 1 from public.profiles where id=p_actor and active for share;
 if not found then raise exception 'sale_permission_denied' using errcode='42501'; end if;
 select * into m from public.business_members where business_id=p_business and user_id=p_actor for share;
 if m.id is null or m.role::text not in ('owner','admin','manager','employee','kitchen','cashier','waiter','delivery') then
  raise exception 'sale_permission_denied' using errcode='42501'; end if;
 perform 1 from public.business_modules where business_id=p_business and module_key='sales' and enabled for share;
 if not found then raise exception 'sale_module_disabled' using errcode='42501'; end if;
 if p_branch is null then
  if not p_allow_null_branch then raise exception 'sale_branch_forbidden' using errcode='42501'; end if;
  if m.role::text not in ('owner','admin','manager') then
   perform 1 from public.branch_assignments ba join public.branches b on b.id=ba.branch_id where ba.business_member_id=m.id and b.business_id=p_business for share of ba;
   if not found then raise exception 'sale_branch_forbidden' using errcode='42501'; end if;
  end if;
 else
  perform 1 from public.branches where id=p_branch and business_id=p_business for share;
  if not found then raise exception 'sale_branch_forbidden' using errcode='42501'; end if;
  if m.role::text not in ('owner','admin','manager') then
   perform 1 from public.branch_assignments where business_member_id=m.id and branch_id=p_branch for share;
   if not found then raise exception 'sale_branch_forbidden' using errcode='42501'; end if;
  end if;
 end if;
 return m.role::text;
end $$;
create function sales_private.snapshot(p_sale uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('sale',to_jsonb(s),'items',coalesce((select jsonb_agg(to_jsonb(i)||jsonb_build_object('quantity',i.quantity::text,'unit_price',i.unit_price::text,'total',i.total::text) order by position) from public.sale_items i where sale_id=s.id),'[]'::jsonb)) from public.sales s where s.id=p_sale
$$;
create function sales_private.bom(p_product uuid,p_quantity numeric) returns jsonb language plpgsql set search_path='' as $$
declare r public.recipes%rowtype; parts jsonb; complete boolean;
begin
 select * into r from public.recipes where product_id=p_product order by id limit 1 for share;
 if r.id is null then return jsonb_build_object('recipeId',null,'recipeUpdatedAt',null,'state','none','ingredients','[]'::jsonb); end if;
 -- A single statement snapshots every component consistently. No interpretation
 -- of legacy qty text, cost backfill, or mutation of the physical stock ledger.
 select jsonb_agg(jsonb_build_object('ingredientId',ri.ingredient_id,'name',ri.name,
  'quantity',ri.quantity::text,'unit',ri.unit,'baseUnit',i.unit,
  'baseQuantity',case when i.business_id=p.business_id then (ri.quantity*public.catalog_unit_factor(ri.unit,i.unit))::text end,
  'theoreticalQuantity',case when i.business_id=p.business_id then (p_quantity*ri.quantity*public.catalog_unit_factor(ri.unit,i.unit))::text end) order by ri.id),
  bool_and(ri.quantity is not null and i.id is not null and i.business_id=p.business_id and public.catalog_unit_factor(ri.unit,i.unit) is not null)
 into parts,complete from public.recipe_items ri join public.products p on p.id=p_product left join public.ingredients i on i.id=ri.ingredient_id where ri.recipe_id=r.id;
 return jsonb_build_object('recipeId',r.id,'recipeUpdatedAt',r.updated_at,'state',case when parts is null then 'none' when complete then 'complete' else 'incomplete' end,'ingredients',coalesce(parts,'[]'::jsonb));
end $$;

-- Shared transaction engine. NOT executable by API roles. Its only callers are
-- private, identity-bound manual/agent/Inbox entry points below.
create function sales_private.mutate(p_business uuid,p_actor uuid,p_source text,p_operation text,p_input jsonb,p_summary boolean default false)
returns jsonb language plpgsql set search_path='' as $$
declare
 v_id uuid; v_request uuid; v_branch uuid; v_role text; v_receipt public.sale_mutations%rowtype;
 v_sale public.sales%rowtype; v_before jsonb; v_after jsonb; v_result jsonb; v_payload jsonb;
 v_item jsonb; v_items jsonb:='[]'; v_qty numeric; v_price numeric; v_total numeric:=0; v_line numeric;
 v_product public.products%rowtype; v_old_item public.sale_items%rowtype; v_snapshot jsonb; v_at timestamptz; v_pos integer:=0; v_log uuid;
begin
 if p_source not in ('manual','whatsapp','inbox') or p_operation not in ('save','void') then raise exception 'sale_invalid_input'; end if;
 if p_summary and p_source<>'inbox' then raise exception 'sale_invalid_input'; end if;
 if p_operation='void' then
  perform sales_private.require_keys(p_input,array['requestId','businessId','userId','id','expectedVersion','reason']);
 else
  perform sales_private.require_keys(p_input,array['requestId','businessId','userId','id','expectedVersion','branchId','occurredAt','channel','paymentMethod','customerId','notes','items'] || case when p_summary then array['summaryAmount'] else array[]::text[] end);
 end if;
 if (p_input->>'businessId')::uuid is distinct from p_business or (p_input->>'userId')::uuid is distinct from p_actor then raise exception 'sale_context_changed' using errcode='42501'; end if;
 v_request:=(p_input->>'requestId')::uuid; v_id:=(p_input->>'id')::uuid;
 if v_request is null then raise exception 'sale_invalid_input'; end if;
 -- Same key is serialized before any writes; collisions only serialize unrelated
 -- commands, they never change identity. Receipt equality is exact JSONB.
 perform pg_advisory_xact_lock(hashtextextended(p_business::text||v_request::text,0));
 v_payload:=jsonb_build_object('operation',p_operation,'source',p_source,'summary',p_summary,'input',p_input);
 select * into v_receipt from public.sale_mutations where business_id=p_business and request_id=v_request;
 if found then
  perform sales_private.actor_role(p_business,v_receipt.branch_id,p_actor,true);
  if v_receipt.before_snapshot is not null then perform sales_private.actor_role(p_business,(v_receipt.before_snapshot->'sale'->>'branch_id')::uuid,p_actor,true); end if;
  if v_receipt.actor_id<>p_actor or v_receipt.payload<>v_payload then raise exception 'sale_idempotency_conflict'; end if;
  return v_receipt.result;
 end if;
 if v_id is not null then
  select * into v_sale from public.sales where id=v_id and business_id=p_business for update;
  if not found then raise exception 'sale_not_found'; end if;
  v_role:=sales_private.actor_role(p_business,v_sale.branch_id,p_actor,true);
  if jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or p_input->>'expectedVersion' !~ '^[0-9]+$' or (p_input->>'expectedVersion')::numeric<>v_sale.version then raise exception 'sale_conflict'; end if;
  if v_sale.status<>'active' then raise exception 'sale_already_voided'; end if;
  v_before:=sales_private.snapshot(v_id);
 elsif p_operation='void' or p_input->>'expectedVersion' is not null then raise exception 'sale_invalid_input';
 end if;
 if p_operation='void' then
  if jsonb_typeof(p_input->'reason') is distinct from 'string' or length(btrim(p_input->>'reason')) not between 1 and 1000 or translate(p_input->>'reason',E'\n\r\t','') ~ '[[:cntrl:]]' then raise exception 'sale_invalid_input'; end if;
  v_branch:=v_sale.branch_id;
  update public.sales set status='voided',void_reason=btrim(p_input->>'reason'),voided_at=clock_timestamp(),voided_by=p_actor,version=version+1 where id=v_id returning * into v_sale;
 else
  v_branch:=(p_input->>'branchId')::uuid;
  v_role:=sales_private.actor_role(p_business,v_branch,p_actor);
  if v_id is not null and (v_sale.sale_kind<>'detailed' or p_summary) then raise exception 'sale_detail_required'; end if;
  if p_input->>'occurredAt' is null or p_input->>'occurredAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'sale_invalid_date'; end if;
  if substring(p_input->>'occurredAt' from 12 for 2)::int>23 or substring(p_input->>'occurredAt' from 15 for 2)::int>59 or substring(p_input->>'occurredAt' from 18 for 2)::int>59 then raise exception 'sale_invalid_date'; end if;
  v_at:=(p_input->>'occurredAt')::timestamptz;
  if not isfinite(v_at) or v_at>clock_timestamp()+interval '5 minutes' then raise exception 'sale_invalid_date'; end if;
  if p_input->>'channel' is null or p_input->>'channel' not in ('salon','delivery','whatsapp','pedidos_ya','rappi','mp_qr') then raise exception 'sale_invalid_input'; end if;
  if (not p_summary and (jsonb_typeof(p_input->'paymentMethod') is distinct from 'string' or length(btrim(p_input->>'paymentMethod')) not between 1 and 80))
    or (p_input->>'paymentMethod' is not null and (jsonb_typeof(p_input->'paymentMethod')<>'string' or length(btrim(p_input->>'paymentMethod')) not between 1 and 80 or p_input->>'paymentMethod' ~ '[[:cntrl:]]'))
    or (p_input->>'notes' is not null and (jsonb_typeof(p_input->'notes')<>'string' or length(p_input->>'notes')>2000 or translate(p_input->>'notes',E'\n\r\t','') ~ '[[:cntrl:]]')) then raise exception 'sale_invalid_input'; end if;
  if p_input->>'customerId' is not null then
   perform 1 from public.customers where id=(p_input->>'customerId')::uuid and business_id=p_business and (active or id=v_sale.customer_id) for share;
   if not found then raise exception 'sale_customer_forbidden'; end if;
  end if;
  if jsonb_typeof(p_input->'items') is distinct from 'array' then raise exception 'sale_invalid_input'; end if;
  if p_summary then
   if jsonb_array_length(p_input->'items')<>0 or p_input->>'summaryAmount' is null or p_input->>'summaryAmount' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$' then raise exception 'sale_invalid_input'; end if;
   v_total:=(p_input->>'summaryAmount')::numeric;
  else
   if jsonb_array_length(p_input->'items') not between 1 and 100 then raise exception 'sale_invalid_input'; end if;
   -- Product locking is deterministic across multi-line commands.
   perform 1 from public.products where id in(select (x->>'productId')::uuid from jsonb_array_elements(p_input->'items') x) order by id for share;
   for v_item in select * from jsonb_array_elements(p_input->'items') loop
    perform sales_private.require_keys(v_item,array['id','productId','description','quantity','unitPrice']);
    v_old_item:=null;
    if v_item->>'id' is not null then
     select * into v_old_item from public.sale_items where id=(v_item->>'id')::uuid and sale_id=v_id;
     if not found then raise exception 'sale_line_forbidden'; end if;
     if exists(select 1 from jsonb_array_elements(v_items) x where x->>'id'=v_item->>'id') then raise exception 'sale_invalid_input'; end if;
    end if;
    if jsonb_typeof(v_item->'description') is distinct from 'string' or length(btrim(v_item->>'description')) not between 1 and 200 or v_item->>'description' ~ '[[:cntrl:]]'
     or jsonb_typeof(v_item->'quantity') is distinct from 'string' or v_item->>'quantity' !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
     or jsonb_typeof(v_item->'unitPrice') is distinct from 'string' or v_item->>'unitPrice' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$' then raise exception 'sale_invalid_input'; end if;
    v_qty:=(v_item->>'quantity')::numeric; v_price:=(v_item->>'unitPrice')::numeric;
    if v_qty<=0 then raise exception 'sale_invalid_quantity'; end if;
    v_line:=round(v_qty*v_price,2); v_total:=v_total+v_line; v_pos:=v_pos+1;
    if v_line>=10000000000 then raise exception 'sale_invalid_total'; end if;
    v_snapshot:=null;
    if v_item->>'productId' is not null then
     select * into v_product from public.products where id=(v_item->>'productId')::uuid and business_id=p_business;
     if not found or (not v_product.active and not exists(select 1 from public.sale_items where sale_id=v_id and product_id=v_product.id)) then raise exception 'sale_product_forbidden'; end if;
     if v_old_item.id is not null and v_old_item.product_id=v_product.id and v_old_item.recipe_snapshot is not null then
      -- Header/price edits never replace the sale's historical recipe with today's
      -- BOM. Quantity corrections scale the originally captured base quantities.
      v_snapshot:=v_old_item.recipe_snapshot;
      if v_old_item.quantity<>v_qty then
       select jsonb_set(v_snapshot,'{ingredients}',coalesce(jsonb_agg(x||jsonb_build_object('theoreticalQuantity',((x->>'baseQuantity')::numeric*v_qty)::text)),'[]'::jsonb)) into v_snapshot
        from jsonb_array_elements(v_snapshot->'ingredients') x;
      end if;
     else v_snapshot:=sales_private.bom(v_product.id,v_qty); end if;
    end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('id',coalesce(v_old_item.id,gen_random_uuid()),'created_at',coalesce(v_old_item.created_at,clock_timestamp()),'product_id',v_item->>'productId','description',btrim(v_item->>'description'),'quantity',v_qty,'unit_price',v_price,'total',v_line,'position',v_pos,'recipe_snapshot',v_snapshot));
   end loop;
  end if;
  if v_total<=0 or v_total>=10000000000 then raise exception 'sale_invalid_total'; end if;
  if v_id is null then
   insert into public.sales(business_id,branch_id,channel,amount,occurred_at,sale_kind,source,payment_method,customer_id,notes,version,created_by)
    values(p_business,v_branch,(p_input->>'channel')::public.sales_channel,v_total,v_at,case when p_summary then 'summary' else 'detailed' end,p_source,nullif(btrim(p_input->>'paymentMethod'),''),(p_input->>'customerId')::uuid,nullif(btrim(p_input->>'notes'),''),1,p_actor) returning * into v_sale;
   v_id:=v_sale.id;
  else
   update public.sales set branch_id=v_branch,channel=(p_input->>'channel')::public.sales_channel,amount=v_total,occurred_at=v_at,payment_method=btrim(p_input->>'paymentMethod'),customer_id=(p_input->>'customerId')::uuid,notes=nullif(btrim(p_input->>'notes'),''),version=version+1 where id=v_id returning * into v_sale;
   delete from public.sale_items where sale_id=v_id;
  end if;
  insert into public.sale_items(id,sale_id,business_id,product_id,description,quantity,unit_price,total,position,recipe_snapshot,created_at)
   select (x->>'id')::uuid,v_id,p_business,(x->>'product_id')::uuid,x->>'description',(x->>'quantity')::numeric,(x->>'unit_price')::numeric,(x->>'total')::numeric,(x->>'position')::integer,x->'recipe_snapshot',(x->>'created_at')::timestamptz from jsonb_array_elements(v_items) x;
 end if;
 -- Accounting snapshots contain other aggregates that cannot be recomputed
 -- from sales alone. Invalidate affected civil months, preserving every value.
 update public.balance_snapshots bs set sales_data_stale=true where bs.business_id=p_business
  and bs.period_month in (
   date_trunc('month',v_sale.occurred_at at time zone (select timezone from public.businesses where id=p_business))::date,
   date_trunc('month',(v_before->'sale'->>'occurred_at')::timestamptz at time zone (select timezone from public.businesses where id=p_business))::date
  );
 v_after:=sales_private.snapshot(v_id); v_result:=jsonb_build_object('ok',true,'id',v_id,'version',v_sale.version);
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
  select p_business,p_actor,full_name,v_role,case when p_operation='void' then 'sale.voided' when v_before is null then 'sale.created' else 'sale.updated' end,'sales',v_id,
   case when p_operation='void' then 'Venta anulada con historial conservado' when v_before is null then 'Venta registrada' else 'Venta actualizada' end,
   jsonb_build_object('source',p_source,'branch_id',v_branch,'result','success','request_id',v_request,'version',v_sale.version,'stock_effect','none') from public.profiles where id=p_actor returning id into v_log;
 insert into public.sale_mutations(request_id,business_id,branch_id,sale_id,actor_id,actor_role,source,operation,payload,result,before_snapshot,after_snapshot,activity_log_id)
  values(v_request,p_business,v_branch,v_id,p_actor,v_role,p_source,p_operation,v_payload,v_result,v_before,v_after,v_log);
 insert into sales_private.revisions(business_id,revision) values(p_business,1) on conflict(business_id) do update set revision=sales_private.revisions.revision+1;
 return v_result;
end $$;

-- Minimal SECURITY DEFINER entry points in a non-exposed schema. No trusted
-- context is read from client-settable GUCs. All actor checks run against live DB.
create function sales_private.manual(p_business uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or current_setting('role',true)<>'authenticated' then raise exception 'sale_permission_denied' using errcode='42501'; end if;
 return sales_private.mutate(p_business,auth.uid(),'manual',p_operation,p_input);
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'sale_%' then sqlerrm else 'sale_invalid_input' end);
end $$;
create function sales_private.agent(p_business uuid,p_actor uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' and session_user<>'service_role' then raise exception 'sale_permission_denied' using errcode='42501'; end if;
 return sales_private.mutate(p_business,p_actor,'whatsapp',p_operation,p_input);
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'sale_%' then sqlerrm else 'sale_invalid_input' end);
end $$;
revoke all on all functions in schema sales_private from public,anon,authenticated,service_role;
grant execute on function sales_private.can_read_log(uuid) to authenticated;
grant execute on function sales_private.manual(uuid,text,jsonb) to authenticated;
grant execute on function sales_private.agent(uuid,uuid,text,jsonb) to service_role;
create function public.save_sale_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select sales_private.manual(p_business_id,'save',p_input) $$;
create function public.void_sale_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select sales_private.manual(p_business_id,'void',p_input) $$;
create function public.mutate_sale_for_agent(p_business_id uuid,p_actor_id uuid,p_operation text,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select sales_private.agent(p_business_id,p_actor_id,p_operation,p_input) $$;
revoke all on function public.save_sale_atomic(uuid,jsonb),public.void_sale_atomic(uuid,jsonb),public.mutate_sale_for_agent(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_sale_atomic(uuid,jsonb),public.void_sale_atomic(uuid,jsonb) to authenticated;
grant execute on function public.mutate_sale_for_agent(uuid,uuid,text,jsonb) to service_role;

-- Inbox summary approval is explicit, atomic and replay-safe. Aggregated sales
-- never manufacture detail, a ticket count, payment method, currency or stock.
create table sales_private.inbox_receipts (
 extraction_id uuid primary key references public.ai_extractions(id) on delete restrict,
 business_id uuid not null, branch_id uuid not null, actor_id uuid not null,
 expected_fields jsonb not null, review jsonb not null, result jsonb not null
);
revoke all on sales_private.inbox_receipts from public,anon,authenticated,service_role;
create function sales_private.approve_inbox(p_business uuid,p_actor uuid,p_extraction uuid,p_expected jsonb,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype; receipt sales_private.inbox_receipts%rowtype;
 v_branch uuid; v_result jsonb; v_results jsonb:='[]'; c jsonb; n int:=0; v_input jsonb; ids uuid[]; v_role text;
begin
 if auth.uid() is null or p_actor is distinct from auth.uid() or current_setting('role',true)<>'authenticated' then raise exception 'sale_permission_denied'; end if;
 select * into e from public.ai_extractions where id=p_extraction for update;
 if not found or e.type<>'sale' then raise exception 'sale_not_found'; end if;
 select * into m from public.whatsapp_messages where id=e.message_id for share;
 if m.business_id is distinct from p_business or (e.business_id is not null and e.business_id<>p_business) then raise exception 'sale_permission_denied'; end if;
 perform sales_private.require_keys(p_review,array['kind','branchId','occurredAt','paymentMethod','notes','channels']);
 if p_review->>'kind' is distinct from 'summary' then raise exception 'sale_extraction_fields_required'; end if;
 v_branch:=(p_review->>'branchId')::uuid; v_role:=sales_private.actor_role(p_business,v_branch,p_actor);
 -- Delivery cannot see Inbox under the current app module matrix.
 if v_role='delivery' then raise exception 'sale_permission_denied'; end if;
 perform 1 from public.business_modules where business_id=p_business and module_key='inbox_ai' and enabled for share;
 if not found then raise exception 'sale_module_disabled'; end if;
 if (e.branch_id is not null and e.branch_id<>v_branch) or (m.branch_id is not null and m.branch_id<>v_branch) then raise exception 'sale_branch_forbidden'; end if;
 select * into receipt from sales_private.inbox_receipts where extraction_id=p_extraction;
 if found then
  if receipt.business_id<>p_business or receipt.actor_id<>p_actor or receipt.review<>p_review or receipt.expected_fields<>p_expected then raise exception 'sale_idempotency_conflict'; end if;
  return receipt.result;
 end if;
 if e.status not in ('pending','needs_review','failed') then raise exception 'sale_extraction_closed'; end if;
 if e.fields is distinct from p_expected then raise exception 'sale_extraction_changed'; end if;
 if jsonb_typeof(p_review->'channels') is distinct from 'array' or jsonb_array_length(p_review->'channels') not between 1 and 6 then raise exception 'sale_extraction_fields_required'; end if;
 if (select count(distinct x->>'channel') from jsonb_array_elements(p_review->'channels') x)<>jsonb_array_length(p_review->'channels') then raise exception 'sale_invalid_input'; end if;
 for c in select * from jsonb_array_elements(p_review->'channels') loop
  perform sales_private.require_keys(c,array['channel','amount']); n:=n+1;
  if jsonb_typeof(c->'amount') is distinct from 'string' then raise exception 'sale_invalid_input'; end if;
  v_input:=jsonb_build_object('requestId',md5(p_extraction::text||':sale:'||n)::uuid,'businessId',p_business,'userId',p_actor,'id',null,'expectedVersion',null,
   'branchId',v_branch,'occurredAt',p_review->>'occurredAt','channel',c->>'channel','paymentMethod',p_review->>'paymentMethod','customerId',null,'notes',p_review->>'notes','items','[]'::jsonb,'summaryAmount',c->>'amount');
  v_result:=sales_private.mutate(p_business,p_actor,'inbox','save',v_input,true);
  v_results:=v_results||jsonb_build_array(v_result); ids:=array_append(ids,(v_result->>'id')::uuid);
 end loop;
 update public.ai_extractions set status='approved',approved_at=clock_timestamp(),approved_by=p_actor,target_entity='sales',target_record_id=ids[1],branch_id=v_branch,
  fields=e.fields||jsonb_build_object('approved_sale_review',p_review) where id=p_extraction;
 v_result:=jsonb_build_object('ok',true,'id',ids[1],'version',1,'sales',v_results);
 insert into sales_private.inbox_receipts values(p_extraction,p_business,v_branch,p_actor,p_expected,p_review,v_result);
 return v_result;
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'sale_%' then sqlerrm else 'sale_invalid_input' end);
end $$;
revoke all on function sales_private.approve_inbox(uuid,uuid,uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function sales_private.approve_inbox(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
create function public.approve_sale_extraction_atomic(p_business_id uuid,p_actor_id uuid,p_extraction_id uuid,p_expected_fields jsonb,p_review jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select sales_private.approve_inbox(p_business_id,p_actor_id,p_extraction_id,p_expected_fields,p_review) $$;
revoke all on function public.approve_sale_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.approve_sale_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

-- Paged REST reads span transactions. A private, monotonic business revision
-- lets readers reject a mixed snapshot even when row counts remain unchanged.
create table sales_private.revisions (
 business_id uuid primary key references public.businesses(id) on delete cascade,
 revision bigint not null check(revision>=0)
);
revoke all on sales_private.revisions from public,anon,authenticated,service_role;
create function sales_private.read_revision(p_business uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare v bigint;
begin
 if not (current_setting('role',true)='service_role' or session_user='service_role') then
  if auth.uid() is null or not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id where m.business_id=p_business and m.user_id=auth.uid() and p.active) then
   raise exception 'sale_permission_denied' using errcode='42501'; end if;
 end if;
 select revision into v from sales_private.revisions where business_id=p_business;
 return coalesce(v,0)::text;
end $$;
revoke all on function sales_private.read_revision(uuid) from public,anon;
grant execute on function sales_private.read_revision(uuid) to authenticated,service_role;
create function public.get_sales_revision(p_business_id uuid) returns text language sql security invoker set search_path='' as $$ select sales_private.read_revision(p_business_id) $$;
revoke all on function public.get_sales_revision(uuid) from public,anon;
grant execute on function public.get_sales_revision(uuid) to authenticated,service_role;

-- Keep a durable recovery reference BEFORE invoking the sales transaction.
-- A process crash cannot erase the operation ID between claim and RPC. Only the
-- first confirmation of a fresh pending row wins; retries use the same payload.
create function public.claim_sales_pending_execution(p_business_id uuid,p_member_id uuid,p_conversation_id uuid,p_pending_id uuid,p_recovery boolean)
returns boolean language plpgsql security invoker set search_path='' as $$
declare pending public.whatsapp_agent_pending_operations%rowtype;
begin
 if current_user<>'service_role' then raise exception 'permission_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-pending:'||p_business_id::text||':'||p_member_id::text||':'||p_conversation_id::text,0));
 select * into pending from public.whatsapp_agent_pending_operations where id=p_pending_id and business_id=p_business_id and member_id=p_member_id and conversation_id=p_conversation_id and consumed_at is null for update;
 if not found or pending.kind<>'confirmation' or pending.tool_name not in ('sales.create','sales.edit','sales.void') or pending.expires_at<=now()
   or coalesce((pending.arguments->>'__resultUncertain')::boolean,false) is distinct from p_recovery then return false; end if;
 if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id where m.id=p_member_id and m.business_id=p_business_id and p.active)
  or not exists(select 1 from public.whatsapp_authorized_conversations where id=p_conversation_id and business_id=p_business_id and enabled) then return false; end if;
 update public.whatsapp_agent_pending_operations set arguments=arguments||'{"__resultUncertain":true}'::jsonb,expires_at=now()+interval '30 days' where id=pending.id;
 return true;
end $$;
create function public.cancel_sales_pending_execution(p_business_id uuid,p_member_id uuid,p_conversation_id uuid,p_pending_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare pending public.whatsapp_agent_pending_operations%rowtype;
begin
 if current_user<>'service_role' then raise exception 'permission_denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-pending:'||p_business_id::text||':'||p_member_id::text||':'||p_conversation_id::text,0));
 select * into pending from public.whatsapp_agent_pending_operations where id=p_pending_id and business_id=p_business_id and member_id=p_member_id and conversation_id=p_conversation_id and consumed_at is null for update;
 if not found or pending.tool_name not in ('sales.create','sales.edit','sales.void') then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
 if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id where m.id=p_member_id and m.business_id=p_business_id and p.active) then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
 update public.whatsapp_agent_pending_operations set consumed_at=now() where id=pending.id;
 return jsonb_build_object('consumed',true,'resultUncertain',coalesce((pending.arguments->>'__resultUncertain')::boolean,false));
end $$;
revoke all on function public.claim_sales_pending_execution(uuid,uuid,uuid,uuid,boolean),public.cancel_sales_pending_execution(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_sales_pending_execution(uuid,uuid,uuid,uuid,boolean),public.cancel_sales_pending_execution(uuid,uuid,uuid,uuid) to service_role;
