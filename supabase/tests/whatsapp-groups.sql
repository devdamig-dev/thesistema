-- Disposable fixtures, real migrations, no Meta requests. All writes roll back.
begin;
create function pg_temp.group_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
create function pg_temp.group_throws(statement text,expected text) returns void language plpgsql as $$
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
insert into public.whatsapp_integrations(business_id,waba_id,phone_number_id,access_token,display_phone_number)
values('00000000-0000-4000-8000-000000009010','900000000','910000000','fixture-not-a-token','+5491190000000');
select pg_temp.group_assert(not has_function_privilege('authenticated','public.set_whatsapp_group_conversation(uuid,uuid,text,text,text,uuid,uuid[])','execute'),'browser cannot authorize groups via RPC');
select pg_temp.group_assert(not has_function_privilege('anon','public.pause_whatsapp_group(uuid,uuid,uuid)','execute'),'anonymous cannot pause groups');
select pg_temp.group_assert(not has_function_privilege('authenticated','public.identify_whatsapp_group_member(uuid,uuid,uuid,text)','execute'),'browser cannot change group identities via RPC');
select pg_temp.group_assert(not has_table_privilege('authenticated','public.whatsapp_group_members','insert'),'browser cannot widen group membership');
select pg_temp.group_assert(not has_table_privilege('authenticated','public.whatsapp_group_creation_requests','select'),'creation requests are server-only');
select pg_temp.group_assert(not (select prosecdef from pg_proc where oid='public.set_whatsapp_group_conversation(uuid,uuid,text,text,text,uuid,uuid[])'::regprocedure),'group authorization does not escalate database privilege');
set local role service_role;
do $$
declare
 b uuid:='00000000-0000-4000-8000-000000009010'; owner_id uuid:='00000000-0000-4000-8000-000000009001';
 owner_member uuid:='00000000-0000-4000-8000-000000009101'; staff_member uuid:='00000000-0000-4000-8000-000000009102';
 branch uuid:='00000000-0000-4000-8000-000000009011'; cid uuid;
begin
 perform pg_temp.group_throws(format('select public.identify_whatsapp_group_member(%L,%L,%L,''5491199999999'')',b,owner_id,staff_member),'profile_phone_change_requires_review');
 perform pg_temp.group_throws(format('select public.identify_whatsapp_group_member(%L,%L,%L,''5491199999999'')',b,owner_id,'00000000-0000-4000-8000-000000009103'),'member_not_found');
 update public.profiles set phone=null where id='00000000-0000-4000-8000-000000009002';
 perform pg_temp.group_throws(format('select public.identify_whatsapp_group_member(%L,%L,%L,''5491111111111'')',b,owner_id,staff_member),'phone_ambiguous');
 perform public.identify_whatsapp_group_member(b,owner_id,staff_member,'5491122222222');
 perform pg_temp.group_assert((select phone='5491122222222' from public.profiles where id='00000000-0000-4000-8000-000000009002'),'explicit missing phone saved');
 perform pg_temp.group_assert(not exists(select 1 from public.whatsapp_authorized_conversations where business_id=b),'identification does not enroll a direct chat');
 perform pg_temp.group_throws(format('select public.set_whatsapp_group_conversation(%L,%L,''Y2FwaV9ncm91cDox'',''910000000'',''Local'',%L,ARRAY[%L]::uuid[])',b,'00000000-0000-4000-8000-000000009003',branch,owner_member),'permission_denied');
 perform pg_temp.group_throws(format('select public.set_whatsapp_group_conversation(%L,%L,''Y2FwaV9ncm91cDox'',''wrong-number'',''Local'',%L,ARRAY[%L]::uuid[])',b,owner_id,branch,owner_member),'whatsapp_not_connected');
 perform pg_temp.group_throws(format('select public.set_whatsapp_group_conversation(%L,%L,''Y2FwaV9ncm91cDox'',''910000000'',''Local'',%L,ARRAY[%L]::uuid[])',b,owner_id,'00000000-0000-4000-8000-000000009021',owner_member),'invalid_group');
 perform pg_temp.group_throws(format('select public.set_whatsapp_group_conversation(%L,%L,''Y2FwaV9ncm91cDox'',''910000000'',''Local'',%L,ARRAY[%L]::uuid[])',b,owner_id,branch,staff_member),'group_member_not_authorized');
 insert into public.branch_assignments(business_member_id,branch_id) values(staff_member,branch);
 cid:=public.set_whatsapp_group_conversation(b,owner_id,'Y2FwaV9ncm91cDox','910000000','Local',branch,array[owner_member,staff_member]);
 perform pg_temp.group_assert((select count(*)=2 from public.whatsapp_group_members where conversation_id=cid),'only selected members persisted');
 perform pg_temp.group_assert((select group_phone_number_id='910000000' and group_activated_at is not null and enabled from public.whatsapp_authorized_conversations where id=cid),'group pinned to phone and activation time');
 perform pg_temp.group_throws(format('insert into public.whatsapp_group_members(conversation_id,business_id,member_id) values(%L,%L,%L)',cid,b,'00000000-0000-4000-8000-000000009103'),'foreign key');
 perform public.replace_whatsapp_agent_pending(b,owner_member,cid,'confirmation','sales.create','{}',now()+interval '10 minutes');
 perform public.pause_whatsapp_group(b,owner_id,cid);
 perform pg_temp.group_assert((select not enabled from public.whatsapp_authorized_conversations where id=cid),'pause persisted');
 perform pg_temp.group_assert(not exists(select 1 from public.whatsapp_agent_pending_operations where conversation_id=cid and consumed_at is null),'pause retires old confirmations');
 update public.profiles set active=false where id=owner_id;
 perform pg_temp.group_throws(format('select public.pause_whatsapp_group(%L,%L,%L)',b,owner_id,cid),'permission_denied');
end $$;
rollback;
