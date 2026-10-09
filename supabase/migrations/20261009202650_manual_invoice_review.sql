-- Manual invoice review, exact-version approval and immutable approved records.
-- Historical OCR/header values are not promoted to reviewed facts by migration.
alter table public.invoices add column edit_version integer not null default 0 check(edit_version>=0),
 add column reviewed_version integer, add column reviewed_by uuid, add column reviewed_at timestamptz, add column reviewed_request_id uuid;
alter table public.invoice_items add column review_position integer check(review_position between 1 and 100);
create unique index invoice_manual_line_position on public.invoice_items(invoice_id,review_position) where review_position is not null;
create schema invoices_private;
revoke all on schema invoices_private from public,anon;
grant usage on schema invoices_private to authenticated,service_role;
create table public.invoice_mutations(
 business_id uuid not null, request_id uuid not null, invoice_id uuid not null references public.invoices(id) on delete restrict,
 branch_id uuid not null, actor_id uuid not null, actor_role text not null, payload jsonb not null,
 result jsonb not null, before_snapshot jsonb, after_snapshot jsonb not null,
 activity_log_id uuid not null references public.activity_logs(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(business_id,request_id)
);
create index invoice_mutations_history_idx on public.invoice_mutations(invoice_id,created_at,request_id);
create index invoice_mutations_activity_idx on public.invoice_mutations(activity_log_id);
alter table public.invoice_mutations enable row level security;
revoke all on public.invoice_mutations from public,anon,authenticated,service_role;
grant select on public.invoice_mutations to authenticated,service_role;
revoke insert,update,delete,truncate,references,trigger on public.invoices,public.invoice_items from public,anon,authenticated;
create function invoices_private.can_read(p_business uuid,p_branch uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.profiles p join public.business_members m on m.user_id=p.id
 join public.business_modules mod on mod.business_id=m.business_id and mod.module_key='invoices_ocr' and mod.enabled
 where p.id=auth.uid() and p.active and m.business_id=p_business and m.role::text in('owner','admin','manager','accountant'))
$$;
create policy invoice_active_module on public.invoices as restrictive for select to authenticated using(invoices_private.can_read(business_id,branch_id));
create policy invoice_items_active_module on public.invoice_items as restrictive for select to authenticated using(exists(select 1 from public.invoices i where i.id=invoice_id));
create policy invoice_mutations_read on public.invoice_mutations for select to authenticated using(invoices_private.can_read(business_id,branch_id));
create function invoices_private.can_read_log(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare m public.invoice_mutations%rowtype;
begin select * into m from public.invoice_mutations where activity_log_id=p_id; if not found then return true; end if; return invoices_private.can_read(m.business_id,m.branch_id); end $$;
create policy invoice_manual_log_scope on public.activity_logs as restrictive for select to authenticated using(invoices_private.can_read_log(id));

-- OCR/service edits invalidate review too. There is no client-settable bypass.
create function invoices_private.guard_header() returns trigger language plpgsql set search_path='' as $$
declare old_data jsonb; new_data jsonb;
begin
 if old.status in('approved','sent_to_accountant') then
  if tg_op='DELETE' then raise exception 'invoice_readonly'; end if;
  if (to_jsonb(new)-array['status','updated_at']) is distinct from (to_jsonb(old)-array['status','updated_at']) or new.status not in('approved','sent_to_accountant') then raise exception 'invoice_readonly'; end if;
  return new;
 end if;
 if tg_op='DELETE' then return old; end if;
 if new.status in('approved','sent_to_accountant') then
  if old.reviewed_version is distinct from old.edit_version or old.reviewed_request_id is null then raise exception 'invoice_review_required';end if;
  if not exists(select 1 from public.purchases p where p.invoice_id=old.id and p.business_id=old.business_id and p.branch_id=old.branch_id) then raise exception 'invoice_approval_required';end if;
 end if;
 old_data:=to_jsonb(old)-array['updated_at','edit_version','reviewed_version','reviewed_by','reviewed_at','reviewed_request_id'];
 new_data:=to_jsonb(new)-array['updated_at','edit_version','reviewed_version','reviewed_by','reviewed_at','reviewed_request_id'];
 if old_data is distinct from new_data or new.edit_version is distinct from old.edit_version then
  new.edit_version:=old.edit_version+1; new.reviewed_version:=null;new.reviewed_by:=null;new.reviewed_at:=null;new.reviewed_request_id:=null;
 end if;
 return new;
end $$;
create trigger invoice_review_header before update or delete on public.invoices for each row execute function invoices_private.guard_header();
create function invoices_private.guard_initial_status() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user::text in('authenticated','anon','service_role') and new.status in('approved','sent_to_accountant') then raise exception 'invoice_review_required';end if;
 return new;
end $$;
create trigger invoice_initial_status before insert on public.invoices for each row execute function invoices_private.guard_initial_status();
create function invoices_private.guard_item() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invoices%rowtype;
begin
 if tg_op='UPDATE' and new.invoice_id<>old.invoice_id then raise exception 'invoice_invalid_input'; end if;
 select * into inv from public.invoices where id=coalesce(new.invoice_id,old.invoice_id) for update;
 if inv.status in('approved','sent_to_accountant') then raise exception 'invoice_readonly'; end if;
 update public.invoices set edit_version=edit_version+1 where id=inv.id;
 return coalesce(new,old);
end $$;
create trigger invoice_review_items before insert or update or delete on public.invoice_items for each row execute function invoices_private.guard_item();
create function invoices_private.actor(p_business uuid,p_branch uuid,p_actor uuid,p_approve boolean default false) returns text language plpgsql set search_path='' as $$
declare m public.business_members%rowtype;
begin
 perform 1 from public.profiles where id=p_actor and active for share;
 if p_actor is null or not found then raise exception 'invoice_permission_denied'; end if;
 select * into m from public.business_members where business_id=p_business and user_id=p_actor for share;
 if not found or m.role::text not in('owner','admin','manager') or p_approve and m.role::text='manager' then raise exception 'invoice_permission_denied'; end if;
 perform 1 from public.business_modules where business_id=p_business and module_key='invoices_ocr' and enabled for share;
 if not found then raise exception 'invoice_module_disabled'; end if;
 perform 1 from public.branches where id=p_branch and business_id=p_business for share;
 if not found then raise exception 'invoice_branch_forbidden'; end if;
 return m.role::text;
end $$;
create function invoices_private.snapshot(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('invoice',to_jsonb(i)||jsonb_build_object('subtotal',i.subtotal::text,'tax',i.tax::text,'total',i.total::text),'items',coalesce((select jsonb_agg(to_jsonb(x)||jsonb_build_object('qty_numeric',x.qty_numeric::text,'unit_price',x.unit_price::text,'total',x.total::text) order by x.review_position nulls last,x.id) from public.invoice_items x where x.invoice_id=i.id),'[]'::jsonb)) from public.invoices i where id=p_id
$$;
create function invoices_private.save(p_business uuid,p_actor uuid,p_input jsonb) returns jsonb language plpgsql set search_path='' as $$
declare inv public.invoices%rowtype; receipt public.invoice_mutations%rowtype; v_id uuid;v_request uuid;v_branch uuid;v_role text;v_date date;v_due date;v_item jsonb;v_qty numeric;v_price numeric;v_total numeric:=0;v_tax numeric;v_before jsonb;v_after jsonb;v_result jsonb;v_log uuid;v_position integer:=0;
begin
 if jsonb_typeof(p_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input))<>16 or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(array['requestId','businessId','userId','id','expectedVersion','branchId','supplierId','number','type','invoiceDate','dueDate','taxId','paymentMethod','tax','items','reviewed'])) then raise exception 'invoice_invalid_input'; end if;
 if (p_input->>'businessId')::uuid is distinct from p_business or (p_input->>'userId')::uuid is distinct from p_actor then raise exception 'invoice_context_changed'; end if;
 v_request:=(p_input->>'requestId')::uuid;v_id:=(p_input->>'id')::uuid;v_branch:=(p_input->>'branchId')::uuid;
 if v_request is null or p_input->'reviewed' is distinct from 'true'::jsonb then raise exception 'invoice_review_required'; end if;
 v_role:=invoices_private.actor(p_business,v_branch,p_actor);
 perform pg_advisory_xact_lock(hashtextextended('invoice:'||p_business::text||v_request::text,0));
 select * into receipt from public.invoice_mutations where business_id=p_business and request_id=v_request;
 if found then if receipt.actor_id<>p_actor or receipt.payload<>p_input then raise exception 'invoice_idempotency_conflict'; end if;return receipt.result;end if;
 if v_id is not null then
  select * into inv from public.invoices where id=v_id and business_id=p_business for update;
  if not found then raise exception 'invoice_not_found';end if;
  if inv.status in('approved','sent_to_accountant') then raise exception 'invoice_readonly';end if;
  if inv.status='processing' then raise exception 'invoice_processing';end if;
  if jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or p_input->>'expectedVersion' !~ '^[0-9]+$' or (p_input->>'expectedVersion')::numeric<>inv.edit_version then raise exception 'invoice_conflict';end if;
  v_before:=invoices_private.snapshot(v_id);
 elsif p_input->>'expectedVersion' is not null then raise exception 'invoice_invalid_input';end if;
 if jsonb_typeof(p_input->'number') is distinct from 'string' or length(btrim(p_input->>'number')) not between 1 and 120 or btrim(p_input->>'number') ~* '^TEMP-' or p_input->>'number' ~ '[[:cntrl:]]'
 or p_input->>'type' is null or p_input->>'type' not in('A','B','C')
 or jsonb_typeof(p_input->'paymentMethod') is distinct from 'string' or length(btrim(p_input->>'paymentMethod')) not between 1 and 100 or p_input->>'paymentMethod' ~ '[[:cntrl:]]'
 or p_input->>'taxId' is not null and (jsonb_typeof(p_input->'taxId')<>'string' or length(btrim(p_input->>'taxId')) not between 1 and 32 or p_input->>'taxId' ~ '[[:cntrl:]]') then raise exception 'invoice_invalid_input';end if;
 if p_input->>'supplierId' is not null then perform 1 from public.suppliers where id=(p_input->>'supplierId')::uuid and business_id=p_business and (active or id=inv.supplier_id) for share;if not found then raise exception 'invoice_supplier_forbidden';end if;end if;
 if jsonb_typeof(p_input->'invoiceDate') is distinct from 'string' or p_input->>'invoiceDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invoice_invalid_date';end if;
 v_date:=(p_input->>'invoiceDate')::date;
 if v_date<'1900-01-01' or v_date>(clock_timestamp() at time zone(select timezone from public.businesses where id=p_business))::date then raise exception 'invoice_invalid_date';end if;
 if p_input->>'dueDate' is not null then
  if jsonb_typeof(p_input->'dueDate')<>'string' or p_input->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'invoice_invalid_date';end if;
  v_due:=(p_input->>'dueDate')::date;if v_due<v_date then raise exception 'invoice_invalid_date';end if;
 end if;
 if jsonb_typeof(p_input->'tax') is distinct from 'string' or p_input->>'tax' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$' or jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') not between 1 and 100 then raise exception 'invoice_invalid_input';end if;
 v_tax:=(p_input->>'tax')::numeric;
 perform 1 from public.ingredients where id in(select (x->>'ingredientId')::uuid from jsonb_array_elements(p_input->'items') x) order by id for share;
 for v_item in select * from jsonb_array_elements(p_input->'items') loop
  if jsonb_typeof(v_item) is distinct from 'object' or (select count(*) from jsonb_object_keys(v_item))<>5 or exists(select 1 from jsonb_object_keys(v_item) k where not k=any(array['description','quantity','unit','unitPrice','ingredientId']))
  or jsonb_typeof(v_item->'description') is distinct from 'string' or length(btrim(v_item->>'description')) not between 1 and 500 or v_item->>'description' ~ '[[:cntrl:]]'
  or jsonb_typeof(v_item->'unit') is distinct from 'string' or length(btrim(v_item->>'unit')) not between 1 and 20 or v_item->>'unit' ~ '[[:cntrl:]]'
  or jsonb_typeof(v_item->'quantity') is distinct from 'string' or v_item->>'quantity' !~ '^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$'
  or jsonb_typeof(v_item->'unitPrice') is distinct from 'string' or v_item->>'unitPrice' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$' then raise exception 'invoice_invalid_input';end if;
  v_qty:=(v_item->>'quantity')::numeric;v_price:=(v_item->>'unitPrice')::numeric;
  if v_qty<=0 or round(v_qty*v_price,2)>=10000000000 then raise exception 'invoice_invalid_input';end if;
  if v_item->>'ingredientId' is not null then
   perform 1 from public.ingredients where id=(v_item->>'ingredientId')::uuid and business_id=p_business for share;if not found then raise exception 'invoice_ingredient_forbidden';end if;
   if (select public.catalog_unit_factor(v_item->>'unit',unit) from public.ingredients where id=(v_item->>'ingredientId')::uuid) is null then raise exception 'invoice_invalid_units';end if;
  end if;
  v_total:=v_total+round(v_qty*v_price,2);
 end loop;
 if v_total+v_tax>=10000000000 then raise exception 'invoice_invalid_input';end if;
 if v_id is null then
  insert into public.invoices(business_id,branch_id,supplier_id,number,type,tax_id,invoice_date,due_date,payment_method,subtotal,tax,total,status,source,created_by)
  values(p_business,v_branch,(p_input->>'supplierId')::uuid,btrim(p_input->>'number'),(p_input->>'type')::public.invoice_type,nullif(btrim(p_input->>'taxId'),''),v_date,v_due,btrim(p_input->>'paymentMethod'),v_total,v_tax,v_total+v_tax,'needs_review','manual',p_actor) returning id into v_id;
 else
  update public.invoices set branch_id=v_branch,supplier_id=(p_input->>'supplierId')::uuid,number=btrim(p_input->>'number'),type=(p_input->>'type')::public.invoice_type,tax_id=nullif(btrim(p_input->>'taxId'),''),invoice_date=v_date,due_date=v_due,payment_method=btrim(p_input->>'paymentMethod'),subtotal=v_total,tax=v_tax,total=v_total+v_tax,status='needs_review' where id=v_id;
  delete from public.invoice_items where invoice_id=v_id;
 end if;
 for v_item in select * from jsonb_array_elements(p_input->'items') loop
  v_position:=v_position+1;
  insert into public.invoice_items(invoice_id,description,qty,qty_numeric,unit,unit_price,total,matched_ingredient_id,suggested_ingredient_id,match_status,review_position)
  values(v_id,btrim(v_item->>'description'),v_item->>'quantity',(v_item->>'quantity')::numeric,btrim(v_item->>'unit'),(v_item->>'unitPrice')::numeric,round((v_item->>'quantity')::numeric*(v_item->>'unitPrice')::numeric,2),(v_item->>'ingredientId')::uuid,null,case when v_item->>'ingredientId' is null then 'unmatched'::public.item_match_status else 'manual'::public.item_match_status end,v_position);
 end loop;
 update public.invoices set reviewed_version=edit_version,reviewed_by=p_actor,reviewed_at=clock_timestamp(),reviewed_request_id=v_request where id=v_id returning * into inv;
 v_result:=jsonb_build_object('ok',true,'id',v_id,'version',inv.edit_version);v_after:=invoices_private.snapshot(v_id);
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 select p_business,p_actor,full_name,v_role,'invoice.reviewed','invoices',v_id,'Factura revisada manualmente',jsonb_build_object('branch_id',v_branch,'source','manual','request_id',v_request,'version',inv.edit_version,'approved',false) from public.profiles where id=p_actor returning id into v_log;
 insert into public.invoice_mutations(business_id,request_id,invoice_id,branch_id,actor_id,actor_role,payload,result,before_snapshot,after_snapshot,activity_log_id)
 values(p_business,v_request,v_id,v_branch,p_actor,v_role,p_input,v_result,v_before,v_after,v_log);
 return v_result;
end $$;
create function invoices_private.manual(p_business uuid,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or current_setting('role',true)<>'authenticated' then raise exception 'invoice_permission_denied';end if;
 return invoices_private.save(p_business,auth.uid(),p_input);
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'invoice_%' then sqlerrm else 'invoice_invalid_input' end);end $$;
revoke all on all functions in schema invoices_private from public,anon,authenticated,service_role;
grant execute on function invoices_private.can_read(uuid,uuid),invoices_private.can_read_log(uuid),invoices_private.manual(uuid,jsonb) to authenticated;
create function public.save_invoice_review_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select invoices_private.manual(p_business_id,p_input) $$;
revoke all on function public.save_invoice_review_atomic(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_invoice_review_atomic(uuid,jsonb) to authenticated;

-- Move the existing accounting engine out of the exposed API. Only the reviewed
-- wrapper below is public; legacy ID-only approval can no longer post effects.
alter function public.approve_invoice_atomic(uuid,uuid,uuid) set schema invoices_private;
alter function invoices_private.approve_invoice_atomic(uuid,uuid,uuid) rename to approve_ledger;
drop function invoices_private.approve_ledger(uuid,uuid,uuid);
create function public.approve_invoice_atomic(p_invoice_id uuid,p_business_id uuid,p_actor_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select jsonb_build_object('ok',false,'error','invoice_review_required') $$;
revoke all on function public.approve_invoice_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_invoice_atomic(uuid,uuid,uuid) to service_role;
create function invoices_private.approve_ledger(p_invoice_id uuid,p_business_id uuid,p_actor_id uuid,p_expected_version integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_roles public.role_key[]; v_role public.role_key; v_actor_name text;
  v_invoice public.invoices%rowtype; v_item public.invoice_items%rowtype;
  v_purchase_id uuid; v_purchase_item_id uuid; v_ingredient_id uuid;
  v_ingredient_ids uuid[]:=array[]::uuid[]; v_item_count integer:=0; v_stock_count integer:=0;
begin
  if p_invoice_id is null or p_business_id is null or p_actor_id is null then
    return jsonb_build_object('ok',false,'error','invalid_arguments');
  end if;
  select array_agg(m.role) into v_roles from public.business_members m
    join public.profiles p on p.id=m.user_id and p.active
    where m.business_id=p_business_id and m.user_id=p_actor_id;
  if coalesce(cardinality(v_roles),0)<>1 then
    return jsonb_build_object('ok',false,'error','membership_not_found');
  end if;
  v_role:=v_roles[1];
  if v_role not in ('owner','admin') then return jsonb_build_object('ok',false,'error','permission_denied'); end if;
  select full_name into v_actor_name from public.profiles where id=p_actor_id;
  select * into v_invoice from public.invoices where id=p_invoice_id and business_id=p_business_id for update;
  if not found then return jsonb_build_object('ok',false,'error','invoice_not_found'); end if;
  if v_invoice.status in ('approved','sent_to_accountant') then
    select id into v_purchase_id from public.purchases where invoice_id=v_invoice.id and business_id=p_business_id;
    if v_purchase_id is null then return jsonb_build_object('ok',false,'error','approval_inconsistent'); end if;
    -- Never replay old stock history or infer that legacy balances are wrong.
    return jsonb_build_object('ok',true,'already_approved',true,'invoice_id',v_invoice.id,'purchase_id',v_purchase_id,
      'invoice_number',v_invoice.number,'item_count',0,'stock_count',0,'ingredient_ids',jsonb_build_array());
  end if;
  -- The callable accounting boundary validates review itself, even when a
  -- privileged server caller invokes it without the public approval wrapper.
  if current_user::text<>'service_role' then return jsonb_build_object('ok',false,'error','invoice_permission_denied');end if;
  perform 1 from public.business_modules where business_id=p_business_id and module_key='invoices_ocr' and enabled for share;
  if not found then return jsonb_build_object('ok',false,'error','invoice_module_disabled');end if;
  perform invoices_private.actor(p_business_id,v_invoice.branch_id,p_actor_id,true);
  if p_expected_version is null or p_expected_version<>v_invoice.edit_version then return jsonb_build_object('ok',false,'error','invoice_conflict');end if;
  if v_invoice.reviewed_version is distinct from v_invoice.edit_version or v_invoice.reviewed_request_id is null
   or not exists(select 1 from public.invoice_mutations m where m.business_id=p_business_id and m.invoice_id=p_invoice_id and m.request_id=v_invoice.reviewed_request_id and (m.result->>'version')::integer=v_invoice.edit_version and m.payload->'reviewed'='true'::jsonb)
  then return jsonb_build_object('ok',false,'error','invoice_review_required');end if;
  if v_invoice.status not in ('extracted','needs_review','rejected') then
    return jsonb_build_object('ok',false,'error','invoice_not_approvable');
  end if;
  if v_invoice.supplier_id is not null and not exists(select 1 from public.suppliers s
    where s.id=v_invoice.supplier_id and s.business_id=p_business_id) then
    return jsonb_build_object('ok',false,'error','invalid_supplier');
  end if;
  if v_invoice.branch_id is null or not exists(select 1 from public.branches b
    where b.id=v_invoice.branch_id and b.business_id=p_business_id) then
    return jsonb_build_object('ok',false,'error','invalid_branch');
  end if;
  -- Required even on privileged server transport. No inferred default branch.
  perform public.stock_actor_role(p_business_id,v_invoice.branch_id,p_actor_id);
  perform 1 from public.invoice_items where invoice_id=v_invoice.id order by id for update;
  select count(*) into v_item_count from public.invoice_items where invoice_id=v_invoice.id;
  if v_item_count=0 then return jsonb_build_object('ok',false,'error','invoice_items_required'); end if;
  if exists(select 1 from public.invoice_items item where item.invoice_id=v_invoice.id and (
    item.qty_numeric is null or item.qty_numeric<=0 or item.qty_numeric::text in ('NaN','Infinity','-Infinity')
    or item.unit_price<0 or item.unit_price::text in ('NaN','Infinity','-Infinity')
    or item.total<0 or item.total::text in ('NaN','Infinity','-Infinity')
  )) then return jsonb_build_object('ok',false,'error','invalid_invoice_item'); end if;
  if exists(select 1 from public.invoice_items item where item.invoice_id=v_invoice.id
    and coalesce(item.matched_ingredient_id,item.suggested_ingredient_id) is not null
    and not exists(select 1 from public.ingredients i where i.id=coalesce(item.matched_ingredient_id,item.suggested_ingredient_id)
      and i.business_id=p_business_id)) then
    return jsonb_build_object('ok',false,'error','invalid_ingredient');
  end if;
  -- Common lock order with catalog saves: ingredient row before stock row.
  -- The server transport can lock all matched ingredients without expanding RLS.
  perform 1 from public.ingredients where id in (
    select coalesce(matched_ingredient_id,suggested_ingredient_id) from public.invoice_items where invoice_id=v_invoice.id
  ) order by id for update;
  if exists(select 1 from public.invoice_items item join public.ingredients i
    on i.id=coalesce(item.matched_ingredient_id,item.suggested_ingredient_id)
    where item.invoice_id=v_invoice.id and (
      public.catalog_unit_factor(item.unit,i.unit) is null
      or item.qty_numeric*public.catalog_unit_factor(item.unit,i.unit)<>round(item.qty_numeric*public.catalog_unit_factor(item.unit,i.unit),6)
  )) then return jsonb_build_object('ok',false,'error','invalid_stock_units_or_precision'); end if;

  insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total,payment_method,invoice_id,created_by)
    values(p_business_id,v_invoice.branch_id,v_invoice.supplier_id,v_invoice.invoice_date,v_invoice.total,
      v_invoice.payment_method,v_invoice.id,p_actor_id) returning id into v_purchase_id;
  -- Deterministic ingredient order avoids opposite lock order within approvals.
  for v_item in select * from public.invoice_items where invoice_id=v_invoice.id
    order by coalesce(matched_ingredient_id,suggested_ingredient_id),id loop
    v_ingredient_id:=coalesce(v_item.matched_ingredient_id,v_item.suggested_ingredient_id);
    insert into public.purchase_items(purchase_id,ingredient_id,description,qty,unit,unit_price,total)
      values(v_purchase_id,v_ingredient_id,v_item.description,v_item.qty_numeric,v_item.unit,v_item.unit_price,v_item.total)
      returning id into v_purchase_item_id;
    if v_ingredient_id is not null then
      perform public.record_stock_movement_atomic(p_business_id,p_actor_id,v_ingredient_id,v_invoice.branch_id,
        'in',v_item.qty_numeric,left(format('Factura %s · %s',v_invoice.number,v_item.description),1000),v_item.unit,
        case when v_invoice.source='manual' then 'manual' else 'ocr' end,'purchase_item',v_purchase_item_id);
      v_stock_count:=v_stock_count+1;
      if not(v_ingredient_id=any(v_ingredient_ids)) then v_ingredient_ids:=array_append(v_ingredient_ids,v_ingredient_id); end if;
    end if;
  end loop;
  foreach v_ingredient_id in array v_ingredient_ids loop
    perform public.recalc_ingredient_cost(v_ingredient_id);
  end loop;
  update public.balance_snapshots set purchases_data_stale=true where business_id=p_business_id and period_month=date_trunc('month',v_invoice.invoice_date)::date;
  update public.invoices set status='approved' where id=v_invoice.id and business_id=p_business_id;
  if not found then raise exception 'invoice_update_race'; end if;
  insert into public.invoice_processing_logs(invoice_id,stage,ok,data)
    values(v_invoice.id,'approval',true,jsonb_build_object('purchase_id',v_purchase_id,'atomic',true,'stock_count',v_stock_count));
  insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
    values(p_business_id,p_actor_id,coalesce(v_actor_name,'Usuario'),v_role::text,'invoice.approved','invoices',v_invoice.id,
      format('Factura %s aprobada · %s ítems · compra creada.',v_invoice.number,v_item_count),
      jsonb_build_object('invoice_id',v_invoice.id,'purchase_id',v_purchase_id,'branch_id',v_invoice.branch_id,
        'source',case when v_invoice.source='manual' then 'manual' else 'ocr' end,'result','success','ingredients_affected',cardinality(v_ingredient_ids),'atomic',true));
  insert into public.notifications(business_id,tone,priority,category,title,detail,href,source)
    values(p_business_id,'success','medium','system','Factura aprobada e imputada',
      format('%s · %s ítems · %s entradas de stock registradas.',v_invoice.number,v_item_count,v_stock_count),'/facturas','invoices');
  return jsonb_build_object('ok',true,'already_approved',false,'invoice_id',v_invoice.id,'purchase_id',v_purchase_id,
    'invoice_number',v_invoice.number,'item_count',v_item_count,'stock_count',v_stock_count,'ingredient_ids',to_jsonb(v_ingredient_ids));
end; $$;

revoke all on function invoices_private.approve_ledger(uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function invoices_private.approve_ledger(uuid,uuid,uuid,integer) to service_role;

create table invoices_private.approval_receipts(business_id uuid not null,request_id uuid not null,invoice_id uuid not null,actor_id uuid not null,payload jsonb not null,result jsonb not null,primary key(business_id,request_id));
revoke all on invoices_private.approval_receipts from public,anon,authenticated,service_role;
grant select,insert on invoices_private.approval_receipts to service_role;
grant execute on function invoices_private.actor(uuid,uuid,uuid,boolean) to service_role;
create function public.approve_invoice_reviewed_atomic(p_business_id uuid,p_actor_id uuid,p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;receipt invoices_private.approval_receipts%rowtype;v_id uuid;v_request uuid;v_result jsonb;
begin
 if current_user::text<>'service_role' then raise exception 'invoice_permission_denied';end if;
 if jsonb_typeof(p_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input))<>5 or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(array['requestId','businessId','userId','id','expectedVersion'])) then raise exception 'invoice_invalid_input';end if;
 if (p_input->>'businessId')::uuid is distinct from p_business_id or (p_input->>'userId')::uuid is distinct from p_actor_id then raise exception 'invoice_context_changed';end if;
 v_id:=(p_input->>'id')::uuid;v_request:=(p_input->>'requestId')::uuid;if v_id is null or v_request is null then raise exception 'invoice_invalid_input';end if;
 perform pg_advisory_xact_lock(hashtextextended('invoice-approve:'||p_business_id::text||v_request::text,0));
 select * into inv from public.invoices where id=v_id and business_id=p_business_id for update;if not found then raise exception 'invoice_not_found';end if;
 perform invoices_private.actor(p_business_id,inv.branch_id,p_actor_id,true);
 select * into receipt from invoices_private.approval_receipts where business_id=p_business_id and request_id=v_request;
 if found then if receipt.actor_id<>p_actor_id or receipt.payload<>p_input then raise exception 'invoice_idempotency_conflict';end if;return receipt.result;end if;
 if inv.status in('approved','sent_to_accountant') then raise exception 'invoice_readonly';end if;
 if jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or p_input->>'expectedVersion' !~ '^[0-9]+$' or (p_input->>'expectedVersion')::numeric<>inv.edit_version then raise exception 'invoice_conflict';end if;
 if inv.reviewed_version is distinct from inv.edit_version or inv.reviewed_request_id is null or not exists(select 1 from public.invoice_mutations m where m.business_id=p_business_id and m.invoice_id=v_id and m.request_id=inv.reviewed_request_id and (m.result->>'version')::integer=inv.edit_version and m.payload->'reviewed'='true'::jsonb) then raise exception 'invoice_review_required';end if;
 v_result:=invoices_private.approve_ledger(v_id,p_business_id,p_actor_id,inv.edit_version);
 if v_result->'ok' is distinct from 'true'::jsonb then raise exception '%',coalesce(v_result->>'error','invoice_invalid_input');end if;
 select * into inv from public.invoices where id=v_id;
 v_result:=v_result||jsonb_build_object('id',v_id,'version',inv.edit_version);
 insert into invoices_private.approval_receipts values(p_business_id,v_request,v_id,p_actor_id,p_input,v_result);
 return v_result;
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'invoice_%' then sqlerrm else 'invoice_invalid_input' end);
end $$;
revoke all on function public.approve_invoice_reviewed_atomic(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.approve_invoice_reviewed_atomic(uuid,uuid,jsonb) to service_role;
create function invoices_private.revision(p_business uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if not invoices_private.can_read(p_business,null) then raise exception 'invoice_permission_denied';end if;
 return(select md5(coalesce(string_agg(id::text||':'||edit_version::text,',' order by id),'')) from public.invoices where business_id=p_business);
end $$;
revoke all on function invoices_private.revision(uuid) from public,anon,authenticated,service_role;
grant execute on function invoices_private.revision(uuid) to authenticated;
create function public.get_invoice_review_revision(p_business_id uuid) returns text language sql security invoker set search_path='' as $$select invoices_private.revision(p_business_id)$$;
revoke all on function public.get_invoice_review_revision(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_invoice_review_revision(uuid) to authenticated;
