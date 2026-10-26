-- Groups are bound to the connected phone, business, branch and explicit team members.
alter table public.whatsapp_authorized_conversations
  add column group_phone_number_id text,
  add column group_activated_at timestamptz;
create unique index whatsapp_conversation_business_reference
  on public.whatsapp_authorized_conversations(id,business_id);
create unique index whatsapp_member_business_reference on public.business_members(id,business_id);

create table public.whatsapp_group_members (
  conversation_id uuid not null,
  business_id uuid not null,
  member_id uuid not null,
  primary key(conversation_id,member_id),
  foreign key(conversation_id,business_id) references public.whatsapp_authorized_conversations(id,business_id) on delete cascade,
  foreign key(member_id,business_id) references public.business_members(id,business_id) on delete cascade
);
create index whatsapp_group_members_member on public.whatsapp_group_members(member_id,business_id);
alter table public.whatsapp_group_members enable row level security;
revoke all on public.whatsapp_group_members from public,anon,authenticated;
grant select on public.whatsapp_group_members to authenticated;
grant select,insert,update,delete on public.whatsapp_group_members to service_role;
create policy "group members admin read" on public.whatsapp_group_members
  for select to authenticated using(public.is_admin_of_business(business_id));

-- Reserve a creation attempt before calling Meta. A lost response cannot create duplicates on retry.
create table public.whatsapp_group_creation_requests (
  id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  phone_number_id text not null,
  subject text not null check(length(subject) between 1 and 128),
  status text not null default 'requested' check(status in ('requested','submitted','unknown','failed')),
  created_at timestamptz not null default now()
);
create unique index whatsapp_group_creation_once on public.whatsapp_group_creation_requests(business_id,phone_number_id,subject)
  where status in ('requested','submitted','unknown');
create index whatsapp_group_creation_actor on public.whatsapp_group_creation_requests(actor_id);
alter table public.whatsapp_group_creation_requests enable row level security;
revoke all on public.whatsapp_group_creation_requests from public,anon,authenticated;
grant select,insert,update,delete on public.whatsapp_group_creation_requests to service_role;

create function public.set_whatsapp_group_conversation(
  p_business_id uuid, p_actor_id uuid, p_group_id text, p_phone_number_id text,
  p_name text, p_branch_id uuid, p_member_ids uuid[]
) returns uuid language plpgsql security invoker set search_path='' as $$
declare cid uuid; member_count integer; valid_count integer; target record;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=p_business_id and m.user_id=p_actor_id and m.role::text in ('owner','admin') and p.active)
    then raise exception 'permission_denied'; end if;
  perform 1 from public.whatsapp_integrations where business_id=p_business_id and phone_number_id=p_phone_number_id
    and status='connected' and (token_expires_at is null or token_expires_at>now()) for update;
  if not found then raise exception 'whatsapp_not_connected'; end if;
  if p_group_id is null or length(p_group_id) not between 8 and 512 or p_group_id !~ '^[A-Za-z0-9_=-]+$' or nullif(trim(p_name),'') is null or length(p_name)>128
    or p_branch_id is null or not exists(select 1 from public.branches where id=p_branch_id and business_id=p_business_id)
    then raise exception 'invalid_group'; end if;
  member_count := coalesce(array_length(p_member_ids,1),0);
  if member_count < 1 or member_count > 8 or member_count <> (select count(distinct value) from unnest(p_member_ids) value)
    then raise exception 'invalid_group_members'; end if;
  select count(*) into valid_count from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=p_business_id and m.id=any(p_member_ids) and p.active
    and regexp_replace(coalesce(p.phone,''),'[^0-9]','','g') ~ '^[1-9][0-9]{7,14}$'
    and (m.role::text in ('owner','admin','manager','accountant') or exists(
      select 1 from public.branch_assignments a where a.business_member_id=m.id and a.branch_id=p_branch_id));
  if valid_count <> member_count then raise exception 'group_member_not_authorized'; end if;
  for target in select p.id,p.phone from public.profiles p join public.business_members m on m.user_id=p.id
    where m.business_id=p_business_id and m.id=any(p_member_ids) loop
    if exists(select 1 from public.profiles p where p.active and p.id<>target.id
      and regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')=regexp_replace(target.phone,'[^0-9]','','g'))
      then raise exception 'phone_ambiguous'; end if;
  end loop;
  insert into public.whatsapp_authorized_conversations(business_id,branch_id,provider,provider_conversation_id,
    conversation_type,display_name,enabled,created_by,group_phone_number_id,group_activated_at)
    values(p_business_id,p_branch_id,'meta',p_group_id,'group',trim(p_name),true,p_actor_id,p_phone_number_id,clock_timestamp())
    on conflict(business_id,provider,provider_conversation_id) do update set branch_id=excluded.branch_id,
      display_name=excluded.display_name,enabled=true,group_phone_number_id=excluded.group_phone_number_id,
      group_activated_at=clock_timestamp(),updated_at=now()
      where public.whatsapp_authorized_conversations.conversation_type='group'
    returning id into cid;
  if cid is null then raise exception 'conversation_type_conflict'; end if;
  delete from public.whatsapp_group_members where conversation_id=cid and business_id=p_business_id;
  insert into public.whatsapp_group_members(conversation_id,business_id,member_id)
    select cid,p_business_id,value from unnest(p_member_ids) value;
  update public.whatsapp_agent_pending_operations set consumed_at=now()
    where business_id=p_business_id and conversation_id=cid and consumed_at is null;
  insert into public.activity_logs(business_id,actor_id,actor_role,action,target_type,target_id,summary,data)
    values(p_business_id,p_actor_id,'admin','whatsapp.group.authorized','whatsapp_conversation',cid,
      'Grupo oficial autorizado con integrantes y sucursal explícitos',jsonb_build_object('member_ids',p_member_ids,'branch_id',p_branch_id));
  return cid;
end $$;
revoke all on function public.set_whatsapp_group_conversation(uuid,uuid,text,text,text,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.set_whatsapp_group_conversation(uuid,uuid,text,text,text,uuid,uuid[]) to service_role;

create function public.pause_whatsapp_group(p_business_id uuid,p_actor_id uuid,p_conversation_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare cid uuid;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=p_business_id and m.user_id=p_actor_id and m.role::text in ('owner','admin') and p.active)
    then raise exception 'permission_denied'; end if;
  update public.whatsapp_authorized_conversations set enabled=false,updated_at=now()
    where id=p_conversation_id and business_id=p_business_id and conversation_type='group' returning id into cid;
  if cid is null then raise exception 'group_not_found'; end if;
  update public.whatsapp_agent_pending_operations set consumed_at=now()
    where business_id=p_business_id and conversation_id=cid and consumed_at is null;
  insert into public.activity_logs(business_id,actor_id,actor_role,action,target_type,target_id,summary)
    values(p_business_id,p_actor_id,'admin','whatsapp.group.paused','whatsapp_conversation',cid,'Procesamiento del grupo pausado');
  return cid;
end $$;
revoke all on function public.pause_whatsapp_group(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pause_whatsapp_group(uuid,uuid,uuid) to service_role;

-- Establish a missing team phone explicitly, without enabling any direct chat.
create function public.identify_whatsapp_group_member(p_business_id uuid,p_actor_id uuid,p_member_id uuid,p_phone text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare target_user uuid; existing_phone text;
begin
  if coalesce(auth.role(),'') <> 'service_role' then raise exception 'service_role_required'; end if;
  if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
    where m.business_id=p_business_id and m.user_id=p_actor_id and m.role::text in ('owner','admin') and p.active)
    then raise exception 'permission_denied'; end if;
  if p_phone is null or p_phone !~ '^[1-9][0-9]{7,14}$' then raise exception 'invalid_phone'; end if;
  select m.user_id,p.phone into target_user,existing_phone from public.business_members m join public.profiles p on p.id=m.user_id
    where m.id=p_member_id and m.business_id=p_business_id and p.active for update of p;
  if not found then raise exception 'member_not_found'; end if;
  if nullif(trim(existing_phone),'') is not null and regexp_replace(existing_phone,'[^0-9]','','g')<>p_phone
    then raise exception 'profile_phone_change_requires_review'; end if;
  perform pg_advisory_xact_lock(hashtextextended('whatsapp-member-phone:'||p_phone,0));
  if exists(select 1 from public.profiles where id<>target_user and active and regexp_replace(coalesce(phone,''),'[^0-9]','','g')=p_phone)
    then raise exception 'phone_ambiguous'; end if;
  if nullif(trim(existing_phone),'') is null then
    if exists(select 1 from public.business_members where user_id=target_user and business_id<>p_business_id)
      then raise exception 'profile_phone_change_requires_review'; end if;
    update public.profiles set phone=p_phone,updated_at=now() where id=target_user;
  end if;
  insert into public.activity_logs(business_id,actor_id,actor_role,action,target_type,target_id,summary)
    values(p_business_id,p_actor_id,'admin','whatsapp.group.member_identified','business_member',p_member_id,'Teléfono de integrante confirmado para configurar grupos');
  return p_member_id;
end $$;
revoke all on function public.identify_whatsapp_group_member(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.identify_whatsapp_group_member(uuid,uuid,uuid,text) to service_role;
