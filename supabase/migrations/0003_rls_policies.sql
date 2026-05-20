-- =============================================================================
-- GastroPilot AI · Row Level Security
-- =============================================================================
-- Política base:
--   - Un usuario sólo ve datos de su organization (vía profiles.organization_id).
--   - Cada negocio chequea membership en business_members.
--   - admin/owner pueden gestionar miembros y módulos.
--   - Lectura y escritura básica para todos los miembros del business.
--
-- Granularidad por rol (kitchen no aprueba facturas, etc.) se afina en
-- sprint 1 cuando empecemos a tocar mutations reales.
-- =============================================================================

-- Habilitar RLS
alter table organizations         enable row level security;
alter table businesses            enable row level security;
alter table branches              enable row level security;
alter table profiles              enable row level security;
alter table business_members      enable row level security;
alter table business_modules      enable row level security;
alter table suppliers             enable row level security;
alter table ingredients           enable row level security;
alter table products              enable row level security;
alter table recipes               enable row level security;
alter table recipe_items          enable row level security;
alter table stock_items           enable row level security;
alter table stock_movements       enable row level security;
alter table invoices              enable row level security;
alter table invoice_items         enable row level security;
alter table purchases             enable row level security;
alter table purchase_items        enable row level security;
alter table sales                 enable row level security;
alter table expenses              enable row level security;
alter table employees             enable row level security;
alter table shifts                enable row level security;
alter table advance_payments      enable row level security;
alter table customers             enable row level security;
alter table daily_closures        enable row level security;
alter table whatsapp_messages     enable row level security;
alter table ai_extractions        enable row level security;
alter table ai_recommendations    enable row level security;
alter table campaigns             enable row level security;

-- ---------- profiles ----------
-- Cada quien ve y edita su propio profile; también se pueden ver perfiles de
-- otros miembros de la misma org.
drop policy if exists "profiles self read" on profiles;
create policy "profiles self read" on profiles
  for select using (
    auth.uid() = id
    or organization_id = user_organization_id()
  );

drop policy if exists "profiles self update" on profiles;
create policy "profiles self update" on profiles
  for update using (auth.uid() = id);

drop policy if exists "profiles insert by trigger" on profiles;
create policy "profiles insert by trigger" on profiles
  for insert with check (auth.uid() = id);

-- ---------- organizations ----------
drop policy if exists "organizations read" on organizations;
create policy "organizations read" on organizations
  for select using (id = user_organization_id());

drop policy if exists "organizations admin update" on organizations;
create policy "organizations admin update" on organizations
  for update using (owner_id = auth.uid());

-- ---------- businesses ----------
drop policy if exists "businesses read by member" on businesses;
create policy "businesses read by member" on businesses
  for select using (
    organization_id = user_organization_id()
    or is_member_of_business(id)
  );

drop policy if exists "businesses admin write" on businesses;
create policy "businesses admin write" on businesses
  for all using (is_admin_of_business(id))
  with check (is_admin_of_business(id));

-- ---------- branches ----------
drop policy if exists "branches read" on branches;
create policy "branches read" on branches
  for select using (is_member_of_business(business_id));

drop policy if exists "branches write admin" on branches;
create policy "branches write admin" on branches
  for all using (is_admin_of_business(business_id))
  with check (is_admin_of_business(business_id));

-- ---------- business_members ----------
drop policy if exists "members read own business" on business_members;
create policy "members read own business" on business_members
  for select using (is_member_of_business(business_id));

drop policy if exists "members write admin" on business_members;
create policy "members write admin" on business_members
  for all using (is_admin_of_business(business_id))
  with check (is_admin_of_business(business_id));

-- ---------- business_modules ----------
drop policy if exists "modules read" on business_modules;
create policy "modules read" on business_modules
  for select using (is_member_of_business(business_id));

drop policy if exists "modules write admin" on business_modules;
create policy "modules write admin" on business_modules
  for all using (is_admin_of_business(business_id))
  with check (is_admin_of_business(business_id));

-- ============================================================================
-- Helper macro: políticas estándar para tablas con business_id.
-- ============================================================================
-- Como PostgreSQL no tiene macros, repetimos el patrón.

-- helper macro: lectura para miembros + escritura para miembros
-- (más adelante refinamos qué roles pueden mutar qué).
create or replace function _policy_business_read_member(business_id uuid)
returns boolean language sql stable as $$
  select is_member_of_business(business_id);
$$;

-- suppliers
drop policy if exists "suppliers rw" on suppliers;
create policy "suppliers rw" on suppliers
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- ingredients
drop policy if exists "ingredients rw" on ingredients;
create policy "ingredients rw" on ingredients
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- products
drop policy if exists "products rw" on products;
create policy "products rw" on products
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- recipes (vía product)
drop policy if exists "recipes rw" on recipes;
create policy "recipes rw" on recipes
  for all using (
    exists (
      select 1 from products p
      where p.id = recipes.product_id
        and is_member_of_business(p.business_id)
    )
  )
  with check (
    exists (
      select 1 from products p
      where p.id = recipes.product_id
        and is_member_of_business(p.business_id)
    )
  );

-- recipe_items (vía recipe → product)
drop policy if exists "recipe_items rw" on recipe_items;
create policy "recipe_items rw" on recipe_items
  for all using (
    exists (
      select 1 from recipes r
      join products p on p.id = r.product_id
      where r.id = recipe_items.recipe_id
        and is_member_of_business(p.business_id)
    )
  )
  with check (
    exists (
      select 1 from recipes r
      join products p on p.id = r.product_id
      where r.id = recipe_items.recipe_id
        and is_member_of_business(p.business_id)
    )
  );

-- stock_items (vía branch)
drop policy if exists "stock_items rw" on stock_items;
create policy "stock_items rw" on stock_items
  for all using (
    exists (
      select 1 from branches b
      where b.id = stock_items.branch_id
        and is_member_of_business(b.business_id)
    )
  )
  with check (
    exists (
      select 1 from branches b
      where b.id = stock_items.branch_id
        and is_member_of_business(b.business_id)
    )
  );

-- stock_movements (vía branch)
drop policy if exists "stock_movements rw" on stock_movements;
create policy "stock_movements rw" on stock_movements
  for all using (
    exists (
      select 1 from branches b
      where b.id = stock_movements.branch_id
        and is_member_of_business(b.business_id)
    )
  )
  with check (
    exists (
      select 1 from branches b
      where b.id = stock_movements.branch_id
        and is_member_of_business(b.business_id)
    )
  );

-- invoices
drop policy if exists "invoices rw" on invoices;
create policy "invoices rw" on invoices
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- invoice_items (vía invoice)
drop policy if exists "invoice_items rw" on invoice_items;
create policy "invoice_items rw" on invoice_items
  for all using (
    exists (
      select 1 from invoices i
      where i.id = invoice_items.invoice_id
        and is_member_of_business(i.business_id)
    )
  )
  with check (
    exists (
      select 1 from invoices i
      where i.id = invoice_items.invoice_id
        and is_member_of_business(i.business_id)
    )
  );

-- purchases
drop policy if exists "purchases rw" on purchases;
create policy "purchases rw" on purchases
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- purchase_items
drop policy if exists "purchase_items rw" on purchase_items;
create policy "purchase_items rw" on purchase_items
  for all using (
    exists (
      select 1 from purchases p
      where p.id = purchase_items.purchase_id
        and is_member_of_business(p.business_id)
    )
  )
  with check (
    exists (
      select 1 from purchases p
      where p.id = purchase_items.purchase_id
        and is_member_of_business(p.business_id)
    )
  );

-- sales
drop policy if exists "sales rw" on sales;
create policy "sales rw" on sales
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- expenses
drop policy if exists "expenses rw" on expenses;
create policy "expenses rw" on expenses
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- employees
drop policy if exists "employees rw" on employees;
create policy "employees rw" on employees
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- shifts (vía employee)
drop policy if exists "shifts rw" on shifts;
create policy "shifts rw" on shifts
  for all using (
    exists (
      select 1 from employees e
      where e.id = shifts.employee_id
        and is_member_of_business(e.business_id)
    )
  )
  with check (
    exists (
      select 1 from employees e
      where e.id = shifts.employee_id
        and is_member_of_business(e.business_id)
    )
  );

-- advance_payments
drop policy if exists "advance_payments rw" on advance_payments;
create policy "advance_payments rw" on advance_payments
  for all using (
    exists (
      select 1 from employees e
      where e.id = advance_payments.employee_id
        and is_member_of_business(e.business_id)
    )
  )
  with check (
    exists (
      select 1 from employees e
      where e.id = advance_payments.employee_id
        and is_member_of_business(e.business_id)
    )
  );

-- customers
drop policy if exists "customers rw" on customers;
create policy "customers rw" on customers
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- daily_closures
drop policy if exists "daily_closures rw" on daily_closures;
create policy "daily_closures rw" on daily_closures
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- whatsapp_messages
drop policy if exists "whatsapp rw" on whatsapp_messages;
create policy "whatsapp rw" on whatsapp_messages
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- ai_extractions (vía whatsapp_messages)
drop policy if exists "ai_extractions rw" on ai_extractions;
create policy "ai_extractions rw" on ai_extractions
  for all using (
    exists (
      select 1 from whatsapp_messages m
      where m.id = ai_extractions.message_id
        and is_member_of_business(m.business_id)
    )
  )
  with check (
    exists (
      select 1 from whatsapp_messages m
      where m.id = ai_extractions.message_id
        and is_member_of_business(m.business_id)
    )
  );

-- ai_recommendations
drop policy if exists "ai_recommendations rw" on ai_recommendations;
create policy "ai_recommendations rw" on ai_recommendations
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

-- campaigns
drop policy if exists "campaigns rw" on campaigns;
create policy "campaigns rw" on campaigns
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));
