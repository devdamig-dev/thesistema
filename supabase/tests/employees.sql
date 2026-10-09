-- Local-only, rolled-back employee fixtures. No live user records.
begin;
create function pg_temp.employee_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if; end $$;
create function pg_temp.employee_throws(p_sql text,p_message text) returns void language plpgsql as $$ begin begin execute p_sql; exception when others then if position(p_message in sqlerrm)>0 then return; end if; raise exception 'Expected %, received %',p_message,sqlerrm; end; raise exception 'Expected %, but succeeded',p_message; end $$;
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
-- Represents a pre-migration unassigned legacy row, without guessing its branch.
alter table public.employees disable trigger employee_validate_and_version;
insert into public.employees(id,business_id,full_name,role) values('00000000-0000-4000-8000-000000000039','00000000-0000-4000-8000-000000000011','Legacy unassigned','Operative');
alter table public.employees enable trigger employee_validate_and_version;
insert into public.balance_snapshots(business_id,period_month,payroll_total) values('00000000-0000-4000-8000-000000000011','2026-10-01',12345);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.employee_assert(not has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='employee_private' and p.proname='audit_employee_change'),'execute'),'private audit remains noncallable');
select pg_temp.employee_assert(not has_table_privilege('authenticated','public.employees','INSERT') and not has_table_privilege('authenticated','public.employees','UPDATE') and not has_table_privilege('authenticated','public.employees','DELETE'),'direct employee DML revoked');
select pg_temp.employee_assert(not has_function_privilege('anon','public.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer)','execute'),'anonymous RPC denied');
select pg_temp.employee_assert(not (select prosecdef from pg_proc where oid='public.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer)'::regprocedure),'create invoker RLS');
select pg_temp.employee_assert(not (select prosecdef from pg_proc where oid='public.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer)'::regprocedure),'update invoker RLS');
do $$ declare b uuid:='00000000-0000-4000-8000-000000000011'; e uuid:='00000000-0000-4000-8000-000000000031'; br uuid:='00000000-0000-4000-8000-000000000021'; r jsonb; token timestamptz; token2 timestamptz; logs bigint;
begin
 r:=public.create_employee_manual(b,e,br,' Employee One ',' Cook ',' Night ',120.5,700000,50000,2,3); token:=(r->>'updated_at')::timestamptz;
 perform pg_temp.employee_assert((select payroll_data_stale and payroll_total=12345 from public.balance_snapshots where business_id=b),'payroll snapshot invalidated without changing amounts');
 perform pg_temp.employee_assert(r->>'full_name'='Employee One' and r->>'role'='Cook' and r->>'shift'='Night' and (r->>'active')::boolean,'create normalized operational fields');
 select count(*) into logs from public.activity_logs;
 r:=public.create_employee_manual(b,e,br,' Employee One ',' Cook ',' Night ',120.5,700000,50000,2,3);
 perform pg_temp.employee_assert((r->>'updated_at')::timestamptz=token and (select count(*) from public.employees where id=e)=1 and (select count(*) from public.activity_logs)=logs,'stable retry no row or audit duplicate');
 perform pg_temp.employee_throws(format('select public.create_employee_manual(%L,%L,%L,%L,%L,null,0,0,0,0,0)',b,e,br,'Different','Cook'),'employee_request_conflict');
 r:=public.update_employee_manual(b,e,token,br,'Employee Edited','Chef','Morning',160,800000.99,45000,1,2); token2:=(r->>'updated_at')::timestamptz;
 perform pg_temp.employee_assert(token2>token and (r->>'monthly_cost')::numeric=800000.99 and (r->>'absences')::integer=1,'edit fields and monotonic version');
 perform pg_temp.employee_throws(format('select public.update_employee_manual(%L,%L,%L,%L,%L,%L,null,0,0,0,0,0)',b,e,token,br,'Stale','Cook'),'employee_stale_version');
 perform pg_temp.employee_throws(format('select public.set_employee_active_manual(%L,%L,%L,false)',b,e,token),'employee_stale_version');
 -- Legacy history fixture is seeded by the database owner; application DML is closed.
 execute 'reset role';
 insert into public.advance_payments(id,employee_id,amount) values('00000000-0000-4000-8000-000000000041',e,100);
 execute 'set local role authenticated';
 insert into public.shifts(id,employee_id,branch_id,weekday,from_time,to_time,hours) values('00000000-0000-4000-8000-000000000051',e,br,'mon','09:00','17:00',8);
 r:=public.set_employee_active_manual(b,e,token2,false);
 perform pg_temp.employee_assert(not (r->>'active')::boolean and (r->>'pending_advance')::numeric=45000,'archive retains outstanding advance');
 perform pg_temp.employee_assert(exists(select 1 from public.advance_payments where employee_id=e) and exists(select 1 from public.shifts where employee_id=e),'archive retains advance and shift history');
 r:=public.set_employee_active_manual(b,e,(r->>'updated_at')::timestamptz,true);
 perform pg_temp.employee_assert((r->>'active')::boolean,'restore');
 perform pg_temp.employee_assert(exists(select 1 from public.activity_logs where target_id=e and actor_id=auth.uid() and actor_role='owner' and action='employee.updated' and data->>'source'='manual' and data->'before'->>'full_name'='Employee One' and data->'after'->>'full_name'='Employee Edited'),'audit trusted actor and before/after');
 perform pg_temp.employee_assert(exists(select 1 from public.activity_logs where target_id=e and action='employee.archived') and exists(select 1 from public.activity_logs where target_id=e and action='employee.restored'),'archive and restore audit');
 perform pg_temp.employee_assert((public.employee_manual_summary(b,'Edited',true,br)->>'count')::int=1,'filtered summary');
 perform pg_temp.employee_throws(format('delete from public.employees where id=%L',e),'permission denied');
 perform pg_temp.employee_assert(exists(select 1 from public.employees where id=e),'authenticated cannot delete payroll');
end $$;
select public.create_employee_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000022','Other branch','Operative',null,0,0,0,0,0);
select pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000023','Wrong branch','Cook',null,0,0,0,0,0)$q$,'employee_branch_business_mismatch');
select pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),null,'Missing branch','Cook',null,0,0,0,0,0)$q$,'invalid_employee_input');
select pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000021','Invalid precision','Cook',null,0.001,0,0,0,0)$q$,'invalid_employee_input');
select pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000021','Invalid negative','Cook',null,0,-1,0,0,0)$q$,'invalid_employee');
select pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000021','Invalid hours','Cook',null,745,0,0,0,0)$q$,'invalid_employee');
select pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000021','Invalid incidents','Cook',null,0,0,0,32,0)$q$,'invalid_employee');
select pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000021',' ','Cook',null,0,0,0,0,0)$q$,'invalid_employee');
select pg_temp.employee_throws($q$update public.employees set business_id='00000000-0000-4000-8000-000000000012' where id='00000000-0000-4000-8000-000000000031'$q$,'permission denied');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select public.create_employee_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000021','Admin allowed','Operative',null,0,0,0,0,0);
-- Only owner/admin writes; inactive, unauthenticated and foreign actors fail closed.
do $$ declare actor text; begin foreach actor in array array['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000007','00000000-0000-4000-8000-000000000008',''] loop
 perform set_config('request.jwt.claim.sub',actor,true);
 perform pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000021','Forbidden','Cook',null,0,0,0,0,0)$q$,'employee_forbidden');
 perform pg_temp.employee_throws($q$select public.update_employee_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',now(),'00000000-0000-4000-8000-000000000021','Forbidden','Cook',null,0,0,0,0,0)$q$,'employee_forbidden');
 perform pg_temp.employee_throws($q$select public.set_employee_active_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',now(),false)$q$,'employee_forbidden');
 perform pg_temp.employee_throws('update public.employees set monthly_cost=123.456','permission denied');
 if actor not in ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004') then perform pg_temp.employee_assert(not exists(select 1 from public.employees),'unauthorized reads denied'); end if;
end loop; end $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.employee_assert(exists(select 1 from public.employees where id='00000000-0000-4000-8000-000000000031') and not exists(select 1 from public.employees where id in('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000039')),'viewer only assigned branch, never unassigned legacy');
select pg_temp.employee_assert(not exists(select 1 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000032'),'other branch payroll audit hidden');
update public.shifts set hours=1 where id='00000000-0000-4000-8000-000000000051';
select pg_temp.employee_assert((select hours from public.shifts where id='00000000-0000-4000-8000-000000000051')=8,'viewer cannot edit shifts');
-- Moving an employee cannot leak the old branch payroll in a new branch log.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select public.update_employee_manual(business_id,id,updated_at,'00000000-0000-4000-8000-000000000021',full_name,role,shift,monthly_hours,monthly_cost,pending_advance,absences,late_arrivals) from public.employees where id='00000000-0000-4000-8000-000000000032';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.employee_assert(exists(select 1 from public.employees where id='00000000-0000-4000-8000-000000000032') and not exists(select 1 from public.activity_logs where target_id='00000000-0000-4000-8000-000000000032'),'branch move audit requires both branches');
-- A disabled employees module blocks every entrypoint, including private kernels.
reset role;
update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000011' and module_key='employees';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000021','Forbidden module','Cook',null,0,0,0,0,0)$q$,'employee_forbidden');
select pg_temp.employee_throws($q$select employee_private.create_employee_manual('00000000-0000-4000-8000-000000000011',gen_random_uuid(),'00000000-0000-4000-8000-000000000021','Forbidden module','Cook',null,0,0,0,0,0)$q$,'employee_forbidden');
select pg_temp.employee_throws($q$select public.update_employee_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',now(),'00000000-0000-4000-8000-000000000021','Forbidden module','Cook',null,0,0,0,0,0)$q$,'employee_forbidden');
select pg_temp.employee_throws($q$select public.set_employee_active_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',now(),false)$q$,'employee_forbidden');
select pg_temp.employee_assert(not exists(select 1 from public.employees),'disabled module also hides payroll');
reset role;
update public.business_modules set enabled=true where business_id='00000000-0000-4000-8000-000000000011' and module_key='employees';
-- An audit failure rolls back the whole write and its version token.
reset role;
create function pg_temp.employee_fail_audit() returns trigger language plpgsql as $$ begin if new.target_type='employees' then raise exception 'forced_employee_audit_failure'; end if; return new; end $$;
create trigger employee_test_fail_audit before insert on public.activity_logs for each row execute function pg_temp.employee_fail_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare oldrow jsonb; token timestamptz; begin
 select to_jsonb(e),updated_at into oldrow,token from public.employees e where id='00000000-0000-4000-8000-000000000031';
 perform pg_temp.employee_throws($q$select public.create_employee_manual('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000021','Audit fail','Cook',null,0,0,0,0,0)$q$,'forced_employee_audit_failure');
 perform pg_temp.employee_throws(format('select public.update_employee_manual(%L,%L,%L,%L,%L,%L,null,0,0,0,0,0)','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',token,'00000000-0000-4000-8000-000000000021','Audit fail','Cook'),'forced_employee_audit_failure');
 perform pg_temp.employee_throws(format('select public.set_employee_active_manual(%L,%L,%L,false)','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',token),'forced_employee_audit_failure');
 perform pg_temp.employee_assert(not exists(select 1 from public.employees where id='00000000-0000-4000-8000-000000000099') and (select to_jsonb(e) from public.employees e where id='00000000-0000-4000-8000-000000000031')=oldrow,'audit failure is atomic for create/update/archive');
end $$;
rollback;
