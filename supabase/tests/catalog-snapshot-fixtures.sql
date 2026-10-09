-- Disposable test data. The runner wraps this fixture in a transaction.
insert into auth.users(id,email)
select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'snapshot-'||n||'@example.invalid'
from generate_series(1,13) n;
insert into public.organizations(id,name) values ('10000000-0000-4000-8000-000000000020','Snapshot org');
update public.profiles set organization_id='10000000-0000-4000-8000-000000000020'
where id::text like '10000000-0000-4000-8000-%';
update public.profiles set active=false where id='10000000-0000-4000-8000-000000000012';
insert into public.businesses(id,organization_id,name) values
 ('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000020','Snapshot A'),
 ('10000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000020','Snapshot B');
insert into public.business_members(business_id,user_id,role)
select '10000000-0000-4000-8000-000000000021',('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 (array['owner','admin','manager','viewer','employee','kitchen','cashier','waiter','delivery','accountant','marketing','owner'])[n]::public.role_key
from generate_series(1,12) n;
insert into public.business_members(business_id,user_id,role) values
 ('10000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000001','owner');
insert into public.business_modules(business_id,module_key,enabled)
select b.id,m::public.module_key,true from public.businesses b cross join unnest(array['products','purchases','stock']) m
where b.id in ('10000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000022')
on conflict(business_id,module_key) do update set enabled=true;
insert into public.branches(id,business_id,name) values
 ('10000000-0000-4000-8000-000000000031','10000000-0000-4000-8000-000000000021','Assigned'),
 ('10000000-0000-4000-8000-000000000032','10000000-0000-4000-8000-000000000021','Hidden');
insert into public.branch_assignments(business_member_id,branch_id)
select id,'10000000-0000-4000-8000-000000000031' from public.business_members
where business_id='10000000-0000-4000-8000-000000000021' and role in ('viewer','employee','kitchen','cashier','waiter','delivery');
insert into public.suppliers(id,business_id,name) values
 ('10000000-0000-4000-8000-000000000041','10000000-0000-4000-8000-000000000021','Supplier');
insert into public.ingredients(id,business_id,name,unit,avg_unit_cost) values
 ('10000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000021','Flour','kg',10);
insert into public.products(id,business_id,name,category,price,cost) values
 ('10000000-0000-4000-8000-000000000061','10000000-0000-4000-8000-000000000021','A typed','Food',100,10),
 ('10000000-0000-4000-8000-000000000062','10000000-0000-4000-8000-000000000021','B legacy','Food',100,33),
 ('10000000-0000-4000-8000-000000000063','10000000-0000-4000-8000-000000000021','C manual','Food',100,44),
 ('10000000-0000-4000-8000-000000000064','10000000-0000-4000-8000-000000000022','Foreign','Food',100,99);
insert into public.recipes(id,product_id) values
 ('10000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000061'),
 ('10000000-0000-4000-8000-000000000072','10000000-0000-4000-8000-000000000062');
insert into public.recipe_items(recipe_id,ingredient_id,name,qty,unit_cost,quantity,unit) values
 ('10000000-0000-4000-8000-000000000071','10000000-0000-4000-8000-000000000051','Flour','1 kg',10,1,'kg'),
 ('10000000-0000-4000-8000-000000000072','10000000-0000-4000-8000-000000000051','Flour','Legacy handful',10,null,null);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
select public.create_purchase_manual_atomic('10000000-0000-4000-8000-000000000021',
 '{"requestId":"10000000-0000-4000-8000-000000000081","branchId":"10000000-0000-4000-8000-000000000031","supplierId":"10000000-0000-4000-8000-000000000041","purchasedAt":"2026-10-09","paymentMethod":"Cash","items":[{"ingredientId":"10000000-0000-4000-8000-000000000051","description":"Flour","qty":1,"unit":"kg","unitPrice":10}]}');
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',true);
select public.create_purchase_manual_atomic('10000000-0000-4000-8000-000000000021',
 '{"requestId":"10000000-0000-4000-8000-000000000082","branchId":"10000000-0000-4000-8000-000000000032","supplierId":"10000000-0000-4000-8000-000000000041","purchasedAt":"2026-10-09","paymentMethod":"Cash","items":[{"ingredientId":"10000000-0000-4000-8000-000000000051","description":"Flour","qty":1,"unit":"kg","unitPrice":30}]}');
set constraints all immediate;
reset role;
