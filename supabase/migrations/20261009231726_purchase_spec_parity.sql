-- Purchase references, audited correction provenance and exact detailed transports.
-- No storage policies, credentials or catalog write grants change.
alter table public.purchases add column correction_origin text,
 add column cost_refresh_pending boolean not null default false,
 add column receipt_reference text generated always as (manual_payload->>'receiptReference') stored;
create index purchases_pending_costs_idx on public.purchases(business_id,id) where cost_refresh_pending;


create or replace function public.validate_purchase_payload(p_business_id uuid,payload jsonb) returns numeric language plpgsql security invoker set search_path='' as $$
declare branch uuid; supplier uuid; request uuid; kind text; line jsonb; ingredient public.ingredients%rowtype; q numeric; price numeric; total numeric:=0; purchase_date date; method text; description text; unit text; ingredient_id uuid;
begin
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('requestId','kind','branchId','supplierId','purchasedAt','paymentMethod','amount','items','replacesPurchaseId','correctionReason','receiptReference')) then raise exception 'purchase_invalid_input' using errcode='22023'; end if;
 if payload ? 'receiptReference' and (jsonb_typeof(payload->'receiptReference')<>'string' or length(btrim(payload->>'receiptReference')) not between 1 and 200 or payload->>'receiptReference' ~ '[[:cntrl:]]') then raise exception 'purchase_reference_invalid' using errcode='22023'; end if;
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
    select * into ingredient from public.ingredients where id=ingredient_id and business_id=p_business_id and active;
    if not found or public.catalog_unit_factor(unit,ingredient.unit) is null then raise exception 'purchase_ingredient_unavailable' using errcode='23514'; end if;
   end if;
  end loop;
 end if;
 return total;
end $$;

create or replace function public.guard_purchase_origin() returns trigger language plpgsql security invoker set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype; p public.whatsapp_agent_pending_operations%rowtype; member public.business_members%rowtype; c public.whatsapp_authorized_conversations%rowtype; invoice public.invoices%rowtype; role_name text;
begin
 if new.record_status is distinct from 'active' or new.version is distinct from 1 or new.void_reason is not null or new.voided_at is not null then raise exception 'purchase_invalid_initial_state' using errcode='23514'; end if;
 new.created_at:=clock_timestamp();
 new.correction_origin:=null;
 new.cost_refresh_pending:=false;
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
  perform 1 from public.business_members where business_id=new.business_id and user_id=new.created_by and role in ('owner','admin');
  if not found then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
  perform 1 from public.business_modules where business_id=new.business_id and module_key='invoices_ocr' and enabled;
  if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
  return new;
 end if;
 if current_user::text not in ('authenticated','service_role') then raise exception 'purchase_transport_forbidden' using errcode='42501'; end if;
 role_name:=public.stock_actor_role(new.business_id,new.branch_id,new.created_by);
 perform 1 from public.profiles where id=new.created_by and active for share;
 if not found then raise exception 'purchase_actor_inactive' using errcode='42501'; end if;
 perform 1 from public.business_members where business_id=new.business_id and user_id=new.created_by and role in ('owner','admin','manager');
 if not found then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 perform 1 from public.business_modules where business_id=new.business_id and module_key='purchases' and enabled;
 if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
 if role_name not in ('owner','admin','manager') or not exists(select 1 from public.business_modules where business_id=new.business_id and module_key='purchases' and enabled) then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 if new.total is distinct from public.validate_purchase_payload(new.business_id,new.manual_payload)
  or (new.manual_request_id,new.branch_id,new.supplier_id,new.purchased_at,new.payment_method)
   is distinct from ((new.manual_payload->>'requestId')::uuid,(new.manual_payload->>'branchId')::uuid,(new.manual_payload->>'supplierId')::uuid,(new.manual_payload->>'purchasedAt')::date,btrim(new.manual_payload->>'paymentMethod'))
  or new.invoice_id is not null then raise exception 'purchase_receipt_header_mismatch' using errcode='23514'; end if;
 if new.manual_payload ? 'replacesPurchaseId' and (new.source<>'manual' or not exists(select 1 from public.purchases prior where prior.id=(new.manual_payload->>'replacesPurchaseId')::uuid and prior.business_id=new.business_id and prior.record_status='voided' and prior.source in ('manual','inbox','whatsapp') and prior.invoice_id is null and prior.void_reason=new.manual_payload->>'correctionReason')) then raise exception 'purchase_correction_reference_required' using errcode='23514'; end if;
 if new.manual_payload ? 'replacesPurchaseId' then
  select coalesce(prior.correction_origin,prior.source) into new.correction_origin from public.purchases prior where prior.id=(new.manual_payload->>'replacesPurchaseId')::uuid and prior.business_id=new.business_id;
 end if;
 new.cost_refresh_pending:=role_name='manager' and coalesce(new.manual_payload->>'kind','detailed')='detailed' and exists(select 1 from jsonb_array_elements(new.manual_payload->'items') i where nullif(i->>'ingredientId','') is not null);
 if new.source='manual' then
  if current_user::text<>'authenticated' or new.created_by is distinct from auth.uid() then raise exception 'purchase_actor_forbidden' using errcode='42501'; end if;
 elsif new.source='inbox' then
  perform 1 from public.business_modules where business_id=new.business_id and module_key='inbox_ai' and enabled;
  if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
  if current_user::text<>'authenticated' or new.created_by is distinct from auth.uid() or not exists(select 1 from public.business_modules where business_id=new.business_id and module_key='inbox_ai' and enabled) then raise exception 'purchase_actor_forbidden' using errcode='42501'; end if;
  select * into e from public.ai_extractions where id=new.origin_extraction_id for update;
  select * into m from public.whatsapp_messages where id=e.message_id for share;
  if e.id is null or e.type<>'purchase' or e.status not in ('pending','needs_review','failed') or e.fields is distinct from new.origin_expected_fields
   or m.id is null or m.business_id is distinct from new.business_id or (e.business_id is not null and e.business_id<>new.business_id)
   or (e.branch_id is not null and e.branch_id<>new.branch_id) or (m.branch_id is not null and m.branch_id<>new.branch_id)
   then raise exception 'purchase_extraction_changed' using errcode='23514'; end if;
 elsif new.source='whatsapp' then
  if new.manual_payload->>'kind'='detailed' and exists(select 1 from jsonb_array_elements(new.manual_payload->'items') i where nullif(i->>'ingredientId','') is null) then raise exception 'purchase_agent_ingredient_required' using errcode='22023'; end if;
  if current_user::text<>'service_role' then raise exception 'purchase_transport_forbidden' using errcode='42501'; end if;
  select * into p from public.whatsapp_agent_pending_operations where id=new.origin_pending_id for update;
  select * into member from public.business_members where id=p.member_id;
  select * into c from public.whatsapp_authorized_conversations where id=p.conversation_id for share;
  if p.id is null or p.business_id is distinct from new.business_id or member.business_id is distinct from new.business_id or member.user_id is distinct from new.created_by
   or p.arguments->>'kind' is null or p.arguments->>'kind' not in ('summary','detailed') or p.kind<>'confirmation' or p.tool_name<>'purchases.create' or p.consumed_at is not null or p.expires_at<=clock_timestamp()
   or p.arguments->'__resultUncertain' is distinct from 'true'::jsonb or (p.arguments-'__resultUncertain'-'supplierLabel'-'branchLabel') is distinct from new.manual_payload
   or c.id is null or not c.enabled or c.business_id<>new.business_id or (c.branch_id is not null and c.branch_id<>new.branch_id)
   then raise exception 'purchase_pending_forbidden' using errcode='42501'; end if;
 else raise exception 'purchase_source_forbidden' using errcode='42501'; end if;
 return new;
end $$;

create or replace function public.commit_purchase_atomic(p_business_id uuid,p_input jsonb default null,p_extraction_id uuid default null,p_pending_id uuid default null)
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
  select * into member from public.business_members where id=pending.member_id and business_id=p_business_id;
  select * into conversation from public.whatsapp_authorized_conversations where id=pending.conversation_id and business_id=p_business_id for share;
  if member.id is null or pending.kind<>'confirmation' or pending.tool_name<>'purchases.create' or pending.consumed_at is not null or pending.expires_at<=clock_timestamp()
   or pending.arguments->'__resultUncertain' is distinct from 'true'::jsonb or conversation.id is null or not conversation.enabled then raise exception 'purchase_pending_forbidden' using errcode='42501'; end if;
  actor:=member.user_id; origin:='whatsapp'; payload:=pending.arguments-'__resultUncertain'-'supplierLabel'-'branchLabel';
  if payload->>'kind' is null or payload->>'kind' not in ('summary','detailed') then raise exception 'purchase_pending_forbidden' using errcode='42501'; end if;
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
  perform 1 from public.business_modules where business_id=p_business_id and module_key='inbox_ai' and enabled;
  if not found then raise exception 'purchase_module_disabled'; end if;
 else
  if current_user::text<>'authenticated' or auth.uid() is null then raise exception 'purchase_transport_forbidden' using errcode='42501'; end if;
  actor:=auth.uid(); origin:='manual'; payload:=p_input;
 end if;
 if jsonb_typeof(payload) is distinct from 'object' or exists(select 1 from jsonb_object_keys(payload) k where k not in ('requestId','kind','branchId','supplierId','purchasedAt','paymentMethod','amount','items','replacesPurchaseId','correctionReason','receiptReference')) then raise exception 'purchase_invalid_input' using errcode='22023'; end if;
 branch:=(payload->>'branchId')::uuid; supplier:=(payload->>'supplierId')::uuid; request:=(payload->>'requestId')::uuid; kind:=coalesce(payload->>'kind','detailed');
 if branch is null or supplier is null or request is null or kind not in ('summary','detailed') then raise exception 'purchase_invalid_input' using errcode='22023'; end if;
 role_name:=public.stock_actor_role(p_business_id,branch,actor);
 if role_name not in ('owner','admin','manager') then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'purchase_actor_inactive' using errcode='42501'; end if;
 perform 1 from public.business_members where business_id=p_business_id and user_id=actor and role in ('owner','admin','manager');
 if not found then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 perform 1 from public.business_modules where business_id=p_business_id and module_key='purchases' and enabled;
 if not found then raise exception 'purchase_module_disabled'; end if;
 if origin='whatsapp' and conversation.branch_id is not null and conversation.branch_id<>branch then raise exception 'purchase_branch_forbidden' using errcode='42501'; end if;
 if origin='inbox' and ((e.branch_id is not null and e.branch_id<>branch) or (message.branch_id is not null and message.branch_id<>branch)) then raise exception 'purchase_branch_forbidden' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_business_id::text||request::text,0));
 -- Recheck authorization after the idempotency wait. The private lock-only
 -- receipt trigger serializes member/module revocation without granting UPDATE.
 role_name:=public.stock_actor_role(p_business_id,branch,actor);
 if role_name not in ('owner','admin','manager') then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 select * into existing from public.purchases where business_id=p_business_id and manual_request_id=request;
 if found then
  if existing.created_by is distinct from actor or existing.source is distinct from origin or existing.manual_payload is distinct from payload or existing.origin_extraction_id is distinct from p_extraction_id or existing.origin_pending_id is distinct from p_pending_id or existing.origin_expected_fields is distinct from expected_fields then raise exception 'purchase_idempotency_conflict' using errcode='23505'; end if;
  return jsonb_build_object('ok',true,'id',existing.id,'replayed',true,'kind',existing.purchase_kind,'source',existing.source,'costRefreshPending',existing.cost_refresh_pending);
 end if;
 if origin='inbox' and (e.status not in ('pending','needs_review','failed') or e.fields is distinct from expected_fields) then raise exception 'purchase_extraction_changed' using errcode='23514'; end if;
 if payload ? 'replacesPurchaseId' then
  if origin<>'manual' or not exists(select 1 from public.purchases prior where prior.id=(payload->>'replacesPurchaseId')::uuid and prior.business_id=p_business_id and prior.record_status='voided' and prior.source in ('manual','inbox','whatsapp') and prior.invoice_id is null and prior.void_reason=payload->>'correctionReason') then raise exception 'purchase_correction_reference_required' using errcode='23514'; end if;
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
 return jsonb_build_object('ok',true,'id',purchase_id,'replayed',false,'kind',kind,'source',origin,'costRefreshPending',(select cost_refresh_pending from public.purchases where id=purchase_id));
end $$;

create or replace function public.void_purchase_manual_atomic(p_business_id uuid,p_id uuid,p_expected_version integer,p_reason text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.purchases%rowtype; l public.purchase_items%rowtype; role_name text;
begin
 select * into p from public.purchases where id=p_id and business_id=p_business_id for update;
 if not found then raise exception 'purchase_unavailable'; end if;
 role_name:=public.stock_actor_role(p_business_id,p.branch_id,auth.uid());
 if role_name not in ('owner','admin','manager') then raise exception 'purchase_permission_denied'; end if;
 if current_user::text<>'authenticated' or p.source not in ('manual','inbox','whatsapp') or p.source is null or p.invoice_id is not null then raise exception 'purchase_requires_source_review'; end if;
 if p.record_status='voided' and p.void_reason=btrim(p_reason) and p.version=p_expected_version+1 then return jsonb_build_object('ok',true,'id',p.id,'replayed',true); end if;
 if p.version is distinct from p_expected_version or p.record_status<>'active' then raise exception 'purchase_conflict'; end if;
 if p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'purchase_reason_required'; end if;
 update public.purchases set record_status='voided',version=version+1,void_reason=btrim(p_reason),voided_at=clock_timestamp() where id=p.id;
 return jsonb_build_object('ok',true,'id',p.id,'replayed',false);
end $$;

create or replace function public.guard_manual_purchase_history() returns trigger language plpgsql security invoker set search_path='' as $$
declare ingredient uuid;
begin
 if tg_op='UPDATE' and old.manual_request_id is null and new.manual_request_id is not null then raise exception 'purchase_history_immutable'; end if;
 if old.manual_request_id is null then raise exception 'purchase_history_immutable'; end if;
 if tg_op='DELETE' then raise exception 'purchase_history_immutable'; end if;
 if current_user::text<>'authenticated' or old.source not in ('manual','inbox','whatsapp') or old.source is null or old.invoice_id is not null then raise exception 'purchase_requires_source_review'; end if;
 perform public.stock_actor_role(old.business_id,old.branch_id,auth.uid());
 perform 1 from public.profiles where id=auth.uid() and active for share;
 if not found then raise exception 'purchase_actor_inactive'; end if;
 perform 1 from public.business_members where business_id=old.business_id and user_id=auth.uid() and role in ('owner','admin','manager');
 if not found then raise exception 'purchase_permission_denied'; end if;
 perform 1 from public.business_modules where business_id=old.business_id and module_key='purchases' and enabled;
 if not found then raise exception 'purchase_module_disabled'; end if;
 if new.created_at is distinct from old.created_at then raise exception 'purchase_history_immutable'; end if;
 if (new.id,new.business_id,new.branch_id,new.supplier_id,new.purchased_at,new.total,new.payment_method,new.invoice_id,new.created_by,new.manual_request_id,new.manual_payload,new.source,new.correction_origin,new.origin_extraction_id,new.origin_pending_id,new.origin_expected_fields)
  is distinct from (old.id,old.business_id,old.branch_id,old.supplier_id,old.purchased_at,old.total,old.payment_method,old.invoice_id,old.created_by,old.manual_request_id,old.manual_payload,old.source,old.correction_origin,old.origin_extraction_id,old.origin_pending_id,old.origin_expected_fields) then raise exception 'purchase_history_immutable'; end if;
 if new.record_status=old.record_status and new.version=old.version and new.voided_at is not distinct from old.voided_at and new.void_reason is not distinct from old.void_reason and old.cost_refresh_pending and not new.cost_refresh_pending then
  if not public.has_business_write_role(old.business_id,array['owner','admin']) then raise exception 'purchase_cost_refresh_forbidden' using errcode='42501'; end if;
  if exists(select 1 from public.purchase_items line where line.purchase_id=old.id and line.ingredient_id is not null and not exists(select 1 from public.purchase_items evidence join public.purchases receipt on receipt.id=evidence.purchase_id where evidence.ingredient_id=line.ingredient_id and receipt.business_id=old.business_id and receipt.record_status='active')) then raise exception 'purchase_cost_evidence_missing' using errcode='23514'; end if;
  for ingredient in select distinct ingredient_id from public.purchase_items where purchase_id=old.id and ingredient_id is not null order by ingredient_id loop
   if not exists(select 1 from public.ingredients where id=ingredient and business_id=old.business_id) then raise exception 'purchase_ingredient_forbidden' using errcode='42501'; end if;
   perform public.recalc_ingredient_cost(ingredient);
  end loop;
  return new;
 end if;
 -- A last-receipt void retains the historical cost, but cannot certify it as current.
 new.cost_refresh_pending:=exists(select 1 from public.purchase_items line where line.purchase_id=old.id and line.ingredient_id is not null and (not public.has_business_write_role(old.business_id,array['owner','admin']) or not exists(select 1 from public.purchase_items evidence join public.purchases receipt on receipt.id=evidence.purchase_id where evidence.ingredient_id=line.ingredient_id and receipt.business_id=old.business_id and receipt.id<>old.id and receipt.record_status='active')));
 if old.record_status<>'active' or new.record_status<>'voided' or new.version<>old.version+1 or new.voided_at is null or length(btrim(coalesce(new.void_reason,''))) not between 1 and 1000 then raise exception 'purchase_invalid_transition'; end if;
 return new;
end $$;

create or replace function public.reverse_manual_purchase_receipts() returns trigger language plpgsql security invoker set search_path='' as $$
declare l public.purchase_items%rowtype; r text;
begin
 if new.record_status is not distinct from old.record_status or new.source not in ('manual','inbox','whatsapp') or new.source is null then return null; end if;
 r:=public.stock_actor_role(new.business_id,new.branch_id,auth.uid());
 if r not in ('owner','admin','manager') then raise exception 'purchase_permission_denied'; end if;
 for l in select i.* from public.purchase_items i where i.purchase_id=new.id and i.ingredient_id is not null order by i.ingredient_id,i.id loop
  if not exists(select 1 from public.stock_movements m where m.ref_type='purchase_item' and m.ref_id=l.id and m.input_quantity=l.qty and m.input_unit=public.catalog_normalize_unit(l.unit)) then raise exception 'purchase_receipt_missing'; end if;
  perform public.record_stock_movement_atomic(new.business_id,auth.uid(),l.ingredient_id,new.branch_id,'out',l.qty,left('Anulación de compra · '||new.void_reason,1000),l.unit,'manual','purchase_item_void',l.id);
 end loop;
 if not new.cost_refresh_pending then
  for l in select distinct on (ingredient_id) * from public.purchase_items where purchase_id=new.id and ingredient_id is not null order by ingredient_id,id loop perform public.recalc_ingredient_cost(l.ingredient_id); end loop;
 end if;
 return null;
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
    if new.ref_type='purchase_item_void' and (v_purchase.record_status<>'voided' or v_purchase.source not in ('manual','inbox','whatsapp') or v_purchase.source is null) then raise exception 'invalid_purchase_reversal'; end if;
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

create or replace function public.recalc_ingredient_cost(p_ingredient_id uuid)
returns numeric language plpgsql security invoker set search_path = '' as $$
declare
  v_ingredient public.ingredients%rowtype;
  v_count integer; v_valid boolean; v_avg numeric(18,6);
begin
  select * into v_ingredient from public.ingredients where id=p_ingredient_id for update;
  if not found then raise exception 'ingredient_not_found_or_forbidden' using errcode='P0002'; end if;
  select count(*),bool_and(qty>0 and qty::text not in ('NaN','Infinity','-Infinity')
    and unit_price>=0 and unit_price::text not in ('NaN','Infinity','-Infinity')
    and factor is not null),
    sum(unit_price*qty)/nullif(sum(qty*factor),0)
    into v_count,v_valid,v_avg
  from (
    select pi.qty,pi.unit_price,public.catalog_unit_factor(pi.unit,v_ingredient.unit) as factor
    from public.purchase_items pi join public.purchases p on p.id=pi.purchase_id
    where pi.ingredient_id=p_ingredient_id and p.business_id=v_ingredient.business_id and p.record_status='active'
    order by pi.created_at desc,pi.id desc limit 5
  ) recent;
  -- No active purchase evidence: retain the last known recorded cost. Never invent zero.
  if v_count=0 then return v_ingredient.avg_unit_cost; end if;
  if v_valid is not true or v_avg is null or v_avg::text in ('NaN','Infinity','-Infinity') then
    raise exception 'purchase_cost_unit_or_quantity_invalid' using errcode='23514';
  end if;
  update public.ingredients set avg_unit_cost=v_avg where id=p_ingredient_id;
  return v_avg;
end;
$$;


-- Derived cost changes honor the existing invoker catalog permissions.
create function public.purchase_recalc_inserted_item() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.purchases%rowtype;
begin
 if new.ingredient_id is null then return null; end if;
 select * into p from public.purchases where id=new.purchase_id;
 if not p.cost_refresh_pending then perform public.recalc_ingredient_cost(new.ingredient_id); end if;
 return null;
end $$;
revoke all on function public.purchase_recalc_inserted_item() from public,anon,authenticated,service_role;
create trigger purchase_item_recalculate after insert on public.purchase_items for each row execute function public.purchase_recalc_inserted_item();

-- Explicit owner/admin refresh closes manager-created cost work without granting
-- managers access to products/ingredients. One transaction clears only its work.
create function public.refresh_purchase_costs_atomic(p_business_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; ingredient uuid; n integer;
begin
 if current_user::text<>'authenticated' or auth.uid() is null or not public.has_business_write_role(p_business_id,array['owner','admin']) or not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'purchase_cost_refresh_forbidden' using errcode='42501'; end if;
 perform 1 from public.business_members where business_id=p_business_id and user_id=auth.uid() and role in ('owner','admin') for share;
 perform 1 from public.business_modules where business_id=p_business_id and module_key='purchases' and enabled for share;
 if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
 select array_agg(id) into ids from (select id from public.purchases where business_id=p_business_id and cost_refresh_pending order by id for update) pending;
 for ingredient in select distinct ingredient_id from public.purchase_items where purchase_id=any(ids) and ingredient_id is not null order by ingredient_id loop
  if not exists(select 1 from public.ingredients where id=ingredient and business_id=p_business_id) then raise exception 'purchase_ingredient_forbidden' using errcode='42501'; end if;
  perform public.recalc_ingredient_cost(ingredient);
 end loop;
 update public.purchases p set cost_refresh_pending=false where p.id=any(ids)
 and not exists(select 1 from public.purchase_items line where line.purchase_id=p.id and line.ingredient_id is not null and not exists(select 1 from public.purchase_items evidence join public.purchases receipt on receipt.id=evidence.purchase_id where evidence.ingredient_id=line.ingredient_id and receipt.business_id=p_business_id and receipt.record_status='active'));
 get diagnostics n=row_count;
 return jsonb_build_object('ok',true,'refreshed',n,'pending',(select count(*) from public.purchases where business_id=p_business_id and cost_refresh_pending));
end $$;
revoke all on function public.refresh_purchase_costs_atomic(uuid) from public,anon,service_role;
grant execute on function public.refresh_purchase_costs_atomic(uuid) to authenticated;


create or replace function purchases_private.audit_purchase_void() returns trigger language plpgsql security definer set search_path='' as $$
declare r text;
begin
 if new.record_status is not distinct from old.record_status and new.cost_refresh_pending is not distinct from old.cost_refresh_pending then return null; end if;
 update public.balance_snapshots set purchases_data_stale=true where business_id=new.business_id;
 select role::text into r from public.business_members where business_id=new.business_id and user_id=auth.uid();
 if r is null or r not in ('owner','admin','manager') or not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'purchase_actor_forbidden'; end if;
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 select new.business_id,auth.uid(),p.full_name,r,case when new.record_status is distinct from old.record_status then 'purchase.voided' else 'purchase.costs_refreshed' end,'purchases',new.id,case when new.record_status is distinct from old.record_status then 'Compra anulada con historial' else 'Costos de compra actualizados' end,
 jsonb_build_object('branch_id',new.branch_id,'reason',new.void_reason,'before',to_jsonb(old),'after',to_jsonb(new)) from public.profiles p where p.id=auth.uid();
 return null;
end $$;
-- Existing noninvoice detail was not repriced by the earlier kernel. Mark only
-- those rows for an explicit owner/admin refresh; do not guess historic costs.
-- This metadata flag is not a purchase edit: preserve timestamps, audit history
-- and each affected trigger's exact ordinary/always/replica/disabled mode. One
-- atomic statement rolls back both data and trigger changes on any failure.
do $purchase_cost_backfill$
declare trigger_states jsonb; legacy_trigger record;
begin
 lock table public.purchases in access exclusive mode;
 select jsonb_object_agg(tgname,tgenabled::text) into trigger_states
 from pg_catalog.pg_trigger
 where tgrelid='public.purchases'::regclass and not tgisinternal
  and tgname in ('manual_purchase_history','purchase_void_audit','trg_purchases_updated');
 if trigger_states is null or not (trigger_states ?& array['manual_purchase_history','purchase_void_audit','trg_purchases_updated']) then
  raise exception 'purchase_cost_backfill_expected_triggers_missing';
 end if;
 for legacy_trigger in select key as name,value as enabled from jsonb_each_text(trigger_states) loop
  if legacy_trigger.enabled<>'D' then
   execute format('alter table public.purchases disable trigger %I',legacy_trigger.name);
  end if;
 end loop;
 update public.purchases p set cost_refresh_pending=true
 where p.manual_request_id is not null and p.purchase_kind='detailed'
  and exists(select 1 from public.purchase_items i where i.purchase_id=p.id and i.ingredient_id is not null);
 for legacy_trigger in select key as name,value as enabled from jsonb_each_text(trigger_states) loop
  if legacy_trigger.enabled<>'D' then
   execute format('alter table public.purchases enable %s trigger %I',
    case legacy_trigger.enabled when 'A' then 'always' when 'R' then 'replica' else '' end,
    legacy_trigger.name);
  end if;
 end loop;
end
$purchase_cost_backfill$;

create or replace function public.claim_purchase_pending_execution(
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
 or pending.arguments->>'kind' is null or pending.arguments->>'kind' not in ('summary','detailed')
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

create or replace function purchases_private.audit_manual_purchase() returns trigger language plpgsql security definer set search_path='' as $$
declare r text;
begin
 if new.manual_request_id is null then return null; end if;
 update public.balance_snapshots set purchases_data_stale=true where business_id=new.business_id;
 select role::text into r from public.business_members where business_id=new.business_id and user_id=new.created_by;
 if r is null or r not in ('owner','admin','manager') or not exists(select 1 from public.profiles where id=new.created_by and active) then raise exception 'purchase_actor_forbidden'; end if;
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 select new.business_id,new.created_by,p.full_name,r,'purchase.created','purchases',new.id,'Compra registrada con origen verificado',
 jsonb_build_object('branch_id',new.branch_id,'supplier_id',new.supplier_id,'total',new.total,'source',new.source,'kind',new.purchase_kind,'request_id',new.manual_request_id,'extraction_id',new.origin_extraction_id,'pending_id',new.origin_pending_id,'receipt_reference',new.receipt_reference,'correction_origin',new.correction_origin,'replaces_purchase_id',new.manual_payload->>'replacesPurchaseId','cost_refresh_pending',new.cost_refresh_pending,'stock_effect',case when new.purchase_kind='summary' then 'none' else 'referenced_items' end)
 from public.profiles p where p.id=new.created_by;
 return null;
end $$;


-- SELECT FOR SHARE under invoker RLS also requires UPDATE visibility. Managers
-- must not gain membership, module or catalog write permissions merely to lock.
-- The public guard runs first; this private, non-callable trigger locks and
-- revalidates that already-authorized context. It never changes data or costs.
create function purchases_private.lock_purchase_context() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid; member_role text; module_name text; ingredient uuid;
begin
 actor:=case when tg_op='INSERT' then new.created_by else auth.uid() end;
 perform 1 from public.profiles where id=actor and active for share;
 if not found then raise exception 'purchase_actor_inactive' using errcode='42501'; end if;
 select role::text into member_role from public.business_members where business_id=new.business_id and user_id=actor for share;
 if member_role is null or member_role not in ('owner','admin','manager') then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 if new.invoice_id is not null and member_role not in ('owner','admin') then raise exception 'purchase_permission_denied' using errcode='42501'; end if;
 perform 1 from public.branches where id=new.branch_id and business_id=new.business_id for share;
 if not found then raise exception 'purchase_branch_forbidden' using errcode='42501'; end if;
 module_name:=case when new.invoice_id is not null then 'invoices_ocr' else 'purchases' end;
 perform 1 from public.business_modules where business_id=new.business_id and module_key::text=module_name and enabled for share;
 if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
 if tg_op='INSERT' and new.source='inbox' then
  perform 1 from public.business_modules where business_id=new.business_id and module_key='inbox_ai' and enabled for share;
  if not found then raise exception 'purchase_module_disabled' using errcode='42501'; end if;
 end if;
 if tg_op='INSERT' and new.manual_request_id is not null then
  for ingredient in select distinct nullif(i->>'ingredientId','')::uuid from jsonb_array_elements(new.manual_payload->'items') i where nullif(i->>'ingredientId','') is not null order by 1 loop
   perform 1 from public.ingredients where id=ingredient and business_id=new.business_id and active for share;
   if not found or exists(select 1 from jsonb_array_elements(new.manual_payload->'items') i join public.ingredients base on base.id=ingredient where nullif(i->>'ingredientId','')::uuid=ingredient and public.catalog_unit_factor(i->>'unit',base.unit) is null) then raise exception 'purchase_ingredient_unavailable' using errcode='23514'; end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function purchases_private.lock_purchase_context() from public,anon,authenticated,service_role;
-- PostgreSQL runs same-event triggers alphabetically: manual_purchase_history
-- (UPDATE) / purchase_origin_guard (INSERT) must run before purchase_origin_lock.
create trigger purchase_origin_lock before insert or update on public.purchases for each row execute function purchases_private.lock_purchase_context();
