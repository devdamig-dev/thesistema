-- Offline disposable fixture only. No real messages or production cleanup.
begin;
create function pg_temp.pending_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
create function pg_temp.pending_throws(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement; exception when others then if position(expected in sqlerrm)>0 then return; end if; raise; end; raise exception 'Expected %, succeeded',expected; end $$;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000001002','pending-fixture@example.invalid');
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000001000','Pending fixture');
insert into public.businesses(id,organization_id,name) values('00000000-0000-4000-8000-000000001001','00000000-0000-4000-8000-000000001000','Pending business');
insert into public.business_members(id,business_id,user_id,role) values('00000000-0000-4000-8000-000000001003','00000000-0000-4000-8000-000000001001','00000000-0000-4000-8000-000000001002','owner');
insert into public.whatsapp_authorized_conversations(id,business_id,provider,provider_conversation_id,conversation_type)
values('00000000-0000-4000-8000-000000001004','00000000-0000-4000-8000-000000001001','internal','pending-fixture','direct');
select pg_temp.pending_assert(not has_function_privilege('authenticated','public.replace_whatsapp_agent_pending(uuid,uuid,uuid,text,text,jsonb,timestamptz)','execute'),'authenticated cannot write server confirmations');
select pg_temp.pending_assert(not has_function_privilege('anon','public.replace_whatsapp_agent_pending(uuid,uuid,uuid,text,text,jsonb,timestamptz)','execute'),'anonymous cannot write server confirmations');
select pg_temp.pending_assert(not (select prosecdef from pg_proc where oid='public.replace_whatsapp_agent_pending(uuid,uuid,uuid,text,text,jsonb,timestamptz)'::regprocedure),'replacement invoker');
set local role service_role;
do $$
declare b uuid:='00000000-0000-4000-8000-000000001001'; m uuid:='00000000-0000-4000-8000-000000001003'; c uuid:='00000000-0000-4000-8000-000000001004'; first_id uuid; second_id uuid; r jsonb;
begin
 r:=public.replace_whatsapp_agent_pending(b,m,c,'confirmation','debts.createPlan','{"requestId":"request-one"}',now()+interval '10 minutes');first_id:=(r->>'id')::uuid;
 r:=public.replace_whatsapp_agent_pending(b,m,c,'confirmation','debts.createPlan','{"requestId":"request-two"}',now()+interval '10 minutes');second_id:=(r->>'id')::uuid;
 perform pg_temp.pending_assert(first_id<>second_id,'new pending identity');
 perform pg_temp.pending_assert((select count(*)=1 from public.whatsapp_agent_pending_operations where business_id=b and member_id=m and conversation_id=c and consumed_at is null),'single live confirmation');
 perform pg_temp.pending_assert((select consumed_at is not null from public.whatsapp_agent_pending_operations where id=first_id),'old pending retained consumed');
 perform pg_temp.pending_throws(format('insert into public.whatsapp_agent_pending_operations(business_id,member_id,conversation_id,kind,tool_name,arguments,expires_at) values(%L,%L,%L,''confirmation'',''debts.createPlan'',''{}'',now()+interval ''10 minutes'')',b,m,c),'pending_scope_conflict');
 update public.whatsapp_agent_pending_operations set consumed_at=now() where id=second_id and consumed_at is null;
 perform pg_temp.pending_assert(not exists(select 1 from public.whatsapp_agent_pending_operations where business_id=b and member_id=m and conversation_id=c and consumed_at is null),'second confirmation cannot resurrect first');
 perform public.replace_whatsapp_agent_pending(b,m,c,'confirmation','debts.registerPlanPayment','{"requestId":"uncertain","amountCents":100,"__resultUncertain":true}',now()+interval '10 minutes');
 perform pg_temp.pending_throws(format('select public.replace_whatsapp_agent_pending(%L,%L,%L,''confirmation'',''debts.registerPlanPayment'',''{"requestId":"new"}'',now()+interval ''10 minutes'')',b,m,c),'pending_recovery_required');
 perform pg_temp.pending_throws(format('select public.replace_whatsapp_agent_pending(%L,%L,%L,''confirmation'',''debts.registerPlanPayment'',''{"requestId":"uncertain","amountCents":200}'',now()+interval ''10 minutes'')',b,m,c),'pending_recovery_required');
 perform public.replace_whatsapp_agent_pending(b,m,c,'confirmation','debts.registerPlanPayment','{"requestId":"uncertain","amountCents":100,"__resultUncertain":true}',now()+interval '10 minutes');
 perform pg_temp.pending_assert((select count(*)=1 from public.whatsapp_agent_pending_operations where business_id=b and member_id=m and conversation_id=c and consumed_at is null),'same uncertain recovery stays single');
 perform pg_temp.pending_throws(format('select public.replace_whatsapp_agent_pending(%L,%L,%L,''confirmation'',''debts.createPlan'',''{}'',now()+interval ''10 minutes'')','00000000-0000-4000-8000-000000009999',m,c),'pending_actor_not_authorized');
 update public.whatsapp_authorized_conversations set enabled=false where id=c;
 perform pg_temp.pending_throws(format('select public.replace_whatsapp_agent_pending(%L,%L,%L,''confirmation'',''debts.createPlan'',''{}'',now()+interval ''10 minutes'')',b,m,c),'pending_conversation_not_authorized');
end $$;
rollback;
