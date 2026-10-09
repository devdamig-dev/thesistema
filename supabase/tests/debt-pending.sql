-- Disposable fixtures for durable WhatsApp debt execution. PGlite verifies SQL
-- behavior; the native runner separately verifies independent-session races.
begin;
create function pg_temp.debt_pending_assert(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
create function pg_temp.debt_pending_throws(statement text,expected text) returns void language plpgsql as $$
begin begin execute statement; exception when others then if position(expected in sqlerrm)>0 then return; end if; raise; end; raise exception 'Expected %, succeeded',expected; end $$;
create function pg_temp.debt_pending_args() returns jsonb language sql as $$
 select jsonb_build_object('requestId',gen_random_uuid(),'branchId','00000000-0000-4000-8000-000000003005',
 'creditor','Durable test bank','creditorType','bank','takenAt',current_date::text,'mode','installments','currency','ARS',
 'originalAmountCents',10000,'totalFinancedCents',10000,'installmentCount',3,'periodicity','monthly','firstDueDate','2026-01-31')
$$;
create function pg_temp.debt_pending_plan() returns jsonb language sql as $$
 select jsonb_build_object('business_id','00000000-0000-4000-8000-000000003001','branch_id','00000000-0000-4000-8000-000000003005',
 'creditor','Durable test bank','creditor_type','bank','taken_at',current_date::text,'origin','whatsapp','plan',
 jsonb_build_object('mode','installments','currency','ARS','originalAmountCents',10000,'totalFinancedCents',10000,
 'downPaymentCents',null,'totalObligationCents',null,'regularInstallmentAmountCents',3333,'installmentCount',3,
 'periodicity','monthly','monthlyAnchorDay',31,'amountSource','explicit_total','confirmedBalance',null,'interestRate',null,'installments',
 '[{"installmentNumber":1,"dueDate":"2026-01-31","totalAmountCents":3333,"capitalAmountCents":null,"interestAmountCents":null,"feesAmountCents":null},{"installmentNumber":2,"dueDate":"2026-02-28","totalAmountCents":3333,"capitalAmountCents":null,"interestAmountCents":null,"feesAmountCents":null},{"installmentNumber":3,"dueDate":"2026-03-31","totalAmountCents":3334,"capitalAmountCents":null,"interestAmountCents":null,"feesAmountCents":null}]'::jsonb))
$$;
create function pg_temp.debt_pending_new(tool text default 'debts.createPlan',args jsonb default null,kind text default 'confirmation') returns uuid language sql as $$
 select (public.replace_whatsapp_agent_pending('00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000003003','00000000-0000-4000-8000-000000003004',kind,tool,coalesce(args,pg_temp.debt_pending_args()),now()+interval '10 minutes')->>'id')::uuid
$$;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000003002','debt-pending@example.invalid');
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000003000','Durable debt fixture');
update public.profiles set organization_id='00000000-0000-4000-8000-000000003000' where id='00000000-0000-4000-8000-000000003002';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000003000','Debt pending business'),
 ('00000000-0000-4000-8000-000000003011','00000000-0000-4000-8000-000000003000','Other debt business');
insert into public.business_modules(business_id,module_key,enabled) values('00000000-0000-4000-8000-000000003001','debts',true)
 on conflict(business_id,module_key) do update set enabled=true;
insert into public.business_members(id,business_id,user_id,role) values
 ('00000000-0000-4000-8000-000000003003','00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000003002','owner');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000003005','00000000-0000-4000-8000-000000003001','Debt pending A'),
 ('00000000-0000-4000-8000-000000003006','00000000-0000-4000-8000-000000003001','Debt pending B'),
 ('00000000-0000-4000-8000-000000003015','00000000-0000-4000-8000-000000003011','Foreign debt branch');
insert into public.whatsapp_authorized_conversations(id,business_id,branch_id,provider,provider_conversation_id,conversation_type) values
 ('00000000-0000-4000-8000-000000003004','00000000-0000-4000-8000-000000003001','00000000-0000-4000-8000-000000003005','internal','debt-pending-fixture','direct'),
 ('00000000-0000-4000-8000-000000003014','00000000-0000-4000-8000-000000003011',null,'internal','foreign-debt-pending-fixture','direct');
-- DEBT_PENDING_FIXTURE_END

select pg_temp.debt_pending_assert(not exists(select 1 from pg_proc where oid in (
 'public.claim_debt_pending_execution(uuid,uuid,uuid,uuid,boolean)'::regprocedure,
 'public.cancel_debt_pending_execution(uuid,uuid,uuid,uuid)'::regprocedure) and prosecdef),'claim and cancel are security invoker');
do $$ declare role_name text; signature text; begin
 foreach role_name in array array['anon','authenticated'] loop
  foreach signature in array array['public.claim_debt_pending_execution(uuid,uuid,uuid,uuid,boolean)','public.cancel_debt_pending_execution(uuid,uuid,uuid,uuid)'] loop
   perform pg_temp.debt_pending_assert(not has_function_privilege(role_name,signature,'execute'),role_name||' cannot execute '||signature);
  end loop;
 end loop;
 perform pg_temp.debt_pending_assert(has_function_privilege('service_role','public.claim_debt_pending_execution(uuid,uuid,uuid,uuid,boolean)','execute'),'server may claim');
 perform pg_temp.debt_pending_assert(has_function_privilege('service_role','public.cancel_debt_pending_execution(uuid,uuid,uuid,uuid)','execute'),'server may cancel');
 perform pg_temp.debt_pending_assert(not has_function_privilege('service_role','public.is_admin_of_business(uuid)','execute'),'no membership helper grants');
end $$;
set local role authenticated;
select pg_temp.debt_pending_throws('select public.claim_debt_pending_execution(null,null,null,null,false)','permission denied');
select pg_temp.debt_pending_throws('select public.cancel_debt_pending_execution(null,null,null,null)','permission denied');
set local role anon;
select pg_temp.debt_pending_throws('select public.claim_debt_pending_execution(null,null,null,null,false)','permission denied');
select pg_temp.debt_pending_throws('select public.cancel_debt_pending_execution(null,null,null,null)','permission denied');
set local role service_role;
do $$
declare b uuid:='00000000-0000-4000-8000-000000003001'; m uuid:='00000000-0000-4000-8000-000000003003'; c uuid:='00000000-0000-4000-8000-000000003004';
 pending_id uuid; old_id uuid; args jsonb; result jsonb; tool text; invalid jsonb; request uuid; debt uuid;
begin
 foreach tool in array array['debts.createPlan','debts.registerPlanPayment','debts.voidPlanPayment','debts.editPlan'] loop
  args:=pg_temp.debt_pending_args(); pending_id:=pg_temp.debt_pending_new(tool,args);
  perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,true),'recovery cannot claim a fresh row');
  perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,null),'null recovery cannot claim');
  perform pg_temp.debt_pending_assert(public.claim_debt_pending_execution(b,m,c,pending_id,false),'fresh claim wins for '||tool);
  perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,false),'a second fresh claim loses CAS');
  perform pg_temp.debt_pending_assert(public.claim_debt_pending_execution(b,m,c,pending_id,true),'recovery retains same row');
  perform pg_temp.debt_pending_assert((select p.arguments- '__resultUncertain'=args and p.arguments->'__resultUncertain'='true'::jsonb and p.consumed_at is null and p.expires_at>now()+interval '29 days' from public.whatsapp_agent_pending_operations p where p.id=pending_id),'claim preserves UUID/payload and keeps durable reference');
  result:=public.cancel_debt_pending_execution(b,m,c,pending_id);
  perform pg_temp.debt_pending_assert(result='{"consumed":true,"resultUncertain":true}'::jsonb,'cancel observes durable uncertainty');
  perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,true),'cancellation never resurrects recovery');
  perform pg_temp.debt_pending_assert(public.cancel_debt_pending_execution(b,m,c,pending_id)='{"consumed":false,"resultUncertain":false}'::jsonb,'double cancellation is not a new rollback');
 end loop;
 pending_id:=pg_temp.debt_pending_new();
 perform pg_temp.debt_pending_assert(public.cancel_debt_pending_execution(b,m,c,pending_id)='{"consumed":true,"resultUncertain":false}'::jsonb,'cancel before claim has definitive no-start result');
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,false),'cancel before claim prevents execution');
 old_id:=pg_temp.debt_pending_new(); pending_id:=pg_temp.debt_pending_new();
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,old_id,false),'stale claim cannot reach replacement');
 perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,c,old_id)->>'consumed')::boolean,'stale cancellation cannot consume replacement');
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution('00000000-0000-4000-8000-000000003011',m,c,pending_id,false),'foreign business cannot claim');
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,'00000000-0000-4000-8000-000000003014',pending_id,false),'foreign conversation cannot claim');
 perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,'00000000-0000-4000-8000-000000003014',pending_id)->>'consumed')::boolean,'foreign conversation cannot cancel');
 perform pg_temp.debt_pending_assert(public.claim_debt_pending_execution(b,m,c,pending_id,false),'current replacement remains claimable');
 perform pg_temp.debt_pending_throws('select pg_temp.debt_pending_new()','pending_recovery_required');
 perform public.cancel_debt_pending_execution(b,m,c,pending_id);
 old_id:=pending_id; pending_id:=pg_temp.debt_pending_new();
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,old_id,true),'late recovery cannot mark later request');
 perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,c,old_id)->>'consumed')::boolean,'late cancel cannot retire later request');
 perform pg_temp.debt_pending_assert((select p.consumed_at is null and not p.arguments ? '__resultUncertain' from public.whatsapp_agent_pending_operations p where p.id=pending_id),'later request is untouched');
 perform public.cancel_debt_pending_execution(b,m,c,pending_id);
 -- Only prepared, unexpired canonical writes may start. Malformed inputs fail closed.
 foreach invalid in array array['{}'::jsonb,'{"requestId":17}'::jsonb,'{"requestId":"bad"}'::jsonb,'{"requestId":null}'::jsonb,
   '{"__resultUncertain":"true"}'::jsonb,'{"__resultUncertain":null}'::jsonb,'{"branchId":"bad"}'::jsonb,
   '{"branchId":"00000000-0000-4000-8000-000000003015"}'::jsonb,'{"branchId":"00000000-0000-4000-8000-000000003006"}'::jsonb] loop
  args:=case when invalid='{}'::jsonb then '{}'::jsonb else pg_temp.debt_pending_args()||invalid end;
  pending_id:=pg_temp.debt_pending_new('debts.createPlan',args);
  perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,false),'invalid prepared confirmation rejected: '||invalid::text);
  update public.whatsapp_agent_pending_operations p set consumed_at=now() where p.id=pending_id;
 end loop;
 pending_id:=pg_temp.debt_pending_new();
 update public.whatsapp_agent_pending_operations p set expires_at=now()-interval '1 second' where p.id=pending_id;
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,false),'expired fresh confirmation rejected');
 perform pg_temp.debt_pending_assert((public.cancel_debt_pending_execution(b,m,c,pending_id)->>'consumed')::boolean,'expired confirmation may be canceled explicitly');
 foreach tool in array array['debts.create','debts.getPlan','debts.listDue','sales.create','stock.adjust'] loop
  pending_id:=pg_temp.debt_pending_new(tool);
  perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,false),'noncanonical/foreign tool cannot claim');
  if tool<>'debts.create' then perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,c,pending_id)->>'consumed')::boolean,'foreign tool cannot cancel'); end if;
  update public.whatsapp_agent_pending_operations p set consumed_at=now() where p.id=pending_id;
 end loop;
 foreach tool in array array['debts.create','debts.createPlan','debts.registerPlanPayment'] loop
  pending_id:=pg_temp.debt_pending_new(tool,'{}','clarification');
  perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,false),'clarification cannot execute');
  perform pg_temp.debt_pending_assert(public.cancel_debt_pending_execution(b,m,c,pending_id)='{"consumed":true,"resultUncertain":false}'::jsonb,'clarification and legacy create may cancel without prepared ID');
 end loop;
 -- A known malformed historical marker must never produce a rollback promise.
 pending_id:=pg_temp.debt_pending_new('debts.createPlan',pg_temp.debt_pending_args()||'{"__resultUncertain":"true"}');
 perform pg_temp.debt_pending_assert(public.cancel_debt_pending_execution(b,m,c,pending_id)='{"consumed":true,"resultUncertain":true}'::jsonb,'malformed uncertainty stays conservative');
 -- Crash before RPC: durable claim survives; retry uses the exact prepared UUID.
 args:=pg_temp.debt_pending_args(); request:=(args->>'requestId')::uuid; pending_id:=pg_temp.debt_pending_new('debts.createPlan',args);
 perform pg_temp.debt_pending_assert(public.claim_debt_pending_execution(b,m,c,pending_id,false),'claim before crash');
 perform pg_temp.debt_pending_assert(public.claim_debt_pending_execution(b,m,c,pending_id,true),'restart can recover before RPC');
 result:=public.create_debt_installment_plan(pg_temp.debt_pending_plan(),request,'00000000-0000-4000-8000-000000003002');
 perform pg_temp.debt_pending_assert((result->>'ok')::boolean,'recovery domain create succeeds: '||result::text); debt:=(result->>'debt_id')::uuid;
 -- Crash after commit before cleanup: exact replay returns one persisted result.
 perform pg_temp.debt_pending_assert(public.claim_debt_pending_execution(b,m,c,pending_id,true),'committed request remains recoverable');
 result:=public.create_debt_installment_plan(pg_temp.debt_pending_plan(),request,'00000000-0000-4000-8000-000000003002');
 perform pg_temp.debt_pending_assert((result->>'ok')::boolean and (result->>'idempotent')::boolean and (result->>'debt_id')::uuid=debt,'restart after commit replays same result');
 perform pg_temp.debt_pending_assert((select count(*)=1 from public.debts where plan_request_id=request),'one debt after recovery');
 perform pg_temp.debt_pending_assert((select count(*)=1 from public.activity_logs where target_id=debt and action='debt.plan.created'),'one financial audit after recovery');
 perform public.cancel_debt_pending_execution(b,m,c,pending_id);
 -- Actor, role, module and conversation state are checked live for recovery.
 pending_id:=pg_temp.debt_pending_new(); perform public.claim_debt_pending_execution(b,m,c,pending_id,false);
 update public.profiles set active=false where public.profiles.id='00000000-0000-4000-8000-000000003002';
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,true),'inactive actor cannot recover');
 perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,c,pending_id)->>'consumed')::boolean,'inactive actor cannot cancel');
 update public.profiles set active=true where public.profiles.id='00000000-0000-4000-8000-000000003002';
 update public.business_members set role='viewer' where public.business_members.id=m;
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,true),'revoked role cannot recover');
 perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,c,pending_id)->>'consumed')::boolean,'revoked role cannot cancel');
 update public.business_members set role='owner' where public.business_members.id=m;
 update public.business_modules set enabled=false where business_id=b and module_key='debts';
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,true),'disabled debt module cannot recover');
 perform pg_temp.debt_pending_assert(public.cancel_debt_pending_execution(b,m,c,pending_id)='{"consumed":true,"resultUncertain":true}'::jsonb,'paused module still permits explicitly stopping uncertain recovery');
 update public.business_modules set enabled=true where business_id=b and module_key='debts';
 pending_id:=pg_temp.debt_pending_new(); perform public.claim_debt_pending_execution(b,m,c,pending_id,false);
 update public.whatsapp_authorized_conversations set enabled=false where public.whatsapp_authorized_conversations.id=c;
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,true),'disabled conversation cannot recover');
 perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,c,pending_id)->>'consumed')::boolean,'disabled conversation cannot cancel');
 update public.whatsapp_authorized_conversations set enabled=true,branch_id='00000000-0000-4000-8000-000000003006' where public.whatsapp_authorized_conversations.id=c;
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,true),'changed conversation branch cannot recover another branch');
 perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,c,pending_id)->>'consumed')::boolean,'changed conversation branch cannot cancel another branch');
 update public.whatsapp_authorized_conversations set branch_id='00000000-0000-4000-8000-000000003005' where public.whatsapp_authorized_conversations.id=c;
 perform pg_temp.debt_pending_assert(public.claim_debt_pending_execution(b,m,c,pending_id,true),'permitted recovery resumes on same ID');
 perform public.cancel_debt_pending_execution(b,m,c,pending_id);
 pending_id:=pg_temp.debt_pending_new(); delete from public.business_members where public.business_members.id=m;
 perform pg_temp.debt_pending_assert(not public.claim_debt_pending_execution(b,m,c,pending_id,false),'deleted membership cannot claim');
 perform pg_temp.debt_pending_assert(not (public.cancel_debt_pending_execution(b,m,c,pending_id)->>'consumed')::boolean,'deleted membership cannot cancel');
end $$;
rollback;
