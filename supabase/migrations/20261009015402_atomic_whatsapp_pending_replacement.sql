-- Same server-owned table and authorization scope; no public access is added.
-- Replacing an operation and retiring its predecessors must be one transaction.
create function public.replace_whatsapp_agent_pending(
 p_business_id uuid,p_member_id uuid,p_conversation_id uuid,p_kind text,
 p_tool_name text,p_arguments jsonb,p_expires_at timestamptz
) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare new_id uuid; member_role text; conversation_branch uuid;
begin
 if current_user<>'service_role' then raise exception 'permission_denied' using errcode='42501'; end if;
 if p_business_id is null or p_member_id is null or p_conversation_id is null
 or p_kind not in ('clarification','confirmation') or p_kind is null
 or nullif(btrim(p_tool_name),'') is null or length(p_tool_name)>120
 or jsonb_typeof(p_arguments) is distinct from 'object'
 or p_expires_at is null or p_expires_at<=now() or p_expires_at>now()+interval '31 days' then raise exception 'invalid_pending_operation'; end if;
 select m.role::text into member_role from public.business_members m join public.profiles p on p.id=m.user_id
 where m.id=p_member_id and m.business_id=p_business_id and p.active;
 if not found then raise exception 'pending_actor_not_authorized'; end if;
 select branch_id into conversation_branch from public.whatsapp_authorized_conversations
 where id=p_conversation_id and business_id=p_business_id and enabled;
 if not found then raise exception 'pending_conversation_not_authorized'; end if;
 if conversation_branch is not null and member_role not in ('owner','admin','manager','accountant')
 and not exists(select 1 from public.branch_assignments where business_member_id=p_member_id and branch_id=conversation_branch)
 then raise exception 'pending_branch_not_authorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-pending:'||p_business_id::text||':'||p_member_id::text||':'||p_conversation_id::text,0));
 -- An uncertain financial result must not be replaced by a new operation ID.
 if exists(select 1 from public.whatsapp_agent_pending_operations
   where business_id=p_business_id and member_id=p_member_id and conversation_id=p_conversation_id and consumed_at is null
   and arguments->'__resultUncertain'='true'::jsonb
   and (tool_name is distinct from p_tool_name or (arguments-'__resultUncertain') is distinct from (p_arguments-'__resultUncertain')))
 then raise exception 'pending_recovery_required'; end if;
 update public.whatsapp_agent_pending_operations set consumed_at=now()
 where business_id=p_business_id and member_id=p_member_id and conversation_id=p_conversation_id and consumed_at is null;
 insert into public.whatsapp_agent_pending_operations(business_id,member_id,conversation_id,kind,tool_name,arguments,expires_at)
 values(p_business_id,p_member_id,p_conversation_id,p_kind,p_tool_name,p_arguments,p_expires_at) returning id into new_id;
 return jsonb_build_object('ok',true,'id',new_id);
end $$;
revoke all on function public.replace_whatsapp_agent_pending(uuid,uuid,uuid,text,text,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.replace_whatsapp_agent_pending(uuid,uuid,uuid,text,text,jsonb,timestamptz) to service_role;

-- Preserve historical duplicates for review, but prevent new ones even if an old
-- server build attempts the former raw INSERT. No production cleanup is performed.
create function public.guard_whatsapp_pending_scope() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.consumed_at is not null then return new; end if;
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-pending:'||new.business_id::text||':'||new.member_id::text||':'||coalesce(new.conversation_id::text,'none'),0));
 if exists(select 1 from public.whatsapp_agent_pending_operations p
   where p.business_id=new.business_id and p.member_id=new.member_id
     and p.conversation_id is not distinct from new.conversation_id
     and p.consumed_at is null and p.id<>new.id)
 then raise exception 'pending_scope_conflict'; end if;
 return new;
end $$;
revoke all on function public.guard_whatsapp_pending_scope() from public,anon,authenticated;
grant execute on function public.guard_whatsapp_pending_scope() to service_role;
create trigger whatsapp_pending_scope_guard before insert or update on public.whatsapp_agent_pending_operations
for each row execute function public.guard_whatsapp_pending_scope();
