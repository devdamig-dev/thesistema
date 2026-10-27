-- Disposable fixtures: no external requests and all writes roll back.
begin;
create function pg_temp.chat_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
create function pg_temp.chat_throws(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement; exception when others then if position(expected in sqlerrm)>0 then return; end if; raise; end; raise exception 'Expected %, succeeded',expected; end $$;
insert into auth.users(id,email) values
('00000000-0000-4000-8000-000000009001','group-owner@example.invalid'),
('00000000-0000-4000-8000-000000009002','group-staff@example.invalid'),
('00000000-0000-4000-8000-000000009003','group-other@example.invalid');
update public.profiles set phone=case id
  when '00000000-0000-4000-8000-000000009001' then '5491111111111'
  when '00000000-0000-4000-8000-000000009002' then '5491122222222'
  else '5491133333333' end where id in ('00000000-0000-4000-8000-000000009001','00000000-0000-4000-8000-000000009002','00000000-0000-4000-8000-000000009003');
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000009000','Group fixture');
insert into public.businesses(id,organization_id,name) values
('00000000-0000-4000-8000-000000009010','00000000-0000-4000-8000-000000009000','Business one'),
('00000000-0000-4000-8000-000000009020','00000000-0000-4000-8000-000000009000','Business two');
insert into public.branches(id,business_id,name) values
('00000000-0000-4000-8000-000000009011','00000000-0000-4000-8000-000000009010','Main'),
('00000000-0000-4000-8000-000000009021','00000000-0000-4000-8000-000000009020','Other');
insert into public.business_members(id,business_id,user_id,role) values
('00000000-0000-4000-8000-000000009101','00000000-0000-4000-8000-000000009010','00000000-0000-4000-8000-000000009001','owner'),
('00000000-0000-4000-8000-000000009102','00000000-0000-4000-8000-000000009010','00000000-0000-4000-8000-000000009002','waiter'),
('00000000-0000-4000-8000-000000009103','00000000-0000-4000-8000-000000009020','00000000-0000-4000-8000-000000009003','owner');
select pg_temp.chat_assert(not has_table_privilege('authenticated','public.chat_messages','select'),'browser cannot bypass room authorization');
select pg_temp.chat_assert(not has_table_privilege('anon','public.chat_push_config','select'),'VAPID private key never public');
select pg_temp.chat_assert(not has_function_privilege('authenticated','public.configure_chat_room(uuid,uuid,uuid,uuid,text,uuid[],boolean)','execute'),'configuration server only');
select pg_temp.chat_assert(not has_function_privilege('anon','public.send_chat_message(uuid,uuid,uuid,uuid,text,uuid,boolean,uuid)','execute'),'anonymous cannot send');
select pg_temp.chat_assert((select not public from storage.buckets where id='team-chat'),'attachment bucket private');
set local role service_role;
do $$
declare
 b uuid:='00000000-0000-4000-8000-000000009010'; owner_id uuid:='00000000-0000-4000-8000-000000009001';
 staff_id uuid:='00000000-0000-4000-8000-000000009002'; other_id uuid:='00000000-0000-4000-8000-000000009003';
 owner_member uuid:='00000000-0000-4000-8000-000000009101'; staff_member uuid:='00000000-0000-4000-8000-000000009102';
 branch uuid:='00000000-0000-4000-8000-000000009011'; room uuid:='00000000-0000-4000-8000-000000009200';
 msg uuid:='00000000-0000-4000-8000-000000009300'; msg2 uuid:='00000000-0000-4000-8000-000000009301';
 file_id uuid:='00000000-0000-4000-8000-000000009400'; pending_id uuid; result jsonb;
begin
 perform pg_temp.chat_throws(format('select public.configure_chat_room(%L,%L,%L,%L,''Administración'',ARRAY[%L]::uuid[])',b,staff_id,room,branch,staff_member),'chat_admin_required');
 perform pg_temp.chat_throws(format('select public.configure_chat_room(%L,%L,%L,%L,''Administración'',ARRAY[%L,%L]::uuid[])',b,owner_id,room,branch,owner_member,staff_member),'chat_member_not_allowed');
 perform public.configure_chat_room(b,owner_id,room,branch,'Administración',array[owner_member]);
 perform pg_temp.chat_assert(public.chat_access(owner_id,b,room)=owner_member,'owner uses account, no phone');
 perform pg_temp.chat_assert(public.chat_access(staff_id,b,room) is null,'unselected teammate denied');
 perform pg_temp.chat_assert(public.chat_access(other_id,b,room) is null,'other tenant denied');
 perform pg_temp.chat_assert((select provider='internal' from public.whatsapp_authorized_conversations where id=room),'transport separate from Meta');
 result:=public.send_chat_message(b,owner_id,room,msg,'mensaje del equipo',null,false);
 perform pg_temp.chat_assert(not(result->>'existing')::boolean,'first send persisted');
 result:=public.send_chat_message(b,owner_id,room,msg,'mensaje del equipo',null,false);
 perform pg_temp.chat_assert((result->>'existing')::boolean,'lost response retry idempotent');
 perform pg_temp.chat_assert((select count(*)=1 from public.chat_messages where id=msg),'no duplicate row');
 perform pg_temp.chat_assert((select ai_status='none' from public.chat_messages where id=msg),'normal chat never runs AI');
 perform pg_temp.chat_throws(format('select public.send_chat_message(%L,%L,%L,%L,''cambió el importe'',null,false)',b,owner_id,room,msg),'chat_request_conflict');
 perform pg_temp.chat_throws(format('select public.send_chat_message(%L,%L,%L,%L,''hola'',null,false)',b,staff_id,room,msg2),'chat_access_denied');
 insert into public.branch_assignments(business_member_id,branch_id) values(staff_member,branch);
 perform public.configure_chat_room(b,owner_id,room,branch,'Administración',array[owner_member,staff_member]);
 perform pg_temp.chat_assert(public.chat_access(staff_id,b,room)=staff_member,'selected branch teammate allowed');
 perform public.send_chat_message(b,owner_id,room,msg2,'productos',null,true);
 perform pg_temp.chat_assert(public.claim_chat_ai(b,owner_id,room,msg2),'AI request claimed once');
 perform pg_temp.chat_assert(not public.claim_chat_ai(b,owner_id,room,msg2),'concurrent retry cannot run twice');
 perform pg_temp.chat_throws(format('select public.configure_chat_room(%L,%L,%L,%L,''Nuevo nombre'',ARRAY[%L]::uuid[])',b,owner_id,room,branch,owner_member),'chat_agent_busy');
 perform pg_temp.chat_assert(not public.finish_chat_ai(b,room,msg,'stale response','completed',null,null),'old worker cannot finish another request');
 perform pg_temp.chat_assert(public.finish_chat_ai(b,room,msg2,'Productos visibles','completed','products.list',null),'owner lease finishes');
 perform pg_temp.chat_assert((select ai_text='Productos visibles' and ai_status='done' from public.chat_messages where id=msg2),'reply persisted');
 perform pg_temp.chat_assert((select agent_request_id is null from public.chat_rooms where id=room),'lease released');
 insert into public.chat_attachments(id,business_id,room_id,member_id,filename,mime,size,storage_path) values(file_id,b,room,owner_member,'foto.png','image/png',8,b::text||'/'||room::text||'/'||file_id::text);
 perform pg_temp.chat_throws(format('select public.send_chat_message(%L,%L,%L,%L,'''',%L,false)',b,owner_id,room,gen_random_uuid(),file_id),'chat_attachment_unavailable');
 update public.chat_attachments set ready=true where id=file_id;
 perform pg_temp.chat_throws(format('select public.send_chat_message(%L,%L,%L,%L,'''',%L,false)',b,staff_id,room,gen_random_uuid(),file_id),'chat_attachment_unavailable');
 perform public.send_chat_message(b,owner_id,room,gen_random_uuid(),'',file_id,false);
 perform public.replace_whatsapp_agent_pending(b,owner_member,room,'confirmation','products.create','{"name":"Prueba","price":100}',now()+interval '10 minutes');
 select id into pending_id from public.whatsapp_agent_pending_operations where conversation_id=room and consumed_at is null;
 perform pg_temp.chat_throws(format('select public.send_chat_message(%L,%L,%L,%L,''confirmar'',null,true,%L)',b,staff_id,room,gen_random_uuid(),pending_id),'chat_confirmation_expired');
 perform public.send_chat_message(b,owner_id,room,gen_random_uuid(),'confirmar',null,true,pending_id);
 update public.whatsapp_agent_pending_operations set expires_at=now()-interval '1 minute' where id=pending_id;
 perform pg_temp.chat_throws(format('select public.send_chat_message(%L,%L,%L,%L,''confirmar'',null,true,%L)',b,owner_id,room,gen_random_uuid(),pending_id),'chat_confirmation_expired');
 perform public.send_chat_message(b,owner_id,room,gen_random_uuid(),'cancelar',null,true,pending_id);
 update public.business_members set role='employee' where id=staff_member;
 perform pg_temp.chat_assert(public.chat_access(staff_id,b,room) is null,'changed role requires reauthorization');
 perform public.configure_chat_room(b,owner_id,room,branch,'Administración',array[owner_member,staff_member]);
 perform pg_temp.chat_assert(public.chat_access(staff_id,b,room)=staff_member,'new role explicitly authorized');
 perform pg_temp.chat_assert(not exists(select 1 from public.whatsapp_agent_pending_operations where conversation_id=room and consumed_at is null),'configuration invalidates old confirmations');
 perform public.replace_whatsapp_agent_pending(b,owner_member,room,'confirmation','sales.create','{"__resultUncertain":true}',now()+interval '10 minutes');
 perform public.configure_chat_room(b,owner_id,room,branch,'Administración',array[owner_member,staff_member]);
 perform pg_temp.chat_assert(exists(select 1 from public.whatsapp_agent_pending_operations where conversation_id=room and consumed_at is null and arguments->>'__resultUncertain'='true'),'configuration preserves uncertain durable execution identity');
 update public.profiles set active=false where id=staff_id;
 perform pg_temp.chat_assert(public.chat_access(staff_id,b,room) is null,'deactivated user denied');
 update public.profiles set active=true where id=staff_id;
 delete from public.branch_assignments where business_member_id=staff_member;
 perform pg_temp.chat_assert(public.chat_access(staff_id,b,room) is null,'removed branch assignment denied');
 perform public.configure_chat_room(b,owner_id,room,branch,'Administración',array[owner_member]);
 perform pg_temp.chat_assert(public.chat_access(staff_id,b,room) is null,'removed participant denied');
 perform public.configure_chat_room(b,owner_id,room,branch,'Administración',array[owner_member],true);
 perform pg_temp.chat_assert(public.chat_access(owner_id,b,room) is null,'archived room denies access');
end $$;
rollback;
