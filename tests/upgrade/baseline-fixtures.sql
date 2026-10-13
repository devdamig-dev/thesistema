-- Entirely synthetic fixtures inserted BEFORE the 19 management migrations.
-- Deterministic 71000000-... IDs avoid collisions with existing SQL suites.
create function pg_temp.u(n integer) returns uuid language sql immutable as $$
 select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
insert into auth.users(id,email,raw_user_meta_data) values
 (pg_temp.u(1),'upgrade-owner@example.invalid','{"full_name":"Synthetic owner"}'),
 (pg_temp.u(2),'upgrade-viewer@example.invalid','{"full_name":"Synthetic viewer"}'),
 (pg_temp.u(3),'upgrade-cashier@example.invalid','{"full_name":"Synthetic cashier"}');
insert into public.organizations(id,name,owner_id) values(pg_temp.u(10),'Synthetic upgrade org',pg_temp.u(1));
update public.profiles set organization_id=pg_temp.u(10) where id in(pg_temp.u(1),pg_temp.u(2),pg_temp.u(3));
insert into public.businesses(id,organization_id,name) values
 (pg_temp.u(11),pg_temp.u(10),'Synthetic café'),(pg_temp.u(12),pg_temp.u(10),'Synthetic second tenant');
insert into public.business_members(id,business_id,user_id,role) values
 (pg_temp.u(21),pg_temp.u(11),pg_temp.u(1),'owner'),(pg_temp.u(22),pg_temp.u(11),pg_temp.u(2),'viewer'),
 (pg_temp.u(23),pg_temp.u(11),pg_temp.u(3),'cashier'),(pg_temp.u(24),pg_temp.u(12),pg_temp.u(1),'owner');
insert into public.branches(id,business_id,name,is_main) values
 (pg_temp.u(31),pg_temp.u(11),'Main synthetic branch',true),(pg_temp.u(32),pg_temp.u(11),'Second synthetic branch',false),
 (pg_temp.u(33),pg_temp.u(12),'Other tenant branch',true);
insert into public.branch_assignments(business_member_id,branch_id) values(pg_temp.u(23),pg_temp.u(31));
insert into public.business_modules(business_id,module_key,enabled)
 select b.id,k,true from public.businesses b cross join unnest(enum_range(null::public.module_key)) k;
insert into public.suppliers(id,business_id,name,tax_id,category,phone,email) values
 (pg_temp.u(41),pg_temp.u(11),'Synthetic Flour Co','SYNTHETIC-01','Food','+1 202 555 0144','supplier@example.invalid'),
 (pg_temp.u(42),pg_temp.u(12),'Synthetic foreign supplier',null,null,null,null);
insert into public.customers(id,business_id,name,phone,email,visits,total_spend,last_visit_at,segment) values
 (pg_temp.u(51),pg_temp.u(11),'Synthetic regular','+1 202 555 0144','customer@example.invalid',12,25001.99,'2026-10-07T12:00Z','Frecuente'),
 (pg_temp.u(52),pg_temp.u(11),'Synthetic incomplete',null,null,0,0,null,null),
 (pg_temp.u(53),pg_temp.u(12),'Synthetic foreign customer',null,null,2,999.99,null,null);
insert into public.ingredients(id,business_id,name,unit,avg_unit_cost) values
 (pg_temp.u(61),pg_temp.u(11),'Synthetic flour','kg',123.45),
 (pg_temp.u(62),pg_temp.u(11),'Synthetic milk','l',51.25),
 (pg_temp.u(63),pg_temp.u(11),'Legacy nonstandard unit','cajon',999.99),
 (pg_temp.u(64),pg_temp.u(12),'Synthetic foreign flour','kg',777.77);
insert into public.products(id,business_id,name,category,price,cost,active) values
 (pg_temp.u(71),pg_temp.u(11),'Legacy pastry','Food',1234.56,432.10,true),
 (pg_temp.u(72),pg_temp.u(11),'Archived legacy product','Food',500,111.11,false),
 (pg_temp.u(73),pg_temp.u(12),'Foreign product','Food',600,222.22,true);
insert into public.recipes(id,product_id) values(pg_temp.u(81),pg_temp.u(71)),(pg_temp.u(82),pg_temp.u(72));
insert into public.recipe_items(id,recipe_id,ingredient_id,name,qty,unit_cost,share) values
 (pg_temp.u(91),pg_temp.u(81),pg_temp.u(61),'Flour','250 g',123.45,60),
 (pg_temp.u(92),pg_temp.u(81),pg_temp.u(62),'Milk','un chorrito; NO PARSE',51.25,40),
 (pg_temp.u(93),pg_temp.u(82),null,'Unmatched legacy component','a gusto',111.11,100);
insert into public.stock_items(id,ingredient_id,branch_id,current,min) values
 (pg_temp.u(101),pg_temp.u(61),pg_temp.u(31),17.25,3.50),
 (pg_temp.u(102),pg_temp.u(61),pg_temp.u(32),4.75,1),
 (pg_temp.u(103),pg_temp.u(62),pg_temp.u(31),-1.25,0),
 (pg_temp.u(104),pg_temp.u(64),pg_temp.u(33),8.50,2);
-- Historical movements intentionally do not reconcile to stock. Never replay.
insert into public.stock_movements(id,ingredient_id,branch_id,reason,qty,ref_type,ref_id) values
 (pg_temp.u(111),pg_temp.u(61),pg_temp.u(31),'purchase',50,'purchase',pg_temp.u(151)),
 (pg_temp.u(112),pg_temp.u(61),pg_temp.u(31),'manual_adjust',-2.50,null,null),
 (pg_temp.u(113),pg_temp.u(62),pg_temp.u(31),'waste',-0.75,null,null);
insert into public.invoices(id,business_id,branch_id,supplier_id,number,invoice_date,subtotal,tax,total,status,source,ocr_text,created_by) values
 (pg_temp.u(121),pg_temp.u(11),pg_temp.u(31),pg_temp.u(41),'SYNTHETIC-APPROVED','2026-10-01',123.45,25.92,149.37,'approved','foto','Synthetic OCR approved',pg_temp.u(1)),
 (pg_temp.u(122),pg_temp.u(11),pg_temp.u(32),pg_temp.u(41),'SYNTHETIC-REVIEW','2026-10-02',200,42,242,'needs_review','documento','Synthetic OCR needs review',pg_temp.u(1)),
 (pg_temp.u(123),pg_temp.u(11),null,null,'SYNTHETIC-FAILED','2026-10-03',0,0,0,'failed','foto',null,null);
insert into public.invoice_items(id,invoice_id,description,qty,qty_numeric,unit,unit_price,total,matched_ingredient_id,match_status) values
 (pg_temp.u(131),pg_temp.u(121),'Flour','1 kg',1,'kg',123.45,123.45,pg_temp.u(61),'matched'),
 (pg_temp.u(132),pg_temp.u(122),'Legacy uncertain quantity','2 packs?',null,'pack',100,200,null,'unmatched');
insert into public.purchases(id,business_id,branch_id,supplier_id,purchased_at,total,payment_method,invoice_id,created_by) values
 (pg_temp.u(151),pg_temp.u(11),pg_temp.u(31),pg_temp.u(41),'2026-10-01',149.37,'Transferencia',pg_temp.u(121),pg_temp.u(1)),
 (pg_temp.u(152),pg_temp.u(11),pg_temp.u(32),null,'2026-10-02',51.25,'Efectivo',null,null);
insert into public.purchase_items(id,purchase_id,ingredient_id,description,qty,unit,unit_price,total) values
 (pg_temp.u(161),pg_temp.u(151),pg_temp.u(61),'Flour',1,'kg',123.45,123.45),
 (pg_temp.u(162),pg_temp.u(152),pg_temp.u(62),'Milk',1,'l',51.25,51.25),
 (pg_temp.u(163),pg_temp.u(151),null,'Legacy tax/service',1,'u',25.92,25.92);
insert into public.sales(id,business_id,branch_id,channel,amount,occurred_at,product_id) values
 (pg_temp.u(171),pg_temp.u(11),pg_temp.u(31),'salon',2469.12,'2026-10-01T12:00Z',pg_temp.u(71)),
 (pg_temp.u(172),pg_temp.u(11),null,'whatsapp',3000,'2026-10-02T16:00Z',null),
 (pg_temp.u(173),pg_temp.u(11),pg_temp.u(32),'delivery',0,'2026-10-03T12:00Z',pg_temp.u(72)),
 (pg_temp.u(174),pg_temp.u(12),pg_temp.u(33),'salon',600,'2026-10-03T12:00Z',pg_temp.u(73));
insert into public.expenses(id,business_id,branch_id,name,category,amount,due_date,status) values
 (pg_temp.u(181),pg_temp.u(11),pg_temp.u(31),'Legacy rent','Alquiler',10000,'2026-10-01','paid'),
 (pg_temp.u(182),pg_temp.u(11),pg_temp.u(32),'Legacy unpaid service','Servicios',3000,null,'pending');
insert into public.employees(id,business_id,full_name,role,shift,monthly_hours,monthly_cost,pending_advance,absences,late_arrivals,active) values
 (pg_temp.u(191),pg_temp.u(11),'Synthetic active employee','Cocina','Mañana',160.50,125000.25,750.50,1,2,true),
 (pg_temp.u(192),pg_temp.u(11),'Synthetic archived employee','Caja',null,0,0,0,0,0,false);
insert into public.shifts(id,employee_id,branch_id,weekday,from_time,to_time,hours) values
 (pg_temp.u(201),pg_temp.u(191),pg_temp.u(31),'mon','08:00','16:00',8),
 (pg_temp.u(202),pg_temp.u(191),pg_temp.u(32),'tue','09:00','17:00',8);
insert into public.advance_payments(id,employee_id,amount,paid_at,status) values
 (pg_temp.u(211),pg_temp.u(191),500.25,'2026-09-20','paid'),(pg_temp.u(212),pg_temp.u(191),250.25,'2026-09-21','pending');
insert into public.daily_closures(id,business_id,branch_id,closure_date,raw_text,parsed,inconsistencies,status,gross_total,net_total,created_by) values
 (pg_temp.u(221),pg_temp.u(11),pg_temp.u(31),'2026-10-01','Legacy approved close; do not rewrite','{"salon":2469.12,"observacion":"legacy"}','[]','approved',2469.12,2000,pg_temp.u(1)),
 (pg_temp.u(222),pg_temp.u(11),null,'2026-10-02','Legacy review close','{"total":3000}','["branch unknown"]','needs_review',3000,2700,pg_temp.u(1));
insert into public.debts(id,business_id,branch_id,creditor,supplier_id,concept,original_amount,pending_amount,due_date,notes,created_by) values
 (pg_temp.u(231),pg_temp.u(11),pg_temp.u(31),'Synthetic supplier',pg_temp.u(41),'Legacy partial debt',1000,1000,'2099-01-01','Keep legacy financing unknown',pg_temp.u(1)),
 (pg_temp.u(232),pg_temp.u(11),pg_temp.u(32),'Synthetic settled debt',null,'Legacy paid debt',250,250,'2026-09-01','Keep paid history',pg_temp.u(1)),
 (pg_temp.u(233),pg_temp.u(11),pg_temp.u(31),'Synthetic overdue debt',null,'Legacy due debt',700,700,'2026-09-01','Keep debt status',pg_temp.u(1));
-- Model a retained row predating branch isolation. That historical migration
-- explicitly retained null branches; its current insert guard must not invent
-- a branch here. Only this fixture insert suspends the named branch trigger.
alter table public.debts disable trigger trg_debts_branch_business;
insert into public.debts(id,business_id,branch_id,creditor,supplier_id,concept,original_amount,pending_amount,due_date,notes,created_by) values
 (pg_temp.u(234),pg_temp.u(11),null,'Synthetic unassigned debt',null,'Legacy shared debt',500,500,null,'Do not guess a branch',pg_temp.u(1));
alter table public.debts enable trigger trg_debts_branch_business;
insert into public.debt_payments(id,debt_id,amount,paid_at,payment_method,notes,created_by) values
 (pg_temp.u(241),pg_temp.u(231),125.25,'2026-09-20','Transferencia','Partial 1',pg_temp.u(1)),
 (pg_temp.u(242),pg_temp.u(231),74.75,'2026-09-21','Efectivo','Partial 2',pg_temp.u(1)),
 (pg_temp.u(243),pg_temp.u(232),250,'2026-09-22','Ajuste manual','Historical settlement',pg_temp.u(1)),
 (pg_temp.u(244),pg_temp.u(233),50,'2026-09-23','Transferencia','Overdue partial',pg_temp.u(1)),
 (pg_temp.u(245),pg_temp.u(234),50,'2026-09-24','Transferencia','Unassigned debt payment',pg_temp.u(1));
insert into public.balance_snapshots(id,business_id,period_month,sales_total,purchases_total,expenses_total,payroll_total,debt_payments_total,debts_pending,stock_valued,cash_estimated,net_result) values
 (pg_temp.u(251),pg_temp.u(11),'2026-09-01',150000,70000,13000,125000.25,500,1450,2500,10000,-58000.25);
insert into public.whatsapp_messages(id,business_id,branch_id,sender_id,sender_name,raw,preview) values
 (pg_temp.u(261),pg_temp.u(11),pg_temp.u(31),pg_temp.u(1),'Synthetic owner','Synthetic inbox messages','Synthetic inbox');
insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status,summary,target_entity,target_record_id,approved_by,approved_at) values
 (pg_temp.u(271),pg_temp.u(261),pg_temp.u(11),pg_temp.u(31),'sale','{"amount":2469.12,"channel":"salon"}','approved','Legacy accepted sale','sales',pg_temp.u(171),pg_temp.u(1),'2026-10-01T12:00Z'),
 (pg_temp.u(272),pg_temp.u(261),pg_temp.u(11),pg_temp.u(31),'expense','{"name":"Supplies","amount":100}','pending','Legacy pending expense',null,null,null,null),
 (pg_temp.u(273),pg_temp.u(261),pg_temp.u(11),pg_temp.u(31),'purchase','{"supplier":"Synthetic Flour Co","total":123.45}','needs_review','Legacy purchase review',null,null,null,null),
 (pg_temp.u(274),pg_temp.u(261),pg_temp.u(11),pg_temp.u(31),'daily_closure','{"date":"2026-10-01"}','approved','Legacy close','daily_closures',pg_temp.u(221),pg_temp.u(1),'2026-10-01T22:00Z'),
 (pg_temp.u(275),pg_temp.u(261),pg_temp.u(11),pg_temp.u(31),'debt','{"creditor":"Synthetic supplier","amount":1000}','pending','Legacy debt',null,null,null,null),
 (pg_temp.u(276),pg_temp.u(261),pg_temp.u(11),pg_temp.u(31),'employee_advance','{"employee":"Synthetic active employee","amount":200}','pending','Legacy advance',null,null,null,null);
insert into public.whatsapp_authorized_conversations(id,business_id,branch_id,provider_conversation_id,conversation_type,display_name,created_by) values
 (pg_temp.u(281),pg_temp.u(11),pg_temp.u(31),'synthetic-conversation','direct','Synthetic direct channel',pg_temp.u(1));
insert into public.whatsapp_agent_pending_operations(id,business_id,member_id,conversation_id,kind,tool_name,arguments,expires_at) values
 (pg_temp.u(291),pg_temp.u(11),pg_temp.u(21),pg_temp.u(281),'confirmation','register_purchase','{"amount":123.45}','2099-01-01'),
 (pg_temp.u(292),pg_temp.u(11),pg_temp.u(21),null,'clarification','register_debt','{"creditor":"Synthetic"}','2026-10-01');
insert into public.activity_logs(id,business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data) values
 (pg_temp.u(301),pg_temp.u(11),pg_temp.u(1),'Synthetic owner','owner','legacy.approved','invoices',pg_temp.u(121),'Synthetic immutable legacy audit','{"source":"legacy"}');
