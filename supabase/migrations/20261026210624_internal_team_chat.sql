-- Separate transport; existing WhatsApp integrations are not changed.
create table public.chat_rooms (
 id uuid primary key references public.whatsapp_authorized_conversations(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,
 branch_id uuid not null references public.branches(id) on delete restrict,
 name text not null check(length(trim(name)) between 1 and 80), archived boolean not null default false,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 agent_request_id uuid, agent_busy_until timestamptz, unique(id,business_id)
);
create index chat_rooms_business_idx on public.chat_rooms(business_id,created_at);
create index chat_rooms_branch_idx on public.chat_rooms(branch_id);
create index chat_rooms_creator_idx on public.chat_rooms(created_by);
create table public.chat_room_members (
 room_id uuid not null, business_id uuid not null, member_id uuid not null,
 role_snapshot public.role_key not null, joined_at timestamptz not null default now(), last_read_at timestamptz,
 primary key(room_id,member_id),
 foreign key(room_id,business_id) references public.chat_rooms(id,business_id) on delete cascade,
 foreign key(member_id,business_id) references public.business_members(id,business_id) on delete cascade
);
create index chat_room_members_member_idx on public.chat_room_members(member_id,business_id,room_id);
create index chat_room_members_room_business_idx on public.chat_room_members(room_id,business_id);
create table public.chat_attachments (
 id uuid primary key, business_id uuid not null, room_id uuid not null, member_id uuid not null,
 filename text not null, mime text not null, size integer not null check(size between 1 and 20971520),
 storage_path text not null unique, ready boolean not null default false, created_at timestamptz not null default now(),
 foreign key(room_id,business_id) references public.chat_rooms(id,business_id) on delete cascade,
 foreign key(member_id,business_id) references public.business_members(id,business_id) on delete cascade
);
create index chat_attachments_room_idx on public.chat_attachments(room_id,business_id);
create index chat_attachments_member_idx on public.chat_attachments(member_id,business_id);
create table public.chat_messages (
 id uuid primary key, business_id uuid not null, room_id uuid not null, member_id uuid not null,
 author_name text not null, body text not null check(length(body)<=10000),
 attachment_id uuid unique references public.chat_attachments(id), ask_ai boolean not null default false,
 ai_status text not null default 'none' check(ai_status in ('none','queued','processing','done','failed')),
 ai_text text, ai_result text, ai_tool text, pending_id uuid, created_at timestamptz not null default now(),
 check(length(trim(body))>0 or attachment_id is not null),
 foreign key(room_id,business_id) references public.chat_rooms(id,business_id) on delete cascade,
 foreign key(member_id,business_id) references public.business_members(id,business_id) on delete cascade
);
create index chat_messages_room_time_idx on public.chat_messages(room_id,business_id,created_at desc,id);
create index chat_messages_member_idx on public.chat_messages(member_id,business_id);
create table public.chat_push_config (id boolean primary key default true check(id), public_key text not null, private_key text not null);
create table public.chat_push_subscriptions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 endpoint text not null unique, p256dh text not null, auth text not null, created_at timestamptz not null default now()
);
create index chat_push_user_idx on public.chat_push_subscriptions(user_id);
-- Access is through authenticated tenant-scoped server endpoints; no browser grants.
alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
alter table public.chat_attachments enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_push_config enable row level security;
alter table public.chat_push_subscriptions enable row level security;
revoke all on public.chat_rooms,public.chat_room_members,public.chat_attachments,public.chat_messages,public.chat_push_config,public.chat_push_subscriptions from public,anon,authenticated;
grant select,insert,update,delete on public.chat_rooms,public.chat_room_members,public.chat_attachments,public.chat_messages,public.chat_push_config,public.chat_push_subscriptions to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('team-chat','team-chat',false,20971520,array['image/jpeg','image/png','image/webp','application/pdf','audio/webm','audio/ogg','audio/mpeg','audio/mp4','audio/wav']) on conflict(id) do nothing;

create function public.chat_access(p_user uuid,p_business uuid,p_room uuid) returns uuid
language sql stable security invoker set search_path='' as $$
 select m.id from public.chat_room_members cm
 join public.chat_rooms r on r.id=cm.room_id and r.business_id=cm.business_id
 join public.business_members m on m.id=cm.member_id and m.business_id=cm.business_id
 join public.profiles p on p.id=m.user_id
 where cm.room_id=p_room and cm.business_id=p_business and m.user_id=p_user and p.active
 and m.role=cm.role_snapshot and not r.archived
 and (m.role::text in ('owner','admin','manager','accountant') or exists(select 1 from public.branch_assignments ba where ba.business_member_id=m.id and ba.branch_id=r.branch_id))
$$;
revoke all on function public.chat_access(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.chat_access(uuid,uuid,uuid) to service_role;

create function public.configure_chat_room(p_business uuid,p_user uuid,p_room uuid,p_branch uuid,p_name text,p_members uuid[],p_archived boolean default false)
returns uuid language plpgsql security invoker set search_path='' as $$
declare v_actor uuid; v_role text; v_count integer; v_room public.chat_rooms%rowtype;
begin
 if current_user<>'service_role' then raise exception 'service_role_required'; end if;
 select m.id,m.role::text into v_actor,v_role from public.business_members m join public.profiles p on p.id=m.user_id
 where m.business_id=p_business and m.user_id=p_user and m.role::text in ('owner','admin') and p.active;
 if v_actor is null then raise exception 'chat_admin_required'; end if;
 if p_room is null or p_archived is null or length(trim(p_name)) not between 1 and 80 or p_name is null
 or cardinality(p_members) not between 1 and 50 or p_members is null or not(v_actor=any(p_members)) then raise exception 'invalid_chat_configuration'; end if;
 if not exists(select 1 from public.branches where id=p_branch and business_id=p_business) then raise exception 'branch_not_allowed'; end if;
 select count(distinct m.id) into v_count from public.business_members m join public.profiles p on p.id=m.user_id
 where m.id=any(p_members) and m.business_id=p_business and p.active and
 (m.role::text in ('owner','admin','manager','accountant') or exists(select 1 from public.branch_assignments b where b.business_member_id=m.id and b.branch_id=p_branch));
 if v_count<>cardinality(p_members) then raise exception 'chat_member_not_allowed'; end if;
 perform pg_advisory_xact_lock(hashtextextended('chat-room:'||p_room::text,0));
 select * into v_room from public.chat_rooms where id=p_room for update;
 if found then
  if v_room.business_id<>p_business or v_room.branch_id<>p_branch then raise exception 'chat_scope_mismatch'; end if;
  if v_room.agent_busy_until>now() then raise exception 'chat_agent_busy'; end if;
 else
  insert into public.whatsapp_authorized_conversations(id,business_id,branch_id,provider,provider_conversation_id,conversation_type,display_name,created_by)
   values(p_room,p_business,p_branch,'internal',p_room::text,'group',trim(p_name),p_user);
  insert into public.chat_rooms(id,business_id,branch_id,name,created_by) values(p_room,p_business,p_branch,trim(p_name),p_user);
 end if;
 update public.chat_rooms set name=trim(p_name),archived=p_archived where id=p_room;
 update public.whatsapp_authorized_conversations set display_name=trim(p_name),enabled=not p_archived,updated_at=now() where id=p_room and provider='internal';
 delete from public.chat_room_members where room_id=p_room and not(member_id=any(p_members));
 insert into public.chat_room_members(room_id,business_id,member_id,role_snapshot)
 select p_room,p_business,m.id,m.role from public.business_members m where m.id=any(p_members) and m.business_id=p_business
 on conflict(room_id,member_id) do update set role_snapshot=excluded.role_snapshot,
 joined_at=case when chat_room_members.role_snapshot<>excluded.role_snapshot then now() else chat_room_members.joined_at end;
 update public.whatsapp_agent_pending_operations set consumed_at=now() where conversation_id=p_room and consumed_at is null;
 insert into public.activity_logs(business_id,actor_id,actor_role,action,target_type,target_id,summary,data)
 values(p_business,p_user,v_role,'chat.room.configured','chat_room',p_room,'Grupo interno y participantes actualizados',jsonb_build_object('member_ids',p_members,'archived',p_archived));
 return p_room;
end $$;
revoke all on function public.configure_chat_room(uuid,uuid,uuid,uuid,text,uuid[],boolean) from public,anon,authenticated;
grant execute on function public.configure_chat_room(uuid,uuid,uuid,uuid,text,uuid[],boolean) to service_role;

create function public.send_chat_message(p_business uuid,p_user uuid,p_room uuid,p_id uuid,p_body text,p_attachment uuid,p_ask_ai boolean,p_pending uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_member uuid; v_existing public.chat_messages%rowtype; v_name text;
begin
 if current_user<>'service_role' then raise exception 'service_role_required'; end if;
 perform 1 from public.chat_rooms where id=p_room and business_id=p_business for update;
 v_member:=public.chat_access(p_user,p_business,p_room);
 if v_member is null then raise exception 'chat_access_denied'; end if;
 if p_id is null or p_body is null or p_ask_ai is null or length(p_body)>10000 or (length(trim(p_body))=0 and p_attachment is null) then raise exception 'invalid_chat_message'; end if;
 select * into v_existing from public.chat_messages where id=p_id;
 if found then
  if v_existing.member_id<>v_member or v_existing.room_id<>p_room or v_existing.body<>trim(p_body) or v_existing.attachment_id is distinct from p_attachment or v_existing.ask_ai<>p_ask_ai then raise exception 'chat_request_conflict'; end if;
  return jsonb_build_object('id',p_id,'existing',true);
 end if;
 if p_attachment is not null and not exists(select 1 from public.chat_attachments where id=p_attachment and room_id=p_room and business_id=p_business and member_id=v_member and ready) then raise exception 'chat_attachment_unavailable'; end if;
 if p_pending is not null and not exists(select 1 from public.whatsapp_agent_pending_operations where id=p_pending and business_id=p_business and member_id=v_member and conversation_id=p_room and consumed_at is null and (expires_at>now() or trim(p_body) ~* '^(no|cancelar|cancel[aá]|cancelo|no confirmar)[.!\s]*$')) then raise exception 'chat_confirmation_expired'; end if;
 select full_name into v_name from public.profiles where id=p_user;
 insert into public.chat_messages(id,business_id,room_id,member_id,author_name,body,attachment_id,ask_ai,ai_status,pending_id)
 values(p_id,p_business,p_room,v_member,v_name,trim(p_body),p_attachment,p_ask_ai,case when p_ask_ai then 'queued' else 'none' end,p_pending);
 return jsonb_build_object('id',p_id,'existing',false);
end $$;
revoke all on function public.send_chat_message(uuid,uuid,uuid,uuid,text,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.send_chat_message(uuid,uuid,uuid,uuid,text,uuid,boolean,uuid) to service_role;

create function public.claim_chat_ai(p_business uuid,p_user uuid,p_room uuid,p_id uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare v_member uuid; v_room public.chat_rooms%rowtype; v_message public.chat_messages%rowtype;
begin
 if current_user<>'service_role' then raise exception 'service_role_required'; end if;
 select * into v_room from public.chat_rooms where id=p_room and business_id=p_business for update;
 v_member:=public.chat_access(p_user,p_business,p_room);
 if v_member is null then raise exception 'chat_access_denied'; end if;
 select * into v_message from public.chat_messages where id=p_id and room_id=p_room and member_id=v_member for update;
 if not found or v_message.ai_status<>'queued' then return false; end if;
 if v_room.agent_busy_until>now() then return false; end if;
 update public.chat_rooms set agent_request_id=p_id,agent_busy_until=now()+interval '2 minutes' where id=p_room;
 update public.chat_messages set ai_status='processing' where id=p_id;
 return true;
end $$;
revoke all on function public.claim_chat_ai(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_chat_ai(uuid,uuid,uuid,uuid) to service_role;

create function public.finish_chat_ai(p_business uuid,p_room uuid,p_id uuid,p_text text,p_result text,p_tool text,p_pending uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise exception 'service_role_required'; end if;
 perform 1 from public.chat_rooms where id=p_room and business_id=p_business and agent_request_id=p_id for update;
 if not found then return false; end if;
 update public.chat_messages set ai_status='done',ai_text=left(p_text,16000),ai_result=p_result,ai_tool=p_tool,pending_id=p_pending where id=p_id and room_id=p_room and business_id=p_business;
 update public.chat_rooms set agent_request_id=null,agent_busy_until=null where id=p_room;
 return true;
end $$;
revoke all on function public.finish_chat_ai(uuid,uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.finish_chat_ai(uuid,uuid,uuid,text,text,text,uuid) to service_role;
