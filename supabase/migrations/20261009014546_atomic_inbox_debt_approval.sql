-- Inbox approval is a single transaction: lock the reviewed source, bind the
-- canonical domain payload to that source, write the ledger and mark approval.
-- No service-role client, auth change or additional membership privilege needed.
create function debt_private.assert_inbox_plan(p_input jsonb,p_plan jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare f jsonb; item jsonb; component jsonb; k text; idx integer:=0; n integer;
begin
 perform debt_private.keys(p_input,array['mode','currency','originalAmountCents','financing','components','interestRate','dueDate','installmentCount','schedule']);
 perform debt_private.validate_plan(p_plan);
 if p_input->'mode' is distinct from p_plan->'mode' or p_input->'currency' is distinct from p_plan->'currency'
 or p_input->'originalAmountCents' is distinct from p_plan->'originalAmountCents'
 or coalesce(p_input->'interestRate','null'::jsonb) is distinct from p_plan->'interestRate' then raise exception 'debt_review_required'; end if;
 f:=p_input->'financing';
 perform debt_private.keys(f,array['totalFinancedCents','installmentAmountCents','confirmedBalance']);
 n:=(p_plan->>'installmentCount')::integer;
 if not (f ? 'totalFinancedCents' or f ? 'installmentAmountCents' or f ? 'confirmedBalance')
 or (f ? 'totalFinancedCents' and f->'totalFinancedCents' is distinct from p_plan->'totalFinancedCents')
 or (f ? 'installmentAmountCents' and debt_private.cents(f->'installmentAmountCents')*n<>debt_private.cents(p_plan->'totalFinancedCents'))
 or coalesce(f->'confirmedBalance','null'::jsonb) is distinct from p_plan->'confirmedBalance'
 or p_plan->>'amountSource' is distinct from (case when f ? 'totalFinancedCents' then 'explicit_total' when f ? 'installmentAmountCents' then 'explicit_installment' else 'confirmed_balance' end)
 then raise exception 'debt_review_required'; end if;
 if p_input->>'mode'='single' then
   if p_input ? 'schedule' or p_input ? 'installmentCount'
   or coalesce(p_input->'dueDate','null'::jsonb) is distinct from p_plan#>'{installments,0,dueDate}' then raise exception 'debt_review_required'; end if;
 else
   if p_input ? 'dueDate' or p_input->'installmentCount' is distinct from p_plan->'installmentCount'
   or p_input#>'{schedule,periodicity}' is distinct from p_plan->'periodicity' then raise exception 'debt_review_required'; end if;
   if p_plan->>'periodicity'='custom' then
     perform debt_private.keys(p_input->'schedule',array['periodicity','dueDates']);
     if jsonb_typeof(p_input#>'{schedule,dueDates}') is distinct from 'array'
     or jsonb_array_length(p_input#>'{schedule,dueDates}')<>n then raise exception 'debt_review_required'; end if;
   else
     perform debt_private.keys(p_input->'schedule',array['periodicity','firstDueDate']);
     if p_input#>'{schedule,firstDueDate}' is distinct from p_plan#>'{installments,0,dueDate}' then raise exception 'debt_review_required'; end if;
   end if;
 end if;
 if p_input ? 'components' and (jsonb_typeof(p_input->'components') is distinct from 'array' or jsonb_array_length(p_input->'components')<>n) then raise exception 'debt_review_required'; end if;
 for item in select value from jsonb_array_elements(p_plan->'installments') loop
   if p_plan->>'periodicity'='custom' and p_input#>array['schedule','dueDates',idx::text] is distinct from item->'dueDate' then raise exception 'debt_review_required'; end if;
   component:=coalesce(p_input->'components'->idx,'{}'::jsonb);
   perform debt_private.keys(component,array['capitalAmountCents','interestAmountCents','feesAmountCents']);
   foreach k in array array['capitalAmountCents','interestAmountCents','feesAmountCents'] loop
     if coalesce(component->k,'null'::jsonb) is distinct from item->k then raise exception 'debt_review_required'; end if;
   end loop;
   idx:=idx+1;
 end loop;
end $$;
revoke all on function debt_private.assert_inbox_plan(jsonb,jsonb) from public,anon;
grant execute on function debt_private.assert_inbox_plan(jsonb,jsonb) to authenticated;

create function public.approve_debt_extraction_atomic(
 p_extraction_id uuid,p_expected_fields jsonb,p_expected_message_id uuid,
 p_operation text,p_payload jsonb,p_expected_version bigint default null
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype; d public.debts%rowtype;
 actor uuid; branch uuid; raw jsonb; canonical jsonb; result jsonb; target text; target_id uuid; affected integer;
begin
 actor:=debt_private.set_actor(null);
 select * into e from public.ai_extractions where id=p_extraction_id for update;
 if not found then raise exception 'extraction_not_found'; end if;
 if e.message_id is distinct from p_expected_message_id or e.fields is distinct from p_expected_fields then raise exception 'debt_review_required'; end if;
 select * into m from public.whatsapp_messages where id=e.message_id for update;
 if not found or (e.business_id is not null and e.business_id<>m.business_id) then raise exception 'source_message_not_found'; end if;
 if e.branch_id is not null and m.branch_id is not null and e.branch_id<>m.branch_id then raise exception 'branch_mismatch'; end if;
 branch:=coalesce(e.branch_id,m.branch_id);
 if e.status not in ('pending','needs_review','approved') then raise exception 'extraction_not_pending'; end if;
 if e.status='approved' and e.approved_by is distinct from actor then raise exception 'idempotency_conflict'; end if;
 if not exists(select 1 from public.business_modules where business_id=m.business_id and module_key='inbox_ai' and enabled)
 or not exists(select 1 from public.business_modules where business_id=m.business_id and module_key='debts' and enabled) then raise exception 'module_disabled'; end if;
 -- Role/active-profile checks are also repeated by the canonical financial RPC.
 if not debt_private.can_write(m.business_id,branch) then raise exception 'permission_denied'; end if;
 if p_operation='create' and e.type='debt_created' then
   perform debt_private.keys(e.fields,array['planRequest']); raw:=e.fields->'planRequest';
   perform debt_private.keys(raw,array['branchId','creditor','creditorType','takenAt','concept','category','reference','notes','expectedPaymentMethod','planInput']);
   if raw ? 'branchId' then
     if branch is not null and branch is distinct from (raw->>'branchId')::uuid then raise exception 'branch_mismatch'; end if;
     branch:=(raw->>'branchId')::uuid;
   end if;
   if branch is null then raise exception 'branch_required'; end if;
   perform debt_private.assert_inbox_plan(raw->'planInput',p_payload->'plan');
   canonical:=jsonb_strip_nulls(jsonb_build_object('business_id',m.business_id,'branch_id',branch,'creditor',btrim(raw->>'creditor'),'creditor_type',raw->>'creditorType','taken_at',raw->>'takenAt','concept',btrim(raw->>'concept'),'category',raw->>'category','reference',btrim(raw->>'reference'),'notes',btrim(raw->>'notes'),'expected_payment_method',btrim(raw->>'expectedPaymentMethod'),'origin','whatsapp'))||jsonb_build_object('plan',p_payload->'plan');
   if p_payload is distinct from canonical then raise exception 'debt_review_required'; end if;
   result:=public.create_debt_installment_plan(canonical,e.id);
   target:='debts'; target_id:=(result->>'debt_id')::uuid;
 elsif p_operation='pay' and e.type='debt_payment' then
   perform debt_private.keys(e.fields,array['paymentRequest']); raw:=e.fields->'paymentRequest';
   perform debt_private.keys(raw,array['debtId','expectedVersion','amountCents','paidAt','paymentMethod','allocation','reference','notes']);
   select * into d from public.debts where id=(raw->>'debtId')::uuid and business_id=m.business_id for update;
   if not found then raise exception 'debt_not_found'; end if;
   if branch is not null and branch is distinct from d.branch_id then raise exception 'branch_mismatch'; end if;
   if p_expected_version is null or jsonb_typeof(raw->'expectedVersion') is distinct from 'number' or p_expected_version::numeric is distinct from (raw->>'expectedVersion')::numeric then raise exception 'debt_review_required'; end if;
   canonical:=jsonb_strip_nulls(jsonb_build_object('amountCents',raw->'amountCents','paidAt',raw->>'paidAt','paymentMethod',btrim(raw->>'paymentMethod'),'allocation',raw->'allocation','reference',btrim(raw->>'reference'),'notes',btrim(raw->>'notes'),'origin','whatsapp'));
   if p_payload is distinct from jsonb_build_object('debt_id',d.id,'payment',canonical) then raise exception 'debt_review_required'; end if;
   result:=public.register_debt_plan_payment(d.id,p_expected_version,canonical,e.id);
   target:='debt_payments'; target_id:=(result->>'payment_id')::uuid;
 else raise exception 'unsupported_debt_extraction'; end if;
 if e.status='approved' and (e.target_entity is distinct from target or e.target_record_id is distinct from target_id) then raise exception 'idempotency_conflict'; end if;
 if result->'ok' is distinct from 'true'::jsonb then raise exception '%',coalesce(result->>'error','debt_rejected'); end if;
 update public.ai_extractions set status='approved',approved_by=actor,approved_at=coalesce(approved_at,now()),target_entity=target,target_record_id=target_id where id=e.id;
 get diagnostics affected=row_count;
 if affected<>1 then raise exception 'inbox_status_write_failed'; end if;
 return result||jsonb_build_object('target_entity',target,'target_record_id',target_id);
exception when others then return jsonb_build_object('ok',false,'error',sqlerrm); end $$;
revoke all on function public.approve_debt_extraction_atomic(uuid,jsonb,uuid,text,jsonb,bigint) from public,anon,service_role;
grant execute on function public.approve_debt_extraction_atomic(uuid,jsonb,uuid,text,jsonb,bigint) to authenticated;

-- Preserve the exact reviewed proposal once it has an audited financial result.
-- Other Inbox modules keep their existing edit policy.
create function debt_private.freeze_approved_extraction() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.type in ('debt_created','debt_payment') and old.status='approved' then
   if row(new.message_id,new.business_id,new.branch_id,new.type,new.fields,new.status,new.approved_by,new.approved_at,new.target_entity,new.target_record_id)
      is distinct from row(old.message_id,old.business_id,old.branch_id,old.type,old.fields,old.status,old.approved_by,old.approved_at,old.target_entity,old.target_record_id) then
     raise exception 'approved_debt_extraction_immutable';
   end if;
 end if;
 return new;
end $$;
revoke all on function debt_private.freeze_approved_extraction() from public,anon,authenticated,service_role;
create trigger guard_approved_debt_extraction before update on public.ai_extractions
for each row execute function debt_private.freeze_approved_extraction();
