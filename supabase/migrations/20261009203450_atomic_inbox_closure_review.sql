-- Share the existing closure engine while binding origin inside trusted callers.
-- Manual receipt payloads retain their original shape for historical replay.
create function closures_private.mutate_shared(p_business uuid,p_actor uuid,p_source text,p_operation text,p_input jsonb,p_original jsonb default null) returns jsonb
language plpgsql set search_path='' as $$
declare
 v_row public.daily_closures%rowtype; v_receipt public.closure_mutations%rowtype;
 v_id uuid; v_request uuid; v_branch uuid; v_role text; v_date date; v_before jsonb; v_after jsonb;
 v_result jsonb; v_payload jsonb; v_log uuid; v_keys text[]; v_reason text;
begin
 if p_source not in ('manual','inbox') or p_source is null then raise exception 'closure_invalid_input'; end if;
 if p_source='inbox' and (jsonb_typeof(p_original) is distinct from 'object' or jsonb_typeof(p_original->'rawText') is distinct from 'string' or jsonb_typeof(p_original->'fields') is distinct from 'object') then raise exception 'closure_invalid_input'; end if;
 if p_source='manual' and p_original is not null then raise exception 'closure_invalid_input'; end if;
 if p_operation is null or p_operation not in ('save','archive') then raise exception 'closure_invalid_input'; end if;
 v_keys:=case when p_operation='save' then array['requestId','businessId','userId','id','expectedVersion','branchId','closureDate','grossTotal','netTotal','note','reason'] else array['requestId','businessId','userId','id','expectedVersion','reason'] end;
 if jsonb_typeof(p_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input))<>cardinality(v_keys)
  or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(v_keys)) then raise exception 'closure_invalid_input'; end if;
 if (p_input->>'businessId')::uuid is distinct from p_business or (p_input->>'userId')::uuid is distinct from p_actor then raise exception 'closure_context_changed'; end if;
 v_id:=(p_input->>'id')::uuid; v_request:=(p_input->>'requestId')::uuid;
 if v_request is null then raise exception 'closure_invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_business::text||v_request::text,0));
 v_payload:=jsonb_build_object('operation',p_operation,'input',p_input);
 if p_source='inbox' then v_payload:=v_payload||jsonb_build_object('source','inbox','original',p_original); end if;
 select * into v_receipt from public.closure_mutations where business_id=p_business and request_id=v_request;
 if found then
  perform closures_private.actor(p_business,v_receipt.branch_id,p_actor,true);
  if v_receipt.actor_id<>p_actor or v_receipt.payload<>v_payload then raise exception 'closure_idempotency_conflict'; end if;
  return v_receipt.result;
 end if;
 if v_id is not null then
  select * into v_row from public.daily_closures where id=v_id and business_id=p_business for update;
  if not found then raise exception 'closure_not_found'; end if;
  v_role:=closures_private.actor(p_business,v_row.branch_id,p_actor,true);
  if jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or p_input->>'expectedVersion' !~ '^[0-9]+$' or (p_input->>'expectedVersion')::numeric<>v_row.version then raise exception 'closure_conflict'; end if;
  if v_row.archived_at is not null then raise exception 'closure_archived'; end if;
  v_before:=to_jsonb(v_row); v_branch:=v_row.branch_id;
 elsif p_operation='archive' or p_input->>'expectedVersion' is not null then raise exception 'closure_invalid_input';
 end if;
 if v_id is not null and (jsonb_typeof(p_input->'reason') is distinct from 'string' or length(btrim(p_input->>'reason')) not between 1 and 1000) then raise exception 'closure_invalid_input'; end if;
 if p_input->>'reason' is not null and (jsonb_typeof(p_input->'reason')<>'string' or length(p_input->>'reason')>1000 or translate(p_input->>'reason',E'\n\r\t','') ~ '[[:cntrl:]]') then raise exception 'closure_invalid_input'; end if;
 v_reason:=nullif(btrim(p_input->>'reason'),'');
 if p_operation='archive' then
  update public.daily_closures set archived_at=clock_timestamp(),archived_by=p_actor,archive_reason=v_reason,version=version+1 where id=v_id returning * into v_row;
 else
  v_branch:=(p_input->>'branchId')::uuid;
  if v_id is not null and v_branch is distinct from v_row.branch_id then raise exception 'closure_branch_immutable'; end if;
  v_role:=closures_private.actor(p_business,v_branch,p_actor,v_id is not null);
  if jsonb_typeof(p_input->'closureDate') is distinct from 'string' or p_input->>'closureDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'closure_invalid_date'; end if;
  v_date:=(p_input->>'closureDate')::date;
  if v_date<'1900-01-01'::date or v_date>(clock_timestamp() at time zone (select timezone from public.businesses where id=p_business))::date then raise exception 'closure_invalid_date'; end if;
  if jsonb_typeof(p_input->'grossTotal') is distinct from 'string' or p_input->>'grossTotal' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
   or jsonb_typeof(p_input->'netTotal') is distinct from 'string' or p_input->>'netTotal' !~ '^-?(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
   or jsonb_typeof(p_input->'note') is distinct from 'string' or length(p_input->>'note')>4000 or translate(p_input->>'note',E'\n\r\t','') ~ '[[:cntrl:]]' then raise exception 'closure_invalid_input'; end if;
  if v_id is null then
   insert into public.daily_closures(business_id,branch_id,closure_date,raw_text,parsed,gross_total,net_total,created_by,source,manual_note,version,status)
   values(p_business,v_branch,v_date,case when p_source='inbox' then p_original->>'rawText' else p_input->>'note' end,case when p_source='inbox' then p_original->'fields' end,(p_input->>'grossTotal')::numeric,(p_input->>'netTotal')::numeric,p_actor,p_source,nullif(btrim(p_input->>'note'),''),1,case when p_source='inbox' then 'approved'::public.approval_status else 'pending'::public.approval_status end) returning * into v_row;
   v_id:=v_row.id;
  else
   update public.daily_closures set closure_date=v_date,gross_total=(p_input->>'grossTotal')::numeric,net_total=(p_input->>'netTotal')::numeric,manual_note=nullif(btrim(p_input->>'note'),''),version=version+1 where id=v_id returning * into v_row;
  end if;
 end if;
 v_after:=to_jsonb(v_row); v_result:=jsonb_build_object('ok',true,'id',v_id,'version',v_row.version);
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 select p_business,p_actor,full_name,v_role,case when p_operation='archive' then 'closure.archived' when v_before is null then 'closure.created' else 'closure.corrected' end,'daily_closures',v_id,
  case when p_operation='archive' then 'Cierre archivado' when v_before is null then 'Cierre manual registrado' else 'Cierre corregido con historial' end,
  jsonb_build_object('source',p_source,'branch_id',v_branch,'request_id',v_request,'version',v_row.version,'accounting_effect','none') from public.profiles where id=p_actor returning id into v_log;
 insert into public.closure_mutations(business_id,request_id,closure_id,branch_id,actor_id,actor_role,operation,reason,payload,result,before_snapshot,after_snapshot,activity_log_id)
 values(p_business,v_request,v_id,v_branch,p_actor,v_role,p_operation,v_reason,v_payload,v_result,v_before,v_after,v_log);
 return v_result;
end $$;
revoke all on function closures_private.mutate_shared(uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function closures_private.mutate(p_business uuid,p_actor uuid,p_operation text,p_input jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select closures_private.mutate_shared(p_business,p_actor,'manual',p_operation,p_input,null) $$;
revoke all on function closures_private.mutate(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
create table closures_private.inbox_receipts (
 extraction_id uuid primary key references public.ai_extractions(id) on delete restrict,
 message_id uuid not null references public.whatsapp_messages(id) on delete restrict,
 business_id uuid not null, branch_id uuid not null, actor_id uuid not null,
 expected_fields jsonb not null, review jsonb not null, result jsonb not null
);
revoke all on closures_private.inbox_receipts from public,anon,authenticated,service_role;
create function closures_private.approve_inbox(p_business uuid,p_actor uuid,p_extraction uuid,p_expected jsonb,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype; receipt closures_private.inbox_receipts%rowtype;
 v_branch uuid; v_result jsonb; v_input jsonb; allowed text[]:=array['branchId','closureDate','grossTotal','netTotal','note'];
begin
 if auth.uid() is null or p_actor is distinct from auth.uid() or current_setting('role',true)<>'authenticated' then raise exception 'closure_permission_denied'; end if;
 select * into e from public.ai_extractions where id=p_extraction for update;
 if not found or e.type<>'daily_closure' then raise exception 'closure_not_found'; end if;
 select * into m from public.whatsapp_messages where id=e.message_id for share;
 if not found or m.business_id is distinct from p_business or (e.business_id is not null and e.business_id<>p_business) then raise exception 'closure_permission_denied'; end if;
 if jsonb_typeof(p_review) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_review))<>cardinality(allowed)
  or exists(select 1 from jsonb_object_keys(p_review) k where not k=any(allowed)) or jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'closure_invalid_input'; end if;
 v_branch:=(p_review->>'branchId')::uuid;
 perform closures_private.actor(p_business,v_branch,p_actor);
 perform 1 from public.business_modules where business_id=p_business and module_key='inbox_ai' and enabled for share;
 if not found then raise exception 'closure_module_disabled'; end if;
 if (e.branch_id is not null and e.branch_id<>v_branch) or (m.branch_id is not null and m.branch_id<>v_branch) then raise exception 'closure_branch_forbidden'; end if;
 select * into receipt from closures_private.inbox_receipts where extraction_id=p_extraction;
 if found then
  if receipt.business_id<>p_business or receipt.actor_id<>p_actor or receipt.message_id<>m.id or receipt.branch_id<>v_branch
   or receipt.review<>p_review or receipt.expected_fields<>p_expected then raise exception 'closure_idempotency_conflict'; end if;
  return receipt.result;
 end if;
 if e.status not in ('pending','needs_review','failed') then raise exception 'closure_extraction_closed'; end if;
 if e.fields is distinct from p_expected then raise exception 'closure_extraction_changed'; end if;
 v_input:=p_review||jsonb_build_object('requestId',md5(p_extraction::text||':closure')::uuid,'businessId',p_business,'userId',p_actor,'id',null,'expectedVersion',null,'reason',null);
 v_result:=closures_private.mutate_shared(p_business,p_actor,'inbox','save',v_input,jsonb_build_object('rawText',m.raw,'fields',e.fields));
 update public.ai_extractions set status='approved',approved_at=clock_timestamp(),approved_by=p_actor,target_entity='daily_closures',target_record_id=(v_result->>'id')::uuid,branch_id=v_branch where id=p_extraction;
 if not found then raise exception 'closure_extraction_changed'; end if;
 insert into closures_private.inbox_receipts values(p_extraction,m.id,p_business,v_branch,p_actor,p_expected,p_review,v_result);
 return v_result;
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'closure_%' then sqlerrm else 'closure_invalid_input' end);
end $$;
revoke all on function closures_private.approve_inbox(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function closures_private.approve_inbox(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
create function public.approve_closure_extraction_atomic(p_business_id uuid,p_actor_id uuid,p_extraction_id uuid,p_expected_fields jsonb,p_review jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select closures_private.approve_inbox(p_business_id,p_actor_id,p_extraction_id,p_expected_fields,p_review) $$;
revoke all on function public.approve_closure_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.approve_closure_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
-- The authenticated Inbox now uses its transaction wrapper. No production
-- caller needs legacy direct insertion; close the old service-only bypass too.
revoke insert(id,business_id,branch_id,closure_date,raw_text,parsed,inconsistencies,status,gross_total,net_total,created_by,created_at,updated_at) on public.daily_closures from service_role;

-- Ordinary Data API callers cannot mark a reviewed extraction as approved or
-- rewrite an approved record. Only the validated owner-executed atomic wrapper
-- may make that transition; direct service transport is also denied.
create function closures_private.guard_extraction_approval() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if current_user::text in ('authenticated','anon','service_role') then
  if tg_op<>'INSERT' and old.type='daily_closure' and old.status='approved' then raise exception 'closure_extraction_closed'; end if;
  if tg_op<>'DELETE' and new.type='daily_closure' and new.status='approved' then raise exception 'closure_review_required'; end if;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function closures_private.guard_extraction_approval() from public,anon,authenticated,service_role;
create trigger closure_extraction_approval_guard before insert or update or delete on public.ai_extractions for each row execute function closures_private.guard_extraction_approval();
