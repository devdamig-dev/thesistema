-- Execute on a LOCAL disposable Supabase/PostgreSQL after real migrations.
-- Every fixture rolls back. PGlite exercises real SQL/RLS, but not concurrency.
begin;
create function pg_temp.assert_true(ok boolean,message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'ASSERTION FAILED: %',message; end if; end $$;
create function pg_temp.throws(statement text,expected text) returns void language plpgsql security invoker as $$
begin
 begin execute statement; exception when others then
   if position(expected in sqlerrm)>0 then return; end if;
   raise exception 'Expected %, received %',expected,sqlerrm;
 end;
 raise exception 'Expected %, but operation succeeded',expected;
end $$;
create function pg_temp.payload(branch text default '00000000-0000-4000-8000-000000000021') returns jsonb language sql as $$
 select jsonb_build_object('business_id','00000000-0000-4000-8000-000000000011','branch_id',branch,'creditor','Test bank','taken_at',current_date::text,'origin','manual','plan',
 jsonb_build_object('mode','installments','currency','ARS','originalAmountCents',10000,'totalFinancedCents',10000,'downPaymentCents',null,'totalObligationCents',null,'regularInstallmentAmountCents',3333,'installmentCount',3,'periodicity','monthly','monthlyAnchorDay',31,'amountSource','explicit_total','confirmedBalance',null,'interestRate',null,'installments',
 '[{"installmentNumber":1,"dueDate":"2026-01-31","totalAmountCents":3333,"capitalAmountCents":null,"interestAmountCents":null,"feesAmountCents":null},{"installmentNumber":2,"dueDate":"2026-02-28","totalAmountCents":3333,"capitalAmountCents":null,"interestAmountCents":null,"feesAmountCents":null},{"installmentNumber":3,"dueDate":"2026-03-31","totalAmountCents":3334,"capitalAmountCents":null,"interestAmountCents":null,"feesAmountCents":null}]'::jsonb))
$$;
create function pg_temp.payment(cents int,installment uuid default null) returns jsonb language sql as $$
 select jsonb_build_object('amountCents',cents,'paidAt',debt_private.business_date('00000000-0000-4000-8000-000000000011')::text,'paymentMethod','Transferencia','origin','manual','allocation',
 case when installment is null then jsonb_build_object('rule','oldest_due') else jsonb_build_object('rule','selected_installment','installmentId',installment) end)
$$;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','debt-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','debt-admin@example.invalid'),
 ('00000000-0000-4000-8000-000000000003','debt-viewer@example.invalid'),
 ('00000000-0000-4000-8000-000000000004','debt-manager@example.invalid'),
 ('00000000-0000-4000-8000-000000000005','debt-inactive@example.invalid');
insert into public.organizations(id,name) values ('00000000-0000-4000-8000-000000000010','Debt tests');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000010' where id::text like '00000000-0000-4000-8000-00000000000%';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000005';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','Debt business A'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','Debt business B');
update public.businesses set timezone='UTC' where id in ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012');
insert into public.business_members(business_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','admin'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003','viewer'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000004','manager'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000005','owner');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','Debt A1'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000011','Debt A2'),
 ('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000012','Debt B1');
insert into public.branch_assignments(business_member_id,branch_id)
 select id,'00000000-0000-4000-8000-000000000021' from public.business_members where user_id='00000000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(not has_function_privilege('authenticated','debt_private.audit_change()','execute'),'private audit cannot be invoked');
select pg_temp.assert_true(not has_function_privilege('anon','public.create_debt_installment_plan(jsonb,uuid,uuid)','execute'),'anonymous create denied');
select pg_temp.assert_true(not exists(select 1 from pg_proc where oid in ('public.create_debt_installment_plan(jsonb,uuid,uuid)'::regprocedure,'public.register_debt_plan_payment(uuid,bigint,jsonb,uuid,uuid)'::regprocedure,'public.void_debt_plan_payment(uuid,uuid,bigint,text,uuid,uuid)'::regprocedure) and prosecdef),'all RPCs security invoker');

-- Inbox source is factual fixture data and all rows roll back.
insert into public.business_modules(business_id,module_key,enabled) values
 ('00000000-0000-4000-8000-000000000011','inbox_ai',true),
 ('00000000-0000-4000-8000-000000000011','debts',true) on conflict(business_id,module_key) do update set enabled=true;
create function pg_temp.inbox_fields() returns jsonb language sql as $$
 select jsonb_build_object('planRequest',jsonb_build_object('creditor','Test bank','creditorType','bank','takenAt',current_date::text,'planInput',jsonb_build_object('mode','installments','currency','ARS','originalAmountCents',10000,'financing',jsonb_build_object('totalFinancedCents',10000),'installmentCount',3,'schedule',jsonb_build_object('periodicity','monthly','firstDueDate','2026-01-31'))))
$$;
create function pg_temp.inbox_payload() returns jsonb language sql as $$ select pg_temp.payload()||jsonb_build_object('creditor_type','bank','origin','whatsapp') $$;
select pg_temp.assert_true(not has_function_privilege('anon','public.approve_debt_extraction_atomic(uuid,jsonb,uuid,text,jsonb,bigint)','execute'),'anonymous inbox approval denied');
select pg_temp.assert_true(not has_function_privilege('service_role','public.approve_debt_extraction_atomic(uuid,jsonb,uuid,text,jsonb,bigint)','execute'),'Inbox does not need service-role escalation');
select pg_temp.assert_true(not (select prosecdef from pg_proc where oid='public.approve_debt_extraction_atomic(uuid,jsonb,uuid,text,jsonb,bigint)'::regprocedure),'Inbox approval invoker');
do $$
declare msg uuid:=gen_random_uuid(); ext uuid:=gen_random_uuid(); payext uuid:=gen_random_uuid(); d uuid; r jsonb; n integer; fields jsonb:=pg_temp.inbox_fields(); payload jsonb:=pg_temp.inbox_payload(); pay jsonb; payfields jsonb;
begin
 insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,raw) values(msg,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Fixture','Fixture');
 insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields) values(ext,msg,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','debt_created',fields);
 select count(*) into n from public.debts;
 r:=public.approve_debt_extraction_atomic(ext,'{}',msg,'create',payload);
 perform pg_temp.assert_true(r->>'error'='debt_review_required','stale fields rejected');
 r:=public.approve_debt_extraction_atomic(ext,fields,gen_random_uuid(),'create',payload);
 perform pg_temp.assert_true(r->>'error'='debt_review_required','changed source rejected');
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',jsonb_set(payload,'{creditor}','"Other creditor"'));
 perform pg_temp.assert_true(r->>'error'='debt_review_required','payload cannot substitute creditor');
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',jsonb_set(payload,'{plan,originalAmountCents}','20000'));
 perform pg_temp.assert_true(r->>'error'='debt_review_required','payload cannot substitute capital');
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',jsonb_set(payload,'{origin}','"manual"'));
 perform pg_temp.assert_true(r->>'error'='debt_review_required','origin derives from source');
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',jsonb_set(payload,'{business_id}','"00000000-0000-4000-8000-000000000012"'));
 perform pg_temp.assert_true(r->>'error'='debt_review_required','cross business payload blocked for dual owner');
 perform pg_temp.assert_true((select count(*) from public.debts)=n,'invalid reviews do not write');
 update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000011' and module_key='debts';
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',payload);
 perform pg_temp.assert_true(r->>'error'='module_disabled','disabled module fails closed');
 update public.business_modules set enabled=true where business_id='00000000-0000-4000-8000-000000000011' and module_key='debts';
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',payload);
 perform pg_temp.assert_true(r->>'error'='permission_denied','inactive owner denied');
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',payload);
 perform pg_temp.assert_true(r->'ok'='false'::jsonb,'viewer denied');
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',payload);
 perform pg_temp.assert_true(r->'ok'='true'::jsonb,'create source+ledger atomic: '||r::text); d:=(r->>'debt_id')::uuid;
 perform pg_temp.assert_true((select status='approved' and target_entity='debts' and target_record_id=d and approved_by=auth.uid() from public.ai_extractions where id=ext),'Inbox approved with exact debt and actor');
 perform pg_temp.assert_true((select origin='whatsapp' and plan_request_id=ext from public.debts where id=d),'source and idempotency bound');
 r:=public.approve_debt_extraction_atomic(ext,fields,msg,'create',payload);
 perform pg_temp.assert_true(r->'idempotent'='true'::jsonb and (select count(*) from public.debts)=n+1,'retry exactly one debt');
 perform pg_temp.throws(format('update public.ai_extractions set status=%L where id=%L','rejected',ext),'approved_debt_extraction_immutable');
 perform pg_temp.throws(format('update public.ai_extractions set fields=%L::jsonb where id=%L','{}',ext),'approved_debt_extraction_immutable');
 perform pg_temp.throws(format('update public.ai_extractions set type=%L where id=%L','debt_payment',ext),'approved_debt_extraction_immutable');
 perform pg_temp.throws(format('update public.ai_extractions set target_record_id=gen_random_uuid() where id=%L',ext),'approved_debt_extraction_immutable');
 pay:=pg_temp.payment(1000)||jsonb_build_object('origin','whatsapp');
 payfields:=jsonb_build_object('paymentRequest',(pay-'origin')||jsonb_build_object('debtId',d,'expectedVersion',0));
 insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields) values(payext,msg,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','debt_payment',payfields);
 r:=public.approve_debt_extraction_atomic(payext,payfields,msg,'pay',jsonb_build_object('debt_id',d,'payment',pay),1);
 perform pg_temp.assert_true(r->>'error'='debt_review_required','payment version tied to review');
 r:=public.approve_debt_extraction_atomic(payext,payfields,msg,'pay',jsonb_build_object('debt_id',d,'payment',jsonb_set(pay,'{amountCents}','1100')),0);
 perform pg_temp.assert_true(r->>'error'='debt_review_required','payment amount tied to review');
 r:=public.approve_debt_extraction_atomic(payext,payfields,msg,'pay',jsonb_build_object('debt_id',d,'payment',pay),0);
 perform pg_temp.assert_true(r->'ok'='true'::jsonb and r->>'target_entity'='debt_payments','payment source+ledger atomic: '||r::text);
 perform pg_temp.assert_true((select status='approved' and target_record_id=(r->>'payment_id')::uuid from public.ai_extractions where id=payext),'approval links exact payment');
 r:=public.approve_debt_extraction_atomic(payext,payfields,msg,'pay',jsonb_build_object('debt_id',d,'payment',pay),0);
 perform pg_temp.assert_true(r->'idempotent'='true'::jsonb and (select pending_amount=90 from public.debts where id=d),'payment retry no duplicate');
end $$;

-- Status failure after a successful nested ledger RPC must roll back both.
reset role;
create function pg_temp.fail_inbox_status() returns trigger language plpgsql as $$ begin if new.status='approved' then raise exception 'test_inbox_status_failure'; end if; return new; end $$;
create trigger test_fail_inbox_status before update on public.ai_extractions for each row execute function pg_temp.fail_inbox_status();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare msg uuid:=gen_random_uuid(); ext uuid:=gen_random_uuid(); n bigint; r jsonb; begin
 insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,raw) values(msg,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Fixture','Fixture');
 insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields) values(ext,msg,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','debt_created',pg_temp.inbox_fields());
 select count(*) into n from public.debts;
 r:=public.approve_debt_extraction_atomic(ext,pg_temp.inbox_fields(),msg,'create',pg_temp.inbox_payload());
 perform pg_temp.assert_true(r->>'error'='test_inbox_status_failure','status write failure returned');
 perform pg_temp.assert_true((select count(*) from public.debts)=n and not exists(select 1 from public.debts where plan_request_id=ext),'status failure rolls back ledger');
 perform pg_temp.assert_true((select status='pending' from public.ai_extractions where id=ext),'status failure leaves source pending');
end $$;
rollback;
