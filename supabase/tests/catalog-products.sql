-- Shared product creation and persisted transport provenance. All fixtures roll back.
begin;
create function pg_temp.product_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if;
end; $$;
create function pg_temp.product_throws(p_sql text,p_message text)
returns void language plpgsql security invoker as $$ begin
  begin execute p_sql;
  exception when others then
    if position(p_message in sqlerrm)>0 then return; end if;
    raise exception 'Expected %, got %',p_message,sqlerrm;
  end;
  raise exception 'Expected %, but statement succeeded',p_message;
end; $$;
insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','product-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','product-admin@example.invalid'),
 ('00000000-0000-4000-8000-000000000003','product-manager@example.invalid'),
 ('00000000-0000-4000-8000-000000000004','product-viewer@example.invalid'),
 ('00000000-0000-4000-8000-000000000005','product-inactive@example.invalid');
insert into public.organizations(id,name) values ('00000000-0000-4000-8000-000000000010','Product test org');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000010'
 where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005');
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000005';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','Product A'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','Product B');
insert into public.business_members(business_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','admin'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003','manager'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000004','viewer'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000005','owner');
insert into public.business_modules(business_id,module_key,enabled) values
 ('00000000-0000-4000-8000-000000000011','products',true),
 ('00000000-0000-4000-8000-000000000012','products',true)
 on conflict(business_id,module_key) do update set enabled=true;
insert into public.products(id,business_id,name,category,price,cost) values
 ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000011','Historical origin unknown','Food',10,2);
select pg_temp.product_assert((select source is null and created_by is null from public.products where id='00000000-0000-4000-8000-000000000051'),'unknown provenance is not fabricated');
select pg_temp.product_assert(not (select prosecdef from pg_proc where oid='public.create_product_atomic(uuid,jsonb,uuid)'::regprocedure),'domain RPC remains invoker');
select pg_temp.product_assert(not has_function_privilege('anon','public.create_product_atomic(uuid,jsonb,uuid)','execute'),'anon cannot call creation RPC');
select pg_temp.product_assert(not has_function_privilege('authenticated','public.catalog_guard_product_creation()','execute'),'guard trigger is not exposed');

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare r jsonb; v_id uuid; before_count bigint; input jsonb;
 base jsonb := '{"name":"  Hamburguesa  ","category":"  Comida  ","price":1250.50,"cost":432.10,"active":false}';
begin
 r:=public.create_product_atomic('00000000-0000-4000-8000-000000000011',base,null); v_id:=(r->>'id')::uuid;
 perform pg_temp.product_assert(r->>'source'='manual' and r->>'actor_id'=auth.uid()::text,'manual session-derived receipt');
 perform pg_temp.product_assert(exists(select 1 from public.products p where p.id=v_id and p.name='Hamburguesa'
  and p.category='Comida' and p.price=1250.50 and p.cost=432.10 and not p.active and p.source='manual' and p.created_by=auth.uid()),'manual fields persist exactly');
 perform pg_temp.product_assert(exists(select 1 from public.activity_logs l where l.target_id=v_id and l.action='catalog.products.insert'
  and l.actor_id=auth.uid() and l.actor_role='owner' and l.business_id='00000000-0000-4000-8000-000000000011'
  and l.data->>'source'='manual' and l.data->>'result'='success' and l.data->'branch_id'='null'::jsonb),'manual atomic provenance audit');
 perform pg_temp.product_assert(not exists(select 1 from public.recipes where product_id=v_id),'creation does not guess a composition');
 r:=public.create_product_atomic('00000000-0000-4000-8000-000000000011',base||'{"price":0,"cost":0,"active":true}',null);
 perform pg_temp.product_assert((r->>'ok')::boolean,'explicit zero price and cost are valid');
 select count(*) into before_count from public.products;
 for input in select value from jsonb_array_elements(jsonb_build_array(
   base-'category',base-'cost',base-'active',base-'price',base-'name',
   base||'{"category":" "}',base||'{"cost":null}',base||'{"price":-1}',base||'{"active":"false"}',base||'{"price":10000000000}',base||'{"cost":"NaN"}',
   base||'{"business_id":"00000000-0000-4000-8000-000000000012"}',base||'{"source":"whatsapp"}',
   base||'{"recipe":[{"ingredientId":"00000000-0000-4000-8000-000000000011","quantity":180,"unit":"g"}]}',base||'{"ingredients":[]}')) loop
   perform pg_temp.product_throws(format('select public.create_product_atomic(%L,%L::jsonb,null)','00000000-0000-4000-8000-000000000011',input),'invalid_product_fields');
 end loop;
 perform pg_temp.product_assert((select count(*) from public.products)=before_count,'invalid payloads cannot partially insert');
end; $$;
select pg_temp.product_throws($q$select public.create_product_atomic('00000000-0000-4000-8000-000000000011','{"name":"Spoof","category":"Food","price":10,"cost":1,"active":true}','00000000-0000-4000-8000-000000000002')$q$,'product_actor_forbidden');
select pg_temp.product_throws($q$insert into public.products(business_id,name,category,price,cost,source,created_by) values('00000000-0000-4000-8000-000000000011','Spoof','Food',10,1,'whatsapp','00000000-0000-4000-8000-000000000001')$q$,'product_actor_forbidden');
select pg_temp.product_throws($q$update public.products set source='manual',created_by=auth.uid() where id='00000000-0000-4000-8000-000000000051'$q$,'product_creation_origin_immutable');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.product_throws($q$select public.create_product_atomic('00000000-0000-4000-8000-000000000012','{"name":"Foreign","category":"Food","price":10,"cost":1,"active":true}',null)$q$,'product_actor_forbidden');
do $$ declare actor text; begin
 foreach actor in array array['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005',''] loop
  perform set_config('request.jwt.claim.sub',actor,true);
  perform pg_temp.product_throws($q$select public.create_product_atomic('00000000-0000-4000-8000-000000000011','{"name":"Denied","category":"Food","price":10,"cost":1,"active":true}',null)$q$,case when actor='00000000-0000-4000-8000-000000000005' then 'catalog_actor_inactive' else 'product_actor_forbidden' end);
 end loop;
end; $$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare r jsonb; v_id uuid; actor text;
 base jsonb := '{"name":"Hamburguesa","category":"Comida","price":1250.50,"cost":432.10,"active":false}';
begin
 r:=public.create_product_atomic('00000000-0000-4000-8000-000000000011',base,'00000000-0000-4000-8000-000000000002'); v_id:=(r->>'id')::uuid;
 perform pg_temp.product_assert(r->>'source'='whatsapp' and r->>'actor_id'='00000000-0000-4000-8000-000000000002','WhatsApp verified-actor receipt');
 perform pg_temp.product_assert(exists(select 1 from public.products p where p.id=v_id and p.name='Hamburguesa'
  and p.category='Comida' and p.price=1250.50 and p.cost=432.10 and not p.active and p.source='whatsapp'
  and p.created_by='00000000-0000-4000-8000-000000000002'),'WhatsApp same fields without defaulting');
 perform pg_temp.product_assert(exists(select 1 from public.activity_logs l where l.target_id=v_id and l.action='catalog.products.insert'
  and l.actor_id='00000000-0000-4000-8000-000000000002' and l.actor_role='admin' and l.data->>'source'='whatsapp'
  and l.data->>'result'='success' and l.business_id='00000000-0000-4000-8000-000000000011'),'WhatsApp atomic audit has actor/role/tenant/source');
 foreach actor in array array['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000099'] loop
  perform pg_temp.product_throws(format('select public.create_product_atomic(%L,%L::jsonb,%L)','00000000-0000-4000-8000-000000000011',base,actor),'product_actor_forbidden');
 end loop;
 perform pg_temp.product_throws(format('select public.create_product_atomic(%L,%L::jsonb,null)','00000000-0000-4000-8000-000000000011',base),'product_actor_forbidden');
 perform pg_temp.product_throws(format('select public.create_product_atomic(%L,%L::jsonb,%L)','00000000-0000-4000-8000-000000000012',base,'00000000-0000-4000-8000-000000000002'),'product_actor_forbidden');
 update public.business_modules set enabled=false where business_id='00000000-0000-4000-8000-000000000012' and module_key='products';
 perform pg_temp.product_throws(format('select public.create_product_atomic(%L,%L::jsonb,%L)','00000000-0000-4000-8000-000000000012',base,'00000000-0000-4000-8000-000000000001'),'product_module_disabled');
 perform pg_temp.product_throws(format('select public.create_product_atomic(%L,%L::jsonb,%L)','00000000-0000-4000-8000-000000000011',base-'cost','00000000-0000-4000-8000-000000000001'),'invalid_product_fields');
end; $$;
-- A later manual edit is attributed to the editor, not the WhatsApp creator.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
update public.products set price=1300 where source='whatsapp';
select pg_temp.product_assert(exists(select 1 from public.activity_logs l join public.products p on p.id=l.target_id
 where p.source='whatsapp' and p.created_by='00000000-0000-4000-8000-000000000002'
 and l.action='catalog.products.update' and l.actor_id=auth.uid() and l.data->>'source'='manual'),'edits audit current actor and retain original creation source');

-- Audit insertion failure rolls back the product itself.
reset role;
create function pg_temp.reject_product_audit() returns trigger language plpgsql as $$ begin
 if new.summary like '%AUDIT_FAIL%' then raise exception 'test_audit_failure'; end if; return new;
end; $$;
create trigger reject_product_audit before insert on public.activity_logs for each row execute function pg_temp.reject_product_audit();
set local role authenticated;
select pg_temp.product_throws($q$select public.create_product_atomic('00000000-0000-4000-8000-000000000011','{"name":"AUDIT_FAIL","category":"Food","price":10,"cost":1,"active":true}',null)$q$,'test_audit_failure');
select pg_temp.product_assert(not exists(select 1 from public.products where name='AUDIT_FAIL'),'product and audit are one transaction');
select pg_temp.product_assert(not exists(select 1 from public.stock_movements),'product creation never modifies physical stock');
rollback;
