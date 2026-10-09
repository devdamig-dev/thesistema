-- Administrative cancellation archives an incorrectly entered/obsolete record.
-- It NEVER pays, forgives, transfers or erases an obligation or its payment history.
-- pending_amount retains the exact historical ledger balance; only active
-- commitment views exclude cancelled records. All metadata is immutable.
-- cancelled enum was committed by the preceding standalone migration.
alter table public.debts
  add column cancelled_at timestamptz,
  add column cancelled_on date,
  add column cancelled_by uuid references public.profiles(id),
  add column cancel_reason text,
  add column cancel_request_id uuid,
  add constraint debt_cancel_request unique (business_id,cancel_request_id),
  add constraint debt_cancel_status_matches check ((status='cancelled')=(cancelled_at is not null)),
  add constraint debt_cancel_complete check (
    (cancelled_at is null and cancelled_on is null and cancelled_by is null and cancel_reason is null and cancel_request_id is null)
    or (plan_definition is not null and cancelled_at is not null and cancelled_on is not null and cancelled_by is not null
      and length(btrim(cancel_reason)) between 1 and 1000 and cancel_request_id is not null));

-- Preserve all existing direct-write integrity and audit controls while adding
-- an immutable cancellation boundary under the same parent row lock.
create or replace function debt_private.guard_debt() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p jsonb; payload jsonb; key text; paid numeric; next_due date;
begin
 if tg_op='INSERT' and (new.cancelled_at is not null or new.cancelled_on is not null or new.cancelled_by is not null or new.cancel_reason is not null or new.cancel_request_id is not null) then raise exception 'cancel_existing_plan_only'; end if;
 if tg_op='UPDATE' and old.cancelled_at is not null then
   if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then raise exception 'debt_cancelled'; end if;
   return old;
 end if;
 if tg_op='UPDATE' and new.cancelled_at is not null then
   if old.plan_definition is null then raise exception 'plan_required'; end if;
   if not debt_private.can_write(old.business_id,old.branch_id) or debt_private.actor_id() is null then raise exception 'permission_denied' using errcode='42501'; end if;
   if new.cancel_request_id is null or nullif(btrim(new.cancel_reason),'') is null or length(new.cancel_reason)>1000 then raise exception 'invalid_cancel_reason'; end if;
   new.cancelled_at:=now(); new.cancelled_on:=debt_private.business_date(old.business_id); new.cancelled_by:=debt_private.actor_id(); new.cancel_reason:=btrim(new.cancel_reason);
 end if;
 if tg_op='DELETE' then
   if old.plan_definition is not null then raise exception 'plan_history_immutable'; end if;
   return old;
 end if;
 if tg_op='UPDATE' and old.plan_definition is not null then
   if (to_jsonb(new)-array['pending_amount','status','settled_at','due_date','notes','updated_at','plan_version','mutation_request_id','cancelled_at','cancelled_on','cancelled_by','cancel_reason','cancel_request_id'])
     is distinct from (to_jsonb(old)-array['pending_amount','status','settled_at','due_date','notes','updated_at','plan_version','mutation_request_id','cancelled_at','cancelled_on','cancelled_by','cancel_reason','cancel_request_id']) then raise exception 'plan_financial_terms_immutable'; end if;
   select coalesce(sum(amount),0) into paid from public.debt_payments where debt_id=new.id and voided_at is null;
   select min(i.due_date) into next_due from public.debt_installments i where i.debt_id=new.id
     and i.total_amount>coalesce((select sum(a.amount) from public.debt_payment_allocations a join public.debt_payments pay on pay.id=a.payment_id where a.installment_id=i.id and pay.voided_at is null),0);
   new.pending_amount:=new.total_financed_amount-paid;
   new.due_date:=case when new.cancelled_at is not null then null else next_due end;
   new.status:=case when new.cancelled_at is not null then 'cancelled'::public.debt_status when new.pending_amount=0 then 'settled'::public.debt_status when next_due<debt_private.business_date(new.business_id) then 'overdue'::public.debt_status else 'active'::public.debt_status end;
   new.settled_at:=case when new.cancelled_at is not null then null when new.pending_amount=0 then coalesce(old.settled_at,debt_private.business_date(new.business_id)) else null end;
   new.plan_version:=old.plan_version+1;
 elsif new.plan_definition is not null then
   if tg_op<>'INSERT' then raise exception 'existing_debt_conversion_not_supported'; end if;
   if not debt_private.can_write(new.business_id,new.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
   perform debt_private.validate_plan(new.plan_definition); p:=new.plan_definition;
   -- Direct Data API callers must also bind the retry receipt to actual data.
   new.creditor:=btrim(new.creditor); new.concept:=nullif(btrim(new.concept),''); new.notes:=nullif(btrim(new.notes),'');
   new.reference:=nullif(btrim(new.reference),''); new.expected_payment_method:=nullif(btrim(new.expected_payment_method),'');
   if nullif(new.creditor,'') is null or length(new.creditor)>200 or length(new.concept)>1000 or length(new.notes)>1000
     or length(new.reference)>200 or length(new.expected_payment_method)>80 or new.origin is null then raise exception 'invalid_debt_metadata'; end if;
   if new.supplier_id is not null and not exists(select 1 from public.suppliers s where s.id=new.supplier_id and s.business_id=new.business_id) then raise exception 'supplier_business_mismatch'; end if;
   payload:=coalesce(new.plan_request_payload,jsonb_build_object('business_id',new.business_id,'branch_id',new.branch_id,'creditor',new.creditor,
     'creditor_type',new.creditor_type,'concept',new.concept,'taken_at',new.taken_at,'category',new.category,'reference',new.reference,
     'notes',new.notes,'origin',new.origin,'expected_payment_method',new.expected_payment_method,'plan',new.plan_definition));
   perform debt_private.keys(payload,array['business_id','branch_id','creditor','creditor_type','concept','taken_at','category','reference','notes','origin','expected_payment_method','plan']);
   foreach key in array array['business_id','branch_id','creditor','creditor_type','concept','taken_at','category','reference','notes','origin','expected_payment_method'] loop
     if payload->key is not null and payload->key<>'null'::jsonb and jsonb_typeof(payload->key)<>'string' then raise exception 'invalid_debt_metadata'; end if;
   end loop;
   if (payload->>'business_id')::uuid is distinct from new.business_id or (payload->>'branch_id')::uuid is distinct from new.branch_id
     or btrim(payload->>'creditor') is distinct from new.creditor or payload->>'creditor_type' is distinct from new.creditor_type
     or nullif(btrim(payload->>'concept'),'') is distinct from new.concept or debt_private.civil_date(payload->>'taken_at') is distinct from new.taken_at
     or payload->>'category' is distinct from new.category::text or nullif(btrim(payload->>'reference'),'') is distinct from new.reference
     or nullif(btrim(payload->>'notes'),'') is distinct from new.notes or payload->>'origin' is distinct from new.origin
     or nullif(btrim(payload->>'expected_payment_method'),'') is distinct from new.expected_payment_method
     or payload->'plan' is distinct from new.plan_definition then raise exception 'request_payload_mismatch'; end if;
   new.plan_request_payload:=payload; new.created_at:=now();

   if new.plan_request_id is null then raise exception 'request_id_required'; end if;
   new.mode:=p->>'mode'; new.currency:=p->>'currency'; new.original_amount:=debt_private.cents(p->'originalAmountCents')/100;
   new.total_financed_amount:=debt_private.cents(p->'totalFinancedCents')/100;
   new.down_payment_amount:=(p->>'downPaymentCents')::numeric/100;
   new.total_obligation_amount:=(p->>'totalObligationCents')::numeric/100;
   new.pending_amount:=new.total_financed_amount; new.installment_count:=(p->>'installmentCount')::int;
   new.periodicity:=p->>'periodicity'; new.monthly_anchor_day:=(p->>'monthlyAnchorDay')::int;
   new.due_date:=(p->'installments'->0->>'dueDate')::date; new.plan_version:=0;
   new.status:=case when new.due_date<debt_private.business_date(new.business_id) then 'overdue'::public.debt_status else 'active'::public.debt_status end;
   new.settled_at:=null; new.created_by:=debt_private.actor_id(); new.interest_rate:=null;
 elsif new.mode<>'single' or new.total_financed_amount is not null or new.plan_request_id is not null then
   raise exception 'plan_definition_required';
 elsif tg_op='UPDATE' then
   if new.id<>old.id or new.business_id<>old.business_id then raise exception 'debt_identity_immutable'; end if;
   select coalesce(sum(amount),0) into paid from public.debt_payments where debt_id=new.id and voided_at is null;
   if new.original_amount<=0 or new.original_amount<paid then raise exception 'original_below_paid'; end if;
   new.pending_amount:=new.original_amount-paid;
   new.status:=case when new.pending_amount=0 then 'settled'::public.debt_status when new.due_date<debt_private.business_date(new.business_id) then 'overdue'::public.debt_status else 'active'::public.debt_status end;
   new.settled_at:=case when new.pending_amount=0 then coalesce(old.settled_at,debt_private.business_date(new.business_id)) else null end;
 end if;
 return new;
end $$;

create or replace function debt_private.guard_installment() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype;
begin
 if tg_op='DELETE' then raise exception 'plan_history_immutable'; end if;
 select * into d from public.debts where id=new.debt_id for update;
 if not found or d.plan_definition is null then raise exception 'plan_not_found'; end if;
 if d.cancelled_at is not null then raise exception 'debt_cancelled'; end if;
 if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
 if tg_op='INSERT' then
   if pg_trigger_depth()<2 then raise exception 'installments_generated_from_plan_only'; end if;
 else
   if (to_jsonb(new)-array['due_date','notes','updated_at','mutation_request_id']) is distinct from (to_jsonb(old)-array['due_date','notes','updated_at','mutation_request_id']) then raise exception 'installment_financial_terms_immutable'; end if;
   if new.due_date<date '0001-01-01' or new.due_date>date '9999-12-31' then raise exception 'invalid_date'; end if;
   if d.mode='installments' and new.due_date is null then raise exception 'installment_date_required'; end if;
   if exists(select 1 from public.debt_installments i where i.debt_id=d.id and i.id<>new.id
      and ((i.installment_number<new.installment_number and i.due_date>=new.due_date) or (i.installment_number>new.installment_number and i.due_date<=new.due_date))) then raise exception 'dates_not_increasing'; end if;
   new.updated_at:=now();
 end if;
 return new;
end $$;

create or replace function public.enforce_debt_payment_balance() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; paid numeric; remaining numeric; payload jsonb; choice jsonb; key text;
begin
 select * into d from public.debts where id=case when tg_op='DELETE' then old.debt_id else new.debt_id end for update;
 if not found then
   if tg_op='DELETE' and pg_trigger_depth()>1 and old.allocation_rule is null then
     -- Legacy parent deletion was authorized/audited before the cascade. Plans
     -- cannot reach this path: their parent BEFORE DELETE guard always rejects.
     return old;
   end if;
   raise exception 'debt_not_found';
 end if;
 if d.cancelled_at is not null then raise exception 'debt_cancelled'; end if;
 if tg_op='DELETE' then
   if d.plan_definition is not null then raise exception 'plan_payment_delete_forbidden'; end if;
   return old;
 end if;
 if new.amount is null or new.amount<=0 or new.amount>9999999999.99 then raise exception 'invalid_debt_payment_amount'; end if;
 if tg_op='UPDATE' and new.debt_id<>old.debt_id then raise exception 'debt_payment_reassignment_forbidden'; end if;
 if d.plan_definition is not null then
   if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
   if tg_op='UPDATE' then
     if (to_jsonb(new)-array['voided_at','voided_on','voided_by','void_reason','void_request_id','void_request_payload','updated_at']) is distinct from
       (to_jsonb(old)-array['voided_at','voided_on','voided_by','void_reason','void_request_id','void_request_payload','updated_at']) then raise exception 'plan_payment_immutable'; end if;
     if old.voided_at is not null or new.voided_at is null or new.void_request_id is null or nullif(btrim(new.void_reason),'') is null then raise exception 'invalid_payment_void'; end if;
     if new.paid_at>debt_private.business_date(d.business_id) then raise exception 'void_before_payment'; end if;
     new.voided_at:=now(); new.voided_on:=debt_private.business_date(d.business_id); new.voided_by:=debt_private.actor_id();
     new.void_reason:=btrim(new.void_reason);
     payload:=jsonb_build_object('payment_id',new.id,'reason',new.void_reason);
     if new.void_request_payload is not null and new.void_request_payload is distinct from payload then raise exception 'request_payload_mismatch'; end if;
     new.void_request_payload:=payload;
   else
     if new.business_id is distinct from d.business_id or new.branch_id is distinct from d.branch_id or new.currency is distinct from d.currency then raise exception 'payment_scope_mismatch'; end if;
     if (select count(*) from public.debt_payments where debt_id=d.id)>=100000 then raise exception 'payment_history_limit'; end if;
     if new.request_id is null or new.voided_at is not null then raise exception 'invalid_payment_request'; end if;
     if new.allocation_rule is null or new.allocation_rule not in ('selected_installment','oldest_due') then raise exception 'allocation_rule_required'; end if;
     if new.allocation_rule='selected_installment' then
       select i.total_amount-coalesce((select sum(a.amount) from public.debt_payment_allocations a join public.debt_payments p on p.id=a.payment_id where a.installment_id=i.id and p.voided_at is null),0)
       into remaining from public.debt_installments i where i.id=new.selected_installment_id and i.debt_id=d.id;
       if not found then raise exception 'installment_not_found'; end if;
       if new.amount>remaining then raise exception 'amount_exceeds_installment_pending'; end if;
     elsif new.selected_installment_id is not null then raise exception 'invalid_allocation_choice'; end if;
     new.created_by:=debt_private.actor_id();
     new.payment_method:=btrim(new.payment_method); new.reference:=nullif(btrim(new.reference),''); new.notes:=nullif(btrim(new.notes),'');
     choice:=case when new.allocation_rule='oldest_due' then jsonb_build_object('rule','oldest_due') else jsonb_build_object('rule','selected_installment','installmentId',new.selected_installment_id) end;
     payload:=coalesce(new.request_payload,jsonb_strip_nulls(jsonb_build_object('amountCents',new.amount*100,'paidAt',new.paid_at,'paymentMethod',new.payment_method,
       'origin',new.origin,'reference',new.reference,'notes',new.notes,'allocation',choice)));
     perform debt_private.keys(payload,array['amountCents','paidAt','paymentMethod','origin','reference','notes','allocation']);
     foreach key in array array['paidAt','paymentMethod','origin','reference','notes'] loop
       if payload->key is not null and payload->key<>'null'::jsonb and jsonb_typeof(payload->key)<>'string' then raise exception 'invalid_payment_metadata'; end if;
     end loop;
     if debt_private.cents(payload->'amountCents')<>new.amount*100 or debt_private.civil_date(payload->>'paidAt') is distinct from new.paid_at
       or btrim(payload->>'paymentMethod') is distinct from new.payment_method or payload->>'origin' is distinct from new.origin
       or nullif(btrim(payload->>'reference'),'') is distinct from new.reference or nullif(btrim(payload->>'notes'),'') is distinct from new.notes
       or payload->'allocation' is distinct from choice then raise exception 'request_payload_mismatch'; end if;
     new.request_payload:=payload; new.created_at:=now();

   end if;
   if new.origin is null or new.origin not in ('manual','whatsapp','purchase','invoice','api','system')
     or nullif(btrim(new.payment_method),'') is null or length(new.payment_method)>80 or length(new.reference)>200 or length(new.notes)>1000
     or new.paid_at is null or new.paid_at<date '0001-01-01' or new.paid_at>debt_private.business_date(d.business_id) then raise exception 'invalid_payment_metadata'; end if;
 else
   if new.allocation_rule is not null or new.voided_at is not null then raise exception 'plan_required'; end if;
   new.business_id:=d.business_id; new.branch_id:=d.branch_id;
   if tg_op='INSERT' and auth.uid() is not null then new.created_by:=debt_private.actor_id(); end if;
 end if;
 select coalesce(sum(amount),0) into paid from public.debt_payments where debt_id=d.id and id<>new.id and voided_at is null;
 if paid+(case when new.voided_at is null then new.amount else 0 end)>coalesce(d.total_financed_amount,d.original_amount) then raise exception 'amount_exceeds_pending' using errcode='23514'; end if;
 return new;
end $$;

create or replace function debt_private.audit_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare d public.debts%rowtype; actor public.profiles%rowtype; actor_id uuid; role_name text; action_name text; row_data jsonb; log_id uuid;
 is_service boolean:=current_setting('role',true)='service_role' or session_user='service_role';
begin
 row_data:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 if tg_table_name='debts' then d:=case when tg_op='DELETE' then old else new end; else select * into d from public.debts where id=(row_data->>'debt_id')::uuid; end if;
 if d.id is null then return coalesce(new,old); end if;
 -- A legacy business-wide cascade also removes its activity feed. There is no
 -- remaining business FK under which a new child audit row could be stored.
 if tg_op='DELETE' and not exists(select 1 from public.businesses where id=d.business_id) then return coalesce(new,old); end if;
 actor_id:=debt_private.actor_id();
 -- INSERT created_by can be an explicit server-supplied creation actor. It is
 -- never evidence of who performed a later UPDATE/DELETE. Background service
 -- work with no bound actor is honestly system/NULL, including overdue cron.
 if actor_id is null and is_service and tg_op='INSERT' then actor_id:=(row_data->>'created_by')::uuid; end if;
 if actor_id is null and is_service then
   role_name:='system';
 else
   select * into actor from public.profiles where id=actor_id and active;
   select role::text into role_name from public.business_members where business_id=d.business_id and user_id=actor_id;
   if actor.id is null or role_name is null or role_name not in ('owner','admin','manager') then raise exception 'audit_actor_forbidden'; end if;
 end if;
 if tg_table_name='debts' then
   if tg_op='UPDATE' and (to_jsonb(new)-array['updated_at','plan_version']) is not distinct from (to_jsonb(old)-array['updated_at','plan_version']) then return new; end if;
   action_name:=case when tg_op='DELETE' then 'debt.deleted' when tg_op='INSERT' then case when d.plan_definition is null then 'debt.created' else 'debt.plan.created' end
     when new.cancelled_at is not null and old.cancelled_at is null then 'debt.cancelled'
     when new.status='settled' and old.status<>'settled' then 'debt.closed' when old.status='settled' and new.status<>'settled' then 'debt.reopened'
     when new.due_date is distinct from old.due_date then 'debt.due_date.updated' when new.notes is distinct from old.notes then 'debt.notes.updated' else 'debt.updated' end;
 elsif tg_table_name='debt_installments' then action_name:='debt.installment.updated';
 else action_name:=case when tg_op='INSERT' then 'debt.payment.registered' when tg_op='DELETE' then 'debt.payment.deleted'
     when new.voided_at is not null then 'debt.payment.voided' else 'debt.payment.updated' end;
 end if;
 if tg_op='UPDATE' and tg_table_name in ('debts','debt_installments') then
   if new.mutation_request_id is not null and new.mutation_request_id is distinct from old.mutation_request_id then
     if actor.id is null then raise exception 'audit_actor_required_for_request'; end if;
     insert into public.debt_plan_mutations(debt_id,business_id,branch_id,request_id,actor_id,operation,payload,result)
     values(d.id,d.business_id,d.branch_id,new.mutation_request_id,actor.id,
       case when tg_table_name='debts' then 'debt.notes' else 'installment.edit' end,
       case when tg_table_name='debts' then jsonb_build_object('notes',new.notes)
         else jsonb_build_object('installment_id',new.id,'due_date',new.due_date,'notes',new.notes) end,
       jsonb_build_object('ok',true,'debt_id',d.id,'version',d.plan_version,'pending_amount',d.pending_amount,
         'installment_id',case when tg_table_name='debt_installments' then new.id else null end));
   end if;
 end if;
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 values(d.business_id,actor.id,case when role_name='system' then 'Sistema' else actor.full_name end,role_name,action_name,'debts',d.id,action_name,
   jsonb_build_object('actor_kind',case when role_name='system' then 'system' else 'user' end,'debt_id',d.id,'branch_id',d.branch_id,'pending_amount',d.pending_amount,'version',d.plan_version,'status',d.status,
     'before',case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,'after',case when tg_op='DELETE' then null else to_jsonb(new) end,
     'allocations',case when tg_table_name='debt_payments' then (select jsonb_agg(to_jsonb(a)) from public.debt_payment_allocations a where a.payment_id=(row_data->>'id')::uuid) else null end,
     'related_payments',case when tg_table_name='debts' and tg_op='DELETE' then (select jsonb_agg(to_jsonb(p)) from public.debt_payments p where p.debt_id=d.id) else null end)) returning id into log_id;
 insert into debt_private.audit_scopes(activity_log_id,business_id,branch_id,debt_id) values(log_id,d.business_id,d.branch_id,d.id);
 return coalesce(new,old);
end $$;

create or replace function public.get_debt_operation_result(
 p_operation text,p_idempotency_key uuid,p_debt_id uuid default null,p_actor_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare actor uuid; ids uuid[]; debt_id uuid; payment_id uuid; d public.debts%rowtype;
begin
 actor:=debt_private.set_actor(p_actor_id);
 if p_idempotency_key is null or p_operation is null or p_operation not in ('create','pay','void','edit_installment','edit_notes','cancel')
   or (p_operation<>'create' and p_debt_id is null) then raise exception 'invalid_arguments'; end if;
 if p_operation='create' then
   select array_agg(x.id) into ids from (select id from public.debts where plan_request_id=p_idempotency_key and created_by=actor
     and (p_debt_id is null or id=p_debt_id) limit 2) x;
   if cardinality(ids)>1 then raise exception 'ambiguous_request'; end if;
   debt_id:=ids[1];
 elsif p_operation='cancel' then
   select x.id into debt_id from public.debts x where x.id=p_debt_id and x.cancel_request_id=p_idempotency_key and x.cancelled_by=actor;
 elsif p_operation='pay' then
   select p.debt_id,p.id into debt_id,payment_id from public.debt_payments p where p.debt_id=p_debt_id and p.request_id=p_idempotency_key and p.created_by=actor;
 elsif p_operation='void' then
   select p.debt_id,p.id into debt_id,payment_id from public.debt_payments p where p.debt_id=p_debt_id and p.void_request_id=p_idempotency_key and p.voided_by=actor;
 else
   select m.debt_id into debt_id from public.debt_plan_mutations m where m.debt_id=p_debt_id and m.request_id=p_idempotency_key and m.actor_id=actor
     and m.operation=case when p_operation='edit_installment' then 'installment.edit' else 'debt.notes' end;
 end if;
 if debt_id is null then return jsonb_build_object('ok',true,'found',false); end if;
 select * into d from public.debts where id=debt_id;
 if not found then return jsonb_build_object('ok',true,'found',false); end if;
 -- RLS already scopes authenticated reads; explicitly mirror it for the verified
 -- server actor because service_role bypasses table RLS by design.
 if not exists(select 1 from public.business_members m where m.business_id=d.business_id and m.user_id=actor
   and (m.role in ('owner','admin','manager','accountant') or exists (
     select 1 from public.branch_assignments a join public.branches b on b.id=a.branch_id
     where a.business_member_id=m.id and b.business_id=d.business_id and (d.branch_id is null or b.id=d.branch_id)))) then
   return jsonb_build_object('ok',true,'found',false);
 end if;
 return jsonb_strip_nulls(jsonb_build_object('ok',true,'found',true,'debt_id',d.id,'version',d.plan_version,'pending_amount',d.pending_amount,'payment_id',payment_id));
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;

create function public.cancel_debt_plan_record(
 p_debt_id uuid,p_expected_version bigint,p_reason text,p_idempotency_key uuid,p_actor_id uuid default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare d public.debts%rowtype; actor uuid;
begin
 actor:=debt_private.set_actor(p_actor_id);
 if p_debt_id is null or p_expected_version is null or p_expected_version<0 or p_idempotency_key is null
   or nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'invalid_arguments'; end if;
 select * into d from public.debts where id=p_debt_id for update;
 if not found then raise exception 'debt_not_found'; end if;
 if d.plan_definition is null then raise exception 'plan_required'; end if;
 if not debt_private.can_write(d.business_id,d.branch_id) then raise exception 'permission_denied' using errcode='42501'; end if;
 if d.cancel_request_id=p_idempotency_key then
   if d.cancel_reason is distinct from btrim(p_reason) or d.cancelled_by is distinct from actor then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('ok',true,'debt_id',d.id,'version',d.plan_version,'pending_amount',d.pending_amount,'idempotent',true);
 end if;
 if d.plan_version<>p_expected_version then raise exception 'stale_version'; end if;
 if d.cancelled_at is not null then raise exception 'debt_cancelled'; end if;
 update public.debts set cancelled_at=now(),cancel_reason=btrim(p_reason),cancel_request_id=p_idempotency_key where id=d.id returning * into d;
 return jsonb_build_object('ok',true,'debt_id',d.id,'version',d.plan_version,'pending_amount',d.pending_amount);
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;
revoke all on function public.cancel_debt_plan_record(uuid,bigint,text,uuid,uuid) from public,anon;
grant execute on function public.cancel_debt_plan_record(uuid,bigint,text,uuid,uuid) to authenticated,service_role;

