-- Offline fixtures only. Every test rolls back. No remote database is used.
begin;
create function pg_temp.e_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin
 if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if;
end $$;
create function pg_temp.e_throws(p_sql text,p_message text) returns void language plpgsql as $$begin begin execute p_sql;exception when others then if position(p_message in sqlerrm)>0 then return;end if;raise exception 'Expected %, received %',p_message,sqlerrm;end;raise exception 'Expected failure %',p_message;end$$;
insert into auth.users(id,email) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'expense-'||i||'@example.invalid' from generate_series(1,7) i;
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000000020','Offline expense test');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000020' where id::text like '00000000-0000-4000-8000-%';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000004';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','Business A'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000020','Business B');
insert into public.business_members(id,business_id,user_id,role) select
 ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000021',
 ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,r::public.role_key
 from unnest(array['owner','admin','viewer','owner','employee','manager','accountant']) with ordinality t(r,i);
insert into public.business_members(business_id,user_id,role) values('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','owner');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000021','Branch A1'),
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000021','Branch A2'),
 ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000022','Branch B');
insert into public.business_modules(business_id,module_key,enabled) select id,'fixed_expenses',true from public.businesses;
insert into public.expenses(id,business_id,branch_id,name,amount,status) values
 ('00000000-0000-4000-8000-000000000091','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','Legacy rent',1000,'historic-status');
insert into public.balance_snapshots(business_id,period_month,expenses_total) values('00000000-0000-4000-8000-000000000021','2026-01-01',1000);
create function pg_temp.expense_input(p_request text default '00000000-0000-4000-8000-000000000201',p_actor text default '00000000-0000-4000-8000-000000000001') returns jsonb language sql as $$
 select jsonb_build_object('requestId',p_request,'businessId','00000000-0000-4000-8000-000000000021','userId',p_actor,'id',null,'expectedVersion',null,'branchId','00000000-0000-4000-8000-000000000031','name','Internet','category','Servicios','amount','123.45','dueDate','2026-10-31','status','paid')
$$;

insert into public.suppliers(id,business_id,name,active) values
 ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000021','Active supplier',true),
 ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000021','Archived supplier',false),
 ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000022','Other tenant supplier',true);
create function pg_temp.expense_full(p_request text default '00000000-0000-4000-8000-000000000501') returns jsonb language sql as $$
 select pg_temp.expense_input(p_request)||'{"expenseDate":"2026-10-09","paymentMethod":"Transferencia","supplierId":"00000000-0000-4000-8000-000000000041","isRecurring":true,"periodicity":"monthly"}'::jsonb
$$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare r jsonb; again jsonb; p jsonb:=pg_temp.expense_full(); eid uuid; legacy_input jsonb; legacy_result jsonb; before_revision text; begin
 before_revision:=public.get_expenses_revision('00000000-0000-4000-8000-000000000021');
 r:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p); eid:=(r->>'id')::uuid;
 perform pg_temp.e_assert(r->>'ok'='true','new full expense persisted: '||r::text);
 perform pg_temp.e_assert((select expense_date='2026-10-09' and due_date='2026-10-31' and payment_method='Transferencia' and supplier_id='00000000-0000-4000-8000-000000000041' and is_recurring and periodicity='monthly' from public.expenses where id=eid),'operational fields stored independently');
 perform pg_temp.e_assert(public.get_expenses_revision('00000000-0000-4000-8000-000000000021')::bigint=before_revision::bigint+1,'single revision increment');
 perform pg_temp.e_assert((select after_snapshot->>'expense_date'='2026-10-09' and after_snapshot->>'payment_method'='Transferencia' and after_snapshot->>'supplier_id'='00000000-0000-4000-8000-000000000041' and after_snapshot->>'is_recurring'='true' and after_snapshot->>'periodicity'='monthly' from public.expense_mutations where request_id=(p->>'requestId')::uuid),'audit captures complete operational fields');
 again:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.e_assert(again=r,'exact replay retains original receipt');
 perform pg_temp.e_assert((select count(*)=1 from public.expense_mutations where expense_id=eid),'replay creates no audit/charge');
 for again in select * from jsonb_array_elements('[{"expenseDate":"2026-10-10"},{"paymentMethod":"Efectivo"},{"supplierId":null},{"isRecurring":false,"periodicity":null},{"periodicity":"yearly"}]') loop
  perform pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p||again)->>'error'='expense_idempotency_conflict','changed fact cannot reuse receipt');
 end loop;
 -- An older deployed UI may edit base fields. Absence must not erase metadata.
 legacy_input:=pg_temp.expense_input(gen_random_uuid()::text)||jsonb_build_object('id',eid,'expectedVersion',1,'name','Legacy transport correction');
 again:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',legacy_input); legacy_result:=again;
 perform pg_temp.e_assert(again->>'ok'='true','legacy payload edit accepted');
 perform pg_temp.e_assert((select expense_date='2026-10-09' and payment_method='Transferencia' and supplier_id='00000000-0000-4000-8000-000000000041' and is_recurring and periodicity='monthly' from public.expenses where id=eid),'legacy edit preserves declared metadata');
 again:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p||jsonb_build_object('requestId',gen_random_uuid(),'id',eid,'expectedVersion',1));
 perform pg_temp.e_assert(again->>'error'='expense_conflict','extended changes respect CAS');
 p:=p||jsonb_build_object('requestId',gen_random_uuid(),'id',eid,'expectedVersion',2,'expenseDate','2026-10-08','paymentMethod','Efectivo','supplierId',null,'isRecurring',false,'periodicity',null);
 again:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.e_assert(again->>'version'='3','extended edit advances version once');
 perform pg_temp.e_assert((select expense_date='2026-10-08' and payment_method='Efectivo' and supplier_id is null and is_recurring=false and periodicity is null from public.expenses where id=eid),'explicit nonrecurring and optional supplier clear');
 perform pg_temp.e_assert((select before_snapshot->>'expense_date'='2026-10-09' and before_snapshot->>'is_recurring'='true' and after_snapshot->>'expense_date'='2026-10-08' and after_snapshot->>'is_recurring'='false' from public.expense_mutations where request_id=(p->>'requestId')::uuid),'audit records old and new facts');
 again:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',legacy_input);
 perform pg_temp.e_assert(again=legacy_result,'old payload replay keeps its original version and receipt after a newer extended edit');
 perform pg_temp.e_assert((select expense_date='2026-10-08' and payment_method='Efectivo' and supplier_id is null and is_recurring=false and periodicity is null and version=3 from public.expenses where id=eid),'old payload replay never overwrites newer metadata');
 perform pg_temp.e_assert((select count(*)=3 from public.expense_mutations where expense_id=eid),'old payload replay creates no new receipt');
 p:=jsonb_build_object('requestId',gen_random_uuid(),'businessId',p->>'businessId','userId',auth.uid(),'id',eid,'expectedVersion',3,'reason','Offline test void');
 perform pg_temp.e_assert(public.void_expense_atomic('00000000-0000-4000-8000-000000000021',p)->>'ok'='true','void accepts full row');
 p:=p||jsonb_build_object('requestId',gen_random_uuid(),'expectedVersion',4,'reason','Offline test restore');
 perform pg_temp.e_assert(public.restore_expense_atomic('00000000-0000-4000-8000-000000000021',p)->>'ok'='true','restore accepts full row');
 perform pg_temp.e_assert((select expense_date='2026-10-08' and payment_method='Efectivo' and is_recurring=false and version=5 from public.expenses where id=eid),'void and restore preserve metadata');
 perform pg_temp.e_assert((select expense_date is null and payment_method is null and supplier_id is null and is_recurring is null and periodicity is null from public.expenses where id='00000000-0000-4000-8000-000000000091'),'historical unknowns are not invented');
 -- Explicit unknowns can be retained while correcting a legacy row.
 p:=pg_temp.expense_full(gen_random_uuid()::text)||'{"id":"00000000-0000-4000-8000-000000000091","expectedVersion":0,"expenseDate":null,"paymentMethod":null,"supplierId":null,"isRecurring":null,"periodicity":null}'::jsonb;
 perform pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p)->>'ok'='true','historical nulls survive explicit edit');
 perform pg_temp.e_assert((select count(*)=0 from public.debt_payments),'recurrence never executes a payment');
end $$;
-- Every malformed field fails before any row, audit or revision is committed.
do $$ declare bad jsonb; p jsonb; r jsonb; n int; audit_count int; rev text; field text; begin
 select count(*) into n from public.expenses; select count(*) into audit_count from public.expense_mutations; rev:=public.get_expenses_revision('00000000-0000-4000-8000-000000000021');
 for bad in select * from jsonb_array_elements('[{"expenseDate":null},{"expenseDate":"2026-02-30"},{"expenseDate":"0000-01-01"},{"expenseDate":"infinity"},{"expenseDate":42},{"paymentMethod":null},{"paymentMethod":""},{"paymentMethod":false},{"supplierId":"bad"},{"supplierId":"00000000-0000-4000-8000-000000000042"},{"supplierId":"00000000-0000-4000-8000-000000000043"},{"isRecurring":null},{"isRecurring":"false"},{"isRecurring":1},{"periodicity":null},{"periodicity":"sometimes"},{"periodicity":false},{"isRecurring":false},{"branchId":"00000000-0000-4000-8000-000000000033"}]') loop
  r:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_full(gen_random_uuid()::text)||bad);
  perform pg_temp.e_assert(r->>'ok'='false','invalid extended input rejected: '||bad::text);
 end loop;
 foreach field in array array['expenseDate','paymentMethod','supplierId','isRecurring','periodicity'] loop
  perform pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_full(gen_random_uuid()::text)-field)->>'ok'='false','partial field group rejected');
 end loop;
 perform pg_temp.e_assert((select count(*) from public.expenses)=n,'rejections preserve expense count');
 perform pg_temp.e_assert((select count(*) from public.expense_mutations)=audit_count,'rejections preserve audit count');
 perform pg_temp.e_assert(public.get_expenses_revision('00000000-0000-4000-8000-000000000021')=rev,'rejections preserve revision');
end $$;
-- Supplier archival cannot invalidate an exact receipt or erase historical linkage.
select pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_full('00000000-0000-4000-8000-000000000502'))->>'ok'='true','supplier-linked expense created');
reset role;
update public.suppliers set active=false where id='00000000-0000-4000-8000-000000000041';
set local role authenticated;
do $$ declare r jsonb; p jsonb:=pg_temp.expense_full('00000000-0000-4000-8000-000000000502'); begin
 r:=public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p);
 perform pg_temp.e_assert(r->>'ok'='true' and r->>'version'='1','exact retry remains valid after supplier archived');
 p:=p||jsonb_build_object('requestId',gen_random_uuid(),'id',r->>'id','expectedVersion',1,'name','Preserve archived supplier');
 perform pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',p)->>'ok'='true','same archived supplier preserved by edit');
 perform pg_temp.e_assert(public.save_expense_atomic('00000000-0000-4000-8000-000000000021',pg_temp.expense_full(gen_random_uuid()::text))->>'error'='expense_supplier_forbidden','archived supplier cannot be linked to a new expense');
end $$;
reset role;
-- Defense in depth: even privileged malformed cross-tenant linkage hits the FK.
select pg_temp.e_throws($q$update public.expenses set supplier_id='00000000-0000-4000-8000-000000000043' where id='00000000-0000-4000-8000-000000000091'$q$,'expenses_supplier_business_fk');
select pg_temp.e_throws($q$update public.expenses set is_recurring=true,periodicity=null where id='00000000-0000-4000-8000-000000000091'$q$,'expenses_recurrence_complete');
update public.suppliers set active=true where id='00000000-0000-4000-8000-000000000041';
-- Trusted WhatsApp transport uses exactly the same reviewed fields and tenant rules.
set local role service_role;
select pg_temp.e_assert(public.mutate_expense_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','save',pg_temp.expense_full('00000000-0000-4000-8000-000000000503'))->>'ok'='true','agent extended input persists');
select pg_temp.e_assert(public.mutate_expense_for_agent('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','save',pg_temp.expense_full(gen_random_uuid()::text)||'{"supplierId":"00000000-0000-4000-8000-000000000043"}')->>'error'='expense_supplier_forbidden','agent cannot attach foreign supplier');
reset role;
insert into public.business_modules(business_id,module_key,enabled) values('00000000-0000-4000-8000-000000000021','inbox_ai',true);
insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,channel,raw) values('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','Operator','text','Offline reviewed expense');
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status) values('00000000-0000-4000-8000-000000000602','00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000031','expense','{"date":"2026-10-07","payment_method":"Efectivo"}','pending');
set local role authenticated;
do $$ declare p jsonb:=pg_temp.expense_full()-array['requestId','businessId','userId','id','expectedVersion']; r jsonb; again jsonb; original jsonb:='{"date":"2026-10-07","payment_method":"Efectivo"}'; begin
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000602',original,p||'{"supplierId":"00000000-0000-4000-8000-000000000043"}');
 perform pg_temp.e_assert(r->>'error'='expense_supplier_forbidden','Inbox rejects foreign supplier');
 perform pg_temp.e_assert((select status='pending' and target_record_id is null from public.ai_extractions where id='00000000-0000-4000-8000-000000000602'),'invalid new facts cannot partially approve');
 r:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000602',original,p);
 perform pg_temp.e_assert(r->>'ok'='true','Inbox extended approval succeeds: '||r::text);
 perform pg_temp.e_assert((select expense_date='2026-10-09' and due_date='2026-10-31' and payment_method='Transferencia' and is_recurring and periodicity='monthly' and source='inbox' from public.expenses where id=(r->>'id')::uuid),'Inbox persists review independently from OCR hints');
 perform pg_temp.e_assert((select fields=original from public.ai_extractions where id='00000000-0000-4000-8000-000000000602'),'original OCR evidence unchanged');
 again:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000602',original,p);
 perform pg_temp.e_assert(again=r,'Inbox exact extended replay succeeds');
 again:=public.approve_expense_extraction_atomic('00000000-0000-4000-8000-000000000021',auth.uid(),'00000000-0000-4000-8000-000000000602',original,p||'{"periodicity":"yearly"}');
 perform pg_temp.e_assert(again->>'error'='expense_idempotency_conflict','Inbox changed recurrence is not a replay');
 perform pg_temp.e_assert((select count(*)=1 from public.expense_mutations where expense_id=(r->>'id')::uuid),'recurrence creates one expense and one receipt only');
end $$;
reset role;
rollback;
