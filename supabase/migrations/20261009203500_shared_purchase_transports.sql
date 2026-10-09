-- One authenticated/service invoker transaction for reviewed purchases. No actor
-- impersonation, generated line quantities, or SECURITY DEFINER stock transport.
alter table public.purchases
 add column origin_extraction_id uuid references public.ai_extractions(id) on delete restrict,
 add column origin_pending_id uuid references public.whatsapp_agent_pending_operations(id) on delete restrict,
 add column origin_expected_fields jsonb,
 add column purchase_kind text generated always as (case when manual_request_id is null then 'legacy' when manual_payload->>'kind'='summary' then 'summary' else 'detailed' end) stored;
create unique index purchases_extraction_once on public.purchases(origin_extraction_id) where origin_extraction_id is not null;
create unique index purchases_pending_once on public.purchases(origin_pending_id) where origin_pending_id is not null;
alter table public.purchases add constraint purchase_origin_receipt check(
 (manual_request_id is null and source is distinct from 'manual' and source is distinct from 'inbox' and source is distinct from 'whatsapp' and origin_extraction_id is null and origin_pending_id is null and origin_expected_fields is null)
 or (manual_request_id is not null and manual_payload is not null and (
  (source='manual' and origin_extraction_id is null and origin_pending_id is null and origin_expected_fields is null)
  or (source='inbox' and origin_extraction_id is not null and origin_pending_id is null and jsonb_typeof(origin_expected_fields)='object')
  or (source='whatsapp' and origin_pending_id is not null and origin_extraction_id is null and origin_expected_fields is null)
 ))) not valid;

-- Shared validation also runs for direct Data API writes; the trigger cannot
-- rely on callers entering through an RPC wrapper.
create function public.validate_purchase_payload(p_business_id uuid,payload jsonb) returns numeric language plpgsql security invoker set search_path='' as $$
declare branch uuid; supplier uuid; request uuid; kind text; line jsonb; ingredient public.ingredients%rowtype; q numeric; price numeric; total numeric:=0; purchase_date date; method text; description text; unit text; ingredient_id uuid;
begin
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('requestId','kind','branchId','supplierId','purchasedAt','paymentMethod','amount','items','replacesPurchaseId','correctionReason')) then raise exception 'purchase_invalid_input' using errcode='22023'; end if;
 branch:=(payload->>'branchId')::uuid; supplier:=(payload->>'supplierId')::uuid; request:=(payload->>'requestId')::uuid; kind:=coalesce(payload->>'kind','detailed');
 if branch is null or supplier is null or request is null or kind not in ('summary','detailed') then raise exception 'purchase_invalid_input' using errcode='22023'; end if;
 perform 1 from public.suppliers where id=supplier and business_id=p_business_id and active for share;
 if not found then raise exception 'purchase_supplier_unavailable' using errcode='23514'; end if;
 if coalesce(payload->>'purchasedAt','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'purchase_date_required' using errcode='22023'; end if;
 purchase_date:=(payload->>'purchasedAt')::date; method:=btrim(payload->>'paymentMethod');
 if method is null or length(method) not between 1 and 100 or method ~ '[[:cntrl:]]' then raise exception 'purchase_invalid_input' using errcode='22023'; end if;
 if kind='summary' then
  if payload ? 'items' and payload->'items'<>'[]'::jsonb then raise exception 'purchase_summary_has_no_items' using errcode='22023'; end if;
  total:=(payload->>'amount')::numeric;
  if total is null or total::text in ('NaN','Infinity','-Infinity') or total<=0 or total>=10000000000 or total<>round(total,2) then raise exception 'purchase_invalid_summary' using errcode='22023'; end if;
 else
  if payload ? 'amount' then raise exception 'purchase_detailed_total_derived' using errcode='22023'; end if;
  if jsonb_typeof(payload->'items') is distinct from 'array' or jsonb_array_length(payload->'items') not between 1 and 100 then raise exception 'purchase_items_required' using errcode='22023'; end if;
  for line in select value from jsonb_array_elements(payload->'items') loop
   if jsonb_typeof(line) is distinct from 'object' or exists(select 1 from jsonb_object_keys(line) k where k not in ('ingredientId','description','qty','unit','unitPrice')) then raise exception 'purchase_invalid_line' using errcode='22023'; end if;
   q:=(line->>'qty')::numeric; price:=(line->>'unitPrice')::numeric; description:=btrim(line->>'description'); unit:=btrim(line->>'unit');
   if q is null or q::text in ('NaN','Infinity','-Infinity') or q<=0 or q>=1000000000000 or q<>round(q,6) or price is null or price::text in ('NaN','Infinity','-Infinity') or price<0 or price>=10000000000 or price<>round(price,2)
    or description is null or length(description) not between 1 and 1000 or description ~ '[[:cntrl:]]' or unit is null or length(unit) not between 1 and 40 or unit ~ '[[:cntrl:]]' then raise exception 'purchase_invalid_line' using errcode='22023'; end if;
   total:=total+round(q*price,2); if total>=10000000000 then raise exception 'purchase_total_overflow' using errcode='22003'; end if;
   ingredient_id:=nullif(line->>'ingredientId','')::uuid;
   if ingredient_id is not null then
    select * into ingredient from public.ingredients where id=ingredient_id and business_id=p_business_id and active for share;
    if not found or public.catalog_unit_factor(unit,ingredient.unit) is null then raise exception 'purchase_ingredient_unavailable' using errcode='23514'; end if;
   end if;
  end loop;
 end if;
 return total;
end $$;
revoke all on function public.validate_purchase_payload(uuid,jsonb) from public,anon;
grant execute on function public.validate_purchase_payload(uuid,jsonb) to authenticated,service_role;

-- Defense in depth for direct Data API inserts. Sources cannot be selected by a
-- free-form client field: each nonmanual record must match persisted evidence.
create function public.guard_purchase_origin() returns trigger language plpgsql security invoker set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype; p public.whatsapp_agent_pending_operations%rowtype; member public.business_members%rowtype; c public.whatsapp_authorized_conversations%rowtype; invoice public.invoices%rowtype; role_name text;
begin
 if new.record_status is distinct from 'active' or new.version is distinct from 1 or new.void_reason is not null or new.voided_at is not null then raise exception 'purchase_invalid_initial_state' using errcode='23514'; end if;
 new.created_at:=clock_timestamp();
 if new.manual_request_id is null then
  -- Existing legacy rows remain readable. New legacy-shaped writes are not a
  -- transport: only the service invoice transaction has persisted authority.
  if current_user::text<>'service_role' or new.invoice_id is null or new.source is not null then raise exception 'purchase_receipt_required' using errcode='42501'; end if;
  select * into invoice from public.invoices where id=new.invoice_id for update;
  if invoice.id is null or invoice.status not in ('extracted','needs_review','rejected')
   or (new.business_id,new.branch_id,new.supplier_id,new.purchased_at,new.total,new.payment_method)
    is distinct from (invoice.business_id,invoice.branch_id,invoice.supplier_id,invoice.invoice_date,invoice.total,invoice.payment_method)
   or invoice.reviewed_version is distinct from invoice.edit_version
   or not exists(select 1 from public.invoice_mutations im where im.business_id=new.business_id and im.invoice_id=invoice.id and im.request_id=invoice.reviewed_request_id and im.payload->'reviewed'='true'::jsonb and (im.result->>'version')::integer=invoice.edit_version)
   or public.stock_actor_role(new.business_id,new.branch_id,new.created_by) not in ('owner','admin') then raise exception 'purchase_invoice_origin_invalid' using errcode='42501'; end if;
  perform 1 from public.profiles where id=new.created_by and active for share;
  if not found then raise exception 'purchase_actor_inactive' using errcode='42501'; end if;
  perform 1 from public.business_members where business_id=new.business_id and user_id=new.created_by and role in ('owner','admin') for share;
  if not found then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
  perform 1 from public.business_modules where business_id=new.business_id and module_key='invoices_ocr' and enabled for share;
  if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
  return new;
 end if;
 if current_user::text not in ('authenticated','service_role') then raise exception 'purchase_transport_forbidden' using errcode='42501'; end if;
 role_name:=public.stock_actor_role(new.business_id,new.branch_id,new.created_by);
 perform 1 from public.profiles where id=new.created_by and active for share;
 if not found then raise exception 'purchase_actor_inactive' using errcode='42501'; end if;
 perform 1 from public.business_members where business_id=new.business_id and user_id=new.created_by and role in ('owner','admin','manager') for share;
 if not found then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 perform 1 from public.business_modules where business_id=new.business_id and module_key='purchases' and enabled for share;
 if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
 if role_name not in ('owner','admin','manager') or not exists(select 1 from public.business_modules where business_id=new.business_id and module_key='purchases' and enabled) then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 if new.total is distinct from public.validate_purchase_payload(new.business_id,new.manual_payload)
  or (new.manual_request_id,new.branch_id,new.supplier_id,new.purchased_at,new.payment_method)
   is distinct from ((new.manual_payload->>'requestId')::uuid,(new.manual_payload->>'branchId')::uuid,(new.manual_payload->>'supplierId')::uuid,(new.manual_payload->>'purchasedAt')::date,btrim(new.manual_payload->>'paymentMethod'))
  or new.invoice_id is not null then raise exception 'purchase_receipt_header_mismatch' using errcode='23514'; end if;
 if new.manual_payload ? 'replacesPurchaseId' and (new.source<>'manual' or not exists(select 1 from public.purchases prior where prior.id=(new.manual_payload->>'replacesPurchaseId')::uuid and prior.business_id=new.business_id and prior.record_status='voided' and prior.source='manual' and prior.void_reason=new.manual_payload->>'correctionReason')) then raise exception 'purchase_correction_reference_required' using errcode='23514'; end if;
 if new.source='manual' then
  if current_user::text<>'authenticated' or new.created_by is distinct from auth.uid() then raise exception 'purchase_actor_forbidden' using errcode='42501'; end if;
 elsif new.source='inbox' then
  perform 1 from public.business_modules where business_id=new.business_id and module_key='inbox_ai' and enabled for share;
  if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
  if current_user::text<>'authenticated' or new.created_by is distinct from auth.uid() or not exists(select 1 from public.business_modules where business_id=new.business_id and module_key='inbox_ai' and enabled) then raise exception 'purchase_actor_forbidden' using errcode='42501'; end if;
  select * into e from public.ai_extractions where id=new.origin_extraction_id for update;
  select * into m from public.whatsapp_messages where id=e.message_id for share;
  if e.id is null or e.type<>'purchase' or e.status not in ('pending','needs_review','failed') or e.fields is distinct from new.origin_expected_fields
   or m.id is null or m.business_id is distinct from new.business_id or (e.business_id is not null and e.business_id<>new.business_id)
   or (e.branch_id is not null and e.branch_id<>new.branch_id) or (m.branch_id is not null and m.branch_id<>new.branch_id)
   then raise exception 'purchase_extraction_changed' using errcode='23514'; end if;
 elsif new.source='whatsapp' then
  if current_user::text<>'service_role' then raise exception 'purchase_transport_forbidden' using errcode='42501'; end if;
  select * into p from public.whatsapp_agent_pending_operations where id=new.origin_pending_id for update;
  select * into member from public.business_members where id=p.member_id for share;
  select * into c from public.whatsapp_authorized_conversations where id=p.conversation_id for share;
  if p.id is null or p.business_id is distinct from new.business_id or member.business_id is distinct from new.business_id or member.user_id is distinct from new.created_by
   or p.arguments->>'kind' is distinct from 'summary' or p.kind<>'confirmation' or p.tool_name<>'purchases.create' or p.consumed_at is not null or p.expires_at<=clock_timestamp()
   or p.arguments->'__resultUncertain' is distinct from 'true'::jsonb or (p.arguments-'__resultUncertain'-'supplierLabel'-'branchLabel') is distinct from new.manual_payload
   or c.id is null or not c.enabled or c.business_id<>new.business_id or (c.branch_id is not null and c.branch_id<>new.branch_id)
   then raise exception 'purchase_pending_forbidden' using errcode='42501'; end if;
 else raise exception 'purchase_source_forbidden' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function public.guard_purchase_origin() from public,anon,authenticated,service_role;
create trigger purchase_origin_guard before insert on public.purchases for each row execute function public.guard_purchase_origin();

create function public.commit_purchase_atomic(p_business_id uuid,p_input jsonb default null,p_extraction_id uuid default null,p_pending_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; origin text; role_name text; branch uuid; supplier uuid; request uuid; payload jsonb; expected_fields jsonb;
 e public.ai_extractions%rowtype; message public.whatsapp_messages%rowtype; pending public.whatsapp_agent_pending_operations%rowtype; member public.business_members%rowtype; conversation public.whatsapp_authorized_conversations%rowtype;
 existing public.purchases%rowtype; line jsonb; ingredient public.ingredients%rowtype; kind text;
 purchase_id uuid; item_id uuid; q numeric; price numeric; total numeric:=0; purchase_date date; method text; description text; unit text; ingredient_id uuid;
begin
 if p_business_id is null or (p_extraction_id is not null and p_pending_id is not null) then raise exception 'purchase_invalid_context' using errcode='22023'; end if;
 if p_pending_id is not null then
  if current_user::text<>'service_role' or p_input is not null then raise exception 'purchase_transport_forbidden' using errcode='42501'; end if;
  select * into pending from public.whatsapp_agent_pending_operations where id=p_pending_id and business_id=p_business_id;
  if not found then raise exception 'purchase_pending_forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-pending:'||p_business_id::text||':'||pending.member_id::text||':'||pending.conversation_id::text,0));
  select * into pending from public.whatsapp_agent_pending_operations where id=p_pending_id and business_id=p_business_id for update;
  select * into member from public.business_members where id=pending.member_id and business_id=p_business_id for share;
  select * into conversation from public.whatsapp_authorized_conversations where id=pending.conversation_id and business_id=p_business_id for share;
  if member.id is null or pending.kind<>'confirmation' or pending.tool_name<>'purchases.create' or pending.consumed_at is not null or pending.expires_at<=clock_timestamp()
   or pending.arguments->'__resultUncertain' is distinct from 'true'::jsonb or conversation.id is null or not conversation.enabled then raise exception 'purchase_pending_forbidden' using errcode='42501'; end if;
  actor:=member.user_id; origin:='whatsapp'; payload:=pending.arguments-'__resultUncertain'-'supplierLabel'-'branchLabel';
  if payload->>'kind' is distinct from 'summary' then raise exception 'purchase_pending_forbidden' using errcode='42501'; end if;
 elsif p_extraction_id is not null then
  if current_user::text<>'authenticated' or auth.uid() is null then raise exception 'purchase_transport_forbidden' using errcode='42501'; end if;
  actor:=auth.uid(); origin:='inbox';
  if jsonb_typeof(p_input) is distinct from 'object' or jsonb_typeof(p_input->'expectedFields') is distinct from 'object' or jsonb_typeof(p_input->'review') is distinct from 'object'
   or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('expectedFields','review')) then raise exception 'purchase_invalid_review' using errcode='22023'; end if;
  expected_fields:=p_input->'expectedFields'; payload:=p_input->'review';
  if payload ? 'requestId' or payload ? 'replacesPurchaseId' or payload ? 'correctionReason' or payload->>'kind' not in ('summary','detailed') or payload->>'kind' is null then raise exception 'purchase_invalid_review' using errcode='22023'; end if;
  request:=md5(p_extraction_id::text||':purchase')::uuid; payload:=payload||jsonb_build_object('requestId',request);
  select * into e from public.ai_extractions where id=p_extraction_id for update;
  select * into message from public.whatsapp_messages where id=e.message_id for share;
  if e.id is null or e.type<>'purchase' or message.id is null or message.business_id<>p_business_id or (e.business_id is not null and e.business_id<>p_business_id) then raise exception 'purchase_extraction_forbidden' using errcode='42501'; end if;
  perform 1 from public.business_modules where business_id=p_business_id and module_key='inbox_ai' and enabled for share;
  if not found then raise exception 'purchase_module_disabled'; end if;
 else
  if current_user::text<>'authenticated' or auth.uid() is null then raise exception 'purchase_transport_forbidden' using errcode='42501'; end if;
  actor:=auth.uid(); origin:='manual'; payload:=p_input;
 end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('requestId','kind','branchId','supplierId','purchasedAt','paymentMethod','amount','items','replacesPurchaseId','correctionReason')) then raise exception 'purchase_invalid_input' using errcode='22023'; end if;
 branch:=(payload->>'branchId')::uuid; supplier:=(payload->>'supplierId')::uuid; request:=(payload->>'requestId')::uuid; kind:=coalesce(payload->>'kind','detailed');
 if branch is null or supplier is null or request is null or kind not in ('summary','detailed') then raise exception 'purchase_invalid_input' using errcode='22023'; end if;
 role_name:=public.stock_actor_role(p_business_id,branch,actor);
 if role_name not in ('owner','admin','manager') then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'purchase_actor_inactive' using errcode='42501'; end if;
 perform 1 from public.business_members where business_id=p_business_id and user_id=actor and role in ('owner','admin','manager') for share;
 if not found then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 perform 1 from public.business_modules where business_id=p_business_id and module_key='purchases' and enabled for share;
 if not found then raise exception 'purchase_module_disabled'; end if;
 if origin='whatsapp' and conversation.branch_id is not null and conversation.branch_id<>branch then raise exception 'purchase_branch_forbidden' using errcode='42501'; end if;
 if origin='inbox' and ((e.branch_id is not null and e.branch_id<>branch) or (message.branch_id is not null and message.branch_id<>branch)) then raise exception 'purchase_branch_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||request::text,0));
 -- Membership/profile/module rows are share-locked above, preventing live
 -- revocation during the receipt. Recheck branch authorization after the wait.
 role_name:=public.stock_actor_role(p_business_id,branch,actor);
 if role_name not in ('owner','admin','manager') then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 select * into existing from public.purchases where business_id=p_business_id and manual_request_id=request;
 if found then
  if existing.created_by is distinct from actor or existing.source is distinct from origin or existing.manual_payload is distinct from payload or existing.origin_extraction_id is distinct from p_extraction_id or existing.origin_pending_id is distinct from p_pending_id or existing.origin_expected_fields is distinct from expected_fields then raise exception 'purchase_idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('ok',true,'id',existing.id,'replayed',true,'kind',existing.purchase_kind,'source',existing.source);
 end if;
 if origin='inbox' and (e.status not in ('pending','needs_review','failed') or e.fields is distinct from expected_fields) then raise exception 'purchase_extraction_changed' using errcode='23514'; end if;
 if payload ? 'replacesPurchaseId' then
  if origin<>'manual' or not exists(select 1 from public.purchases prior where prior.id=(payload->>'replacesPurchaseId')::uuid and prior.business_id=p_business_id and prior.record_status='voided' and prior.source='manual' and prior.void_reason=payload->>'correctionReason') then raise exception 'purchase_correction_reference_required' using errcode='23514'; end if;
 end if;
 total:=public.validate_purchase_payload(p_business_id,payload);
 purchase_date:=(payload->>'purchasedAt')::date; method:=btrim(payload->>'paymentMethod');
 insert into public.purchases(business_id,branch_id,supplier_id,purchased_at,total,payment_method,created_by,manual_request_id,manual_payload,source,origin_extraction_id,origin_pending_id,origin_expected_fields)
 values(p_business_id,branch,supplier,purchase_date,total,method,actor,request,payload,origin,p_extraction_id,p_pending_id,expected_fields) returning id into purchase_id;
 if kind='detailed' then
  for line in select value from jsonb_array_elements(payload->'items') order by value->>'ingredientId' nulls last loop
   q:=(line->>'qty')::numeric; price:=(line->>'unitPrice')::numeric; ingredient_id:=nullif(line->>'ingredientId','')::uuid;
   insert into public.purchase_items(purchase_id,ingredient_id,description,qty,unit,unit_price,total) values(purchase_id,ingredient_id,btrim(line->>'description'),q,btrim(line->>'unit'),price,round(q*price,2)) returning id into item_id;
   if ingredient_id is not null then perform public.record_stock_movement_atomic(p_business_id,actor,ingredient_id,branch,'in',q,left('Compra registrada · '||btrim(line->>'description'),1000),btrim(line->>'unit'),origin,'purchase_item',item_id); end if;
  end loop;
 end if;
 if origin='inbox' then
  update public.ai_extractions set status='approved',approved_at=clock_timestamp(),approved_by=actor,target_entity='purchases',target_record_id=purchase_id,branch_id=branch where id=p_extraction_id;
 end if;
 return jsonb_build_object('ok',true,'id',purchase_id,'replayed',false,'kind',kind,'source',origin);
end $$;
revoke all on function public.commit_purchase_atomic(uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.commit_purchase_atomic(uuid,jsonb,uuid,uuid) to authenticated,service_role;
create or replace function public.create_purchase_manual_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select public.commit_purchase_atomic(p_business_id,p_input,null,null) $$;

create or replace function purchases_private.audit_manual_purchase() returns trigger language plpgsql security definer set search_path='' as $$
declare r text;
begin
 if new.manual_request_id is null then return null; end if;
 update public.balance_snapshots set purchases_data_stale=true where business_id=new.business_id;
 select role::text into r from public.business_members where business_id=new.business_id and user_id=new.created_by;
 if r is null or r not in ('owner','admin','manager') or not exists(select 1 from public.profiles where id=new.created_by and active) then raise exception 'purchase_actor_forbidden'; end if;
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 select new.business_id,new.created_by,p.full_name,r,'purchase.created','purchases',new.id,'Compra registrada con origen verificado',
 jsonb_build_object('branch_id',new.branch_id,'supplier_id',new.supplier_id,'total',new.total,'source',new.source,'kind',new.purchase_kind,'request_id',new.manual_request_id,'extraction_id',new.origin_extraction_id,'pending_id',new.origin_pending_id,'stock_effect',case when new.purchase_kind='summary' then 'none' else 'referenced_items' end)
 from public.profiles p where p.id=new.created_by;
 return null;
end $$;

create or replace function public.guard_manual_purchase_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.manual_request_id is null and new.manual_request_id is not null then raise exception 'purchase_history_immutable'; end if;
 if old.manual_request_id is null then raise exception 'purchase_history_immutable'; end if;
 if tg_op='DELETE' then raise exception 'purchase_history_immutable'; end if;
 if current_user::text<>'authenticated' or old.source is distinct from 'manual' or old.invoice_id is not null then raise exception 'purchase_requires_source_review'; end if;
 perform public.stock_actor_role(old.business_id,old.branch_id,auth.uid());
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'purchase_actor_inactive'; end if;
 perform 1 from public.business_members where business_id=old.business_id and user_id=auth.uid() and role in ('owner','admin','manager') for share;
 if not found then raise exception 'purchase_permission_denied'; end if;
 perform 1 from public.business_modules where business_id=old.business_id and module_key='purchases' and enabled for share;
 if not found then raise exception 'purchase_module_disabled'; end if;
 if new.created_at is distinct from old.created_at then raise exception 'purchase_history_immutable'; end if;
 if (new.id,new.business_id,new.branch_id,new.supplier_id,new.purchased_at,new.total,new.payment_method,new.invoice_id,new.created_by,new.manual_request_id,new.manual_payload,new.source,new.origin_extraction_id,new.origin_pending_id,new.origin_expected_fields)
  is distinct from (old.id,old.business_id,old.branch_id,old.supplier_id,old.purchased_at,old.total,old.payment_method,old.invoice_id,old.created_by,old.manual_request_id,old.manual_payload,old.source,old.origin_extraction_id,old.origin_pending_id,old.origin_expected_fields) then raise exception 'purchase_history_immutable'; end if;
 if old.record_status<>'active' or new.record_status<>'voided' or new.version<>old.version+1 or new.voided_at is null or length(btrim(coalesce(new.void_reason,''))) not between 1 and 1000 then raise exception 'purchase_invalid_transition'; end if;
 return new;
end $$;

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
    if new.source in ('manual','inbox') and new.ref_type in ('purchase_item','purchase_item_void') and new.ref_id is not null then
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
    if v_purchase.manual_request_id is not null and new.ref_type='purchase_item' and (v_purchase.source is distinct from new.source or v_purchase.created_by is distinct from new.actor_id) then raise exception 'purchase_stock_origin_mismatch' using errcode='42501'; end if;
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


create or replace function public.check_manual_purchase_receipt() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.purchases%rowtype; pid uuid; expected jsonb; actual jsonb;
begin
 if tg_table_name='purchases' then pid:=new.id; else pid:=new.purchase_id; end if;
 select * into p from public.purchases where id=pid;
 if p.manual_request_id is null then
  if p.invoice_id is null then raise exception 'purchase_receipt_required'; end if;
  if not exists(select 1 from public.invoices i where i.id=p.invoice_id and i.business_id=p.business_id and i.status in ('approved','sent_to_accountant')) then raise exception 'purchase_invoice_not_approved'; end if;
  select jsonb_agg(v order by v::text) into expected from (
   select jsonb_build_object('ingredient',coalesce(matched_ingredient_id,suggested_ingredient_id),'description',description,'qty',qty_numeric::numeric(18,6),'unit',unit,'price',unit_price::numeric(12,2),'total',total::numeric(12,2)) v from public.invoice_items where invoice_id=p.invoice_id
  ) e;
  select jsonb_agg(v order by v::text) into actual from (
   select jsonb_build_object('ingredient',ingredient_id,'description',description,'qty',qty,'unit',unit,'price',unit_price,'total',total) v from public.purchase_items where purchase_id=p.id
  ) a;
  if expected is null or expected is distinct from actual then raise exception 'purchase_invoice_receipt_incomplete'; end if;
  if not exists(select 1 from public.activity_logs where action='invoice.approved' and target_id=p.invoice_id and business_id=p.business_id and actor_id=p.created_by) then raise exception 'purchase_invoice_audit_missing'; end if;
  if exists(select 1 from public.purchase_items i where i.purchase_id=p.id and i.ingredient_id is not null and not exists(select 1 from public.stock_movements m where m.ref_type='purchase_item' and m.ref_id=i.id and m.input_quantity=i.qty and m.input_unit=public.catalog_normalize_unit(i.unit) and m.branch_id=p.branch_id and m.ingredient_id=i.ingredient_id and m.actor_id=p.created_by and m.source=case when (select to_jsonb(iv)->>'source' from public.invoices iv where iv.id=p.invoice_id)='manual' then 'manual' else 'ocr' end)) then raise exception 'purchase_stock_receipt_missing'; end if;
  return null;
 end if;
 if (p.manual_payload->>'requestId')::uuid is distinct from p.manual_request_id or (p.manual_payload->>'branchId')::uuid is distinct from p.branch_id or (p.manual_payload->>'supplierId')::uuid is distinct from p.supplier_id or (p.manual_payload->>'purchasedAt')::date is distinct from p.purchased_at or btrim(p.manual_payload->>'paymentMethod') is distinct from p.payment_method then raise exception 'purchase_receipt_header_mismatch'; end if;
 if p.source='inbox' and not exists(select 1 from public.ai_extractions e where e.id=p.origin_extraction_id and e.status='approved' and e.target_record_id=p.id and e.target_entity='purchases' and e.approved_by=p.created_by) then raise exception 'purchase_extraction_not_approved'; end if;
 if p.purchase_kind='summary' then
  if p.total is distinct from (p.manual_payload->>'amount')::numeric or p.total<=0 or p.total>=10000000000 or exists(select 1 from public.purchase_items where purchase_id=p.id) then raise exception 'purchase_summary_has_no_items'; end if;
  return null;
 end if;
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

-- Persist a recovery reference before a WhatsApp purchase RPC can leave this process.
-- This changes only the existing server-owned pending row. Financial writes and
-- idempotent receipts remain in the purchase kernel; no membership grants are added.
create function public.claim_purchase_pending_execution(
 p_business_id uuid,p_member_id uuid,p_conversation_id uuid,p_pending_id uuid,p_recovery boolean
) returns boolean language plpgsql security invoker set search_path='' as $$
declare pending public.whatsapp_agent_pending_operations%rowtype; conversation_branch uuid; operation_branch uuid;
begin
 if current_user<>'service_role' then raise exception 'permission_denied' using errcode='42501'; end if;
 if p_business_id is null or p_member_id is null or p_conversation_id is null or p_pending_id is null or p_recovery is null then return false; end if;
 -- Same namespace/order as replace_whatsapp_agent_pending and the scope guard.
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-pending:'||p_business_id::text||':'||p_member_id::text||':'||p_conversation_id::text,0));
 select * into pending from public.whatsapp_agent_pending_operations
 where id=p_pending_id and business_id=p_business_id and member_id=p_member_id
   and conversation_id=p_conversation_id and consumed_at is null for update;
 if not found or pending.kind<>'confirmation'
 or pending.arguments->>'kind' is distinct from 'summary'
 or pending.tool_name<>'purchases.create'
 or pending.expires_at<=clock_timestamp() or jsonb_typeof(pending.arguments) is distinct from 'object'
 or jsonb_typeof(pending.arguments->'requestId') is distinct from 'string'
 or (pending.arguments->>'requestId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or jsonb_typeof(pending.arguments->'branchId') is distinct from 'string'
 or (pending.arguments->>'branchId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or (pending.arguments ? '__resultUncertain' and jsonb_typeof(pending.arguments->'__resultUncertain') is distinct from 'boolean')
 or coalesce(pending.arguments->'__resultUncertain'='true'::jsonb,false) is distinct from p_recovery
 then return false; end if;
 -- Check live authorization after waiting for the pending lock. The purchase kernel
 -- repeats actor permissions at execution time. Write roles are business-wide.
 if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
   where m.id=p_member_id and m.business_id=p_business_id and p.active and m.role in ('owner','admin','manager'))
 or not exists(select 1 from public.business_modules where business_id=p_business_id and module_key='purchases' and enabled)
 then return false; end if;
 select branch_id into conversation_branch from public.whatsapp_authorized_conversations
 where id=p_conversation_id and business_id=p_business_id and enabled;
 if not found then return false; end if;
 operation_branch:=(pending.arguments->>'branchId')::uuid;
 if not exists(select 1 from public.branches where id=operation_branch and business_id=p_business_id)
 or (conversation_branch is not null and conversation_branch is distinct from operation_branch) then return false; end if;
 -- Fresh confirmation is CAS on false/absent -> true. Recovery may share this
 -- same UUID across processes; the domain RPC serializes its idempotent receipt.
 -- Never consume or replace the reference here, even on an acknowledged claim.
 update public.whatsapp_agent_pending_operations
 set arguments=arguments||'{"__resultUncertain":true}'::jsonb,expires_at=clock_timestamp()+interval '30 days'
 where id=pending.id;
 return true;
end $$;

create function public.cancel_purchase_pending_execution(
 p_business_id uuid,p_member_id uuid,p_conversation_id uuid,p_pending_id uuid
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare pending public.whatsapp_agent_pending_operations%rowtype; conversation_branch uuid; operation_branch uuid; uncertain boolean;
begin
 if current_user<>'service_role' then raise exception 'permission_denied' using errcode='42501'; end if;
 if p_business_id is null or p_member_id is null or p_conversation_id is null or p_pending_id is null
 then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-pending:'||p_business_id::text||':'||p_member_id::text||':'||p_conversation_id::text,0));
 select * into pending from public.whatsapp_agent_pending_operations
 where id=p_pending_id and business_id=p_business_id and member_id=p_member_id
   and conversation_id=p_conversation_id and consumed_at is null for update;
 -- Cancellation also covers unprepared clarifications; only a complete
 -- confirmation is executable through claim_purchase_pending_execution.
 if not found or pending.tool_name<>'purchases.create'
 then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
 if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
   where m.id=p_member_id and m.business_id=p_business_id and p.active and m.role in ('owner','admin','manager'))
 then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
 select branch_id into conversation_branch from public.whatsapp_authorized_conversations
 where id=p_conversation_id and business_id=p_business_id and enabled;
 if not found then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
 if pending.arguments->>'branchId' is not null then
   if jsonb_typeof(pending.arguments->'branchId') is distinct from 'string'
   or (pending.arguments->>'branchId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
   then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
   operation_branch:=(pending.arguments->>'branchId')::uuid;
   if not exists(select 1 from public.branches where id=operation_branch and business_id=p_business_id)
   or (conversation_branch is not null and conversation_branch is distinct from operation_branch)
   then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
 elsif conversation_branch is not null and not exists(select 1 from public.branches where id=conversation_branch and business_id=p_business_id)
 then return jsonb_build_object('consumed',false,'resultUncertain',false); end if;
 -- Read the current durable marker under the lock, never the caller's stale
 -- snapshot. Malformed historical markers are conservatively uncertain.
 uncertain:=jsonb_typeof(pending.arguments) is distinct from 'object'
   or (pending.arguments ? '__resultUncertain' and pending.arguments->'__resultUncertain' is distinct from 'false'::jsonb);
 update public.whatsapp_agent_pending_operations set consumed_at=clock_timestamp() where id=pending.id;
 return jsonb_build_object('consumed',true,'resultUncertain',uncertain);
end $$;
revoke all on function public.claim_purchase_pending_execution(uuid,uuid,uuid,uuid,boolean),public.cancel_purchase_pending_execution(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_purchase_pending_execution(uuid,uuid,uuid,uuid,boolean),public.cancel_purchase_pending_execution(uuid,uuid,uuid,uuid) to service_role;

create or replace function public.void_purchase_manual_atomic(p_business_id uuid,p_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.purchases%rowtype; l public.purchase_items%rowtype; role_name text;
begin
 select * into p from public.purchases where id=p_id and business_id=p_business_id for update;
 if not found then raise exception 'purchase_unavailable'; end if;
 role_name:=public.stock_actor_role(p_business_id,p.branch_id,auth.uid());
 if role_name not in ('owner','admin','manager') then raise exception 'purchase_permission_denied'; end if;
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'purchase_actor_inactive'; end if;
 perform 1 from public.business_members where business_id=p_business_id and user_id=auth.uid() and role in ('owner','admin','manager') for share;
 if not found then raise exception 'purchase_permission_denied'; end if;
 perform 1 from public.business_modules where business_id=p_business_id and module_key='purchases' and enabled for share;
 if not found then raise exception 'purchase_module_disabled'; end if;
 if current_user::text<>'authenticated' or p.source is distinct from 'manual' or p.invoice_id is not null then raise exception 'purchase_requires_source_review'; end if;
 if p.record_status='voided' and p.void_reason=btrim(p_reason) and p.version=p_expected_version+1 then return jsonb_build_object('ok',true,'id',p.id,'replayed',true); end if;
 if p.version is distinct from p_expected_version or p.record_status<>'active' then raise exception 'purchase_conflict'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'purchase_reason_required'; end if;
 update public.purchases set record_status='voided',version=version+1,void_reason=btrim(p_reason),voided_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('ok',true,'id',p.id,'replayed',false);
end $$;

create or replace function public.guard_manual_purchase_item() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'purchase_items_history_immutable' using errcode='23514'; end $$;
create function public.guard_purchase_item_insert() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.purchases%rowtype;
begin
 select * into p from public.purchases where id=new.purchase_id;
 if p.id is null then raise exception 'purchase_receipt_required' using errcode='42501'; end if;
 if p.manual_request_id is null and (current_user::text<>'service_role' or p.invoice_id is null or not exists(select 1 from public.invoices where id=p.invoice_id and status in ('extracted','needs_review','rejected'))) then raise exception 'purchase_receipt_required' using errcode='42501'; end if;
 if p.record_status<>'active' then raise exception 'purchase_items_history_immutable'; end if;
 return new;
end $$;
revoke all on function public.guard_purchase_item_insert() from public,anon,authenticated,service_role;
create trigger purchase_item_insert_guard before insert on public.purchase_items for each row execute function public.guard_purchase_item_insert();
