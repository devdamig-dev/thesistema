-- One append-only stock ledger. Existing balances/history are deliberately not
-- replayed or reconciled: old movements did not reliably affect current.
-- New movement INSERTs are the sole operational write path for current.
alter table public.stock_items alter column current type numeric(18,6);
alter table public.stock_items alter column min type numeric(18,6);
alter table public.stock_movements alter column qty type numeric(18,6);
alter table public.purchase_items alter column qty type numeric(18,6);
alter table public.invoice_items alter column qty_numeric type numeric(18,6);
alter table public.stock_movements
  add column business_id uuid references public.businesses(id) on delete restrict,
  add column actor_id uuid,
  add column actor_name text,
  add column actor_role text,
  add column source text,
  add column operation text,
  add column reason_note text,
  add column input_quantity numeric,
  add column input_unit text,
  add column base_unit text,
  add column balance_before numeric(18,6),
  add column balance_after numeric(18,6),
  add column stock_item_id uuid references public.stock_items(id) on delete restrict;
-- Snapshot actor metadata is retained even when a profile is later removed.
create index stock_movements_branch_history_idx on public.stock_movements(branch_id,created_at desc,id desc);
create unique index stock_movements_purchase_line_once_idx on public.stock_movements(ref_id)
  where ref_type='purchase_item';
create unique index stock_movements_extraction_once_idx on public.stock_movements(ref_id)
  where ref_type='ai_extraction';

-- No new grant broadens the existing stock.adjust role/branch matrix.
-- Invoker helper is also used by server-role callers: service_role is transport,
-- never an actor or permission shortcut.
create function public.stock_actor_role(p_business_id uuid,p_branch_id uuid,p_actor_id uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare v_member public.business_members%rowtype; v_count integer;
begin
  if p_actor_id is null or (current_user::text <> 'service_role' and p_actor_id is distinct from auth.uid()) then
    raise exception 'stock_actor_forbidden' using errcode='42501';
  end if;
  if not exists(select 1 from public.profiles p where p.id=p_actor_id and p.active) then
    raise exception 'stock_actor_inactive' using errcode='42501';
  end if;
  select count(*) into v_count from public.business_members m where m.business_id=p_business_id and m.user_id=p_actor_id;
  if v_count<>1 then raise exception 'stock_membership_forbidden' using errcode='42501'; end if;
  select * into v_member from public.business_members m where m.business_id=p_business_id and m.user_id=p_actor_id;
  if v_member.role::text not in ('owner','admin','manager','employee','kitchen','cashier','waiter','delivery') then
    raise exception 'stock_role_forbidden' using errcode='42501';
  end if;
  if not exists(select 1 from public.branches b where b.id=p_branch_id and b.business_id=p_business_id) then
    raise exception 'stock_branch_forbidden' using errcode='42501';
  end if;
  if v_member.role::text not in ('owner','admin','manager') and not exists(
    select 1 from public.branch_assignments ba where ba.business_member_id=v_member.id and ba.branch_id=p_branch_id
  ) then raise exception 'stock_branch_forbidden' using errcode='42501'; end if;
  return v_member.role::text;
end; $$;

-- current is derived. Column grants protect REST writes and invoker SQL alike.
-- Catalog continues to create zero-balance rows and edit minimums normally.
revoke insert, update, delete on public.stock_items from anon, authenticated, service_role;
grant insert(id,ingredient_id,branch_id,min,created_at,updated_at), update(min,updated_at)
  on public.stock_items to authenticated, service_role;
revoke update, delete, truncate on public.stock_movements from anon, authenticated, service_role;
revoke truncate on public.stock_items from anon, authenticated, service_role;

-- Existing permissive branch policies remain authoritative, intersected with
-- active-profile status for every authenticated Data API operation.
create policy stock_items_active_actor on public.stock_items as restrictive for all to authenticated
  using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active))
  with check(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));
create policy stock_movements_active_actor on public.stock_movements as restrictive for all to authenticated
  using(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active))
  with check(exists(select 1 from public.profiles p where p.id=auth.uid() and p.active));

create function public.stock_guard_item()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'stock_item_immutable' using errcode='23514'; end if;
  if tg_op='UPDATE' and (new.id,new.ingredient_id,new.branch_id) is distinct from (old.id,old.ingredient_id,old.branch_id) then
    raise exception 'stock_item_identity_immutable' using errcode='23514';
  end if;
  if current_user::text in ('authenticated','service_role') then
    if tg_op='INSERT' and new.current<>0 or tg_op='UPDATE' and new.current is distinct from old.current then
      raise exception 'stock_balance_requires_movement' using errcode='42501';
    end if;
    if current_user::text='authenticated' and not exists(select 1 from public.profiles p where p.id=auth.uid() and p.active) then
      raise exception 'stock_actor_inactive' using errcode='42501';
    end if;
  end if;
  return new;
end; $$;
create trigger stock_item_guard before insert or update or delete on public.stock_items
  for each row execute function public.stock_guard_item();

-- Typed Inbox inputs are read from the persisted extraction, never caller JSON.
-- Legacy ambiguous movement directions/reasons stay needs_review.
create function public.stock_extraction_input(p_extraction_id uuid,p_business_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype;
  i public.ingredients%rowtype; v_ids uuid[]; v_branch uuid; q numeric; factor numeric; op text; note text; unit text;
begin
  select * into e from public.ai_extractions where id=p_extraction_id;
  select * into m from public.whatsapp_messages where id=e.message_id;
  if e.id is null or e.type<>'stock_update' or m.business_id is distinct from p_business_id
    or (e.business_id is not null and e.business_id<>p_business_id) then
    return jsonb_build_object('ok',false,'error','stock_extraction_not_found');
  end if;
  v_branch:=coalesce(e.branch_id,m.branch_id);
  if v_branch is null or not exists(select 1 from public.branches b where b.id=v_branch and b.business_id=p_business_id)
    or (e.branch_id is not null and m.branch_id is not null and e.branch_id<>m.branch_id) then
    return jsonb_build_object('ok',false,'error','stock_extraction_branch_required');
  end if;
  op:=e.fields->>'operation'; note:=btrim(e.fields->>'reason_note'); unit:=public.catalog_normalize_unit(e.fields->>'unit');
  if op is null or op not in ('in','out','waste','set') or note is null or length(note) not between 1 and 1000
    or unit is null or jsonb_typeof(e.fields->'qty') is distinct from 'number' then
    return jsonb_build_object('ok',false,'error','stock_extraction_fields_required');
  end if;
  q:=(e.fields->>'qty')::numeric;
  if q<0 or q::text in ('NaN','Infinity','-Infinity') or (op<>'set' and q=0) then
    return jsonb_build_object('ok',false,'error','invalid_stock_quantity');
  end if;
  if nullif(e.fields->>'ingredient_id','') is not null then
    select * into i from public.ingredients where id=(e.fields->>'ingredient_id')::uuid and business_id=p_business_id;
  else
    select array_agg(id) into v_ids from public.ingredients where business_id=p_business_id
      and lower(btrim(name))=lower(btrim(e.fields->>'ingredient'));
    if coalesce(cardinality(v_ids),0)<>1 then return jsonb_build_object('ok',false,'error','stock_ingredient_ambiguous'); end if;
    select * into i from public.ingredients where id=v_ids[1];
  end if;
  if i.id is null then return jsonb_build_object('ok',false,'error','stock_ingredient_not_found'); end if;
  factor:=public.catalog_unit_factor(unit,i.unit);
  if factor is null or q*factor<>round(q*factor,6) or q*factor>=1000000000000 then
    return jsonb_build_object('ok',false,'error','invalid_stock_units_or_precision');
  end if;
  return jsonb_build_object('ok',true,'business_id',p_business_id,'branch_id',v_branch,'ingredient_id',i.id,
    'operation',op,'quantity',q,'unit',unit,'reason',note);
exception when invalid_text_representation or numeric_value_out_of_range then
  return jsonb_build_object('ok',false,'error','stock_extraction_fields_required');
end; $$;

-- Permission checks run as the caller before the lock-only privileged trigger.
-- Ingredient row-locking SELECTs intersect UPDATE RLS; granting operational
-- roles ingredient UPDATE merely to lock would materially expand permissions.
create function public.stock_authorize_movement()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_business uuid;
begin
  if current_user::text='authenticated' then
    if new.actor_id is not null and new.actor_id is distinct from auth.uid() then
      raise exception 'stock_actor_forbidden' using errcode='42501';
    end if;
    new.actor_id:=auth.uid();
  elsif current_user::text<>'service_role' then
    raise exception 'stock_transport_forbidden' using errcode='42501';
  end if;
  select business_id into v_business from public.ingredients where id=new.ingredient_id;
  if v_business is null or (new.business_id is not null and new.business_id<>v_business) then
    raise exception 'stock_ingredient_forbidden' using errcode='42501';
  end if;
  new.business_id:=v_business;
  perform public.stock_actor_role(v_business,new.branch_id,new.actor_id);
  -- Match the Inbox RPC's extraction-before-ingredient lock order. This is an
  -- invoker lock; a forbidden/foreign source never reaches privileged locking.
  if new.ref_type='ai_extraction' then
    perform 1 from public.ai_extractions e join public.whatsapp_messages m on m.id=e.message_id
      where e.id=new.ref_id and m.business_id=v_business and (e.business_id=v_business or e.business_id is null)
      for update of e;
    if not found then raise exception 'stock_extraction_forbidden' using errcode='42501'; end if;
  end if;
  return new;
end; $$;
revoke all on function public.stock_authorize_movement() from public,anon,authenticated,service_role;
create trigger stock_movement_authorize before insert on public.stock_movements
  for each row execute function public.stock_authorize_movement();

-- The second narrow privileged trigger locks the already-authorized ingredient
-- row (no values are changed or returned). SHARE blocks unit UPDATE while allowing
-- parallel movements. Source → ingredient → stock is the stable lock order.
create schema if not exists stock_private;
revoke all on schema stock_private from public,anon,authenticated,service_role;
create function stock_private.lock_movement_ingredient()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.ingredients where id=new.ingredient_id and business_id=new.business_id for share;
  if not found then raise exception 'stock_ingredient_forbidden' using errcode='42501'; end if;
  return new;
end; $$;
revoke all on function stock_private.lock_movement_ingredient() from public,anon,authenticated,service_role;
create trigger stock_movement_lock before insert on public.stock_movements
  for each row execute function stock_private.lock_movement_ingredient();

create function public.stock_validate_movement()
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
    if new.source='inbox' and new.ref_type='ai_extraction' and new.ref_id is not null then
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
  if new.ref_type='purchase_item' then
    if new.operation<>'in' or new.source not in ('ocr','inbox','manual','whatsapp','api') then
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
create trigger stock_movement_validate before insert or update or delete on public.stock_movements
  for each row execute function public.stock_validate_movement();

-- Minimum privilege exception: trigger-only derived balance + audit sink.
-- No public callable endpoint, no arguments, no permission changes. The invoker
-- validation trigger has already enforced active actor, role, tenant, branch,
-- units, references and row locking; failure here aborts its whole transaction.
create schema if not exists stock_private;
revoke all on schema stock_private from public,anon,authenticated,service_role;
create function stock_private.apply_movement()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  update public.stock_items set current=new.balance_after
    where id=new.stock_item_id and ingredient_id=new.ingredient_id and branch_id=new.branch_id
      and current=new.balance_before;
  if not found then raise exception 'stock_balance_conflict' using errcode='40001'; end if;
  insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
    values(new.business_id,new.actor_id,new.actor_name,new.actor_role,'stock.movement_recorded','stock_movements',new.id,
      format('Stock %s · %s %s · %s',new.operation,new.qty,new.base_unit,new.reason_note),
      jsonb_build_object('source',new.source,'result','success','business_id',new.business_id,'branch_id',new.branch_id,
        'stock_item_id',new.stock_item_id,'ingredient_id',new.ingredient_id,'operation',new.operation,
        'reason',new.reason_note,'input_quantity',new.input_quantity,'input_unit',new.input_unit,'base_unit',new.base_unit,
        'delta',new.qty,'balance_before',new.balance_before,'balance_after',new.balance_after,
        'ref_type',new.ref_type,'ref_id',new.ref_id));
  return null;
end; $$;
revoke all on function stock_private.apply_movement() from public,anon,authenticated,service_role;
create trigger stock_movement_apply after insert on public.stock_movements
  for each row execute function stock_private.apply_movement();

-- Source status is an invoker AFTER INSERT effect, never a BEFORE side effect:
-- INSERT ... ON CONFLICT DO NOTHING must not approve an extraction without a
-- persisted movement. It uses the same transaction and the existing source RLS.
create function public.stock_complete_source()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.source='inbox' and new.ref_type='ai_extraction' then
    update public.ai_extractions set status='approved',approved_by=new.actor_id,approved_at=clock_timestamp(),
      target_entity='stock_movements',target_record_id=new.id where id=new.ref_id and status in ('pending','needs_review');
    if not found then raise exception 'stock_extraction_forbidden' using errcode='42501'; end if;
  end if;
  return null;
end; $$;
revoke all on function public.stock_complete_source() from public,anon,authenticated,service_role;
create trigger stock_movement_source_complete after insert on public.stock_movements
  for each row execute function public.stock_complete_source();

-- One service contract for manual UI, WhatsApp and invoice purchases. No direct
-- UPDATE current or separate best-effort audit exists in any of these RPCs.
create function public.record_stock_movement_atomic(
  p_business_id uuid,p_actor_id uuid,p_ingredient_id uuid,p_branch_id uuid,
  p_operation text,p_quantity numeric,p_reason text,p_unit text default null,
  p_source text default 'manual',p_ref_type text default null,p_ref_id uuid default null
) returns table(stock_item_id uuid,new_current numeric,delta numeric)
language plpgsql security invoker set search_path='' as $$
declare v_movement public.stock_movements%rowtype;
begin
  if p_business_id is null then raise exception 'stock_business_required' using errcode='22023'; end if;
  insert into public.stock_movements(business_id,actor_id,ingredient_id,branch_id,operation,input_quantity,
    reason_note,input_unit,source,ref_type,ref_id,reason,qty)
    values(p_business_id,p_actor_id,p_ingredient_id,p_branch_id,p_operation,p_quantity,
      p_reason,p_unit,p_source,p_ref_type,p_ref_id,'manual_adjust',0)
    returning * into v_movement;
  return query select v_movement.stock_item_id,v_movement.balance_after,v_movement.qty;
end; $$;

-- Retire unsafe overloads: old callers fail loudly rather than guessing a reason
-- or an actor, and cannot double-count balance updates.
drop function public.adjust_stock_manual(uuid,uuid,text,numeric);
drop function public.adjust_stock_for_agent(uuid,uuid,uuid,text,numeric);
create function public.adjust_stock_manual(p_ingredient_id uuid,p_branch_id uuid,p_operation text,
  p_quantity numeric,p_reason text,p_unit text default null)
returns table(stock_item_id uuid,new_current numeric,delta numeric)
language plpgsql security invoker set search_path='' as $$
declare v_business uuid;
begin
  select business_id into v_business from public.ingredients where id=p_ingredient_id;
  return query select * from public.record_stock_movement_atomic(v_business,auth.uid(),p_ingredient_id,p_branch_id,
    p_operation,p_quantity,p_reason,p_unit,'manual');
end; $$;
create function public.adjust_stock_for_agent(p_business_id uuid,p_actor_id uuid,p_ingredient_id uuid,p_branch_id uuid,
  p_operation text,p_quantity numeric,p_reason text,p_unit text default null)
returns table(new_current numeric,delta numeric)
language plpgsql security invoker set search_path='' as $$
begin
  return query select movement.new_current,movement.delta from public.record_stock_movement_atomic(
    p_business_id,p_actor_id,p_ingredient_id,p_branch_id,p_operation,p_quantity,p_reason,p_unit,'whatsapp') movement;
end; $$;
revoke all on function public.stock_actor_role(uuid,uuid,uuid),
  public.record_stock_movement_atomic(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid),
  public.adjust_stock_manual(uuid,uuid,text,numeric,text,text) from public,anon;
grant execute on function public.stock_actor_role(uuid,uuid,uuid),
  public.record_stock_movement_atomic(uuid,uuid,uuid,uuid,text,numeric,text,text,text,text,uuid),
  public.adjust_stock_manual(uuid,uuid,text,numeric,text,text) to authenticated,service_role;
revoke all on function public.adjust_stock_for_agent(uuid,uuid,uuid,uuid,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.adjust_stock_for_agent(uuid,uuid,uuid,uuid,text,numeric,text,text) to service_role;
revoke all on function public.stock_guard_item(),public.stock_validate_movement() from public,anon,authenticated,service_role;

-- Approval remains server-only, idempotent on its locked invoice, and atomic
-- across purchase lines, stock, costs, invoice state, activity and notifications.
create or replace function public.approve_invoice_atomic(p_invoice_id uuid,p_business_id uuid,p_actor_id uuid)
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
        'ocr','purchase_item',v_purchase_item_id);
      v_stock_count:=v_stock_count+1;
      if not(v_ingredient_id=any(v_ingredient_ids)) then v_ingredient_ids:=array_append(v_ingredient_ids,v_ingredient_id); end if;
    end if;
  end loop;
  foreach v_ingredient_id in array v_ingredient_ids loop
    perform public.recalc_ingredient_cost(v_ingredient_id);
  end loop;
  update public.invoices set status='approved' where id=v_invoice.id and business_id=p_business_id;
  if not found then raise exception 'invoice_update_race'; end if;
  insert into public.invoice_processing_logs(invoice_id,stage,ok,data)
    values(v_invoice.id,'approval',true,jsonb_build_object('purchase_id',v_purchase_id,'atomic',true,'stock_count',v_stock_count));
  insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
    values(p_business_id,p_actor_id,coalesce(v_actor_name,'Usuario'),v_role::text,'invoice.approved','invoices',v_invoice.id,
      format('Factura %s aprobada · %s ítems · compra creada.',v_invoice.number,v_item_count),
      jsonb_build_object('invoice_id',v_invoice.id,'purchase_id',v_purchase_id,'branch_id',v_invoice.branch_id,
        'source','ocr','result','success','ingredients_affected',cardinality(v_ingredient_ids),'atomic',true));
  insert into public.notifications(business_id,tone,priority,category,title,detail,href,source)
    values(p_business_id,'success','medium','system','Factura aprobada e imputada',
      format('%s · %s ítems · %s entradas de stock registradas.',v_invoice.number,v_item_count,v_stock_count),'/facturas','invoices');
  return jsonb_build_object('ok',true,'already_approved',false,'invoice_id',v_invoice.id,'purchase_id',v_purchase_id,
    'invoice_number',v_invoice.number,'item_count',v_item_count,'stock_count',v_stock_count,'ingredient_ids',to_jsonb(v_ingredient_ids));
end; $$;
revoke all on function public.approve_invoice_atomic(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_invoice_atomic(uuid,uuid,uuid) to service_role;

-- Inbox approval owns its source record and lock; incomplete extraction fields
-- cannot be made authoritative by fallback quantities, names or a main branch.
create function public.approve_stock_extraction_atomic(p_extraction_id uuid,p_business_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.ai_extractions%rowtype; v_input jsonb; v_movement uuid;
begin
  if not exists(select 1 from public.profiles p where p.id=auth.uid() and p.active)
    or not public.has_business_write_role(p_business_id,array['owner','admin','manager','employee','kitchen','cashier','waiter','delivery']) then
    return jsonb_build_object('ok',false,'error','stock_actor_forbidden');
  end if;
  select * into e from public.ai_extractions where id=p_extraction_id and type='stock_update'
    and (business_id=p_business_id or business_id is null) for update;
  if not found or not exists(select 1 from public.whatsapp_messages m where m.id=e.message_id and m.business_id=p_business_id) then
    return jsonb_build_object('ok',false,'error','stock_extraction_not_found');
  end if;
  if e.status='approved' then
    if e.target_record_id is null or not exists(select 1 from public.stock_movements where id=e.target_record_id
      and business_id=p_business_id and source='inbox' and ref_type='ai_extraction' and ref_id=e.id) then
      return jsonb_build_object('ok',false,'error','approval_inconsistent');
    end if;
    return jsonb_build_object('ok',true,'already_approved',true,'target_record_id',e.target_record_id);
  end if;
  if e.status not in ('pending','needs_review') then return jsonb_build_object('ok',false,'error','stock_extraction_not_pending'); end if;
  v_input:=public.stock_extraction_input(e.id,p_business_id);
  if not coalesce((v_input->>'ok')::boolean,false) then
    update public.ai_extractions set status='needs_review' where id=e.id;
    return jsonb_build_object('ok',false,'needs_review',true,'error',v_input->>'error');
  end if;
  perform public.record_stock_movement_atomic(p_business_id,auth.uid(),(v_input->>'ingredient_id')::uuid,
    (v_input->>'branch_id')::uuid,v_input->>'operation',(v_input->>'quantity')::numeric,v_input->>'reason',v_input->>'unit',
    'inbox','ai_extraction',e.id);
  select target_record_id into v_movement from public.ai_extractions where id=e.id;
  return jsonb_build_object('ok',true,'already_approved',false,'target_record_id',v_movement);
end; $$;
revoke all on function public.stock_extraction_input(uuid,uuid),public.approve_stock_extraction_atomic(uuid,uuid) from public,anon;
grant execute on function public.stock_extraction_input(uuid,uuid),public.approve_stock_extraction_atomic(uuid,uuid) to authenticated,service_role;
