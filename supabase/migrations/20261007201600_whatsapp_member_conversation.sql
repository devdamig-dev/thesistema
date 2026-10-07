-- Explicit owner/admin enrollment; neither a chat nor its participants gain additional module/branch permissions.
create or replace function public.set_whatsapp_member_conversation(
 p_business_id uuid, p_actor_id uuid, p_member_id uuid, p_branch_id uuid, p_enabled boolean, p_phone text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
 actor_role text;
 target_user uuid;
 target_role text;
 target_name text;
 existing_phone text;
 conversation_id uuid;
begin
 if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
 select m.role::text into actor_role from public.business_members m join public.profiles p on p.id=m.user_id
  where m.user_id=p_actor_id and m.business_id=p_business_id and m.role::text in ('owner','admin') and p.active=true;
 if not found then raise exception 'permission_denied'; end if;
 if not exists(select 1 from public.whatsapp_integrations where business_id=p_business_id and status='connected'
  and (token_expires_at is null or token_expires_at>now())) then raise exception 'whatsapp_not_connected'; end if;
 if p_phone is null or p_phone !~ '^[1-9][0-9]{7,14}$' or p_enabled is null then raise exception 'invalid_phone'; end if;
 select m.user_id,m.role::text,p.full_name,p.phone into target_user,target_role,target_name,existing_phone
  from public.business_members m join public.profiles p on p.id=m.user_id
  where m.id=p_member_id and m.business_id=p_business_id and p.active=true for update of p;
 if not found then raise exception 'member_not_found'; end if;
 if p_branch_id is not null then
  if not exists(select 1 from public.branches where id=p_branch_id and business_id=p_business_id) then raise exception 'branch_not_authorized'; end if;
  if target_role not in ('owner','admin','manager','accountant') and not exists(select 1 from public.branch_assignments where business_member_id=p_member_id and branch_id=p_branch_id) then raise exception 'branch_not_authorized'; end if;
 end if;
 if nullif(trim(existing_phone),'') is not null and regexp_replace(existing_phone,'[^0-9]','','g')<>p_phone then raise exception 'profile_phone_change_requires_review'; end if;
 -- Advisory lock serializes enrollment of a phone by two admins in different businesses.
 perform pg_advisory_xact_lock(hashtextextended('whatsapp-member-phone:'||p_phone,0));
 if exists(select 1 from public.profiles where id<>target_user and active=true and regexp_replace(coalesce(phone,''),'[^0-9]','','g')=p_phone) then raise exception 'phone_ambiguous'; end if;
 if nullif(trim(existing_phone),'') is null then
  if exists(select 1 from public.business_members where user_id=target_user and business_id<>p_business_id) then raise exception 'profile_phone_change_requires_review'; end if;
  update public.profiles set phone=p_phone,updated_at=now() where id=target_user;
 end if;
 insert into public.whatsapp_authorized_conversations(business_id,branch_id,provider,provider_conversation_id,conversation_type,display_name,enabled,created_by)
  values(p_business_id,p_branch_id,'meta',p_phone,'direct',target_name,p_enabled,p_actor_id)
  on conflict(business_id,provider,provider_conversation_id) do update
   set branch_id=excluded.branch_id,display_name=excluded.display_name,enabled=excluded.enabled,updated_at=now()
   where public.whatsapp_authorized_conversations.conversation_type='direct'
  returning id into conversation_id;
 if conversation_id is null then raise exception 'conversation_type_conflict'; end if;
 insert into public.activity_logs(business_id,actor_id,actor_role,action,target_type,target_id,summary,data)
  values(p_business_id,p_actor_id,actor_role,'whatsapp.conversation.updated','whatsapp_conversation',conversation_id,
   case when p_enabled then 'Conversación directa autorizada para una persona del equipo' else 'Conversación directa pausada' end,
   jsonb_build_object('member_id',p_member_id,'branch_id',p_branch_id,'enabled',p_enabled));
 return conversation_id;
end $$;
revoke all on function public.set_whatsapp_member_conversation(uuid,uuid,uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.set_whatsapp_member_conversation(uuid,uuid,uuid,uuid,boolean,text) to service_role;
