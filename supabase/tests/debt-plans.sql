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

do $$
declare r jsonb; p jsonb:=pg_temp.payload(); req uuid:=gen_random_uuid(); d uuid; d2 uuid; i uuid; i2 uuid; pay uuid; pay2 uuid; k uuid; v bigint; n bigint;
begin
 r:=public.create_debt_installment_plan(p,req);
 perform pg_temp.assert_true((r->>'ok')::boolean,'create: '||r::text); d:=(r->>'debt_id')::uuid;
 perform pg_temp.assert_true((select sum(total_amount) from public.debt_installments where debt_id=d)=100,'exact financed total');
 perform pg_temp.assert_true((select total_amount from public.debt_installments where debt_id=d and installment_number=3)=33.34,'last absorbs remaining cent');
 perform pg_temp.assert_true((select due_date from public.debt_installments where debt_id=d and installment_number=3)='2026-03-31','monthly original anchor retained');
 perform pg_temp.assert_true((select down_payment_amount is null and total_obligation_amount is null and category is null and interest_rate is null from public.debts where id=d),'unknown values stay null');
 perform pg_temp.assert_true((select count(*) from public.activity_logs where target_id=d and action='debt.plan.created')=1,'creation audit atomic');
 r:=public.create_debt_installment_plan(p,req);
 perform pg_temp.assert_true((r->>'debt_id')::uuid=d and (r->>'idempotent')::boolean,'create retry idempotent');
 r:=public.get_debt_operation_result('create',req);
 perform pg_temp.assert_true((r->>'found')::boolean and (r->>'debt_id')::uuid=d,'lookup create by UUID');
 r:=public.get_debt_operation_result('create',gen_random_uuid());
 perform pg_temp.assert_true((r->>'ok')::boolean and not (r->>'found')::boolean,'lookup absent receipt is unknown, not rollback');
 r:=public.create_debt_installment_plan(jsonb_set(p,'{creditor}','"Changed"'),req);
 perform pg_temp.assert_true(r->>'error'='idempotency_conflict','create request payload collision');
 r:=public.create_debt_installment_plan(jsonb_set(p,'{plan,installments,2,totalAmountCents}','3333'),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='installment_total_mismatch','SQL does not trust rounded total');
 r:=public.create_debt_installment_plan(jsonb_set(p,'{plan,installments,2,dueDate}','"2026-03-28"'),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='invalid_schedule','SQL revalidates monthly anchor');
 r:=public.create_debt_installment_plan(jsonb_set(p,'{plan,amountSource}','"explicit_installment"'),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='inconsistent_financing','explicit equal installment total must multiply exactly');
 r:=public.create_debt_installment_plan(jsonb_set(p,'{plan,originalAmountCents}','"10000"'),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='invalid_integer_money','SQL rejects string cents');
 r:=public.create_debt_installment_plan(jsonb_set(p,'{plan,installments,0,capitalAmountCents}','4000'),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='inconsistent_components','SQL rejects components above total');
 r:=public.create_debt_installment_plan(pg_temp.payload('00000000-0000-4000-8000-000000000023'),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='debt_branch_business_mismatch','even dual owner cannot cross branch/business');
 r:=public.create_debt_installment_plan(p,gen_random_uuid()); d2:=(r->>'debt_id')::uuid;
 select id into i from public.debt_installments where debt_id=d and installment_number=1;
 select id into i2 from public.debt_installments where debt_id=d2 and installment_number=1;
 r:=public.register_debt_plan_payment(d,0,pg_temp.payment(100,i2),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='installment_not_found','cross-debt payment rejected');
 r:=public.register_debt_plan_payment(d,0,pg_temp.payment(3334,i),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='amount_exceeds_installment_pending','selected never spills');
 k:=gen_random_uuid(); r:=public.register_debt_plan_payment(d,0,pg_temp.payment(1000,i),k); pay:=(r->>'payment_id')::uuid;
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'pending_amount')::numeric=90 and (r->>'version')::int=1,'partial payment: '||r::text);
 perform pg_temp.assert_true((select sum(amount) from public.debt_payment_allocations where payment_id=pay)=10,'partial allocation');
 r:=public.register_debt_plan_payment(d,0,pg_temp.payment(1000,i),k);
 perform pg_temp.assert_true((r->>'idempotent')::boolean and (r->>'payment_id')::uuid=pay,'retry accepted before stale CAS');
 r:=public.get_debt_operation_result('pay',k,d);
 perform pg_temp.assert_true((r->>'found')::boolean and (r->>'payment_id')::uuid=pay,'lookup committed payment');
 r:=public.register_debt_plan_payment(d,1,pg_temp.payment(1001,i),k);
 perform pg_temp.assert_true(r->>'error'='idempotency_conflict','payment payload collision rejected');
 r:=public.register_debt_plan_payment(d,0,pg_temp.payment(1),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='stale_version','CAS stale payment rejected');
 r:=public.register_debt_plan_payment(d,1,pg_temp.payment(9001),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='amount_exceeds_pending','global overpayment rejected');
 r:=public.register_debt_plan_payment(d,1,pg_temp.payment(0),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='invalid_debt_payment_amount','zero payment rejected');
 r:=public.register_debt_plan_payment(d,1,pg_temp.payment(6000),gen_random_uuid()); pay2:=(r->>'payment_id')::uuid;
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'pending_amount')::numeric=30,'global explicit payment: '||r::text);
 perform pg_temp.assert_true((select count(*) from public.debt_payment_allocations where payment_id=pay2)=3,'global oldest due spans three installments');
 perform pg_temp.assert_true((select amount from public.debt_payment_allocations where payment_id=pay2 and installment_id=i)=23.33,'oldest clears first balance exactly');
 k:=gen_random_uuid(); r:=public.void_debt_plan_payment(d,pay2,2,'Duplicado',k);
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'pending_amount')::numeric=90,'void reopens balances: '||r::text);
 perform pg_temp.assert_true((select count(*) from public.debt_payment_allocations where payment_id=pay2)=3,'void keeps original allocation history');
 perform pg_temp.assert_true((select voided_by=auth.uid() and voided_at is not null and voided_on=debt_private.business_date('00000000-0000-4000-8000-000000000011') from public.debt_payments where id=pay2),'void actor/time audit follows business civil date');
 r:=public.void_debt_plan_payment(d,pay2,2,'Duplicado',k);
 perform pg_temp.assert_true((r->>'idempotent')::boolean,'void retry idempotent');
 r:=public.get_debt_operation_result('void',k,d);
 perform pg_temp.assert_true((r->>'found')::boolean and (r->>'payment_id')::uuid=pay2,'lookup committed void');
 r:=public.void_debt_plan_payment(d,pay2,3,'Otra anulación',gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='payment_already_voided','double void rejected');
 r:=public.register_debt_plan_payment(d,3,pg_temp.payment(9000),gen_random_uuid());
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'pending_amount')::numeric=0,'full settlement');
 perform pg_temp.assert_true((select status='settled' and due_date is null and settled_at is not null from public.debts where id=d),'full debt status consistent');
 perform pg_temp.assert_true(exists(select 1 from public.activity_logs where target_id=d and action='debt.closed'),'closure audit');
 perform pg_temp.throws(format('delete from public.debt_payments where id=%L',pay),'plan_payment_delete_forbidden');
 perform pg_temp.throws(format('update public.debt_payments set amount=1 where id=%L',pay),'plan_payment_immutable');
 perform pg_temp.throws(format('update public.debt_payment_allocations set amount=1 where payment_id=%L',pay),'allocations_immutable');
 perform pg_temp.throws(format('update public.debts set original_amount=1 where id=%L',d),'plan_financial_terms_immutable');
 perform pg_temp.throws(format('delete from public.debts where id=%L',d),'plan_history_immutable');
 update public.debts set pending_amount=999,status='active',plan_version=0 where id=d;
 perform pg_temp.assert_true((select pending_amount=0 and status='settled' and plan_version=5 from public.debts where id=d),'direct balance/version rewrite cannot corrupt ledger');
 perform pg_temp.assert_true(public.register_debt_payment_atomic(d,'00000000-0000-4000-8000-000000000011',null,1)->>'error'='allocation_rule_required','legacy register rejects plan');
 perform pg_temp.assert_true(public.settle_debt_atomic(d,'00000000-0000-4000-8000-000000000011')->>'error'='allocation_rule_required','legacy settle rejects plan');
 -- Direct Data API insert follows exactly the same allocation and audit path.
 insert into public.debt_payments(debt_id,business_id,branch_id,currency,amount,paid_at,payment_method,origin,allocation_rule,request_id)
 values(d2,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','ARS',50,current_date,'Efectivo','manual','oldest_due',gen_random_uuid()) returning id into pay;
 perform pg_temp.assert_true((select pending_amount from public.debts where id=d2)=50,'direct insert updates balance');
 perform pg_temp.assert_true((select sum(amount) from public.debt_payment_allocations where payment_id=pay)=50,'direct insert always allocates');
 perform pg_temp.throws(format('insert into public.debt_payment_allocations(business_id,branch_id,debt_id,payment_id,installment_id,amount) values(%L,%L,%L,%L,%L,1)','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021',d2,pay,i2),'allocations_immutable');
 update public.debt_installments set due_date='2026-02-01',notes='Acordado' where id=i2;
 perform pg_temp.assert_true((select plan_version from public.debts where id=d2)=2,'due-date edit advances version');
 perform pg_temp.assert_true(exists(select 1 from public.activity_logs where target_id=d2 and action='debt.installment.updated'),'due-date audit');
 perform pg_temp.throws(format('update public.debt_installments set due_date=null where id=%L',i2),'installment_date_required');
 perform pg_temp.throws(format('update public.debt_installments set total_amount=1 where id=%L',i2),'installment_financial_terms_immutable');
 perform pg_temp.throws(format('update public.debt_installments set due_date=''2026-05-01'' where id=%L',i2),'dates_not_increasing');
 -- Confirmed 20.00 historical down payment + 10.00 charges: installments 100.00.
 p:=jsonb_set(p,'{plan,originalAmountCents}','11000'); p:=jsonb_set(p,'{plan,downPaymentCents}','2000'); p:=jsonb_set(p,'{plan,totalObligationCents}','12000');
 p:=jsonb_set(p,'{plan,confirmedBalance}','{"confirmed":true,"downPaymentCents":2000,"interestCents":1000,"feesCents":0}');
 r:=public.create_debt_installment_plan(p,gen_random_uuid()); d:=(r->>'debt_id')::uuid;
 perform pg_temp.assert_true((r->>'ok')::boolean,'confirmed financing: '||r::text);
 perform pg_temp.assert_true((select original_amount=110 and total_financed_amount=100 and total_obligation_amount=120 and down_payment_amount=20 and pending_amount=100 from public.debts where id=d),'historical advance never double-subtracted');
 perform pg_temp.assert_true(not exists(select 1 from public.debt_payments where debt_id=d),'historical advance never invented as current payment');
 r:=public.create_debt_installment_plan(jsonb_set(p,'{plan,totalObligationCents}','10000'),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='inconsistent_financing','obligation consistency SQL');
 -- Branch B debt for RLS visibility checks outside this block.
 r:=public.create_debt_installment_plan(pg_temp.payload('00000000-0000-4000-8000-000000000022'),gen_random_uuid());
 perform pg_temp.assert_true((r->>'ok')::boolean,'second branch fixture');
end $$;

-- Single-payment plans can be undated, and financed charges may exceed principal.
do $$ declare p jsonb:=pg_temp.payload(); r jsonb; d uuid; i uuid; begin
 p:=jsonb_set(p,'{plan}',(p->'plan')||'{"mode":"single","installmentCount":1,"regularInstallmentAmountCents":10000,"periodicity":null,"monthlyAnchorDay":null,"originalAmountCents":8000,"installments":[{"installmentNumber":1,"dueDate":null,"totalAmountCents":10000,"capitalAmountCents":null,"interestAmountCents":null,"feesAmountCents":null}]}');
 r:=public.create_debt_installment_plan(p,gen_random_uuid()); d:=(r->>'debt_id')::uuid;
 perform pg_temp.assert_true((r->>'ok')::boolean,'undated single plan: '||r::text);
 perform pg_temp.assert_true((select due_date is null and original_amount=80 and total_financed_amount=100 from public.debts where id=d),'single unknown due and principal maintained');
 r:=public.register_debt_plan_payment(d,0,pg_temp.payment(10000),gen_random_uuid());
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'pending_amount')::numeric=0,'financed ledger may legitimately exceed principal');
 -- Valid direct plan inserts generate their schedule and bind the retry payload.
 insert into public.debts(business_id,branch_id,creditor,taken_at,origin,original_amount,pending_amount,plan_definition,plan_request_id)
 values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Direct plan',current_date,'manual',1,1,p->'plan',gen_random_uuid()) returning id into d;
 perform pg_temp.assert_true((select count(*)=1 from public.debt_installments where debt_id=d),'direct plan generates installments');
 perform pg_temp.assert_true((select original_amount=80 and pending_amount=100 from public.debts where id=d),'direct plan cannot override financial output');
 perform pg_temp.throws(format('insert into public.debt_payments(debt_id,business_id,branch_id,currency,amount,paid_at,payment_method,origin,allocation_rule,request_id,request_payload) values(%L,%L,%L,''ARS'',1,current_date,''Transferencia'',''manual'',''oldest_due'',gen_random_uuid(),%L::jsonb)',d,'00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021',pg_temp.payment(200)::text),'request_payload_mismatch');
end $$;

-- Allowed edits use the same parent CAS, durable retry receipts and atomic audit.
do $$ declare r jsonb; d uuid; i uuid; key1 uuid:=gen_random_uuid(); key2 uuid:=gen_random_uuid(); begin
 r:=public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid()); d:=(r->>'debt_id')::uuid;
 select id into i from public.debt_installments where debt_id=d and installment_number=1;
 r:=public.edit_debt_installment(d,i,0,'2026-01-30','Acordado',key1);
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'version')::int=1,'edit installment RPC: '||r::text);
 perform pg_temp.assert_true((select due_date='2026-01-30' and notes='Acordado' from public.debt_installments where id=i),'edit persisted');
 r:=public.edit_debt_installment(d,i,0,'2026-01-30','Acordado',key1);
 perform pg_temp.assert_true((r->>'idempotent')::boolean,'edit retry before CAS');
 r:=public.get_debt_operation_result('edit_installment',key1,d);
 perform pg_temp.assert_true((r->>'found')::boolean and (r->>'debt_id')::uuid=d,'lookup committed edit');
 r:=public.get_debt_operation_result('edit_notes',key1,d);
 perform pg_temp.assert_true(not (r->>'found')::boolean,'lookup operation mismatch reveals nothing');
 r:=public.edit_debt_installment(d,i,1,'2026-05-01','Bad',gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='dates_not_increasing','edit prevents reordered dates');
 r:=public.edit_debt_installment(d,i,1,null,'Bad',gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='installment_date_required','edit prevents missing installment due date');
 r:=public.update_debt_plan_notes(d,1,'Nota',key2);
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'version')::int=2,'notes RPC: '||r::text);
 r:=public.edit_debt_installment(d,i,0,'2026-01-30','Acordado',key1);
 perform pg_temp.assert_true((r->>'idempotent')::boolean and (r->>'version')::int=2,'old edit retry remains idempotent after later changes');
 r:=public.update_debt_plan_notes(d,1,'Nota',key2);
 perform pg_temp.assert_true((r->>'idempotent')::boolean,'notes retry idempotent');
 r:=public.update_debt_plan_notes(d,2,'Different',key2);
 perform pg_temp.assert_true(r->>'error'='idempotency_conflict','notes request collision');
 r:=public.update_debt_plan_notes(d,2,'Nota',key1);
 perform pg_temp.assert_true(r->>'error'='idempotency_conflict','cross-operation edit request collision');
 r:=public.update_debt_plan_notes(d,1,'Stale',gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='stale_version','edit CAS protects against stale notes');
 r:=public.update_debt_plan_notes(d,2,'Nota',gen_random_uuid());
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'version')::int=3,'no-op request still audited/versioned');
 perform pg_temp.assert_true((select count(*) from public.debt_plan_mutations where debt_id=d)=3,'only committed edits have receipts');
 perform pg_temp.throws(format('update public.debt_plan_mutations set payload=''{}'' where debt_id=%L',d),'permission denied');
end $$;

-- Legacy debt create/pay/settle and payment deletion still work.
insert into public.debts(id,business_id,branch_id,creditor,original_amount,pending_amount) values('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Legacy',10,10);
select pg_temp.assert_true((public.register_debt_payment_atomic('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000011',null,4)->>'ok')::boolean,'legacy partial pay');
select pg_temp.assert_true((public.settle_debt_atomic('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000011')->>'ok')::boolean,'legacy settle');
delete from public.debt_payments where debt_id='00000000-0000-4000-8000-000000000051';
select pg_temp.assert_true((select pending_amount=10 and status='active' from public.debts where id='00000000-0000-4000-8000-000000000051'),'legacy deletion reopens');

select pg_temp.assert_true((select count(*)=2 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000051' and action='debt.payment.registered'),'legacy payment audit atomic');
select pg_temp.assert_true((select count(*)=2 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000051' and action='debt.payment.deleted'),'legacy payment deletion audited');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert_true((public.register_debt_payment_atomic('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',10)->>'ok')::boolean,'legacy service explicit actor atomic audit');

-- WhatsApp/service adapter supplies a verified actor. No implicit actor is reused.
do $$ declare r jsonb; d uuid; pay uuid; req uuid:=gen_random_uuid(); begin
 r:=public.create_debt_installment_plan(jsonb_set(pg_temp.payload(),'{origin}','"whatsapp"'),gen_random_uuid(),'00000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true((r->>'ok')::boolean,'service plan creation: '||r::text); d:=(r->>'debt_id')::uuid;
 r:=public.register_debt_plan_payment(d,0,jsonb_set(pg_temp.payment(100),'{origin}','"whatsapp"'),req,'00000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true((r->>'ok')::boolean,'service planned payment: '||r::text); pay:=(r->>'payment_id')::uuid;
 perform pg_temp.assert_true((select created_by='00000000-0000-4000-8000-000000000001' and origin='whatsapp' from public.debt_payments where id=pay),'verified actor/origin preserved');
 r:=public.get_debt_operation_result('pay',req,d,'00000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true((r->>'found')::boolean,'verified service recovery');
 r:=public.get_debt_operation_result('pay',req,d,'00000000-0000-4000-8000-000000000002');
 perform pg_temp.assert_true(not (r->>'found')::boolean,'recovery cannot disclose another actor receipt');
 r:=public.register_debt_plan_payment(d,0,jsonb_set(pg_temp.payment(100),'{origin}','"whatsapp"'),req,'00000000-0000-4000-8000-000000000002');
 perform pg_temp.assert_true(r->>'error'='idempotency_conflict','server cannot replay another actor request');
 r:=public.void_debt_plan_payment(d,pay,1,'Service reversal',gen_random_uuid(),'00000000-0000-4000-8000-000000000001');
 perform pg_temp.assert_true((r->>'ok')::boolean and (r->>'pending_amount')::numeric=100,'service planned void: '||r::text);
 perform pg_temp.assert_true(exists(select 1 from public.activity_logs where target_id=d and actor_id='00000000-0000-4000-8000-000000000001' and action='debt.payment.voided'),'service reversal actor audited');
 r:=public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='actor_required','service cannot reuse old actor context implicitly');
 r:=public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid(),'00000000-0000-4000-8000-000000000005');
 perform pg_temp.assert_true(r->>'error'='permission_denied','server inactive actor rejected');
 r:=public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid(),'00000000-0000-4000-8000-000000000003');
 perform pg_temp.assert_true(r->>'error'='permission_denied','server viewer actor rejected');
 r:=public.create_debt_installment_plan(jsonb_set(pg_temp.payload('00000000-0000-4000-8000-000000000023'),'{business_id}','"00000000-0000-4000-8000-000000000012"'),gen_random_uuid(),'00000000-0000-4000-8000-000000000002');
 perform pg_temp.assert_true(r->>'error'='permission_denied','server actor foreign membership rejected');
end $$;
reset role;
set local role authenticated;

select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(not exists(select 1 from public.debts where branch_id='00000000-0000-4000-8000-000000000022'),'viewer branch read isolated');
select pg_temp.assert_true(not exists(select 1 from public.debt_installments where branch_id='00000000-0000-4000-8000-000000000022'),'installment RLS branch isolated');
select pg_temp.assert_true(not exists(select 1 from public.activity_logs where target_type='debts' and data->>'branch_id'='00000000-0000-4000-8000-000000000022'),'audit branch isolated');
select pg_temp.assert_true(public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid())->>'error'='permission_denied','viewer create denied');
select set_config('debt.actor_id','00000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid())->>'error'='permission_denied','normal client cannot spoof server actor GUC');
select pg_temp.assert_true(public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid(),'00000000-0000-4000-8000-000000000001')->>'error'='actor_mismatch','normal client explicit actor spoof rejected');
select pg_temp.assert_true(public.register_debt_plan_payment((select id from public.debts where plan_definition is not null limit 1),0,pg_temp.payment(1),gen_random_uuid())->>'error' in ('permission_denied','debt_not_found'),'viewer payment denied');
select pg_temp.throws($q$insert into public.activity_logs(business_id,action,summary) values('00000000-0000-4000-8000-000000000011','forged','forged')$q$,'row-level security');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select pg_temp.assert_true(public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid())->>'error'='permission_denied','inactive owner denied');
select set_config('request.jwt.claim.sub','',true);
select pg_temp.assert_true(public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid())->>'error'='actor_required','missing actor denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.assert_true((public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid())->>'ok')::boolean,'admin create allowed');
select pg_temp.assert_true(public.create_debt_installment_plan(jsonb_set(pg_temp.payload('00000000-0000-4000-8000-000000000023'),'{business_id}','"00000000-0000-4000-8000-000000000012"'),gen_random_uuid())->>'error'='permission_denied','admin foreign tenant denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.assert_true((public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid())->>'ok')::boolean,'manager create allowed');

-- Independent review regressions: audit-feed targets, inactive readers, service
-- attribution, and legacy parent deletion with its payment cascade.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.debts(id,business_id,branch_id,creditor,original_amount,pending_amount,created_by,due_date) values
 ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Review branch A',100,100,auth.uid(),null),
 ('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000022','Review branch B',100,100,auth.uid(),null),
 ('00000000-0000-4000-8000-000000000063','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Review cron',100,100,auth.uid(),current_date-2);
insert into public.debt_payments(id,debt_id,amount) values
 ('00000000-0000-4000-8000-000000000071','00000000-0000-4000-8000-000000000061',10),
 ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000062',10);
reset role;
-- Historical app/actions/debts.ts writes this legacy target shape using admin.
insert into public.activity_logs(id,business_id,action,target_type,target_id,summary,data) values
 ('00000000-0000-4000-8000-000000000081','00000000-0000-4000-8000-000000000011','debt.payment.registered','debt_payments','00000000-0000-4000-8000-000000000071','Review legacy A', '{"debt_id":"00000000-0000-4000-8000-000000000061","amount":10}'),
 ('00000000-0000-4000-8000-000000000082','00000000-0000-4000-8000-000000000011','debt.payment.registered','debt_payments','00000000-0000-4000-8000-000000000072','Review legacy B', '{"debt_id":"00000000-0000-4000-8000-000000000062","amount":10}'),
 ('00000000-0000-4000-8000-000000000083','00000000-0000-4000-8000-000000000012','debt.payment.registered','debt_payments','00000000-0000-4000-8000-000000000071','Review mismatched business', '{"debt_id":"00000000-0000-4000-8000-000000000061","amount":10}'),
 ('00000000-0000-4000-8000-000000000084','00000000-0000-4000-8000-000000000011','debt.payment.registered','debt_payments','00000000-0000-4000-8000-000000000079','Review orphan with forged JSON', '{"debt_id":"00000000-0000-4000-8000-000000000061","branch_id":"00000000-0000-4000-8000-000000000021","amount":10}'),
 ('00000000-0000-4000-8000-000000000085','00000000-0000-4000-8000-000000000011','debt.created','debts','00000000-0000-4000-8000-000000000062','Review mismatched branch', '{"branch_id":"00000000-0000-4000-8000-000000000021"}');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.assert_true(not exists(select 1 from public.activity_logs where id in ('00000000-0000-4000-8000-000000000083','00000000-0000-4000-8000-000000000084','00000000-0000-4000-8000-000000000085')),'log scope mismatch/orphan denied even dual-business owner');
select pg_temp.throws($q$select * from debt_private.audit_scopes$q$,'permission denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(exists(select 1 from public.activity_logs where id='00000000-0000-4000-8000-000000000081'),'active viewer sees legitimate same-branch legacy payment log');
select pg_temp.assert_true(not exists(select 1 from public.activity_logs where id='00000000-0000-4000-8000-000000000082'),'legacy payment audit does not leak another branch');
select pg_temp.assert_true((select count(*) from public.debt_installments)>0 and (select count(*) from public.debt_payment_allocations)>0 and (select count(*) from public.debt_plan_mutations)>0,'active viewer retains authorized child-ledger reads');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select pg_temp.assert_true(not exists(select 1 from public.debt_installments),'inactive cannot read installments');
select pg_temp.assert_true(not exists(select 1 from public.debt_payment_allocations),'inactive cannot read allocations');
select pg_temp.assert_true(not exists(select 1 from public.debt_plan_mutations),'inactive cannot read mutation receipts');
select pg_temp.assert_true(not exists(select 1 from public.activity_logs where target_type in ('debts','debt_payments')),'inactive cannot read debt audit');

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select set_config('debt.actor_id','',true);
-- Match the legitimate notification-checks service-role overdue-status update.
update public.debts set status='overdue' where id='00000000-0000-4000-8000-000000000063';
select pg_temp.assert_true(exists(select 1 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000063' and actor_id is null and actor_role='system' and data->>'actor_kind'='system' and data->'after'->>'status'='overdue'),'cron update records system, not original creator');
do $$ declare d uuid; begin
 select id into d from public.debts where plan_definition is not null limit 1;
 update public.debts set notes='Background update with no human actor' where id=d;
 perform pg_temp.assert_true(exists(select 1 from public.activity_logs where target_id=d and action='debt.notes.updated' and data->'after'->>'notes'='Background update with no human actor' and actor_id is null and actor_role='system'),'service planned update never borrows creator identity');
end $$;
select pg_temp.throws($q$insert into debt_private.audit_scopes(activity_log_id,business_id,debt_id) values('00000000-0000-4000-8000-000000000084','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000061')$q$,'permission denied');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
-- Legacy direct edits conserve balances and are audit-visible.
update public.debts set original_amount=200,creditor='Review creditor changed' where id='00000000-0000-4000-8000-000000000061';
select pg_temp.assert_true((select original_amount=200 and pending_amount=190 from public.debts where id='00000000-0000-4000-8000-000000000061'),'legacy original update reconciles existing payments');
select pg_temp.assert_true(exists(select 1 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000061' and action='debt.updated' and (data->'after'->>'original_amount')::numeric=200),'legacy financial edit audited');
select pg_temp.throws($q$update public.debts set original_amount=5 where id='00000000-0000-4000-8000-000000000061'$q$,'original_below_paid');
-- Removed legacy action logs without private scope receipts fail closed.
delete from public.debt_payments where id='00000000-0000-4000-8000-000000000071';
select pg_temp.assert_true(not exists(select 1 from public.activity_logs where id='00000000-0000-4000-8000-000000000081'),'removed payment without trustworthy snapshot is not business-shared');
insert into public.debt_payments(id,debt_id,amount) values('00000000-0000-4000-8000-000000000073','00000000-0000-4000-8000-000000000061',20);
delete from public.debts where id in ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000062');
select pg_temp.assert_true(not exists(select 1 from public.debt_payments where debt_id in ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000062')),'authorized legacy parent delete cascades payments');
select pg_temp.assert_true((select count(*)=2 from public.activity_logs where action='debt.deleted' and target_id in ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000062') and jsonb_array_length(data->'related_payments')=1),'deletion audited with full pre-cascade payment snapshots');
select pg_temp.assert_true(not exists(select 1 from public.activity_logs where id='00000000-0000-4000-8000-000000000082'),'orphan legacy payment log remains closed after debt removal');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(exists(select 1 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000061' and action='debt.deleted'),'trusted snapshot preserves authorized deleted-debt audit');
select pg_temp.assert_true(not exists(select 1 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000062'),'deleted debt snapshot never leaks branch B to A');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

-- A trusted historical receipt is authoritative if its live parent later moves.
update public.debts set branch_id='00000000-0000-4000-8000-000000000022' where id='00000000-0000-4000-8000-000000000063';
reset role;
update public.branch_assignments set branch_id='00000000-0000-4000-8000-000000000022'
 where business_member_id=(select id from public.business_members where user_id='00000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.assert_true(exists(select 1 from public.debts where id='00000000-0000-4000-8000-000000000063'),'viewer now sees moved live debt in branch B');
select pg_temp.assert_true(not exists(select 1 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000063' and data->>'branch_id'='00000000-0000-4000-8000-000000000021'),'live parent cannot override original audit scope');
reset role;
update public.branch_assignments set branch_id='00000000-0000-4000-8000-000000000021'
 where business_member_id=(select id from public.business_members where user_id='00000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);

-- Existing plan-deletion regression above remains mandatory: no cascade escape.


-- Force audit failure; the SECURITY INVOKER RPC must roll back debt/plan/payment.
reset role;
create function pg_temp.fail_audit() returns trigger language plpgsql as $$ begin raise exception 'test_audit_failure'; end $$;
create trigger test_fail_audit before insert on public.activity_logs for each row execute function pg_temp.fail_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare n bigint; r jsonb; d uuid; balance numeric; version bigint; begin
 select count(*) into n from public.debts;
 r:=public.create_debt_installment_plan(pg_temp.payload(),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='test_audit_failure','audit failure returned');
 perform pg_temp.assert_true((select count(*) from public.debts)=n,'audit failure rolls back whole create');
 select id,pending_amount,plan_version into d,balance,version from public.debts where plan_definition is not null and pending_amount>0 limit 1;
 r:=public.register_debt_plan_payment(d,version,pg_temp.payment(1),gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='test_audit_failure','payment audit failure returned');
 perform pg_temp.assert_true((select pending_amount=balance and plan_version=version from public.debts where id=d),'audit failure rolls back payment balances/version');
 r:=public.update_debt_plan_notes(d,version,'Must rollback',gen_random_uuid());
 perform pg_temp.assert_true(r->>'error'='test_audit_failure','notes audit failure returned');
 perform pg_temp.assert_true((select plan_version=version and notes is distinct from 'Must rollback' from public.debts where id=d),'audit failure rolls back edited notes/version');
 perform pg_temp.throws($q$delete from public.debts where id='00000000-0000-4000-8000-000000000051'$q$,'test_audit_failure');
 perform pg_temp.assert_true(exists(select 1 from public.debts where id='00000000-0000-4000-8000-000000000051') and exists(select 1 from public.debt_payments where debt_id='00000000-0000-4000-8000-000000000051'),'failed deletion audit rolls back parent and cascade');
end $$;
rollback;
