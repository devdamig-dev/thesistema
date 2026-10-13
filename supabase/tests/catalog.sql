-- Run against a LOCAL Supabase database after migrations, as the database owner:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/catalog.sql
-- No production connection required. All fixtures and mutations roll back.
-- Uses PostgreSQL assertions instead of requiring an installed pgTAP extension.
begin;
create function pg_temp.catalog_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %', p_message; end if;
end; $$;
create function pg_temp.catalog_throws(p_sql text, p_message text)
returns void language plpgsql security invoker as $$ begin
  begin
    execute p_sql;
  exception when others then
    if position(p_message in sqlerrm) > 0 then return; end if;
    raise exception 'Expected error %, received %', p_message, sqlerrm;
  end;
  raise exception 'Expected error %, but statement succeeded', p_message;
end; $$;

insert into auth.users(id,email) values
 ('00000000-0000-4000-8000-000000000001','catalog-owner@example.invalid'),
 ('00000000-0000-4000-8000-000000000002','catalog-admin@example.invalid'),
 ('00000000-0000-4000-8000-000000000003','catalog-viewer@example.invalid'),
 ('00000000-0000-4000-8000-000000000004','catalog-kitchen@example.invalid'),
 ('00000000-0000-4000-8000-000000000005','catalog-inactive@example.invalid');
insert into public.organizations(id,name) values ('00000000-0000-4000-8000-000000000010','Catalog test organization');
update public.profiles set organization_id='00000000-0000-4000-8000-000000000010'
 where id in ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002',
 '00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005');
update public.profiles set active=false where id='00000000-0000-4000-8000-000000000005';
insert into public.businesses(id,organization_id,name) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','Catalog A'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','Catalog B');
insert into public.business_members(business_id,user_id,role) values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','owner'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000002','admin'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000003','viewer'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000004','kitchen'),
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000005','owner');
insert into public.branches(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000011','Catalog A branch'),
 ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000012','Catalog B branch');
insert into public.business_modules(business_id,module_key,enabled) values
 ('00000000-0000-4000-8000-000000000011','purchases',true)
 on conflict(business_id,module_key) do update set enabled=true;
insert into public.suppliers(id,business_id,name) values
 ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000011','Supplier A'),
 ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000012','Supplier B');
insert into public.ingredients(id,business_id,name,unit,avg_unit_cost,active) values
 ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000011','Beef','kg',800,true),
 ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000011','Milk','l',1200,true),
 ('00000000-0000-4000-8000-000000000043','00000000-0000-4000-8000-000000000011','Bun','unidad',100,true),
 ('00000000-0000-4000-8000-000000000044','00000000-0000-4000-8000-000000000011','Archived','unit',20,false),
 ('00000000-0000-4000-8000-000000000045','00000000-0000-4000-8000-000000000012','Foreign','kg',900,true);
insert into public.products(id,business_id,name,category,price,cost) values
 ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000011','Typed product','Test',2000,9999),
 ('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000011','Manual product','Test',1000,321),
 ('00000000-0000-4000-8000-000000000053','00000000-0000-4000-8000-000000000011','Legacy product','Test',1000,4321),
 ('00000000-0000-4000-8000-000000000054','00000000-0000-4000-8000-000000000012','Foreign product','Test',1000,123);
insert into public.recipes(id,product_id) values
 ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000053'),
 ('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000054');
insert into public.recipe_items(recipe_id,ingredient_id,name,qty,unit_cost) values
 ('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000041','Legacy beef','a handful / do not parse',800);
insert into public.recipe_items(recipe_id,ingredient_id,name,qty,unit_cost,quantity,unit) values
 ('00000000-0000-4000-8000-000000000062','00000000-0000-4000-8000-000000000045','Foreign quantity fixture','1 kg',900,1,'kg');
insert into public.stock_items(ingredient_id,branch_id,current,min) values
 ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000021',12,2);

set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
select pg_temp.catalog_assert(public.catalog_unit_factor('g','kg')=0.001,'g to kg');
select pg_temp.catalog_assert(public.catalog_unit_factor('kg','g')=1000,'kg to g');
select pg_temp.catalog_assert(public.catalog_unit_factor('ml','l')=0.001,'ml to l');
select pg_temp.catalog_assert(public.catalog_unit_factor('l','ml')=1000,'l to ml');
select pg_temp.catalog_assert(public.catalog_unit_factor('u','unidades')=1,'unit aliases');
select pg_temp.catalog_assert(public.catalog_unit_factor('l','kg') is null,'mass/volume forbidden');
select pg_temp.catalog_assert(public.catalog_unit_factor('box','box') is null,'unsupported units forbidden');
select pg_temp.catalog_assert(not has_function_privilege('authenticated',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='catalog_private' and p.proname='audit_catalog_change'),'execute'),'audit trigger not callable');
select pg_temp.catalog_assert(not has_function_privilege('anon','public.save_recipe_atomic(uuid,uuid,timestamptz,jsonb)','execute'),'anon cannot invoke recipe RPC');
select pg_temp.catalog_assert(not (select prosecdef from pg_proc where oid='public.save_recipe_atomic(uuid,uuid,timestamptz,jsonb)'::regprocedure),'recipe RPC is invoker');
select pg_temp.catalog_assert(not (select prosecdef from pg_proc where oid='public.save_ingredient_atomic(uuid,uuid,jsonb)'::regprocedure),'ingredient RPC is invoker');
select pg_temp.catalog_assert((select not prosecdef and provolatile='s' from pg_proc where oid='public.catalog_recipe_cost(uuid)'::regprocedure),'recipe cost remains stable and invoker');

do $$
declare v_result jsonb; v_recipe uuid; v_token timestamptz; v_token2 timestamptz; v_logs bigint; v_count bigint; v_new uuid;
  v_business uuid := '00000000-0000-4000-8000-000000000011';
  v_product uuid := '00000000-0000-4000-8000-000000000051';
  v_items jsonb := '[{"ingredientId":"00000000-0000-4000-8000-000000000041","quantity":250,"unit":"g"},{"ingredientId":"00000000-0000-4000-8000-000000000042","quantity":100,"unit":"ml"},{"ingredientId":"00000000-0000-4000-8000-000000000043","quantity":2,"unit":"unit"}]';
begin
  v_result := public.save_recipe_atomic(v_business,v_product,null,v_items);
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean and (v_result->>'cost')::numeric=520,'recipe atomic full cost');
  v_recipe := (v_result->>'recipe_id')::uuid; v_token := (v_result->>'updated_at')::timestamptz;
  perform pg_temp.catalog_assert((select count(*) from public.recipe_items where recipe_id=v_recipe)=3,'recipe item count');
  perform pg_temp.catalog_assert((select cost from public.products where id=v_product)=520,'persisted product cost');
  select count(*) into v_logs from public.activity_logs where business_id=v_business;
  v_result := public.save_recipe_atomic(v_business,v_product,null,'[]');
  perform pg_temp.catalog_assert(v_result->>'error'='recipe_conflict','stale null create cannot replace recipe');
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,'[{"ingredientId":"00000000-0000-4000-8000-000000000041","quantity":1,"unit":"kg"},{"ingredientId":"00000000-0000-4000-8000-000000000045","quantity":1,"unit":"kg"}]');
  perform pg_temp.catalog_assert(v_result->>'error'='ingredient_not_found','cross-tenant ingredient rejected even dual owner');
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,'[{"ingredientId":"00000000-0000-4000-8000-000000000041","quantity":1,"unit":"l"}]');
  perform pg_temp.catalog_assert(v_result->>'error'='incompatible_units','incompatible recipe units rejected');
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,'[{"ingredientId":"00000000-0000-4000-8000-000000000044","quantity":1,"unit":"unit"}]');
  perform pg_temp.catalog_assert(v_result->>'error'='ingredient_inactive','new archived line rejected');
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,'[{"ingredientId":"00000000-0000-4000-8000-000000000041","quantity":0,"unit":"kg"}]');
  perform pg_temp.catalog_assert(v_result->>'error'='invalid_recipe_item','zero quantity rejected');
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,'[{"ingredientId":"00000000-0000-4000-8000-000000000041","quantity":"NaN","unit":"kg"}]');
  perform pg_temp.catalog_assert(v_result->>'error'='invalid_recipe_item','nonfinite string quantity rejected');
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,'[{"ingredientId":"not-a-uuid","quantity":1,"unit":"kg"}]');
  perform pg_temp.catalog_assert(v_result->>'error'='invalid_recipe_item','malformed uuid rejected');
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,v_items || jsonb_build_array(v_items->0));
  perform pg_temp.catalog_assert(v_result->>'error'='invalid_recipe_item','duplicate ingredients rejected');
  perform pg_temp.catalog_assert((select count(*) from public.recipe_items where recipe_id=v_recipe)=3,'rejections preserve all lines');
  perform pg_temp.catalog_assert((select updated_at from public.recipes where id=v_recipe)=v_token,'rejections preserve token');
  perform pg_temp.catalog_assert((select count(*) from public.activity_logs where business_id=v_business)=v_logs,'rejections create no success audit');

  v_result := public.save_recipe_atomic(v_business,v_product,v_token,v_items);
  v_token2 := (v_result->>'updated_at')::timestamptz;
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean and v_token2>v_token,'CAS token advances within transaction');
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,'[]');
  perform pg_temp.catalog_assert(v_result->>'error'='recipe_conflict','old token rejected');
  update public.products set cost=1 where id=v_product;
  perform pg_temp.catalog_assert((select cost from public.products where id=v_product)=520,'manual override cannot break typed cost');

  v_result := public.save_ingredient_atomic(v_business,'00000000-0000-4000-8000-000000000041',
    '{"name":"Beef revised","unit":"kg","unitCost":1000,"active":true,"supplierId":"00000000-0000-4000-8000-000000000031","minimums":[{"branchId":"00000000-0000-4000-8000-000000000021","minimum":8}]}');
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean,'ingredient update success');
  perform pg_temp.catalog_assert((select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041')=12,'minimum never changes current');
  perform pg_temp.catalog_assert((select min from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041')=8,'minimum updated');
  perform pg_temp.catalog_assert((select cost from public.products where id=v_product)=570,'ingredient cost propagates with unit conversion');
  perform pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000053')=4321,'legacy cost never guessed during propagation');
  v_result := public.recalc_product_recipe_cost(v_business,v_product);
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean and not (v_result->>'updated')::boolean and (v_result->>'new_cost')::numeric=570,'recalc idempotent');
  v_result := public.recalc_product_recipe_cost(v_business,'00000000-0000-4000-8000-000000000053');
  perform pg_temp.catalog_assert(v_result->>'error'='recipe_incomplete','legacy recalc explicit incomplete');
  update public.products set cost=0 where id='00000000-0000-4000-8000-000000000053';
  perform pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000053')=4321,'manual override preserves legacy cost');
  perform pg_temp.catalog_assert((select qty from public.recipe_items where recipe_id='00000000-0000-4000-8000-000000000061')='a handful / do not parse','legacy qty unchanged');

  v_result := public.save_ingredient_atomic(v_business,'00000000-0000-4000-8000-000000000041',
    '{"name":"Beef revised","unit":"kg","unitCost":1000,"active":false,"supplierId":null,"minimums":[]}');
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean,'archive referenced ingredient allowed');
  v_result := public.recalc_product_recipe_cost(v_business,v_product);
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean and (v_result->>'new_cost')::numeric=570,'existing archived ingredient still counted');
  v_result := public.save_ingredient_atomic(v_business,null,
    '{"name":"New ingredient","unit":"unidades","unitCost":0,"active":true,"supplierId":null,"minimums":[{"branchId":"00000000-0000-4000-8000-000000000021","minimum":0}]}');
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean,'create ingredient with zero valid cost/minimum');
  v_new := (v_result->>'id')::uuid;
  perform pg_temp.catalog_assert((select unit from public.ingredients where id=v_new)='unit','alias normalized');
  perform pg_temp.catalog_assert((select current from public.stock_items where ingredient_id=v_new)=0,'new stock default zero');
  select count(*) into v_count from public.ingredients;
  v_result := public.save_ingredient_atomic(v_business,null,
    '{"name":"Bad supplier","unit":"kg","unitCost":1,"active":true,"supplierId":"00000000-0000-4000-8000-000000000032","minimums":[]}');
  perform pg_temp.catalog_assert(v_result->>'error'='supplier_not_found','foreign supplier rejected');
  v_result := public.save_ingredient_atomic(v_business,null,
    '{"name":"Bad branch","unit":"kg","unitCost":1,"active":true,"minimums":[{"branchId":"00000000-0000-4000-8000-000000000022","minimum":2}]}');
  perform pg_temp.catalog_assert(v_result->>'error'='branch_not_found','foreign branch rejected');
  v_result := public.save_ingredient_atomic(v_business,null,
    '{"name":"Negative min","unit":"kg","unitCost":1,"active":true,"minimums":[{"branchId":"00000000-0000-4000-8000-000000000021","minimum":-1}]}');
  perform pg_temp.catalog_assert(v_result->>'error'='invalid_minimum','negative minimum rejected');
  v_result := public.save_ingredient_atomic(v_business,null,
    '{"name":"Negative cost","unit":"kg","unitCost":-1,"active":true}');
  perform pg_temp.catalog_assert(v_result->>'error'='invalid_ingredient','negative cost rejected');
  perform pg_temp.catalog_assert((select count(*) from public.ingredients)=v_count,'invalid saves insert no partial ingredient');

  select updated_at into v_token from public.recipes where id=v_recipe;
  v_result := public.save_recipe_atomic(v_business,v_product,v_token,'[]');
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean and (v_result->>'cost')::numeric=570,'empty recipe retains last explicit cost');
  perform pg_temp.catalog_assert((select count(*) from public.recipe_items where recipe_id=v_recipe)=0,'empty recipe removes composition');
  update public.products set cost=123 where id=v_product;
  perform pg_temp.catalog_assert((select cost from public.products where id=v_product)=123,'manual cost editable with empty recipe');
  v_result := public.recalc_product_recipe_cost(v_business,v_product);
  perform pg_temp.catalog_assert(v_result->>'error'='recipe_empty','empty recalc does not zero manual cost');
  perform pg_temp.catalog_assert(exists(select 1 from public.activity_logs where business_id=v_business
    and actor_id=auth.uid() and actor_role='owner' and data->>'source'='manual' and data->>'result'='success'),'atomic actor audit exists');
end;
$$;

-- Direct Data API writes cannot bypass cross-tenant guards, unit rules, or audit RLS.
select pg_temp.catalog_throws($q$update public.ingredients set unit='g' where id='00000000-0000-4000-8000-000000000041'$q$,'ingredient_unit_in_use');
select pg_temp.catalog_throws($q$update public.ingredients set preferred_supplier_id='00000000-0000-4000-8000-000000000032' where id='00000000-0000-4000-8000-000000000041'$q$,'supplier_not_found_or_forbidden');
select pg_temp.catalog_throws($q$insert into public.stock_items(ingredient_id,branch_id,min) values('00000000-0000-4000-8000-000000000045','00000000-0000-4000-8000-000000000021',1)$q$,'stock_ingredient_business_mismatch');
select pg_temp.catalog_throws($q$update public.ingredients set business_id='00000000-0000-4000-8000-000000000012' where id='00000000-0000-4000-8000-000000000041'$q$,'catalog_business_immutable');
select pg_temp.catalog_throws($q$insert into public.recipe_items(recipe_id,ingredient_id,name,qty,unit_cost,quantity,unit) values('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000045','Foreign','1kg',1,1,'kg')$q$,'recipe_ingredient_business_mismatch');
select pg_temp.catalog_throws($q$insert into public.recipe_items(recipe_id,ingredient_id,name,qty,unit_cost,quantity,unit) values('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000042','Milk','NaN',1,'NaN','l')$q$,'recipe_items_typed_quantity_check');
select pg_temp.catalog_throws($q$insert into public.recipe_items(recipe_id,ingredient_id,name,qty,unit_cost,quantity,unit) values('00000000-0000-4000-8000-000000000061','00000000-0000-4000-8000-000000000042','Milk','1',1,1,null)$q$,'invalid_recipe_unit_or_ingredient');
select pg_temp.catalog_throws($q$insert into public.activity_logs(business_id,action,summary) values('00000000-0000-4000-8000-000000000011','forged','forged')$q$,'row-level security');

-- Admin succeeds only in their own business. Viewer, kitchen, inactive and absent actors fail.
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.catalog_assert((public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000052',null,'[]')->>'ok')::boolean,'admin can save own business');
select pg_temp.catalog_assert(public.save_recipe_atomic('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000054',null,'[]')->>'error'='permission_denied','admin foreign business blocked');
select pg_temp.catalog_assert(not exists(select 1 from public.ingredients where business_id='00000000-0000-4000-8000-000000000012'),'RLS foreign ingredient read blocked');

do $$ declare v_actor text; begin
  foreach v_actor in array array['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000005',''] loop
    perform set_config('request.jwt.claim.sub',v_actor,true);
    perform pg_temp.catalog_assert(public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000052',null,'[]')->>'error'='permission_denied','role/active/auth gate recipe '||v_actor);
    perform pg_temp.catalog_assert(public.save_ingredient_atomic('00000000-0000-4000-8000-000000000011',null,'{"name":"Forbidden","unit":"kg","unitCost":1,"active":true}')->>'error'='permission_denied','role/active/auth gate ingredient '||v_actor);
  end loop;
end; $$;

reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
-- Compare fresh and previously used call sites after a role switch. This must
-- pass with BYPASSRLS without granting membership helpers to the backend role.
do $$ declare v_direct numeric; v_nested jsonb; v_direct_error text; v_nested_error text; v_bypass boolean; begin
  select rolbypassrls into v_bypass from pg_roles where rolname=current_user;
  begin
    v_direct := public.catalog_recipe_cost('00000000-0000-4000-8000-000000000053');
  exception when others then v_direct_error := sqlerrm; end;
  begin
    v_nested := public.recalc_product_recipe_cost('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000053');
  exception when others then v_nested_error := sqlerrm; end;
  if v_direct_error is not null or v_nested_error is not null then
    raise exception 'catalog role diagnostic: current_user=%, bypassrls=%, direct_error=%, nested_error=%',
      current_user,v_bypass,coalesce(v_direct_error,'none'),coalesce(v_nested_error,'none');
  end if;
  perform pg_temp.catalog_assert(v_bypass and v_direct is null and v_nested->>'error'='recipe_incomplete','service role fresh and cached call sites preserve incomplete recipe');
end; $$;
select pg_temp.catalog_assert(public.recalc_product_recipe_cost('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000053')->>'error'='recipe_incomplete','trusted backend recalc allowed without inventing actor');
select pg_temp.catalog_assert(public.recalc_product_recipe_cost('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000053')->>'error'='product_not_found','service recalc still matches explicit business');
select pg_temp.catalog_assert(public.save_ingredient_atomic('00000000-0000-4000-8000-000000000011',null,'{"name":"Forbidden","unit":"kg","unitCost":1,"active":true}')->>'error'='permission_denied','save still requires real actor');
select pg_temp.catalog_assert(public.catalog_recipe_cost('00000000-0000-4000-8000-000000000054')=900,'trusted backend can calculate the separate business recipe');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.catalog_assert(public.catalog_recipe_cost('00000000-0000-4000-8000-000000000054') is null,'switch back to authenticated cannot inherit backend RLS bypass');
select pg_temp.catalog_assert(not exists(select 1 from public.products where id='00000000-0000-4000-8000-000000000054'),'foreign product still invisible after backend call');
select pg_temp.catalog_assert(public.recalc_product_recipe_cost('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000054')->>'error'='permission_denied','authenticated nested call still enforces tenant after backend call');
select pg_temp.catalog_assert(public.recalc_product_recipe_cost('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000053')->>'error'='recipe_incomplete','authenticated nested call retains own business visibility');
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.catalog_assert(public.catalog_recipe_cost('00000000-0000-4000-8000-000000000054')=900,'repeated switch to backend replans recipe visibility');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
select pg_temp.catalog_assert(public.catalog_recipe_cost('00000000-0000-4000-8000-000000000054') is null,'repeated authenticated switch still excludes foreign recipe');
reset role;

-- Fail the audit after the mutation starts: every catalog row and success audit
-- must roll back together. The trigger exists only inside this test transaction.
create function pg_temp.catalog_fail_audit()
returns trigger language plpgsql as $$ begin
  if new.target_type = 'ingredients' and new.data->'after'->>'name' = 'FORCE_AUDIT_FAILURE' then
    raise exception 'forced_catalog_audit_failure';
  end if;
  return new;
end; $$;
create trigger catalog_test_fail_audit before insert on public.activity_logs
  for each row execute function pg_temp.catalog_fail_audit();
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare v_before jsonb; v_after jsonb; v_logs bigint; v_token timestamptz; v_result jsonb; begin
  select to_jsonb(i) into v_before from public.ingredients i where id='00000000-0000-4000-8000-000000000041';
  select count(*) into v_logs from public.activity_logs;
  perform pg_temp.catalog_throws($q$select public.save_ingredient_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000041',
    '{"name":"FORCE_AUDIT_FAILURE","unit":"kg","unitCost":8000,"active":true,"minimums":[{"branchId":"00000000-0000-4000-8000-000000000021","minimum":99}]}')$q$,'forced_catalog_audit_failure');
  select to_jsonb(i) into v_after from public.ingredients i where id='00000000-0000-4000-8000-000000000041';
  perform pg_temp.catalog_assert(v_after=v_before,'audit failure rolls back ingredient and cost');
  perform pg_temp.catalog_assert((select count(*) from public.activity_logs)=v_logs,'audit failure rolls back success logs');
  perform pg_temp.catalog_assert((select min from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000041')=8,'audit failure leaves stock minimum');

  -- An overflow after deleting prior recipe items is caught by the RPC's
  -- subtransaction; prior composition, cost, CAS token and audit all survive.
  select updated_at into v_token from public.recipes where product_id='00000000-0000-4000-8000-000000000051';
  select count(*) into v_logs from public.activity_logs;
  v_result := public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000051',v_token,
    '[{"ingredientId":"00000000-0000-4000-8000-000000000042","quantity":999999999999999,"unit":"l"}]');
  perform pg_temp.catalog_assert(v_result->>'error'='invalid_recipe_item','overflow caught');
  perform pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000051')=123,'late failure preserves manual cost');
  perform pg_temp.catalog_assert((select updated_at from public.recipes where product_id='00000000-0000-4000-8000-000000000051')=v_token,'late failure preserves CAS');
  perform pg_temp.catalog_assert((select count(*) from public.activity_logs)=v_logs,'late failure rolls back audit');
  select updated_at into v_token from public.recipes where id='00000000-0000-4000-8000-000000000061';
  select jsonb_agg(to_jsonb(ri) order by ri.id) into v_before from public.recipe_items ri where recipe_id='00000000-0000-4000-8000-000000000061';
  v_result := public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000053',v_token,
    '[{"ingredientId":"00000000-0000-4000-8000-000000000042","quantity":999999999999999,"unit":"l"}]');
  select jsonb_agg(to_jsonb(ri) order by ri.id) into v_after from public.recipe_items ri where recipe_id='00000000-0000-4000-8000-000000000061';
  perform pg_temp.catalog_assert(v_result->>'error'='invalid_recipe_item' and v_after=v_before,'late overflow restores deleted composition byte-for-byte');
  perform pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000053')=4321,'late overflow restores legacy cost');
  perform pg_temp.catalog_assert((select updated_at from public.recipes where id='00000000-0000-4000-8000-000000000061')=v_token,'late overflow restores populated recipe token');
end; $$;
reset role;
drop trigger catalog_test_fail_audit on public.activity_logs;

-- Final rounding occurs after aggregation, never on each individual line.
insert into public.ingredients(id,business_id,name,unit,avg_unit_cost) values
 ('00000000-0000-4000-8000-000000000046','00000000-0000-4000-8000-000000000011','Tiny A','kg',1),
 ('00000000-0000-4000-8000-000000000047','00000000-0000-4000-8000-000000000011','Tiny B','kg',1);
set local role authenticated;
do $$ declare v_token timestamptz; v_result jsonb; v_recipe uuid; begin
  select id,updated_at into v_recipe,v_token from public.recipes where product_id='00000000-0000-4000-8000-000000000051';
  v_result := public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000051',v_token,
    '[{"ingredientId":"00000000-0000-4000-8000-000000000046","quantity":5,"unit":"g"},{"ingredientId":"00000000-0000-4000-8000-000000000047","quantity":5,"unit":"g"}]');
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean and (v_result->>'cost')::numeric=0.01,'sum of .005+.005 rounds once');
  perform pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000051')=0.01,'persisted exact aggregate cost');
  v_token := (v_result->>'updated_at')::timestamptz;
  update public.recipe_items set quantity=10 where recipe_id=v_recipe and ingredient_id='00000000-0000-4000-8000-000000000046';
  perform pg_temp.catalog_assert((select updated_at from public.recipes where id=v_recipe)>v_token,'direct item edit invalidates CAS');
  perform pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000051')=0.02,'direct item edit updates cost');
end; $$;
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
update public.ingredients set avg_unit_cost=2 where id='00000000-0000-4000-8000-000000000046';
select pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000051')=0.03,'service invoice-style update propagates typed cost');
select pg_temp.catalog_assert(exists(select 1 from public.activity_logs where actor_id is null and data->>'source'='system' and target_id='00000000-0000-4000-8000-000000000046'),'service audit has honest system actor');
reset role;

-- Native small-unit pricing must retain sub-cent precision before composition.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
do $$ declare v_result jsonb; v_id uuid; v_token timestamptz; v_recipe uuid; begin
  v_result := public.save_ingredient_atomic('00000000-0000-4000-8000-000000000011',null,
    '{"name":"Sub-cent per gram","unit":"g","unitCost":0.005,"active":true,"supplierId":null,"minimums":[]}');
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean,'sub-cent ingredient save');
  v_id := (v_result->>'id')::uuid;
  perform pg_temp.catalog_assert((select avg_unit_cost from public.ingredients where id=v_id)=0.005,'per-gram .005 is not rounded to .01');
  select id,updated_at into v_recipe,v_token from public.recipes where product_id='00000000-0000-4000-8000-000000000051';
  v_result := public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000051',v_token,
    jsonb_build_array(jsonb_build_object('ingredientId',v_id,'quantity',200,'unit','g')));
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean and (v_result->>'cost')::numeric=1,'200g times .005 per g equals 1');
  perform pg_temp.catalog_assert((select unit_cost from public.recipe_items where recipe_id=v_recipe)=0.005,'recipe cost snapshot keeps sub-cent precision');
  perform pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000051')=1,'product cost rounds only final sum');
end; $$;
select pg_temp.catalog_throws($q$update public.products set cost=-1 where id='00000000-0000-4000-8000-000000000051'$q$,'invalid_product_price_or_cost');
select pg_temp.catalog_throws($q$update public.products set price=-1 where id='00000000-0000-4000-8000-000000000051'$q$,'invalid_product_price_or_cost');
select pg_temp.catalog_throws($q$update public.products set cost='NaN' where id='00000000-0000-4000-8000-000000000051'$q$,'invalid_product_price_or_cost');
select pg_temp.catalog_throws($q$update public.products set price='NaN' where id='00000000-0000-4000-8000-000000000051'$q$,'invalid_product_price_or_cost');
select pg_temp.catalog_throws($q$insert into public.products(business_id,name,category,price,cost) values('00000000-0000-4000-8000-000000000011','Bad price','Test',-1,0)$q$,'invalid_product_price_or_cost');
reset role;

-- Weighted-average inputs may be cent-valued while their average is sub-cent.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.ingredients(id,business_id,name,unit,avg_unit_cost) values
 ('00000000-0000-4000-8000-000000000048','00000000-0000-4000-8000-000000000011','Weighted grams','g',1);
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',
 jsonb_build_object('requestId','00000000-0000-4000-8000-000000000071','kind','detailed',
  'branchId','00000000-0000-4000-8000-000000000021','supplierId','00000000-0000-4000-8000-000000000031',
  'purchasedAt',current_date::text,'paymentMethod','Cash',
  'items','[{"ingredientId":"00000000-0000-4000-8000-000000000048","description":"Paid gram","qty":1,"unit":"g","unitPrice":0.01},{"ingredientId":"00000000-0000-4000-8000-000000000048","description":"Included gram","qty":1,"unit":"g","unitPrice":0}]'::jsonb));
do $$ declare v_token timestamptz; v_result jsonb; v_avg numeric; begin
  select updated_at into v_token from public.recipes where product_id='00000000-0000-4000-8000-000000000052';
  v_result := public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000052',v_token,
    '[{"ingredientId":"00000000-0000-4000-8000-000000000048","quantity":200,"unit":"g"}]');
  perform pg_temp.catalog_assert((v_result->>'ok')::boolean and (v_result->>'cost')::numeric=1,'recipe uses automatically refreshed weighted purchase cost');
  v_avg := public.recalc_ingredient_cost('00000000-0000-4000-8000-000000000048');
  perform pg_temp.catalog_assert(v_avg=0.005,'weighted average (.01+0)/2 retains .005');
  perform pg_temp.catalog_assert((select avg_unit_cost from public.ingredients where id='00000000-0000-4000-8000-000000000048')=0.005,'weighted average persists precision');
  perform pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000052')=1,'weighted average propagates exact final recipe cost');
  perform pg_temp.catalog_assert(not (select prosecdef from pg_proc where oid='public.recalc_ingredient_cost(uuid)'::regprocedure),'weighted-average helper remains invoker');
end; $$;
reset role;

-- Purchase units must be converted into the ingredient base unit before averaging.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
insert into public.ingredients(id,business_id,name,unit,avg_unit_cost) values
 ('00000000-0000-4000-8000-000000000049','00000000-0000-4000-8000-000000000011','Mass conversion','kg',100);
insert into public.products(id,business_id,name,category,price,cost) values
 ('00000000-0000-4000-8000-000000000059','00000000-0000-4000-8000-000000000011','Quarter kilo','Test',1000,100);
select public.save_recipe_atomic('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000059',null,
 '[{"ingredientId":"00000000-0000-4000-8000-000000000049","quantity":250,"unit":"g"}]');
select public.create_purchase_manual_atomic('00000000-0000-4000-8000-000000000011',
 jsonb_build_object('requestId','00000000-0000-4000-8000-000000000073','kind','detailed',
  'branchId','00000000-0000-4000-8000-000000000021','supplierId','00000000-0000-4000-8000-000000000031',
  'purchasedAt',current_date::text,'paymentMethod','Cash',
  'items','[{"ingredientId":"00000000-0000-4000-8000-000000000049","description":"1000 grams","qty":1000,"unit":"g","unitPrice":1.2}]'::jsonb));
select pg_temp.catalog_assert(public.recalc_ingredient_cost('00000000-0000-4000-8000-000000000049')=1200,'purchase grams become cost per kg');
select pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000059')=300,'250g BOM costs 300 after 1200 per kg purchase');
-- Flush the genuine RPC receipts before temporarily seeding pre-guard history.
set constraints all immediate;
set constraints all deferred;
reset role;
savepoint catalog_invalid_purchase;
-- Only the disposable test owner can create this malformed historical fixture.
-- Keep all other validation enabled, then restore every new-insert guard before
-- testing the authenticated cost reader. The savepoint removes the fixture
-- without bypassing the immutable-history UPDATE/DELETE protections.
alter table public.purchases disable trigger purchase_origin_guard;
alter table public.purchases disable trigger purchase_origin_lock;
alter table public.purchases disable trigger purchase_receipt_complete;
alter table public.purchase_items disable trigger purchase_item_insert_guard;
alter table public.purchase_items disable trigger purchase_item_recalculate;
alter table public.purchase_items disable trigger purchase_item_receipt_complete;
insert into public.purchases(id,business_id,branch_id,purchased_at,total) values
 ('00000000-0000-4000-8000-000000000074','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021',current_date,5);
insert into public.purchase_items(id,purchase_id,ingredient_id,description,qty,unit,unit_price,total) values
 ('00000000-0000-4000-8000-000000000079','00000000-0000-4000-8000-000000000074','00000000-0000-4000-8000-000000000049','Unknown package',1,'pack',5,5);
alter table public.purchases enable trigger purchase_origin_guard;
alter table public.purchases enable trigger purchase_origin_lock;
alter table public.purchases enable trigger purchase_receipt_complete;
alter table public.purchase_items enable trigger purchase_item_insert_guard;
alter table public.purchase_items enable trigger purchase_item_recalculate;
alter table public.purchase_items enable trigger purchase_item_receipt_complete;
set local role authenticated;
select pg_temp.catalog_throws($q$select public.recalc_ingredient_cost('00000000-0000-4000-8000-000000000049')$q$,'purchase_cost_unit_or_quantity_invalid');
select pg_temp.catalog_assert((select avg_unit_cost from public.ingredients where id='00000000-0000-4000-8000-000000000049')=1200,'invalid purchase unit preserves prior cost');
select pg_temp.catalog_assert((select cost from public.products where id='00000000-0000-4000-8000-000000000059')=300,'invalid purchase unit preserves BOM cost');
rollback to savepoint catalog_invalid_purchase;
release savepoint catalog_invalid_purchase;
-- A privileged internal call still excludes malformed foreign-business purchase
-- links that predate receipt validation. Seed only as the disposable test owner.
alter table public.purchases disable trigger purchase_origin_guard;
alter table public.purchases disable trigger purchase_origin_lock;
alter table public.purchases disable trigger purchase_receipt_complete;
alter table public.purchase_items disable trigger purchase_item_insert_guard;
alter table public.purchase_items disable trigger purchase_item_recalculate;
alter table public.purchase_items disable trigger purchase_item_receipt_complete;
insert into public.purchases(id,business_id,branch_id,purchased_at,total) values
 ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000022',current_date,999999);
insert into public.purchase_items(purchase_id,ingredient_id,description,qty,unit,unit_price,total) values
 ('00000000-0000-4000-8000-000000000072','00000000-0000-4000-8000-000000000049','Foreign link fixture',1,'kg',999999,999999);
alter table public.purchases enable trigger purchase_origin_guard;
alter table public.purchases enable trigger purchase_origin_lock;
alter table public.purchases enable trigger purchase_receipt_complete;
alter table public.purchase_items enable trigger purchase_item_insert_guard;
alter table public.purchase_items enable trigger purchase_item_recalculate;
alter table public.purchase_items enable trigger purchase_item_receipt_complete;
select pg_temp.catalog_assert((select count(*)=6 and bool_and(tgenabled='O') from pg_trigger
 where (tgrelid='public.purchases'::regclass and tgname in ('purchase_origin_guard','purchase_origin_lock','purchase_receipt_complete'))
    or (tgrelid='public.purchase_items'::regclass and tgname in ('purchase_item_insert_guard','purchase_item_recalculate','purchase_item_receipt_complete'))),
 'all purchase receipt guards restored after historical seeding');
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
select pg_temp.catalog_assert(public.recalc_ingredient_cost('00000000-0000-4000-8000-000000000049')=1200,'service average excludes foreign-business purchases');
reset role;
-- Disabled catalog operators must not bypass the RPC through the Data API.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000005',true);
select pg_temp.catalog_throws($q$insert into public.products(business_id,name,category,price,cost) values('00000000-0000-4000-8000-000000000011','Inactive attempt','Test',10,1)$q$,'catalog_actor_inactive');
select pg_temp.catalog_throws($q$update public.ingredients set name='Inactive attempt' where id='00000000-0000-4000-8000-000000000041'$q$,'catalog_actor_inactive');
select pg_temp.catalog_throws($q$update public.recipes set updated_at=clock_timestamp() where product_id='00000000-0000-4000-8000-000000000059'$q$,'catalog_actor_inactive');
reset role;
rollback;
