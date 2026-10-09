-- Persist a recovery reference before a WhatsApp debt RPC can leave this process.
-- This changes only the existing server-owned pending row. Financial writes and
-- idempotent receipts remain in the debt RPCs; no membership grants are added.
create function public.claim_debt_pending_execution(
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
 or pending.tool_name not in ('debts.createPlan','debts.registerPlanPayment','debts.voidPlanPayment','debts.editPlan')
 or pending.expires_at<=clock_timestamp() or jsonb_typeof(pending.arguments) is distinct from 'object'
 or jsonb_typeof(pending.arguments->'requestId') is distinct from 'string'
 or (pending.arguments->>'requestId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or jsonb_typeof(pending.arguments->'branchId') is distinct from 'string'
 or (pending.arguments->>'branchId') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
 or (pending.arguments ? '__resultUncertain' and jsonb_typeof(pending.arguments->'__resultUncertain') is distinct from 'boolean')
 or coalesce(pending.arguments->'__resultUncertain'='true'::jsonb,false) is distinct from p_recovery
 then return false; end if;
 -- Check live authorization after waiting for the pending lock. The debt RPC
 -- repeats actor permissions at execution time. Write roles are business-wide.
 if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
   where m.id=p_member_id and m.business_id=p_business_id and p.active and m.role in ('owner','admin','manager'))
 or not exists(select 1 from public.business_modules where business_id=p_business_id and module_key='debts' and enabled)
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

create function public.cancel_debt_pending_execution(
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
 -- Cancellation also covers unprepared clarifications and the historical create
 -- alias. Neither path is executable through claim_debt_pending_execution.
 if not found or pending.tool_name not in ('debts.create','debts.createPlan','debts.registerPlanPayment','debts.voidPlanPayment','debts.editPlan')
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
revoke all on function public.claim_debt_pending_execution(uuid,uuid,uuid,uuid,boolean),public.cancel_debt_pending_execution(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_debt_pending_execution(uuid,uuid,uuid,uuid,boolean),public.cancel_debt_pending_execution(uuid,uuid,uuid,uuid) to service_role;
