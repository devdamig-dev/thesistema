-- Approving an expense extraction requires explicitly reviewed bookkeeping fields.
-- No status, date, branch or payment is inferred from a message.
create table expenses_private.inbox_receipts (
 extraction_id uuid primary key references public.ai_extractions(id) on delete restrict,
 message_id uuid not null references public.whatsapp_messages(id) on delete restrict,
 business_id uuid not null, branch_id uuid not null, actor_id uuid not null,
 expected_fields jsonb not null, review jsonb not null, result jsonb not null
);
revoke all on expenses_private.inbox_receipts from public,anon,authenticated,service_role;
create function expenses_private.approve_inbox(p_business uuid,p_actor uuid,p_extraction uuid,p_expected jsonb,p_review jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.ai_extractions%rowtype; m public.whatsapp_messages%rowtype; receipt expenses_private.inbox_receipts%rowtype;
 v_branch uuid; v_result jsonb; v_input jsonb;
begin
 if auth.uid() is null or p_actor is distinct from auth.uid() or current_setting('role',true)<>'authenticated' then raise exception 'expense_permission_denied'; end if;
 select * into e from public.ai_extractions where id=p_extraction for update;
 if not found or e.type<>'expense' then raise exception 'expense_not_found'; end if;
 select * into m from public.whatsapp_messages where id=e.message_id for share;
 if not found or m.business_id is distinct from p_business or (e.business_id is not null and e.business_id<>p_business) then raise exception 'expense_permission_denied'; end if;
 perform expenses_private.require_keys(p_review,array['branchId','name','category','amount','dueDate','status']);
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
 insert into expenses_private.inbox_receipts values(p_extraction,m.id,p_business,v_branch,p_actor,p_expected,p_review,v_result);
 return v_result;
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'expense_%' then sqlerrm else 'expense_invalid_input' end);
end $$;
revoke all on function expenses_private.approve_inbox(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function expenses_private.approve_inbox(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
create function public.approve_expense_extraction_atomic(p_business_id uuid,p_actor_id uuid,p_extraction_id uuid,p_expected_fields jsonb,p_review jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select expenses_private.approve_inbox(p_business_id,p_actor_id,p_extraction_id,p_expected_fields,p_review) $$;
revoke all on function public.approve_expense_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.approve_expense_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb) to authenticated;
