-- Offline fixtures only; every write rolls back. Run via npm run test:replenishment:sql
-- or against LOCAL Supabase after migrations. Never run fixtures in production.
begin;
create function pg_temp.s_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if;
end; $$;
create function pg_temp.s_throws(p_sql text,p_message text) returns void language plpgsql security invoker as $$ begin
  begin execute p_sql;
  exception when others then
    if position(p_message in sqlerrm)>0 then return; end if;
    raise exception 'Expected %, received %',p_message,sqlerrm;
  end;
  raise exception 'Expected %, but statement succeeded',p_message;
end; $$;
insert into auth.users(id,email) select ('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'sale-'||i||'@example.invalid' from generate_series(1,11) i;
insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000000020','Offline sales test');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000020' where id::text like '00000000-0000-4000-8000-%';
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000004';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000020','Stock A'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000020','Stock B');
insert into public.business_members(id,business_id,user_id,role) select
 ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000000021',('00000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,
 r::public.role_key from unnest(array['owner','admin','viewer','owner','kitchen','employee','cashier','waiter','delivery','manager','accountant']) with ordinality t(r,i);
-- Dual membership must not allow combining an ingredient from one business with
-- a branch from another business, even for an unrestricted owner.
insert into public.business_members(business_id,user_id,role) values('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000001','owner');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000021','Branch A1'),
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000021','Branch A2'),
 ('00000000-0000-4000-8000-000000000033','00000000-0000-4000-8000-000000000022','Branch B');
insert into public.branch_assignments(business_member_id,branch_id) select
 ('00000000-0000-4000-8000-'||lpad((100+i)::text,12,'0'))::uuid,'00000000-0000-4000-8000-000000000031' from generate_series(3,9) i;
insert into public.ingredients(id,business_id,name,unit,avg_unit_cost) values
 ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000021','Beef','kg',1000),
 ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000021','Milk','ml',1),
 ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000021','Bun','unit',100),
 ('00000000-0000-4000-8000-000000000044','00000000-0000-4000-8000-000000000022','Foreign','kg',1000);

insert into public.business_modules(business_id,module_key,enabled) select b.id,k::public.module_key,true from public.businesses b cross join unnest(array['stock','sales','products','purchases']) k;
insert into public.suppliers(id,business_id,name) values ('00000000-0000-4000-8000-000000000080','00000000-0000-4000-8000-000000000021','QA supplier');

-- Every report source and authorization parent invalidates the revision.
select pg_temp.s_assert((select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where t.tgname='replenishment_revision' and c.relname=any(array['ingredients','stock_items','stock_movements','sales','sale_items','purchases','purchase_items','branches','businesses','business_members','business_modules','branch_assignments','profiles']))=13,'all data and permission sources guarded');
select pg_temp.s_assert(not has_schema_privilege('authenticated','replenishment_private','USAGE'),'private schema inaccessible');
select pg_temp.s_assert(not has_function_privilege('anon','public.get_replenishment_revision(uuid,uuid)','EXECUTE'),'anonymous revision denied');
select pg_temp.s_assert(not has_table_privilege('authenticated','replenishment_private.revisions','UPDATE'),'revisions unforgeable');
select pg_temp.s_assert(not has_table_privilege('service_role','replenishment_private.revisions','UPDATE'),'service revision unforgeable');
select pg_temp.s_assert(not has_column_privilege('authenticated','public.stock_items','current','UPDATE'),'no balance permissions added');
select pg_temp.s_assert(not has_table_privilege('authenticated','public.sale_items','INSERT'),'no sale write permissions added');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare prior bigint; after_stock bigint; p uuid; r jsonb; begin
 prior:=public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint;
 perform public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',10,'QA restock','kg');
 after_stock:=public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint;
 perform pg_temp.s_assert(after_stock>prior,'stock ledger and balance revision'); prior:=after_stock;
 update public.stock_items set min=20 where ingredient_id='00000000-0000-4000-8000-000000000041';
 perform pg_temp.s_assert(public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint>prior,'minimum edit revision');
 prior:=public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint;
 perform public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000021','{"requestId":"00000000-0000-4000-8000-000000000201","branchId":"00000000-0000-4000-8000-000000000031","supplierId":"00000000-0000-4000-8000-000000000080","purchasedAt":"2026-10-09","paymentMethod":"Cuenta corriente","items":[{"ingredientId":"00000000-0000-4000-8000-000000000041","description":"Beef","qty":"1","unit":"kg","unitPrice":"10"}]}');
 perform pg_temp.s_assert(public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint>prior,'purchase with linked details revision');
 select id into p from public.purchases where manual_request_id='00000000-0000-4000-8000-000000000201';
 prior:=public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint;
 perform public.void_purchase_manual_atomic('00000000-0000-4000-8000-000000000021',p,1,'QA void');
 perform pg_temp.s_assert(public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint>prior,'voided purchase revision');
 prior:=public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint;
 r:=public.save_sale_atomic('00000000-0000-4000-8000-000000000021','{"requestId":"00000000-0000-4000-8000-000000000202","businessId":"00000000-0000-4000-8000-000000000021","userId":"00000000-0000-4000-8000-000000000001","id":null,"expectedVersion":null,"branchId":"00000000-0000-4000-8000-000000000031","occurredAt":"2026-01-01T12:00:00Z","channel":"salon","paymentMethod":"Efectivo","customerId":null,"notes":null,"items":[{"id":null,"productId":null,"description":"QA sale","quantity":"2","unitPrice":"10"}]}');
 perform pg_temp.s_assert(r->>'ok'='true','sale saved');
 perform pg_temp.s_assert(public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint>prior,'sale and line revision');
 prior:=public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint;
 begin
  perform public.adjust_stock_manual('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','in',1,'QA rolled back','kg');
  raise exception 'fixture_rollback';
 exception when others then if sqlerrm<>'fixture_rollback' then raise; end if; end;
 perform pg_temp.s_assert(public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint=prior,'revision rollback is atomic');
end $$;
select pg_temp.s_throws($q$select public.get_replenishment_revision('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000002')$q$,'replenishment_actor_forbidden');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
select pg_temp.s_assert(public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())::bigint>0,'viewer read supported');
select pg_temp.s_throws($q$select public.get_replenishment_revision('00000000-0000-4000-8000-000000000022',auth.uid())$q$,'replenishment_access_forbidden');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',true);
select pg_temp.s_throws($q$select public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())$q$,'replenishment_access_forbidden');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000011',true);
select pg_temp.s_throws($q$select public.get_replenishment_revision('00000000-0000-4000-8000-000000000021',auth.uid())$q$,'replenishment_access_forbidden');
set local role service_role;
select pg_temp.s_assert(public.get_replenishment_revision('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000005')::bigint>0,'service actor read validated');
select pg_temp.s_throws($q$select public.get_replenishment_revision('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000004')$q$,'replenishment_access_forbidden');
reset role;
-- Same-count changes and permission ABA transitions still alter the token.
do $$ declare prior bigint; other bigint; begin
 select sum(revision) into prior from replenishment_private.revisions where business_id='00000000-0000-4000-8000-000000000021';
 select sum(revision) into other from replenishment_private.revisions where business_id='00000000-0000-4000-8000-000000000022';
 update public.ingredients set name='Renamed' where id='00000000-0000-4000-8000-000000000041';
 perform pg_temp.s_assert((select sum(revision)>prior from replenishment_private.revisions where business_id='00000000-0000-4000-8000-000000000021'),'ingredient same-count edit');
 perform pg_temp.s_assert((select sum(revision)=other from replenishment_private.revisions where business_id='00000000-0000-4000-8000-000000000022'),'unrelated tenant unaffected');
 select sum(revision) into prior from replenishment_private.revisions where business_id='00000000-0000-4000-8000-000000000021';
 update public.profiles set active=false where id='00000000-0000-4000-8000-000000000005';
 update public.profiles set active=true where id='00000000-0000-4000-8000-000000000005';
 perform pg_temp.s_assert((select sum(revision)>=prior+2 from replenishment_private.revisions where business_id='00000000-0000-4000-8000-000000000021'),'profile ABA detected');
 select sum(revision) into prior from replenishment_private.revisions where business_id='00000000-0000-4000-8000-000000000021';
 delete from public.branch_assignments where business_member_id='00000000-0000-4000-8000-000000000105';
 perform pg_temp.s_assert((select sum(revision)>prior from replenishment_private.revisions where business_id='00000000-0000-4000-8000-000000000021'),'branch revocation revision');
end $$;
update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000021' and module_key='stock';
set local role service_role;
select pg_temp.s_throws($q$select public.get_replenishment_revision('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001')$q$,'replenishment_access_forbidden');
reset role;
rollback;
