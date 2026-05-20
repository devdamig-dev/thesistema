-- =============================================================================
-- GastroPilot AI · Seed demo
-- =============================================================================
-- Carga la organización "GastroPilot Demo" + el negocio "La Birra Burger"
-- + sucursal Palermo + datos demo de cada módulo.
--
-- Importante:
--   - Asume que ya existe un usuario en auth.users con el email definido
--     en la variable :owner_email. Antes de correr este seed, crear el
--     usuario desde el panel de Supabase Auth (o vía signup).
--   - Tomar el id de ese usuario y ejecutar:
--
--       psql ... \
--         -v owner_email="'tu@email.com'" \
--         -v owner_id="'<uuid-del-usuario>'" \
--         -f supabase/seed.sql
--
--   - Es idempotente: usa `on conflict do nothing` donde puede.
-- =============================================================================

\set owner_email :'owner_email'
\set owner_id    :'owner_id'

-- Resolver el owner profile (debería haberlo creado el trigger
-- handle_new_auth_user, pero si no, lo creamos).
insert into profiles (id, full_name, email)
values (:owner_id::uuid, 'Mateo Iglesias', :owner_email)
on conflict (id) do nothing;

-- =============================================================================
-- ORGANIZATION + BUSINESS + BRANCH
-- =============================================================================
with org as (
  insert into organizations (name, owner_id, plan)
  values ('GastroPilot Demo', :owner_id::uuid, 'pro')
  returning id
),
biz as (
  insert into businesses (organization_id, name, industry, tax_id, timezone)
  select id, 'La Birra Burger', 'hamburgueseria', '30-71234567-9',
         'America/Argentina/Buenos_Aires'
  from org
  returning id, organization_id
),
br as (
  insert into branches (business_id, name, address, is_main)
  select id, 'Local Palermo', 'Av. Córdoba 4500, CABA', true
  from biz
  returning id, business_id
)
update profiles
set organization_id = (select organization_id from biz)
where id = :owner_id::uuid;

-- =============================================================================
-- BUSINESS MEMBERS
-- =============================================================================
insert into business_members (business_id, user_id, role)
select b.id, :owner_id::uuid, 'owner'
from businesses b
where b.name = 'La Birra Burger'
on conflict (business_id, user_id) do nothing;

-- =============================================================================
-- BUSINESS MODULES (hamburguesería preset)
-- =============================================================================
insert into business_modules (business_id, module_key, enabled, suggested)
select b.id, m.k::module_key, true, true
from businesses b
cross join (values
  ('dashboard'), ('inbox_ai'), ('reports_ai'), ('marketing_ai'),
  ('invoices_ocr'), ('daily_closures'), ('sales'), ('purchases'),
  ('fixed_expenses'), ('stock'), ('products'), ('recipes'), ('food_cost'),
  ('employees'), ('shifts'), ('customers'), ('deliveries')
) as m(k)
where b.name = 'La Birra Burger'
on conflict (business_id, module_key) do nothing;

-- =============================================================================
-- SUPPLIERS
-- =============================================================================
insert into suppliers (business_id, name, tax_id, category)
select b.id, s.name, s.tax_id, s.category
from businesses b
cross join (values
  ('Don José',              '30-71238412-5', 'Carnes'),
  ('Frigorífico Sur',       '30-71540032-9', 'Carnes'),
  ('La Serenísima',         '30-50000003-2', 'Lácteos'),
  ('Panadería La Espiga',   '30-66781234-2', 'Panificados'),
  ('Coca-Cola FEMSA',       '30-50000694-1', 'Bebidas'),
  ('Verdulería Centro',     '27-32145698-7', 'Frescos')
) as s(name, tax_id, category)
where b.name = 'La Birra Burger';

-- =============================================================================
-- INGREDIENTS
-- =============================================================================
insert into ingredients (business_id, name, unit, avg_unit_cost)
select b.id, i.name, i.unit, i.cost
from businesses b
cross join (values
  ('Carne premium 180g', 'kg', 10260),
  ('Queso cheddar', 'kg', 8400),
  ('Pan brioche', 'u', 520),
  ('Bacon ahumado', 'kg', 42000),
  ('Papa 4ta gama', 'kg', 2880),
  ('Lechuga', 'kg', 1900),
  ('Tomate', 'kg', 2833),
  ('Gaseosas 500ml', 'u', 1000),
  ('Cerveza IPA 473ml', 'u', 1650),
  ('Aceite girasol', 'L', 2750)
) as i(name, unit, cost)
where b.name = 'La Birra Burger';

-- =============================================================================
-- PRODUCTS
-- =============================================================================
insert into products (business_id, name, category, price, cost)
select b.id, p.name, p.category, p.price, p.cost
from businesses b
cross join (values
  ('Clásica La Birra',  'Hamburguesa',      8900,  3450),
  ('Doble Cheddar',     'Hamburguesa',      11500, 5120),
  ('Bacon Lover',       'Hamburguesa',      12400, 6350),
  ('Veggie',            'Hamburguesa',      9900,  3100),
  ('Papas rústicas',    'Acompañamiento',   4900,  1120),
  ('Combo Clásico',     'Combo',            14500, 6100),
  ('Coca 500ml',        'Bebida',           2400,  900),
  ('IPA Artesanal',     'Bebida',           3800,  1900)
) as p(name, category, price, cost)
where b.name = 'La Birra Burger';

-- =============================================================================
-- FIXED EXPENSES
-- =============================================================================
insert into expenses (business_id, name, category, amount, status)
select b.id, e.name, e.category, e.amount, e.status
from businesses b
cross join (values
  ('Alquiler',                       'Alquiler',    450000, 'paid'),
  ('Sueldos',                        'Sueldos',     2480000, 'scheduled'),
  ('Servicios (luz, gas, agua)',     'Servicios',   142000, 'pending'),
  ('Contador',                       'Profesional', 95000,  'pending'),
  ('Publicidad (Meta + Google)',     'Marketing',   180000, 'scheduled'),
  ('Internet + telefonía',           'Servicios',   38000,  'pending'),
  ('Mantenimiento',                  'Operación',   60000,  'variable'),
  ('Comisiones apps',                'Comisiones',  412000, 'auto')
) as e(name, category, amount, status)
where b.name = 'La Birra Burger';

-- =============================================================================
-- EMPLOYEES
-- =============================================================================
insert into employees (business_id, full_name, role, shift, monthly_hours, monthly_cost, pending_advance, absences, late_arrivals)
select b.id, e.name, e.rol, e.turno, e.horas, e.costo, e.adelantos, e.faltas, e.tardes
from businesses b
cross join (values
  ('Juan Pérez',     'Cocina',     'Tarde-Noche', 168, 520000, 30000, 0, 2),
  ('Mariana López',  'Caja',       'Mediodía',    144, 410000, 0,     1, 0),
  ('Lucía Romero',   'Encargada',  'Full time',   192, 780000, 0,     0, 0),
  ('Diego Sosa',     'Cocina',     'Noche',       160, 495000, 50000, 0, 3),
  ('Florencia Gil',  'Atención',   'Tarde',       132, 380000, 0,     0, 1),
  ('Bruno Méndez',   'Delivery',   'Noche',       120, 295000, 0,     2, 4)
) as e(name, rol, turno, horas, costo, adelantos, faltas, tardes)
where b.name = 'La Birra Burger';

-- =============================================================================
-- CUSTOMERS
-- =============================================================================
insert into customers (business_id, name, channel, visits, total_spend, segment)
select b.id, c.name, c.canal, c.visitas, c.gasto, c.estado
from businesses b
cross join (values
  ('Sofía Martínez',                   'whatsapp', 18, 255600, 'frecuente'),
  ('Edificio Av. Córdoba 4500',        'delivery', 24, 235200, 'frecuente'),
  ('Tomás Acuña',                      'salon',    11, 125400, 'frecuente'),
  ('Camila Ruiz',                      'whatsapp', 6,  78600,  'inactivo'),
  ('Oficina Crehana',                  'delivery', 9,  202500, 'inactivo'),
  ('Familia Iglesias',                 'salon',    14, 260400, 'frecuente')
) as c(name, canal, visitas, gasto, estado)
where b.name = 'La Birra Burger';

-- =============================================================================
-- AI RECOMMENDATIONS
-- =============================================================================
insert into ai_recommendations (business_id, area, priority, title, detail, estimated_impact, confidence, status)
select b.id, r.area, r.prio::priority, r.title, r.detail, r.impact, r.conf, 'open'
from businesses b
cross join (values
  ('supplier',  'high',   'Cambiar proveedor de carne a Frigorífico Sur',
   'Don José aumentó 14% y dejó la carne 8% por encima del promedio.', 162000, 0.93),
  ('product',   'high',   'Subir 4% el precio de Doble Cheddar y Bacon Lover',
   'Productos premium con margen erosionado y demanda inelástica.',   210000, 0.88),
  ('schedule',  'medium', 'Lanzar combo del martes por WhatsApp',
   'Día con menor venta y mayor costo laboral relativo.',             120000, 0.76),
  ('schedule',  'low',    'Reducir un cocinero el martes 19-23',
   'Costo laboral del martes a la noche es 2x el promedio.',          48000,  0.69)
) as r(area, prio, title, detail, impact, conf)
where b.name = 'La Birra Burger';

-- =============================================================================
-- FIN — los módulos restantes (whatsapp_messages, ai_extractions,
-- invoices con OCR, closures parseados, campaigns con copy) se siguen
-- consumiendo desde lib/mock-data.ts hasta que cada uno se migre en
-- sprint 1+.
-- =============================================================================

-- Mostrar resumen
select
  (select count(*) from organizations)        as orgs,
  (select count(*) from businesses)           as businesses,
  (select count(*) from branches)             as branches,
  (select count(*) from business_members)     as members,
  (select count(*) from business_modules)     as modules,
  (select count(*) from suppliers)            as suppliers,
  (select count(*) from ingredients)          as ingredients,
  (select count(*) from products)             as products,
  (select count(*) from expenses)             as expenses,
  (select count(*) from employees)            as employees,
  (select count(*) from customers)            as customers,
  (select count(*) from ai_recommendations)   as ai_recommendations;
