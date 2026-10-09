-- Local-only advances tests. Real migrations, rolled-back fictional fixtures.
begin;
create function pg_temp.a_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if; end $$;
create function pg_temp.a_throws(p_sql text,p_message text) returns void language plpgsql as $$ begin begin execute p_sql; exception when others then if position(p_message in sqlerrm)>0 then return; end if; raise exception 'Expected %, received %',p_message,sqlerrm; end; raise exception 'Expected %, but succeeded',p_message; end $$;
insert into auth.users(id,email) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'employee-test-'||i||'@example.invalid' from generate_series(1,8) i;
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000000010','Employee QA');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000010';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000005';
insert into public.businesses(id,organization_id,name) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','Employee A'),('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','Employee B');
insert into public.business_modules(business_id,module_key,enabled) values('00000000-0000-4000-8000-000000000011','employees',true),('00000000-0000-4000-8000-000000000012','employees',true) on conflict(business_id,module_key) do update set enabled=true;
insert into public.business_members(id,business_id,user_id,role) values
('00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner'),
('00000000-0000-4000-8000-000000000102','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','admin'),
('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003','manager'),
('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000004','viewer'),
('00000000-0000-4000-8000-000000000105','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000005','owner'),
('00000000-0000-4000-8000-000000000106','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000006','accountant'),
('00000000-0000-4000-8000-000000000107','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000007','employee'),
('00000000-0000-4000-8000-000000000108','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000008','owner');
insert into public.branches(id,business_id,name) values('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','A first'),('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000011','A second'),('00000000-0000-4000-8000-000000000023','00000000-0000-4000-8000-000000000012','B first');
insert into public.branch_assignments(business_member_id,branch_id) values('00000000-0000-4000-8000-000000000104','00000000-0000-4000-8000-000000000021');
insert into public.business_modules(business_id,module_key,enabled) values('00000000-0000-4000-8000-000000000011','inbox_ai',true),('00000000-0000-4000-8000-000000000012','inbox_ai',true) on conflict(business_id,module_key) do update set enabled=true;
insert into public.employees(id,business_id,branch_id,full_name,role,active,pending_advance,updated_at) values
('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Juan','Cook',true,999,'2026-01-01T00:00:00.123456Z'),
('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Juan','Waiter',true,0,'2026-01-01T00:00:00.123456Z'),
('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000022','Juan','Other branch',true,0,'2026-01-01T00:00:00.123456Z'),
('00000000-0000-4000-8000-000000000034','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Juan','Archived',false,0,'2026-01-01T00:00:00.123456Z'),
('00000000-0000-4000-8000-000000000035','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000023','Juan','Foreign tenant',true,0,'2026-01-01T00:00:00.123456Z');
insert into public.balance_snapshots(business_id,period_month,payroll_total) values('00000000-0000-4000-8000-000000000011','2026-01-01',12345);
insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,channel,raw) values
('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','Operator','text','Adelanto informado a Juan'),
('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000023','Other tenant','text','Foreign message');
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status)
select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','employee_advance','{"employee_name":"Juan","amount":100}',(case when i=79 then 'rejected' else 'pending' end)::public.approval_status from generate_series(71,79) i;
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status) values
('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000023','employee_advance','{"employee_name":"Juan","amount":100}','pending');
create function pg_temp.a_review() returns jsonb language sql as $$ select '{"employeeId":"00000000-0000-4000-8000-000000000031","expectedEmployeeUpdatedAt":"2026-01-01T00:00:00.123456Z","branchId":"00000000-0000-4000-8000-000000000021","amount":"100.25","date":"2026-01-02","note":"Revisado"}'::jsonb $$;
create function pg_temp.a_call(p_extraction uuid default '00000000-0000-4000-8000-000000000071',p_review jsonb default pg_temp.a_review()) returns jsonb language sql as $$ select public.approve_employee_advance_extraction_atomic('00000000-0000-4000-8000-000000000011',auth.uid(),p_extraction,'{"employee_name":"Juan","amount":100}',p_review) $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.a_assert(not has_table_privilege('authenticated','public.advance_payments','INSERT') and not has_table_privilege('authenticated','public.advance_payments','UPDATE') and not has_table_privilege('authenticated','public.advance_payments','DELETE'),'direct authenticated DML closed');
select pg_temp.a_assert(not has_table_privilege('service_role','public.advance_payments','INSERT') and not has_table_privilege('service_role','public.advance_payments','UPDATE') and not has_table_privilege('service_role','public.advance_payments','DELETE'),'service DML closed');
select pg_temp.a_assert(not has_table_privilege('authenticated','advances_private.inbox_receipts','SELECT') and not has_table_privilege('authenticated','advances_private.inbox_receipts','INSERT'),'receipt private');
select pg_temp.a_assert(not has_function_privilege('anon','public.approve_employee_advance_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.approve_employee_advance_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'only authenticated public wrapper');
select pg_temp.a_assert(not (select prosecdef from pg_proc where oid='public.approve_employee_advance_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure),'public wrapper invoker');
select pg_temp.a_throws($q$insert into public.advance_payments(employee_id,amount) values('00000000-0000-4000-8000-000000000031',10)$q$,'permission denied');
select pg_temp.a_throws($q$update public.ai_extractions set status='approved' where id='00000000-0000-4000-8000-000000000071'$q$,'advance_review_required');
-- Every invalid proposal leaves its extraction, payroll record and audit intact.
do $$ declare p jsonb:=pg_temp.a_review(); patch jsonb; r jsonb; n int; begin
 select count(*) into n from public.activity_logs;
 foreach patch in array array['{"employeeId":"Juan"}'::jsonb,'{"employeeId":null}','{"employeeId":"00000000-0000-4000-8000-000000000099"}','{"employeeId":"00000000-0000-4000-8000-000000000033"}','{"employeeId":"00000000-0000-4000-8000-000000000034"}','{"employeeId":"00000000-0000-4000-8000-000000000035"}','{"amount":100}','{"amount":"0"}','{"amount":"-1"}','{"amount":"0.001"}','{"amount":"1e2"}','{"amount":"NaN"}','{"amount":"10000000000"}','{"date":""}','{"date":"2026-02-30"}','{"date":"9999-01-01"}','{"date":"1899-12-31"}','{"date":null}','{"note":null}','{"expectedEmployeeUpdatedAt":"2026-01-01T00:00:00.123455Z"}','{"branchId":"00000000-0000-4000-8000-000000000022"}','{"payment_execution":"now"}'] loop
  r:=pg_temp.a_call('00000000-0000-4000-8000-000000000071',p||patch); perform pg_temp.a_assert(r->>'ok'='false','invalid proposal '||patch::text||' returned '||r::text);
 end loop;
 r:=pg_temp.a_call('00000000-0000-4000-8000-000000000071',p-'employeeId'); perform pg_temp.a_assert(r->>'ok'='false','missing required field');
 r:=public.approve_employee_advance_extraction_atomic('00000000-0000-4000-8000-000000000011',auth.uid(),'00000000-0000-4000-8000-000000000071','{"amount":99}',p); perform pg_temp.a_assert(r->>'error'='advance_extraction_changed','stale extraction blocked');
 r:=public.approve_employee_advance_extraction_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000071','{"employee_name":"Juan","amount":100}',p); perform pg_temp.a_assert(r->>'error'='advance_permission_denied','actor impersonation blocked');
 perform pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000079')->>'error'='advance_extraction_closed','rejected source closed');
 perform pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000080')->>'error'='advance_permission_denied','foreign message and extraction denied');
 perform pg_temp.a_assert((select count(*) from public.advance_payments)=0 and (select count(*) from public.activity_logs)=n and (select status='pending' from public.ai_extractions where id='00000000-0000-4000-8000-000000000071'),'all invalid attempts have no side effects');
end $$;
-- Only a current active owner/admin can approve, even via private kernel.
do $$ declare actor text; begin foreach actor in array array['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008',''] loop
 perform set_config('request.jwt.claim.sub',actor,true);
 perform pg_temp.a_assert(pg_temp.a_call()->>'error'='advance_permission_denied','actor denied '||actor);
 perform pg_temp.a_assert(advances_private.approve_inbox('00000000-0000-4000-8000-000000000011',auth.uid(),'00000000-0000-4000-8000-000000000071','{"employee_name":"Juan","amount":100}',pg_temp.a_review())->>'error'='advance_permission_denied','private kernel denied '||actor);
end loop; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
-- Date and amount are the reviewed values, not the source or current date.
do $$ declare r jsonb; r2 jsonb; n int; employee_before jsonb; begin
 select to_jsonb(e) into employee_before from public.employees e where id='00000000-0000-4000-8000-000000000031';
 select count(*) into n from public.activity_logs;
 r:=pg_temp.a_call(); perform pg_temp.a_assert(r->>'ok'='true','valid exact review '||r::text);
 perform pg_temp.a_assert((select employee_id='00000000-0000-4000-8000-000000000031' and amount=100.25 and paid_at='2026-01-02' and status='pending' and source='inbox' and business_id='00000000-0000-4000-8000-000000000011' and branch_id='00000000-0000-4000-8000-000000000021' and recorded_by=auth.uid() and note='Revisado' from public.advance_payments where id=(r->>'id')::uuid),'exact employee among four Juan names and factual origin');
 perform pg_temp.a_assert(not exists(select 1 from public.advance_payments where employee_id='00000000-0000-4000-8000-000000000032'),'duplicate name not first-match target');
 perform pg_temp.a_assert((select to_jsonb(e) from public.employees e where id='00000000-0000-4000-8000-000000000031')=employee_before,'manual pending balance and CAS untouched');
 perform pg_temp.a_assert((select payroll_total=12345 and not payroll_data_stale from public.balance_snapshots where business_id='00000000-0000-4000-8000-000000000011'),'payroll snapshot not silently recalculated');
 perform pg_temp.a_assert((select status='approved' and approved_by=auth.uid() and approved_at is not null and target_entity='advance_payments' and target_record_id=(r->>'id')::uuid and fields='{"employee_name":"Juan","amount":100}'::jsonb from public.ai_extractions where id='00000000-0000-4000-8000-000000000071'),'approval source and advance atomic');
 perform pg_temp.a_assert((select count(*) from public.activity_logs)=n+1 and exists(select 1 from public.activity_logs where target_id=(r->>'id')::uuid and actor_id=auth.uid() and actor_role='owner' and action='employee_advance.recorded' and data->>'employee_id'='00000000-0000-4000-8000-000000000031' and data->>'payment_execution'='none' and data->>'manual_balance_sync'='none'),'one trusted audit');
 r2:=pg_temp.a_call(); perform pg_temp.a_assert(r2=r and (select count(*) from public.advance_payments)=1 and (select count(*) from public.activity_logs)=n+1,'exact retry no duplicate advance/audit');
 r2:=pg_temp.a_call('00000000-0000-4000-8000-000000000071',pg_temp.a_review()||'{"amount":"101"}'); perform pg_temp.a_assert(r2->>'error'='advance_idempotency_conflict','altered replay refused');
 perform pg_temp.a_assert(not exists(select 1 from public.expenses) and not exists(select 1 from public.debt_payments) and not exists(select 1 from public.sales) and not exists(select 1 from public.stock_movements),'no payment or other financial movement');
end $$;
select pg_temp.a_throws('update public.advance_payments set amount=1000','permission denied');
select pg_temp.a_throws('delete from public.advance_payments','permission denied');
select pg_temp.a_throws($q$update public.ai_extractions set fields='{}' where id='00000000-0000-4000-8000-000000000071'$q$,'advance_extraction_closed');
reset role;
select pg_temp.a_assert((select count(*) from advances_private.inbox_receipts)=1 and exists(select 1 from advances_private.inbox_receipts r join public.activity_logs l on l.id=r.activity_log_id join public.advance_payments a on a.id=r.advance_id where r.review=pg_temp.a_review() and r.employee_id=a.employee_id and l.target_id=a.id),'one exact immutable joined receipt');
-- Module checks also apply to receipt replay, and no write occurs when disabled.
update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000011' and module_key='employees';
set local role authenticated;
select pg_temp.a_assert(pg_temp.a_call()->>'error'='advance_module_disabled','employee module checked before replay');
reset role;
update public.business_modules set enabled=true where business_id='00000000-0000-4000-8000-000000000011' and module_key='employees';
update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000011' and module_key='inbox_ai';
set local role authenticated;
select pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000072')->>'error'='advance_module_disabled','Inbox module live checked');
reset role;
update public.business_modules set enabled=true where business_id='00000000-0000-4000-8000-000000000011' and module_key='inbox_ai';
-- Audit failure and a swallowed approval UPDATE both roll back the ENTIRE unit.
create function pg_temp.a_fail_audit() returns trigger language plpgsql as $$ begin if new.target_type='advance_payments' then raise exception 'forced_audit_failure'; end if; return new; end $$;
create trigger advance_test_fail_audit before insert on public.activity_logs for each row execute function pg_temp.a_fail_audit();
set local role authenticated;
select pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000072')->>'ok'='false','audit failure rejected');
select pg_temp.a_assert((select count(*) from public.advance_payments)=1 and (select status='pending' and target_record_id is null from public.ai_extractions where id='00000000-0000-4000-8000-000000000072'),'audit failure rolls back record and approval');
reset role;
select pg_temp.a_assert((select count(*) from advances_private.inbox_receipts)=1,'failed audit left no receipt');
drop trigger advance_test_fail_audit on public.activity_logs;
create function pg_temp.a_skip_approval() returns trigger language plpgsql as $$ begin if new.type='employee_advance' then return null; end if; return new; end $$;
create trigger advance_test_skip_approval before update on public.ai_extractions for each row execute function pg_temp.a_skip_approval();
set local role authenticated;
do $$ declare n int; begin select count(*) into n from public.activity_logs;
 perform pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000072')->>'error'='advance_approval_write_failed','zero row approval rejected');
 perform pg_temp.a_assert((select count(*) from public.advance_payments)=1 and (select count(*) from public.activity_logs)=n and (select status='pending' and target_record_id is null from public.ai_extractions where id='00000000-0000-4000-8000-000000000072'),'approval failure rolls back record and audit');
end $$;
reset role;
select pg_temp.a_assert((select count(*) from advances_private.inbox_receipts)=1,'failed approval left no receipt');
drop trigger advance_test_skip_approval on public.ai_extractions;
-- Admin works and same receipt cannot be claimed by another actor.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.a_assert(pg_temp.a_call()->>'error'='advance_idempotency_conflict','different actor replay denied');
select pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000072',pg_temp.a_review()||'{"employeeId":"00000000-0000-4000-8000-000000000032"}')->>'ok'='true','admin selects second identical name exactly');
-- A review cannot survive employee edits, archive, or branch move before commit.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.update_employee_manual(business_id,id,updated_at,branch_id,full_name,role,shift,monthly_hours,monthly_cost,pending_advance,absences,late_arrivals) from public.employees where id='00000000-0000-4000-8000-000000000031';
select pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000073')->>'error'='advance_employee_changed','microsecond CAS stale after update');
select pg_temp.a_assert(pg_temp.a_call()->>'ok'='true','same receipt replay survives employee version change without new mutation');
select public.set_employee_active_manual(business_id,id,updated_at,false) from public.employees where id='00000000-0000-4000-8000-000000000031';
select pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000073')->>'error'='advance_employee_forbidden','archived employee refused');
select public.set_employee_active_manual(business_id,id,updated_at,true) from public.employees where id='00000000-0000-4000-8000-000000000031';
-- Viewing advance history and audit requires both original AND current branch.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.a_assert((select count(*) from public.advance_payments)=2 and (select count(*) from public.activity_logs where target_type='advance_payments')=2,'original assigned viewer sees advances before move');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.update_employee_manual(business_id,id,updated_at,'00000000-0000-4000-8000-000000000022',full_name,role,shift,monthly_hours,monthly_cost,pending_advance,absences,late_arrivals) from public.employees where id='00000000-0000-4000-8000-000000000031';
select pg_temp.a_assert(pg_temp.a_call('00000000-0000-4000-8000-000000000073')->>'error'='advance_employee_forbidden','employee branch move refused');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.a_assert((select count(*) from public.advance_payments)=1 and (select count(*) from public.activity_logs where target_type='advance_payments')=1,'old branch viewer loses moved employee history');
reset role;
update public.branch_assignments set branch_id='00000000-0000-4000-8000-000000000022' where business_member_id='00000000-0000-4000-8000-000000000104';
set local role authenticated;
select pg_temp.a_assert(not exists(select 1 from public.advance_payments) and not exists(select 1 from public.activity_logs where target_type='advance_payments'),'new branch viewer cannot read original branch history');
reset role;
rollback;
