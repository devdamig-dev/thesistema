-- Expense operational facts are nullable for historical records. Nothing is inferred
-- from due dates, created_at, paid status or OCR. Recurrence is metadata only:
-- this migration never schedules payments or generates additional expense rows.
alter table public.suppliers add constraint suppliers_expense_scope unique(id,business_id);
alter table public.expenses
 add column expense_date date check(expense_date is null or (isfinite(expense_date) and expense_date between date '0001-01-01' and date '9999-12-31')),
 add column payment_method text check(payment_method is null or (length(btrim(payment_method)) between 1 and 80 and payment_method !~ '[[:cntrl:]]')),
 add column supplier_id uuid,
 add column is_recurring boolean,
 add column periodicity text,
 add constraint expenses_supplier_business_fk foreign key(supplier_id,business_id) references public.suppliers(id,business_id) on delete restrict,
 add constraint expenses_recurrence_complete check(
  (is_recurring is true and periodicity is not null and periodicity in ('daily','weekly','fortnightly','monthly','quarterly','semiannual','yearly'))
  or (is_recurring is not true and periodicity is null));
create index expenses_supplier_scope_idx on public.expenses(supplier_id,business_id) where supplier_id is not null;
comment on column public.expenses.expense_date is 'Date of the expense, independent from optional due_date; null means unknown historical fact.';
comment on column public.expenses.is_recurring is 'Declared recurrence classification only; null means unknown. No automatic payments or generated charges.';
comment on column public.expenses.periodicity is 'Declared recurrence interval; no payment scheduler or automatic expense creation.';

create or replace function expenses_private.mutate(p_business uuid,p_actor uuid,p_source text,p_operation text,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_id uuid; v_request uuid; v_branch uuid; v_role text; v_expense public.expenses%rowtype;
 v_receipt public.expense_mutations%rowtype; v_payload jsonb; v_result jsonb; v_before jsonb; v_after jsonb;
 v_amount numeric; v_due date; v_log uuid; v_extended boolean; v_date date; v_supplier uuid; v_method text; v_recurring boolean; v_period text;
begin
 if p_source not in ('manual','whatsapp','inbox') or p_operation not in ('save','void','restore') then raise exception 'expense_invalid_input'; end if;
 if p_operation='save' then
  v_extended:=p_input ?| array['expenseDate','paymentMethod','supplierId','isRecurring','periodicity'];
  perform expenses_private.require_keys(p_input,array['requestId','businessId','userId','id','expectedVersion','branchId','name','category','amount','dueDate','status'] || case when v_extended then array['expenseDate','paymentMethod','supplierId','isRecurring','periodicity'] else array[]::text[] end);
 else perform expenses_private.require_keys(p_input,array['requestId','businessId','userId','id','expectedVersion','reason']); end if;
 if (p_input->>'businessId')::uuid is distinct from p_business or (p_input->>'userId')::uuid is distinct from p_actor then raise exception 'expense_context_changed'; end if;
 if jsonb_typeof(p_input->'requestId') is distinct from 'string' or p_input->>'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'expense_invalid_input'; end if;
 v_request:=(p_input->>'requestId')::uuid; v_id:=(p_input->>'id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(p_business::text||v_request::text,0));
 v_payload:=jsonb_build_object('operation',p_operation,'source',p_source,'input',p_input);
 select * into v_receipt from public.expense_mutations where business_id=p_business and request_id=v_request;
 if found then
  perform expenses_private.actor_role(p_business,v_receipt.branch_id,p_actor);
  if v_receipt.before_snapshot is not null then perform expenses_private.actor_role(p_business,(v_receipt.before_snapshot->>'branch_id')::uuid,p_actor); end if;
  if v_receipt.actor_id<>p_actor or v_receipt.payload<>v_payload then raise exception 'expense_idempotency_conflict'; end if;
  return v_receipt.result;
 end if;
 if v_id is not null then
  select * into v_expense from public.expenses where id=v_id and business_id=p_business for update;
  if not found then raise exception 'expense_not_found'; end if;
  v_role:=expenses_private.actor_role(p_business,v_expense.branch_id,p_actor);
  if jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or p_input->>'expectedVersion' !~ '^[0-9]+$' or (p_input->>'expectedVersion')::numeric<>v_expense.version then raise exception 'expense_conflict'; end if;
  if (p_operation='restore' and v_expense.record_status<>'voided') or (p_operation<>'restore' and v_expense.record_status<>'active') then raise exception 'expense_state_conflict'; end if;
  v_before:=to_jsonb(v_expense)||jsonb_build_object('amount',v_expense.amount::text);
 elsif p_operation<>'save' or p_input->>'expectedVersion' is not null then raise exception 'expense_invalid_input'; end if;
 if p_operation in ('void','restore') then
  if jsonb_typeof(p_input->'reason') is distinct from 'string' or length(btrim(p_input->>'reason')) not between 1 and 1000 or p_input->>'reason' ~ '[[:cntrl:]]' then raise exception 'expense_invalid_input'; end if;
  v_branch:=v_expense.branch_id;
  update public.expenses set record_status=case when p_operation='void' then 'voided' else 'active' end,
   void_reason=case when p_operation='void' then btrim(p_input->>'reason') end,
   voided_at=case when p_operation='void' then clock_timestamp() end,
   voided_by=case when p_operation='void' then p_actor end,version=version+1 where id=v_id returning * into v_expense;
 else
  v_branch:=(p_input->>'branchId')::uuid;
  v_role:=expenses_private.actor_role(p_business,v_branch,p_actor);
  if jsonb_typeof(p_input->'name') is distinct from 'string' or length(btrim(p_input->>'name')) not between 1 and 200 or p_input->>'name' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_input->'category') is distinct from 'string' or length(btrim(p_input->>'category')) not between 1 and 80 or p_input->>'category' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_input->'amount') is distinct from 'string' or p_input->>'amount' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
   or jsonb_typeof(p_input->'status') is distinct from 'string' or p_input->>'status' not in ('pending','scheduled','paid') then raise exception 'expense_invalid_input'; end if;
  v_amount:=(p_input->>'amount')::numeric;
  if v_amount<=0 or v_amount>=10000000000 then raise exception 'expense_invalid_input'; end if;
  if p_input->>'dueDate' is not null then
   if jsonb_typeof(p_input->'dueDate') is distinct from 'string' or p_input->>'dueDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'expense_invalid_input'; end if;
   v_due:=(p_input->>'dueDate')::date;
   if not isfinite(v_due) or to_char(v_due,'YYYY-MM-DD')<>p_input->>'dueDate' then raise exception 'expense_invalid_input'; end if;
  end if;
  if v_extended then
   -- Existing historical rows may keep unknowns. New reviewed records must declare
   -- the expense date, payment method and recurrence independently of due/status.
   if v_id is null and (p_input->>'expenseDate' is null or p_input->>'paymentMethod' is null or p_input->>'isRecurring' is null) then raise exception 'expense_invalid_input'; end if;
   if p_input->>'expenseDate' is not null then
    if jsonb_typeof(p_input->'expenseDate') is distinct from 'string' or p_input->>'expenseDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'expense_invalid_input'; end if;
    v_date:=(p_input->>'expenseDate')::date;
    if not isfinite(v_date) or to_char(v_date,'YYYY-MM-DD')<>p_input->>'expenseDate' then raise exception 'expense_invalid_input'; end if;
   end if;
   if p_input->>'paymentMethod' is not null then
    if jsonb_typeof(p_input->'paymentMethod') is distinct from 'string' or length(btrim(p_input->>'paymentMethod')) not between 1 and 80 or p_input->>'paymentMethod' ~ '[[:cntrl:]]' then raise exception 'expense_invalid_input'; end if;
    v_method:=btrim(p_input->>'paymentMethod');
   end if;
   if jsonb_typeof(p_input->'isRecurring') not in ('null','boolean') then raise exception 'expense_invalid_input'; end if;
   v_recurring:=(p_input->>'isRecurring')::boolean;
   if v_recurring is true then
    if jsonb_typeof(p_input->'periodicity') is distinct from 'string' or p_input->>'periodicity' not in ('daily','weekly','fortnightly','monthly','quarterly','semiannual','yearly') then raise exception 'expense_invalid_input'; end if;
    v_period:=p_input->>'periodicity';
   elsif jsonb_typeof(p_input->'periodicity') is distinct from 'null' then raise exception 'expense_invalid_input'; end if;
   if p_input->>'supplierId' is not null then
    if jsonb_typeof(p_input->'supplierId') is distinct from 'string' or p_input->>'supplierId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'expense_invalid_input'; end if;
    v_supplier:=(p_input->>'supplierId')::uuid;
    perform 1 from public.suppliers where id=v_supplier and business_id=p_business and (active or id=v_expense.supplier_id) for share;
    if not found then raise exception 'expense_supplier_forbidden'; end if;
   end if;
  else
   -- Compatibility is exact and non-destructive, including pending v1 journals.
   -- Never backfill absent facts from due_date, created_at, payment status or OCR.
   v_date:=v_expense.expense_date; v_method:=v_expense.payment_method;
   v_supplier:=v_expense.supplier_id; v_recurring:=v_expense.is_recurring; v_period:=v_expense.periodicity;
  end if;
  if v_id is null then
   insert into public.expenses(business_id,branch_id,name,category,amount,due_date,status,version,source,created_by,expense_date,payment_method,supplier_id,is_recurring,periodicity)
    values(p_business,v_branch,btrim(p_input->>'name'),btrim(p_input->>'category'),v_amount,v_due,p_input->>'status',1,p_source,p_actor,v_date,v_method,v_supplier,v_recurring,v_period) returning * into v_expense;
   v_id:=v_expense.id;
  else
   update public.expenses set branch_id=v_branch,name=btrim(p_input->>'name'),category=btrim(p_input->>'category'),amount=v_amount,due_date=v_due,status=p_input->>'status',expense_date=v_date,payment_method=v_method,supplier_id=v_supplier,is_recurring=v_recurring,periodicity=v_period,version=version+1
    where id=v_id returning * into v_expense;
  end if;
 end if;
 -- Older expenses may have no expense date. Preserve conservative invalidation
 -- rather than guessing historical attribution or recalculating financial totals.
 update public.balance_snapshots set expenses_data_stale=true where business_id=p_business;
 v_after:=to_jsonb(v_expense)||jsonb_build_object('amount',v_expense.amount::text);
 v_result:=jsonb_build_object('ok',true,'id',v_id,'version',v_expense.version);
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
  select p_business,p_actor,full_name,v_role,case when p_operation='void' then 'expense.voided' when p_operation='restore' then 'expense.restored' when v_before is null then 'expense.created' else 'expense.updated' end,
   'expenses',v_id,case when p_operation='void' then 'Gasto anulado con historial conservado' when p_operation='restore' then 'Gasto restaurado' when v_before is null then 'Gasto registrado' else 'Gasto actualizado' end,
   jsonb_build_object('source',p_source,'branch_id',v_branch,'result','success','request_id',v_request,'version',v_expense.version,'payment_execution','none','recurrence_execution','none')
  from public.profiles where id=p_actor returning id into v_log;
 insert into public.expense_mutations(request_id,business_id,branch_id,expense_id,actor_id,actor_role,source,operation,payload,result,before_snapshot,after_snapshot,activity_log_id)
  values(v_request,p_business,v_branch,v_id,p_actor,v_role,p_source,p_operation,v_payload,v_result,v_before,v_after,v_log);
 insert into expenses_private.revisions values(p_business,1) on conflict(business_id) do update set revision=expenses_private.revisions.revision+1;
 return v_result;
end $$;

create or replace function expenses_private.approve_inbox(p_business uuid,p_actor uuid,p_extraction uuid,p_expected jsonb,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype; receipt expenses_private.inbox_receipts%rowtype;
 v_branch uuid; v_result jsonb; v_input jsonb;
begin
 if auth.uid() is null or p_actor is distinct from auth.uid() or current_setting('role',true)<>'authenticated' then raise exception 'expense_permission_denied'; end if;
 select * into e from public.ai_extractions where id=p_extraction for update;
 if not found or e.type<>'expense' then raise exception 'expense_not_found'; end if;
 select * into m from public.whatsapp_messages where id=e.message_id for share;
 if not found or m.business_id is distinct from p_business or (e.business_id is not null and e.business_id<>p_business) then raise exception 'expense_permission_denied'; end if;
 perform expenses_private.require_keys(p_review,array['branchId','name','category','amount','dueDate','status'] || case when p_review ?| array['expenseDate','paymentMethod','supplierId','isRecurring','periodicity'] then array['expenseDate','paymentMethod','supplierId','isRecurring','periodicity'] else array[]::text[] end);
 if jsonb_typeof(p_expected) is distinct from 'object' then raise exception 'expense_invalid_input'; end if;
 v_branch:=(p_review->>'branchId')::uuid;
 perform expenses_private.actor_role(p_business,v_branch,p_actor);
 perform 1 from public.business_modules where business_id=p_business and module_key='inbox_ai' and enabled for share;
 if not found then raise exception 'expense_module_disabled'; end if;
 if (e.branch_id is not null and e.branch_id<>v_branch) or (m.branch_id is not null and m.branch_id<>v_branch) then raise exception 'expense_branch_forbidden'; end if;
 select * into receipt from expenses_private.inbox_receipts where extraction_id=p_extraction;
 if found then
  if receipt.business_id<>p_business or receipt.actor_id<>p_actor or receipt.message_id<>m.id or receipt.branch_id<>v_branch
   or receipt.review<>p_review or receipt.expected_fields<>p_expected then raise exception 'expense_idempotency_conflict'; end if;
  return receipt.result;
 end if;
 if e.status not in ('pending','needs_review','failed') then raise exception 'expense_extraction_closed'; end if;
 if e.fields is distinct from p_expected then raise exception 'expense_extraction_changed'; end if;
 v_input:=p_review||jsonb_build_object('requestId',md5(p_extraction::text||':expense')::uuid,'businessId',p_business,'userId',p_actor,'id',null,'expectedVersion',null);
 v_result:=expenses_private.mutate(p_business,p_actor,'inbox','save',v_input);
 update public.ai_extractions set status='approved',approved_at=clock_timestamp(),approved_by=p_actor,
  target_entity='expenses',target_record_id=(v_result->>'id')::uuid,branch_id=v_branch where id=p_extraction;
 if not found then raise exception 'expense_extraction_changed'; end if;
 insert into expenses_private.inbox_receipts values(p_extraction,m.id,p_business,v_branch,p_actor,p_expected,p_review,v_result);
 return v_result;
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'expense_%' then sqlerrm else 'expense_invalid_input' end);
end $$;
