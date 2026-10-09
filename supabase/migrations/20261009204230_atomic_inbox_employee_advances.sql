-- These rows record an advance reported by an operator. They never execute a
-- payment or adjust employees.pending_advance, which remains a manual balance.
-- Legacy amounts, dates, statuses and unknown origin stay untouched.
alter table public.advance_payments
 add column business_id uuid references public.businesses(id) on delete restrict,
 add column branch_id uuid references public.branches(id) on delete restrict,
 add column source text check(source in ('manual','inbox','whatsapp','api','system')),
 add column recorded_by uuid,
 add column request_id uuid,
 add column note text,
 add constraint advance_inbox_metadata check(source is distinct from 'inbox' or (business_id is not null and branch_id is not null and recorded_by is not null and request_id is not null));
create unique index advance_request_identity_idx on public.advance_payments(business_id,request_id) where request_id is not null;
create index advance_recorded_branch_idx on public.advance_payments(business_id,branch_id,paid_at,id);
revoke insert,update,delete,truncate,references,trigger on public.advance_payments from public,anon,authenticated,service_role;
-- Both current employee visibility and the ORIGINAL recorded branch apply.
create policy advance_original_branch on public.advance_payments as restrictive for select to authenticated using(
 source is distinct from 'inbox' or public.can_read_employee_scope(business_id,branch_id));
create schema advances_private;
revoke all on schema advances_private from public,anon,service_role;
grant usage on schema advances_private to authenticated;
create table advances_private.inbox_receipts (
 extraction_id uuid primary key references public.ai_extractions(id) on delete restrict,
 message_id uuid not null references public.whatsapp_messages(id) on delete restrict,
 business_id uuid not null, branch_id uuid not null, actor_id uuid not null, employee_id uuid not null,
 expected_fields jsonb not null, review jsonb not null, result jsonb not null,
 activity_log_id uuid not null unique references public.activity_logs(id) on delete restrict,
 advance_id uuid not null unique references public.advance_payments(id) on delete restrict
);
revoke all on advances_private.inbox_receipts from public,anon,authenticated,service_role;
create function advances_private.can_read_log(p_log uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare r advances_private.inbox_receipts%rowtype;
begin
 select * into r from advances_private.inbox_receipts where activity_log_id=p_log;
 if not found then return true; end if;
 return public.can_read_employee_scope(r.business_id,r.branch_id)
  and exists(select 1 from public.employees e where e.id=r.employee_id and e.business_id=r.business_id and public.can_read_employee_scope(e.business_id,e.branch_id));
end $$;
create policy advances_audit_scope on public.activity_logs as restrictive for select to authenticated using(advances_private.can_read_log(id));
create function advances_private.approve_inbox(p_business uuid,p_actor uuid,p_extraction uuid,p_expected jsonb,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype; employee public.employees%rowtype;
 receipt advances_private.inbox_receipts%rowtype; member public.business_members%rowtype;
 allowed text[]:=array['employeeId','expectedEmployeeUpdatedAt','branchId','amount','date','note'];
 v_branch uuid; v_employee uuid; v_amount numeric; v_date date; v_id uuid; v_log uuid; v_result jsonb; v_request uuid; v_name text; v_affected integer;
begin
 if auth.uid() is null or p_actor is distinct from auth.uid() or current_setting('role',true)<>'authenticated' then raise exception 'advance_permission_denied'; end if;
 select * into e from public.ai_extractions where id=p_extraction for update;
 if not found or e.type<>'employee_advance' then raise exception 'advance_not_found'; end if;
 select * into m from public.whatsapp_messages where id=e.message_id for share;
 if not found or m.business_id is distinct from p_business or (e.business_id is not null and e.business_id<>p_business) then raise exception 'advance_permission_denied'; end if;
 if jsonb_typeof(p_review) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_review))<>cardinality(allowed)
  or exists(select 1 from jsonb_object_keys(p_review) k where not k=any(allowed)) or jsonb_typeof(p_expected) is distinct from 'object' or octet_length(p_expected::text)>50000
  or jsonb_typeof(p_review->'branchId') is distinct from 'string' or jsonb_typeof(p_review->'employeeId') is distinct from 'string' then raise exception 'advance_invalid_input'; end if;
 select full_name into v_name from public.profiles where id=p_actor and active for share;
 if not found then raise exception 'advance_permission_denied'; end if;
 select * into member from public.business_members where user_id=p_actor and business_id=p_business for share;
 if not found or member.role::text not in ('owner','admin') then raise exception 'advance_permission_denied'; end if;
 perform 1 from public.business_modules where business_id=p_business and module_key='employees' and enabled for share;
 if not found then raise exception 'advance_module_disabled'; end if;
 perform 1 from public.business_modules where business_id=p_business and module_key='inbox_ai' and enabled for share;
 if not found then raise exception 'advance_module_disabled'; end if;
 v_branch:=(p_review->>'branchId')::uuid; v_employee:=(p_review->>'employeeId')::uuid;
 perform 1 from public.branches where id=v_branch and business_id=p_business for share;
 if not found or (e.branch_id is not null and e.branch_id<>v_branch) or (m.branch_id is not null and m.branch_id<>v_branch) then raise exception 'advance_branch_forbidden'; end if;
 select * into receipt from advances_private.inbox_receipts where extraction_id=p_extraction;
 if found then
  if receipt.business_id<>p_business or receipt.actor_id<>p_actor or receipt.message_id<>m.id or receipt.branch_id<>v_branch or receipt.employee_id<>v_employee
   or receipt.review<>p_review or receipt.expected_fields<>p_expected then raise exception 'advance_idempotency_conflict'; end if;
  return receipt.result;
 end if;
 if e.status not in ('pending','needs_review','failed') then raise exception 'advance_extraction_closed'; end if;
 if e.fields is distinct from p_expected then raise exception 'advance_extraction_changed'; end if;
 select * into employee from public.employees where id=v_employee and business_id=p_business for share;
 if not found or not employee.active or employee.branch_id is distinct from v_branch then raise exception 'advance_employee_forbidden'; end if;
 if jsonb_typeof(p_review->'expectedEmployeeUpdatedAt') is distinct from 'string' or p_review->>'expectedEmployeeUpdatedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.[0-9]{1,6})?(Z|[+-]\d{2}:\d{2})$'
  or (p_review->>'expectedEmployeeUpdatedAt')::timestamptz is distinct from employee.updated_at then raise exception 'advance_employee_changed'; end if;
 if jsonb_typeof(p_review->'amount') is distinct from 'string' or p_review->>'amount' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$' then raise exception 'advance_invalid_input'; end if;
 v_amount:=(p_review->>'amount')::numeric;
 if v_amount<=0 or v_amount>=10000000000 then raise exception 'advance_invalid_input'; end if;
 if jsonb_typeof(p_review->'date') is distinct from 'string' or p_review->>'date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'advance_invalid_input'; end if;
 v_date:=(p_review->>'date')::date;
 if not isfinite(v_date) or v_date<'1900-01-01' or v_date>(clock_timestamp() at time zone (select timezone from public.businesses where id=p_business))::date or to_char(v_date,'YYYY-MM-DD')<>p_review->>'date' then raise exception 'advance_invalid_date'; end if;
 if jsonb_typeof(p_review->'note') is distinct from 'string' or length(p_review->>'note')>1000 or translate(p_review->>'note',E'\n\r\t','') ~ '[[:cntrl:]]' then raise exception 'advance_invalid_input'; end if;
 v_request:=md5(p_extraction::text||':employee-advance')::uuid;
 insert into public.advance_payments(employee_id,amount,paid_at,status,business_id,branch_id,source,recorded_by,request_id,note)
 values(v_employee,v_amount,v_date,'pending',p_business,v_branch,'inbox',p_actor,v_request,nullif(btrim(p_review->>'note'),'')) returning id into v_id;
 v_result:=jsonb_build_object('ok',true,'id',v_id);
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 values(p_business,p_actor,v_name,member.role::text,'employee_advance.recorded','advance_payments',v_id,'Adelanto registrado · '||employee.full_name,
 jsonb_build_object('source','inbox','branch_id',v_branch,'employee_id',v_employee,'employee_name',employee.full_name,'amount',v_amount::text,'date',v_date,'status','pending','request_id',v_request,'payment_execution','none','manual_balance_sync','none','note',nullif(btrim(p_review->>'note'),''))) returning id into v_log;
 update public.ai_extractions set status='approved',approved_at=clock_timestamp(),approved_by=p_actor,target_entity='advance_payments',target_record_id=v_id,branch_id=v_branch where id=p_extraction;
 get diagnostics v_affected=row_count;
 if v_affected<>1 then raise exception 'advance_approval_write_failed'; end if;
 insert into advances_private.inbox_receipts values(p_extraction,m.id,p_business,v_branch,p_actor,v_employee,p_expected,p_review,v_result,v_log,v_id);
 return v_result;
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'advance_%' then sqlerrm else 'advance_invalid_input' end);
end $$;
revoke all on all functions in schema advances_private from public,anon,authenticated,service_role;
grant execute on function advances_private.approve_inbox(uuid,uuid,uuid,jsonb,jsonb),advances_private.can_read_log(uuid) to authenticated;
create function public.approve_employee_advance_extraction_atomic(p_business_id uuid,p_actor_id uuid,p_extraction_id uuid,p_expected_fields jsonb,p_review jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select advances_private.approve_inbox(p_business_id,p_actor_id,p_extraction_id,p_expected_fields,p_review) $$;
revoke all on function public.approve_employee_advance_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.approve_employee_advance_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb) to authenticated;

-- Clients cannot bypass the reviewed RPC by marking an advance extraction as
-- approved directly, or rewrite the origin/payload of an already closed record.
-- Inside the definer transaction current_user is the migration owner.
create function advances_private.guard_extraction() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user in ('authenticated','anon','service_role') then
  if tg_op='DELETE' then
   if old.type='employee_advance' and old.status='approved' then raise exception 'advance_extraction_closed'; end if;
   return old;
  end if;
  if tg_op='UPDATE' and old.type='employee_advance' and old.status='approved' then raise exception 'advance_extraction_closed'; end if;
  if (new.type='employee_advance' or tg_op='UPDATE' and old.type='employee_advance') and
   (new.status='approved' or new.approved_at is not null or new.approved_by is not null or new.target_record_id is not null) then raise exception 'advance_review_required'; end if;
 end if;
 return new;
end $$;
revoke all on function advances_private.guard_extraction() from public,anon,authenticated,service_role;
create trigger guard_reviewed_advance_extraction before insert or update or delete on public.ai_extractions for each row execute function advances_private.guard_extraction();
