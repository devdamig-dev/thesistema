-- Legacy records, new contracts, real inherited rows and RLS after upgrade.
-- All checks/mutations rollback. Never execute against production.
begin;
create function pg_temp.up_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin
 if p_ok is distinct from true then raise exception 'UPGRADE ASSERTION FAILED: %',p_message; end if;
end $$;
create function pg_temp.up_throws(p_sql text,p_expected text) returns void language plpgsql as $$ begin
 begin execute p_sql; exception when others then
  if position(p_expected in sqlerrm)>0 then return; end if;
  raise exception 'Expected %, got %',p_expected,sqlerrm;
 end;
 raise exception 'Expected %, statement succeeded',p_expected;
end $$;
select pg_temp.up_assert((select count(*)=3 and bool_and(quantity is null and unit is null) from public.recipe_items),'raw recipe text is never parsed into guessed quantities');
select pg_temp.up_assert(public.catalog_recipe_cost(pg_temp.u(71)) is null,'legacy incomplete recipe cost stays unknown');
select pg_temp.up_assert((select cost=432.10 from public.products where id=pg_temp.u(71)),'legacy product cost stays intact');
select pg_temp.up_assert((select unit='cajon' and active and preferred_supplier_id is null from public.ingredients where id=pg_temp.u(63)),'unsupported legacy unit is retained without guessed supplier');
select pg_temp.up_assert((select count(*)=3 and bool_and(active and notes is null) from public.customers),'legacy customers receive active default only');
select pg_temp.up_assert((select count(*)=2 and bool_and(active and payment_terms is null and notes is null) from public.suppliers),'legacy suppliers receive active default only');
select pg_temp.up_assert((select count(*)=4 and bool_and(status='active' and sale_kind='legacy' and version=0 and source is null and currency is null and payment_method is null and customer_id is null and created_by is null) from public.sales),'legacy sales retain unknown detail and provenance');
select pg_temp.up_assert(not exists(select 1 from public.sale_items) and not exists(select 1 from public.sale_mutations),'migration invents no sale detail or receipts');
select pg_temp.up_assert((select current=17.25 and min=3.50 from public.stock_items where id=pg_temp.u(101)),'historical stock is not replayed');
select pg_temp.up_assert((select current=-1.25 from public.stock_items where id=pg_temp.u(103)),'historical negative stock is not silently normalized');
select pg_temp.up_assert((select bool_and(business_id is null and actor_id is null and source is null and operation is null and balance_before is null and balance_after is null) from public.stock_movements),'legacy stock audit metadata stays unknown');
select pg_temp.up_assert((select bool_and(mode='single' and plan_version=0 and currency is null and origin is null and creditor_type is null and plan_definition is null and total_financed_amount is null and installment_count is null) from public.debts),'legacy debt is not invented financing');
select pg_temp.up_assert(not exists(select 1 from public.debt_installments) and not exists(select 1 from public.debt_payment_allocations),'no historical installments or allocations invented');
select pg_temp.up_assert((select count(*)=5 and bool_and(p.business_id=d.business_id and p.branch_id is not distinct from d.branch_id and p.origin is null and p.currency is null and p.request_id is null and p.allocation_rule is null) from public.debt_payments p join public.debts d on d.id=p.debt_id),'historical payment tenant/branch backfilled only from real debt');
select pg_temp.up_assert((select pending_amount=800 from public.debts where id=pg_temp.u(231)) and (select status='settled' and pending_amount=0 from public.debts where id=pg_temp.u(232)),'partial and settled debt money unchanged');
select pg_temp.up_assert((select count(*)=2 and bool_and(branch_id is null) from public.employees),'legacy employee branches stay unknown even with real shift branches');
select pg_temp.up_assert((select pending_advance=750.50 and monthly_cost=125000.25 from public.employees where id=pg_temp.u(191)),'employee totals are not reconciled from advance history');
select pg_temp.up_assert((select count(*)=2 and bool_and(business_id is null and branch_id is null and source is null and recorded_by is null and request_id is null) from public.advance_payments),'legacy advance provenance remains unknown');
select pg_temp.up_assert((select count(*)=2 and bool_and(source is null and version=0 and archived_at is null and manual_note is null) from public.daily_closures),'old closure raw text and status not promoted to manual');
select pg_temp.up_assert((select count(*)=2 and bool_and(record_status='active' and source is null and version=0 and created_by is null) from public.expenses),'legacy expenses preserve payment status and unknown origin');
select pg_temp.up_assert((select count(*)=3 and bool_and(edit_version=0 and reviewed_version is null and reviewed_by is null and reviewed_at is null) from public.invoices),'old OCR is not falsely marked manually reviewed');
select pg_temp.up_assert((select count(*)=2 and bool_and(review_position is null) from public.invoice_items),'old invoice line ordering is not fabricated');
select pg_temp.up_assert((select count(*)=2 and bool_and(purchase_kind='legacy' and source is null and manual_request_id is null and manual_payload is null and origin_extraction_id is null and origin_pending_id is null) from public.purchases),'legacy purchases retain factual provenance only');
select pg_temp.up_assert((select count(*)=1 and bool_and(not sales_data_stale and not payroll_data_stale and not expenses_data_stale and not purchases_data_stale) from public.balance_snapshots),'migration does not post duplicate bookkeeping or invalidate untouched totals');
select pg_temp.up_assert((select count(*)=6 from public.ai_extractions) and (select count(*)=2 from public.whatsapp_agent_pending_operations),'pending and approved inbox/WhatsApp preserved');
select pg_temp.up_assert(not exists(select 1 from public.debt_plan_mutations) and not exists(select 1 from public.closure_mutations) and not exists(select 1 from public.expense_mutations) and not exists(select 1 from public.invoice_mutations),'no migration-generated mutation receipts');
select pg_temp.up_assert(not exists(select 1 from pg_tables where schemaname='public' and not rowsecurity),'all exposed tables retain RLS');
select pg_temp.up_assert(not has_table_privilege('authenticated','public.sales','INSERT') and not has_table_privilege('authenticated','public.expenses','UPDATE') and not has_table_privilege('authenticated','public.employees','DELETE'),'raw direct mutations closed after upgrade');
select pg_temp.up_assert(not has_function_privilege('anon','public.save_sale_atomic(uuid,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.approve_employee_advance_extraction_atomic(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE'),'RPC actor boundaries installed');
select pg_temp.up_throws(format('update public.invoices set total=1 where id=%L',pg_temp.u(121)),'invoice_readonly');
select pg_temp.up_throws(format('update public.invoice_items set total=1 where invoice_id=%L',pg_temp.u(121)),'invoice_readonly');

set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.u(1)::text,true);
select pg_temp.up_assert((select count(*)=2 from public.employees),'owner sees unassigned legacy employees');
select pg_temp.up_assert((select count(*)=4 from public.sales),'dual owner sees legitimate historical tenants');
-- First real edits against pre-upgrade rows succeed using their inherited CAS.
do $$ declare r jsonb; c public.customers%rowtype; s public.suppliers%rowtype; e public.employees%rowtype; begin
 select * into c from public.customers where id=pg_temp.u(51);
 r:=public.save_customer_atomic(pg_temp.u(11),jsonb_build_object('id',c.id,'expectedUpdatedAt',to_char(c.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'name','Synthetic edited regular','phone',c.phone,'email',c.email,'channel',c.channel,'notes','Reviewed after migration','active',true));
 perform pg_temp.up_assert(r->>'ok'='true','legacy customer editable after upgrade');
 perform pg_temp.up_assert((select visits=12 and total_spend=25001.99 from public.customers where id=c.id),'customer edit keeps legacy metrics');
 select * into s from public.suppliers where id=pg_temp.u(41);
 r:=public.update_supplier_manual(s.business_id,s.id,s.updated_at,'Synthetic edited supplier',s.tax_id,s.category,s.phone,s.email,'30 days','Reviewed');
 perform pg_temp.up_assert(r->>'name'='Synthetic edited supplier','legacy supplier editable with inherited CAS');
 select * into e from public.employees where id=pg_temp.u(191);
 perform pg_temp.up_throws(format('select public.update_employee_manual(%L,%L,%L,null,%L,%L,null,0,0,0,0,0)',e.business_id,e.id,e.updated_at,e.full_name,e.role),'invalid_employee_input');
 r:=public.update_employee_manual(e.business_id,e.id,e.updated_at,pg_temp.u(31),'Synthetic edited employee',e.role,e.shift,e.monthly_hours,e.monthly_cost,e.pending_advance,e.absences,e.late_arrivals);
 perform pg_temp.up_assert(r->>'full_name'='Synthetic edited employee' and (r->>'branch_id')::uuid=pg_temp.u(31),'legacy employee editable only after explicit branch assignment');
 perform pg_temp.up_assert((select count(*)=2 from public.shifts where employee_id=e.id) and (select count(*)=2 from public.advance_payments where employee_id=e.id),'legacy employee edit retains old shifts/advances');
 r:=public.recalc_product_recipe_cost(pg_temp.u(11),pg_temp.u(71));
 perform pg_temp.up_assert(r->>'error'='recipe_incomplete','legacy free-text recipe cannot silently overwrite cost');
 r:=public.void_sale_atomic(pg_temp.u(11),jsonb_build_object('requestId',pg_temp.u(401),'businessId',pg_temp.u(11),'userId',pg_temp.u(1),'id',pg_temp.u(172),'expectedVersion',0,'reason','Synthetic legacy reversal'));
 perform pg_temp.up_assert(r->>'ok'='true','legacy unassigned sale can be voided atomically');
 perform pg_temp.up_assert((select status='voided' and amount=3000 and sale_kind='legacy' and source is null from public.sales where id=pg_temp.u(172)),'legacy void preserves unknown historical facts');
 perform pg_temp.up_assert((select current=17.25 from public.stock_items where id=pg_temp.u(101)),'legacy edits never replay stock');
 r:=public.register_debt_payment_atomic(pg_temp.u(231),pg_temp.u(11),pg_temp.u(1),25.25,'Efectivo',date '2026-10-01','Synthetic genuine payment after upgrade');
 perform pg_temp.up_assert(r->>'ok'='true','genuine future payment works after metadata backfill');
 perform pg_temp.up_assert((select pending_amount=774.75 and status='active' from public.debts where id=pg_temp.u(231)),'future payment still recalculates real financial balance');
end $$;
select set_config('request.jwt.claim.sub',pg_temp.u(3)::text,true);
select pg_temp.up_assert(not exists(select 1 from public.sales where business_id<>pg_temp.u(11) or branch_id<>pg_temp.u(31)) and exists(select 1 from public.sales where id=pg_temp.u(172)),'cashier keeps baseline business-wide null-branch visibility but no foreign branch/tenant');
select pg_temp.up_assert(not exists(select 1 from public.employees),'cashier cannot read legacy payroll');
select pg_temp.up_assert(not exists(select 1 from public.expenses),'cashier cannot read legacy expenses');
select pg_temp.up_assert(not exists(select 1 from public.customers where business_id=pg_temp.u(12)),'foreign tenant customers remain hidden');
rollback;
