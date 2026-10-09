-- Fixture transaction is opened by run-catalog-sql.mjs. Nothing persists.
create function pg_temp.snapshot_assert(p_ok boolean,p_message text) returns void language plpgsql as $$ begin
 if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %',p_message; end if;
end $$;
create function pg_temp.snapshot_throws(p_sql text,p_message text) returns void language plpgsql security invoker as $$ begin
 begin execute p_sql; exception when others then
  if position(p_message in sqlerrm)>0 then return; end if;
  raise exception 'Expected %, got %',p_message,sqlerrm;
 end;
 raise exception 'Expected %, but succeeded',p_message;
end $$;
select pg_temp.snapshot_assert((select not prosecdef and provolatile='s' and proconfig=array['search_path=""'] from pg_proc where oid='public.read_product_catalog_snapshot(uuid)'::regprocedure),'snapshot is STABLE invoker with fixed search path');
select pg_temp.snapshot_assert(not has_function_privilege('anon','public.read_product_catalog_snapshot(uuid)','execute'),'anonymous access remains forbidden');
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
do $$ declare s jsonb; begin
 s:=public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021');
 perform pg_temp.snapshot_assert(s->>'businessId'='10000000-0000-4000-8000-000000000021' and jsonb_array_length(s->'products')=3,'explicit tenant excludes foreign product even for dual owner');
 perform pg_temp.snapshot_assert((s->>'costRefreshPending')::boolean and (s#>>'{products,0,cost}')::numeric=10,'manager purchase keeps old cost with pending warning');
 perform pg_temp.snapshot_assert(s#>>'{products,0,ingredientCount}'='1' and s#>>'{products,0,recipeNeedsReview}'='false','typed composition is complete');
 perform pg_temp.snapshot_assert(s#>>'{products,1,recipeNeedsReview}'='true' and (s#>>'{products,1,cost}')::numeric=33,'legacy composition remains explicitly unverified');
 perform pg_temp.snapshot_assert(s#>>'{products,2,ingredientCount}'='0' and s#>'{products,2,recipeId}'='null'::jsonb,'manual costs preserve absent composition');
end $$;
-- Every permitted role can read, but restricted readers cannot certify hidden
-- branch purchases, including when all visible purchases are clear.
do $$ declare n integer; s jsonb; begin
 for n in 1..9 loop
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  s:=public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021');
  perform pg_temp.snapshot_assert(jsonb_array_length(s->'products')=3 and (s->>'costRefreshPending')::boolean,'allowed role reads uncertain costs');
 end loop;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',true);
select pg_temp.snapshot_assert(not exists(select 1 from public.purchases where cost_refresh_pending),'viewer really cannot see pending hidden-branch receipt');
select pg_temp.snapshot_throws($q$select public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000022')$q$,'catalog_actor_forbidden');
do $$ declare n integer; begin
 for n in 10..13 loop
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  perform pg_temp.snapshot_throws($q$select public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021')$q$,'catalog_actor_forbidden');
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 perform pg_temp.snapshot_throws($q$select public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021')$q$,'catalog_actor_forbidden');
end $$;

-- STABLE retains the caller snapshot even if a volatile sibling has already
-- completed a real owner refresh within that statement (also runs in PGlite).
reset role;
create function pg_temp.refresh_then_snapshot() returns boolean language plpgsql volatile security invoker as $$ begin
 perform public.refresh_purchase_costs_atomic('10000000-0000-4000-8000-000000000021');
 return true;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
with refreshed as materialized (select pg_temp.refresh_then_snapshot() done)
select pg_temp.snapshot_assert((s->>'costRefreshPending')::boolean and (s#>>'{products,0,cost}')::numeric=10,
 'refresh between snapshot creation and catalog read cannot combine old cost with cleared warning')
from refreshed cross join lateral (select public.read_product_catalog_snapshot(case when refreshed.done then '10000000-0000-4000-8000-000000000021'::uuid end) s) snapshot;
do $$ declare s jsonb; n integer; begin
 s:=public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021');
 perform pg_temp.snapshot_assert(not (s->>'costRefreshPending')::boolean and (s#>>'{products,0,cost}')::numeric=20,'next statement sees refreshed cost and cleared pending together');
 for n in 4..9 loop
  perform set_config('request.jwt.claim.sub','10000000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  s:=public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021');
  perform pg_temp.snapshot_assert((s->>'costRefreshPending')::boolean,'restricted readers still cannot certify business-wide freshness');
 end loop;
end $$;
-- Background service reads have explicit tenant scope and no invented actor.
reset role;
set local role service_role;
select set_config('request.jwt.claim.sub','',true);
do $$ declare s jsonb; begin
 s:=public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021');
 perform pg_temp.snapshot_assert(jsonb_array_length(s->'products')=3 and not (s->>'costRefreshPending')::boolean and s#>>'{products,1,recipeNeedsReview}'='true','background consumes same complete snapshot');
 perform pg_temp.snapshot_throws($q$select public.read_product_catalog_snapshot(null)$q$,'catalog_actor_forbidden');
 perform pg_temp.snapshot_throws($q$select public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000099')$q$,'catalog_module_disabled');
end $$;
reset role;
update public.business_modules set enabled=false where business_id='10000000-0000-4000-8000-000000000022' and module_key='products';
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select pg_temp.snapshot_throws($q$select public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000022')$q$,'catalog_module_disabled');
reset role;
set local role service_role;
select pg_temp.snapshot_throws($q$select public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000022')$q$,'catalog_module_disabled');
-- Aggregated JSON is one RPC result even beyond the usual Data API row cap.
reset role;
insert into public.products(business_id,name,category,price,cost)
select '10000000-0000-4000-8000-000000000021','D bulk '||n,'Food',100,10 from generate_series(1,1001) n;
set local role authenticated;
select pg_temp.snapshot_assert(jsonb_array_length(public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021')->'products')=1004,'catalog larger than 1000 rows stays in one result');
-- A backing-table read failure cannot certify an empty pending set.
reset role;
revoke select on public.purchases from authenticated;
set local role authenticated;
select pg_temp.snapshot_throws($q$select public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021')$q$,'permission denied');
reset role;
grant select on public.purchases to authenticated;
-- Voiding the last active evidence preserves old cost but never certifies it.
reset role;
set local role authenticated;
select public.void_purchase_manual_atomic('10000000-0000-4000-8000-000000000021',(select id from public.purchases where manual_request_id='10000000-0000-4000-8000-000000000081'),1,'No longer valid');
select public.void_purchase_manual_atomic('10000000-0000-4000-8000-000000000021',(select id from public.purchases where manual_request_id='10000000-0000-4000-8000-000000000082'),1,'No longer valid');
select public.refresh_purchase_costs_atomic('10000000-0000-4000-8000-000000000021');
reset role;
set local role service_role;
select pg_temp.snapshot_assert((public.read_product_catalog_snapshot('10000000-0000-4000-8000-000000000021')->>'costRefreshPending')::boolean,'no-active-evidence background read remains uncertain after refresh');
rollback;
