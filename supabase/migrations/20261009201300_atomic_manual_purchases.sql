alter table public.balance_snapshots add column purchases_data_stale boolean not null default false;
alter table public.purchases add column record_status text not null default 'active' check(record_status in ('active','voided')),
 add column version integer not null default 1, add column void_reason text, add column voided_at timestamptz;

-- Additive purchase transaction. Legacy/OCR rows retain their original provenance.
alter table public.purchases add column manual_request_id uuid,
 add column manual_payload jsonb,
 add column source text;
create unique index purchases_manual_request_idx on public.purchases(business_id,manual_request_id) where manual_request_id is not null;
create function public.create_purchase_manual_atomic(p_business_id uuid,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text; branch uuid; supplier uuid; request uuid;
 existing public.purchases%rowtype; line jsonb; ingredient public.ingredients%rowtype;
 purchase_id uuid; item_id uuid; q numeric; price numeric; line_total numeric; total numeric:=0;
 purchase_date date; method text; description text; unit text; ingredient_id uuid; payload jsonb;
begin
 if actor is null or current_user::text<>'authenticated' then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object' then raise exception 'purchase_invalid_input'; end if;
 branch:=(p_input->>'branchId')::uuid; supplier:=(p_input->>'supplierId')::uuid; request:=(p_input->>'requestId')::uuid;
 if branch is null or supplier is null or request is null then raise exception 'purchase_invalid_input'; end if;
 role_name:=public.stock_actor_role(p_business_id,branch,actor);
 if role_name not in ('owner','admin','manager') then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 if not exists(select 1 from public.business_modules where business_id=p_business_id and module_key='purchases' and enabled) then raise exception 'purchase_module_disabled'; end if;
 payload:=p_input;
 perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||request::text,0));
 select * into existing from public.purchases where business_id=p_business_id and manual_request_id=request;
 if found then
  if existing.created_by is distinct from actor or existing.manual_payload is distinct from payload then raise exception 'purchase_idempotency_conflict'; end if;
  return jsonb_build_object('ok',true,'id',existing.id,'replayed',true);
 end if;
 if p_input ? 'replacesPurchaseId' and not exists(select 1 from public.purchases old where old.id=(p_input->>'replacesPurchaseId')::uuid and old.business_id=p_business_id and old.record_status='voided' and old.source='manual' and old.void_reason=p_input->>'correctionReason') then raise exception 'purchase_correction_reference_required'; end if;
 perform 1 from public.suppliers where id=supplier and business_id=p_business_id and active for share;
 if not found then raise exception 'purchase_supplier_unavailable'; end if;
 purchase_date:=(p_input->>'purchasedAt')::date;
 method:=btrim(p_input->>'paymentMethod');
 if purchase_date is null or method is null or length(method) not between 1 and 100 then raise exception 'purchase_invalid_input'; end if;
 if jsonb_typeof(p_input->'items') is distinct from 'array' or jsonb_array_length(p_input->'items') not between 1 and 100 then raise exception 'purchase_items_required'; end if;
 for line in select value from jsonb_array_elements(p_input->'items') loop
  q:=(line->>'qty')::numeric; price:=(line->>'unitPrice')::numeric;
  description:=btrim(line->>'description'); unit:=btrim(line->>'unit');
  if q is null or q::text in ('NaN','Infinity','-Infinity') or q<=0 or q>=1000000000000 or q<>round(q,6)
   or price is null or price::text in ('NaN','Infinity','-Infinity') or price<0 or price>=10000000000 or price<>round(price,2)
   or description is null or length(description) not between 1 and 1000 or unit is null or length(unit) not between 1 and 40 then raise exception 'purchase_invalid_line'; end if;
  total:=total+round(q*price,2);
  if total>=10000000000 then raise exception 'purchase_total_overflow'; end if;
  ingredient_id:=nullif(line->>'ingredientId','')::uuid;
  if ingredient_id is not null then
   select * into ingredient from public.ingredients where id=ingredient_id and business_id=p_business_id and active;
   if not found or public.catalog_unit_factor(unit,ingredient.unit) is null then raise exception 'purchase_ingredient_unavailable'; end if;
  end if;
 end loop;
 insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total,payment_method,created_by,manual_request_id,manual_payload,source)
 values(p_business_id,branch,supplier,purchase_date,total,method,actor,request,payload,'manual') returning id into purchase_id;
 for line in select value from jsonb_array_elements(p_input->'items') order by value->>'ingredientId' nulls last loop
  q:=(line->>'qty')::numeric; price:=(line->>'unitPrice')::numeric; ingredient_id:=nullif(line->>'ingredientId','')::uuid;
  insert into public.purchase_items(purchase_id,ingredient_id,description,qty,unit,unit_price,total)
  values(purchase_id,ingredient_id,btrim(line->>'description'),q,btrim(line->>'unit'),price,round(q*price,2)) returning id into item_id;
  if ingredient_id is not null then
   perform public.record_stock_movement_atomic(p_business_id,actor,ingredient_id,branch,'in',q,
    left('Compra manual · '||btrim(line->>'description'),1000),btrim(line->>'unit'),'manual','purchase_item',item_id);
  end if;
 end loop;
 return jsonb_build_object('ok',true,'id',purchase_id,'replayed',false);
end $$;
revoke all on function public.create_purchase_manual_atomic(uuid,jsonb) from public,anon,service_role;
grant execute on function public.create_purchase_manual_atomic(uuid,jsonb) to authenticated;

create or replace function public.stock_validate_movement()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  v_ingredient public.ingredients%rowtype; v_stock public.stock_items%rowtype;
  v_factor numeric; v_quantity numeric; v_purchase public.purchases%rowtype; v_line public.purchase_items%rowtype;
  v_extraction public.ai_extractions%rowtype; v_input jsonb;
begin
  if tg_op<>'INSERT' then raise exception 'stock_movement_immutable' using errcode='23514'; end if;
  -- RLS still runs on INSERT. This trigger validates privileged server transports
  -- too and derives every audit/balance field instead of trusting caller values.
  if current_user::text='authenticated' then
    if new.actor_id is not null and new.actor_id is distinct from auth.uid() then
      raise exception 'stock_actor_forbidden' using errcode='42501';
    end if;
    new.actor_id:=auth.uid();
    if new.source='manual' and new.ref_type in ('purchase_item','purchase_item_void') and new.ref_id is not null then
      null; -- Full persisted line/tenant/actor verification below, unique receipt index.
    elsif new.source='inbox' and new.ref_type='ai_extraction' and new.ref_id is not null then
      null; -- Validated against the persisted, locked extraction below.
    else
      if new.source is not null and new.source<>'manual' then raise exception 'stock_source_forbidden' using errcode='42501'; end if;
      new.source:='manual';
      if new.ref_type is not null or new.ref_id is not null then raise exception 'stock_reference_forbidden' using errcode='42501'; end if;
    end if;
  elsif current_user::text<>'service_role' then
    raise exception 'stock_transport_forbidden' using errcode='42501';
  end if;
  select * into v_ingredient from public.ingredients where id=new.ingredient_id;
  if not found or (new.business_id is not null and new.business_id<>v_ingredient.business_id) then
    raise exception 'stock_ingredient_forbidden' using errcode='42501';
  end if;
  new.business_id:=v_ingredient.business_id;
  new.actor_role:=public.stock_actor_role(new.business_id,new.branch_id,new.actor_id);
  select p.full_name into new.actor_name from public.profiles p where p.id=new.actor_id;
  if new.source is null or new.source not in ('manual','whatsapp','inbox','ocr','api','system') then
    raise exception 'invalid_stock_source' using errcode='22023';
  end if;
  if new.operation is null or new.operation not in ('in','out','waste','set') then
    raise exception 'invalid_stock_operation' using errcode='22023';
  end if;
  new.reason_note:=btrim(new.reason_note);
  if new.reason_note is null or length(new.reason_note) not between 1 and 1000 then
    raise exception 'stock_reason_required' using errcode='22023';
  end if;
  if new.input_quantity is null or new.input_quantity::text in ('NaN','Infinity','-Infinity')
    or new.input_quantity<0 or (new.operation<>'set' and new.input_quantity<=0) then
    raise exception 'invalid_stock_quantity' using errcode='22023';
  end if;
  new.input_unit:=public.catalog_normalize_unit(coalesce(new.input_unit,v_ingredient.unit));
  new.base_unit:=public.catalog_normalize_unit(v_ingredient.unit);
  v_factor:=public.catalog_unit_factor(new.input_unit,new.base_unit);
  if v_factor is null then raise exception 'incompatible_stock_units' using errcode='22023'; end if;
  v_quantity:=new.input_quantity*v_factor;
  if v_quantity<>round(v_quantity,6) or v_quantity>=1000000000000 then
    raise exception 'stock_quantity_precision' using errcode='22003';
  end if;
  if new.ref_type in ('purchase_item','purchase_item_void') then
    if new.operation<>(case when new.ref_type='purchase_item' then 'in' else 'out' end) or new.source not in ('ocr','inbox','manual','whatsapp','api') then
      raise exception 'invalid_stock_purchase_reference' using errcode='23514';
    end if;
    select * into v_line from public.purchase_items where id=new.ref_id;
    select * into v_purchase from public.purchases where id=v_line.purchase_id;
    if v_line.id is null or v_purchase.business_id is distinct from new.business_id
      or v_purchase.branch_id is distinct from new.branch_id or v_line.ingredient_id is distinct from new.ingredient_id
      or v_line.qty is distinct from new.input_quantity
      or public.catalog_normalize_unit(v_line.unit) is distinct from new.input_unit then
      raise exception 'invalid_stock_purchase_reference' using errcode='23514';
    end if;
    if new.ref_type='purchase_item_void' and (v_purchase.record_status<>'voided' or v_purchase.source is distinct from 'manual') then raise exception 'invalid_purchase_reversal'; end if;
    new.reason:='purchase';
  elsif new.ref_type='ai_extraction' then
    select * into v_extraction from public.ai_extractions where id=new.ref_id for update;
    v_input:=public.stock_extraction_input(new.ref_id,new.business_id);
    if new.source<>'inbox' or v_extraction.status not in ('pending','needs_review') or not coalesce((v_input->>'ok')::boolean,false)
      or (v_input->>'ingredient_id')::uuid is distinct from new.ingredient_id
      or (v_input->>'branch_id')::uuid is distinct from new.branch_id
      or v_input->>'operation' is distinct from new.operation or (v_input->>'quantity')::numeric is distinct from new.input_quantity
      or v_input->>'unit' is distinct from new.input_unit or v_input->>'reason' is distinct from new.reason_note then
      raise exception 'invalid_stock_extraction_reference' using errcode='23514';
    end if;
    new.reason:=case when new.operation='waste' then 'waste'::public.stock_movement_reason else 'manual_adjust'::public.stock_movement_reason end;
  elsif new.ref_type is not null or new.ref_id is not null then
    -- Future sales services must add a validated line reference, never free-form
    -- links that could attribute a movement to another tenant/entity.
    raise exception 'invalid_stock_reference' using errcode='23514';
  else
    new.reason:=case when new.operation='waste' then 'waste'::public.stock_movement_reason else 'manual_adjust'::public.stock_movement_reason end;
  end if;
  insert into public.stock_items(ingredient_id,branch_id) values(new.ingredient_id,new.branch_id)
    on conflict(ingredient_id,branch_id) do nothing;
  select * into v_stock from public.stock_items where ingredient_id=new.ingredient_id and branch_id=new.branch_id for update;
  if not found then raise exception 'stock_item_forbidden' using errcode='42501'; end if;
  if v_stock.current<0 or v_stock.current::text in ('NaN','Infinity','-Infinity') then
    raise exception 'stock_balance_invalid' using errcode='23514';
  end if;
  new.stock_item_id:=v_stock.id;
  new.balance_before:=v_stock.current;
  new.balance_after:=case new.operation when 'in' then v_stock.current+v_quantity
    when 'set' then v_quantity else v_stock.current-v_quantity end;
  if new.balance_after<0 then raise exception 'insufficient_stock' using errcode='22003'; end if;
  new.qty:=new.balance_after-new.balance_before;
  -- A no-op physical count remains an auditable event with delta 0.
  new.created_at:=clock_timestamp(); new.updated_at:=new.created_at;
  return new;
end; $$;

create schema if not exists purchases_private;
revoke all on schema purchases_private from public,anon,authenticated,service_role;
create function purchases_private.audit_manual_purchase() returns trigger language plpgsql security definer set search_path='' as $$
declare r text;
begin
 if new.manual_request_id is null then return null; end if;
 update public.balance_snapshots set purchases_data_stale=true where business_id=new.business_id;
 if new.created_by is distinct from auth.uid() or new.source is distinct from 'manual' then raise exception 'purchase_actor_forbidden'; end if;
 select role::text into r from public.business_members where business_id=new.business_id and user_id=new.created_by;
 if r is null or r not in ('owner','admin','manager') or not exists(select 1 from public.profiles where id=new.created_by and active) then raise exception 'purchase_actor_forbidden'; end if;
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 select new.business_id,new.created_by,p.full_name,r,'purchase.created','purchases',new.id,'Compra manual registrada',
 jsonb_build_object('branch_id',new.branch_id,'supplier_id',new.supplier_id,'total',new.total,'source','manual','request_id',new.manual_request_id)
 from public.profiles p where p.id=new.created_by;
 return null;
end $$;
revoke all on function purchases_private.audit_manual_purchase() from public,anon,authenticated,service_role;
create trigger purchase_manual_audit after insert on public.purchases for each row execute function purchases_private.audit_manual_purchase();

create unique index stock_purchase_reversal_once on public.stock_movements(ref_id) where ref_type='purchase_item_void';
create function public.void_purchase_manual_atomic(p_business_id uuid,p_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.purchases%rowtype; l public.purchase_items%rowtype; role_name text;
begin
 select * into p from public.purchases where id=p_id and business_id=p_business_id for update;
 if not found then raise exception 'purchase_unavailable'; end if;
 role_name:=public.stock_actor_role(p_business_id,p.branch_id,auth.uid());
 if role_name not in ('owner','admin','manager') then raise exception 'purchase_permission_denied'; end if;
 if current_user::text<>'authenticated' or p.source is distinct from 'manual' or p.invoice_id is not null then raise exception 'purchase_requires_source_review'; end if;
 if p.record_status='voided' and p.void_reason=btrim(p_reason) and p.version=p_expected_version+1 then return jsonb_build_object('ok',true,'id',p.id,'replayed',true); end if;
 if p.version is distinct from p_expected_version or p.record_status<>'active' then raise exception 'purchase_conflict'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'purchase_reason_required'; end if;
 update public.purchases set record_status='voided',version=version+1,void_reason=btrim(p_reason),voided_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('ok',true,'id',p.id,'replayed',false);
end $$;
revoke all on function public.void_purchase_manual_atomic(uuid,uuid,integer,text) from public,anon,service_role;
grant execute on function public.void_purchase_manual_atomic(uuid,uuid,integer,text) to authenticated;
create function purchases_private.audit_purchase_void() returns trigger language plpgsql security definer set search_path='' as $$
declare r text;
begin
 if new.record_status is not distinct from old.record_status then return null; end if;
 update public.balance_snapshots set purchases_data_stale=true where business_id=new.business_id;
 select role::text into r from public.business_members where business_id=new.business_id and user_id=auth.uid();
 if r is null or r not in ('owner','admin','manager') or not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'purchase_actor_forbidden'; end if;
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 select new.business_id,auth.uid(),p.full_name,r,'purchase.voided','purchases',new.id,'Compra anulada con historial',
 jsonb_build_object('branch_id',new.branch_id,'reason',new.void_reason,'before',to_jsonb(old),'after',to_jsonb(new)) from public.profiles p where p.id=auth.uid();
 return null;
end $$;
revoke all on function purchases_private.audit_purchase_void() from public,anon,authenticated,service_role;
create trigger purchase_void_audit after update on public.purchases for each row execute function purchases_private.audit_purchase_void();

create function public.guard_manual_purchase_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.manual_request_id is null then return case when tg_op='DELETE' then old else new end; end if;
 if tg_op='DELETE' then raise exception 'purchase_history_immutable'; end if;
 if (new.id,new.business_id,new.branch_id,new.supplier_id,new.purchased_at,new.total,new.payment_method,new.invoice_id,new.created_by,new.manual_request_id,new.manual_payload,new.source)
  is distinct from (old.id,old.business_id,old.branch_id,old.supplier_id,old.purchased_at,old.total,old.payment_method,old.invoice_id,old.created_by,old.manual_request_id,old.manual_payload,old.source) then raise exception 'purchase_history_immutable'; end if;
 if old.record_status<>'active' or new.record_status<>'voided' or new.version<>old.version+1 or new.voided_at is null or length(btrim(coalesce(new.void_reason,''))) not between 1 and 1000 then raise exception 'purchase_invalid_transition'; end if;
 return new;
end $$;
revoke all on function public.guard_manual_purchase_history() from public,anon,authenticated,service_role;
create trigger manual_purchase_history before update or delete on public.purchases for each row execute function public.guard_manual_purchase_history();
create function public.reverse_manual_purchase_receipts() returns trigger language plpgsql security invoker set search_path='' as $$
declare l public.purchase_items%rowtype; r text;
begin
 if new.record_status is not distinct from old.record_status or new.source is distinct from 'manual' then return null; end if;
 r:=public.stock_actor_role(new.business_id,new.branch_id,auth.uid());
 if r not in ('owner','admin','manager') then raise exception 'purchase_permission_denied'; end if;
 for l in select i.* from public.purchase_items i where i.purchase_id=new.id and i.ingredient_id is not null order by i.ingredient_id,i.id loop
  if not exists(select 1 from public.stock_movements m where m.ref_type='purchase_item' and m.ref_id=l.id and m.input_quantity=l.qty and m.input_unit=public.catalog_normalize_unit(l.unit)) then raise exception 'purchase_receipt_missing'; end if;
  perform public.record_stock_movement_atomic(new.business_id,auth.uid(),l.ingredient_id,new.branch_id,'out',l.qty,left('Anulación de compra · '||new.void_reason,1000),l.unit,'manual','purchase_item_void',l.id);
 end loop;
 return null;
end $$;
revoke all on function public.reverse_manual_purchase_receipts() from public,anon,authenticated,service_role;
create trigger purchase_void_receipts after update on public.purchases for each row execute function public.reverse_manual_purchase_receipts();

create function public.guard_manual_purchase_item() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.purchases where id=old.purchase_id and manual_request_id is not null)
 or (tg_op='UPDATE' and exists(select 1 from public.purchases where id=new.purchase_id and manual_request_id is not null)) then raise exception 'purchase_items_history_immutable'; end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function public.guard_manual_purchase_item() from public,anon,authenticated,service_role;
create trigger manual_purchase_item_history before update or delete on public.purchase_items for each row execute function public.guard_manual_purchase_item();
-- Deferred invariant validates the complete transaction, including direct REST
-- writes. No mutable client flag is trusted to bypass receipt integrity.
create function public.check_manual_purchase_receipt() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.purchases%rowtype; pid uuid; expected jsonb; actual jsonb;
begin
 if tg_table_name='purchases' then pid:=new.id; else pid:=new.purchase_id; end if;
 select * into p from public.purchases where id=pid;
 if p.manual_request_id is null then return null; end if;
 select jsonb_agg(v order by v::text) into expected from (
  select jsonb_build_object('ingredient',nullif(x->>'ingredientId','')::uuid,'description',btrim(x->>'description'),'qty',(x->>'qty')::numeric(18,6),'unit',btrim(x->>'unit'),'price',(x->>'unitPrice')::numeric(12,2),'total',round((x->>'qty')::numeric*(x->>'unitPrice')::numeric,2)::numeric(12,2)) v
  from jsonb_array_elements(p.manual_payload->'items') x
 ) e;
 select jsonb_agg(v order by v::text) into actual from (
  select jsonb_build_object('ingredient',ingredient_id,'description',description,'qty',qty,'unit',unit,'price',unit_price,'total',total) v from public.purchase_items where purchase_id=p.id
 ) a;
 if expected is distinct from actual or p.total is distinct from (select sum(total) from public.purchase_items where purchase_id=p.id) then raise exception 'purchase_receipt_incomplete'; end if;
 if exists(select 1 from public.purchase_items i where i.purchase_id=p.id and i.ingredient_id is not null and not exists(select 1 from public.stock_movements m where m.ref_type='purchase_item' and m.ref_id=i.id and m.input_quantity=i.qty and m.input_unit=public.catalog_normalize_unit(i.unit) and m.branch_id=p.branch_id and m.ingredient_id=i.ingredient_id)) then raise exception 'purchase_stock_receipt_missing'; end if;
 return null;
end $$;
revoke all on function public.check_manual_purchase_receipt() from public,anon,authenticated,service_role;
create constraint trigger purchase_receipt_complete after insert on public.purchases deferrable initially deferred for each row execute function public.check_manual_purchase_receipt();
create constraint trigger purchase_item_receipt_complete after insert on public.purchase_items deferrable initially deferred for each row execute function public.check_manual_purchase_receipt();

create policy purchase_audit_scope on public.activity_logs as restrictive for select to authenticated using (
 target_type is distinct from 'purchases' or (
  exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
  and case when data->>'branch_id' is null then public.has_business_write_role(business_id,array['owner','admin','manager'])
   else public.can_access_business_branch(business_id,(data->>'branch_id')::uuid) end
 )
);

create function public.replace_purchase_manual_atomic(p_business_id uuid,p_original_id uuid,p_expected_version integer,p_reason text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if (p_input->>'replacesPurchaseId')::uuid is distinct from p_original_id or p_input->>'correctionReason' is distinct from btrim(p_reason) then raise exception 'purchase_correction_reference_required'; end if;
 perform public.void_purchase_manual_atomic(p_business_id,p_original_id,p_expected_version,p_reason);
 result:=public.create_purchase_manual_atomic(p_business_id,p_input);
 return result;
end $$;
revoke all on function public.replace_purchase_manual_atomic(uuid,uuid,integer,text,jsonb) from public,anon,service_role;
grant execute on function public.replace_purchase_manual_atomic(uuid,uuid,integer,text,jsonb) to authenticated;

create unique index purchase_single_replacement on public.purchases(business_id,((manual_payload->>'replacesPurchaseId')::uuid)) where manual_payload ? 'replacesPurchaseId';
create policy purchases_active_profile on public.purchases as restrictive for all to authenticated using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)) with check(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));
create policy purchase_items_active_profile on public.purchase_items as restrictive for all to authenticated using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)) with check(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));
