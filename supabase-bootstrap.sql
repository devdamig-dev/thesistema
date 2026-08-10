-- =============================================================================
-- GastroPilot AI · supabase-bootstrap.sql
-- =============================================================================
-- Archivo único para crear la base de datos completa desde cero usando
-- únicamente el SQL Editor de Supabase. Consolida en orden las 11
-- migraciones de supabase/migrations/0001 → 0011.
--
-- USO:
--   1. Crear el proyecto en Supabase.
--   2. Abrir SQL Editor → New query.
--   3. Pegar este archivo completo y ejecutar (Run).
--   4. Al final correr el bloque "VALIDATION QUERIES" (más abajo) y
--      verificar que cada query devuelve lo esperado.
--   5. Ir a Auth → Users → Add user para crear el owner del piloto.
--
-- IDEMPOTENCIA:
--   Todo el script usa `if not exists`, `do $$ exception when
--   duplicate_object`, `drop policy if exists` y `on conflict do update`
--   donde corresponde. Se puede reejecutar sin romper estado.
--
-- ALCANCE:
--   - 36 tablas + 21 enums + 6 funciones SECURITY DEFINER + triggers.
--   - RLS habilitado en todas las tablas + policies.
--   - Storage bucket `invoices` privado con policies por business.
--   - Publication `supabase_realtime` con las tablas en vivo.
--   - Onboarding flag en businesses.
--   - Sprint contable: categorías de deuda (impuesto / sueldo / etc).
--
-- NO incluye:
--   - Seed de demo (ver supabase/seed.sql aparte).
--   - Creación del usuario owner (hacelo desde Auth → Users).
-- =============================================================================


-- #############################################################################
-- # 0001 · INITIAL SCHEMA — extensiones, enums, tablas core, triggers
-- #############################################################################

-- Extensiones ----------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- ENUMS ----------------------------------------------------------------------
do $$ begin
  create type industry as enum (
    'hamburgueseria', 'foodtruck', 'cafeteria', 'pizzeria',
    'bar', 'heladeria', 'panaderia', 'restaurante', 'dark_kitchen'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type role_key as enum (
    'owner', 'admin', 'manager', 'accountant',
    'kitchen', 'cashier', 'waiter', 'delivery', 'viewer',
    -- Valores que históricamente se agregaron en migration 0007.
    -- Los incluimos en la creación inicial para que Supabase SQL Editor
    -- pueda correr todo en una sola transacción (PG no permite usar
    -- enum values recién agregados dentro de la misma tx — error 55P04).
    'marketing', 'employee'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type module_key as enum (
    'dashboard', 'inbox_ai', 'reports_ai', 'marketing_ai',
    'invoices_ocr', 'daily_closures', 'sales', 'purchases',
    'fixed_expenses', 'stock', 'products', 'recipes', 'food_cost',
    'employees', 'shifts', 'customers', 'deliveries',
    'production', 'expirations', 'waste',
    'beverages_stock', 'drink_recipes', 'happy_hour', 'shift_consumption',
    'breakfast_combos', 'frequent_customers', 'batch_recipes'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type sales_channel as enum (
    'salon', 'delivery', 'whatsapp', 'pedidos_ya', 'rappi', 'mp_qr'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_type as enum ('A', 'B', 'C');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_lifecycle as enum (
    'processing', 'needs_review', 'approved', 'sent_to_accountant',
    -- Valores históricamente agregados en migration 0006. Incluidos
    -- desde el inicio para soportar Supabase SQL Editor en single tx.
    'uploaded', 'extracted', 'rejected', 'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_status as enum (
    'pending', 'needs_review', 'approved', 'rejected',
    -- Valor históricamente agregado en migration 0004. Incluido desde
    -- el inicio para soportar Supabase SQL Editor en single tx.
    'failed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_channel as enum ('whatsapp', 'instagram', 'email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_type as enum (
    'promo', 'reactivation', 'launch', 'content', 'reminder'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type campaign_status as enum (
    'suggested', 'ready', 'scheduled', 'sent', 'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type stock_movement_reason as enum (
    'purchase', 'sale_consumption', 'waste', 'manual_adjust'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type priority as enum ('high', 'medium', 'low');
exception when duplicate_object then null; end $$;

do $$ begin
  create type weekday as enum ('mon','tue','wed','thu','fri','sat','sun');
exception when duplicate_object then null; end $$;

do $$ begin
  create type whatsapp_channel as enum ('text','audio','image','document');
exception when duplicate_object then null; end $$;

-- TRIGGER: updated_at automático -------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- TABLES — multi-tenant -----------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid,
  full_name text not null,
  email text,
  phone text,
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references profiles(id) on delete set null,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_organizations_updated on organizations;
create trigger trg_organizations_updated before update on organizations
  for each row execute function set_updated_at();

-- FK profile.organization_id → organizations (defensiva con if not exists)
do $$ begin
  alter table profiles
    add constraint profiles_organization_fk
    foreign key (organization_id) references organizations(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  industry industry not null default 'hamburgueseria',
  tax_id text,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_businesses_updated on businesses;
create trigger trg_businesses_updated before update on businesses
  for each row execute function set_updated_at();
create index if not exists businesses_org_idx on businesses(organization_id);

create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  address text,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_branches_updated on branches;
create trigger trg_branches_updated before update on branches
  for each row execute function set_updated_at();
create index if not exists branches_business_idx on branches(business_id);

create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role role_key not null default 'manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
drop trigger if exists trg_business_members_updated on business_members;
create trigger trg_business_members_updated before update on business_members
  for each row execute function set_updated_at();
create index if not exists business_members_user_idx on business_members(user_id);

create table if not exists business_modules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  module_key module_key not null,
  enabled boolean not null default true,
  suggested boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, module_key)
);
drop trigger if exists trg_business_modules_updated on business_modules;
create trigger trg_business_modules_updated before update on business_modules
  for each row execute function set_updated_at();

-- TABLES — operación --------------------------------------------------------

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  tax_id text,
  category text,
  phone text,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_suppliers_updated on suppliers;
create trigger trg_suppliers_updated before update on suppliers
  for each row execute function set_updated_at();
create index if not exists suppliers_business_idx on suppliers(business_id);

create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  unit text not null,
  avg_unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_ingredients_updated on ingredients;
create trigger trg_ingredients_updated before update on ingredients
  for each row execute function set_updated_at();
create index if not exists ingredients_business_idx on ingredients(business_id);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  category text not null,
  price numeric(12,2) not null,
  cost numeric(12,2) not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_products_updated on products;
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();
create index if not exists products_business_idx on products(business_id);

create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id)
);
drop trigger if exists trg_recipes_updated on recipes;
create trigger trg_recipes_updated before update on recipes
  for each row execute function set_updated_at();

create table if not exists recipe_items (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  name text not null,
  qty text not null,
  unit_cost numeric(12,2) not null,
  share numeric(6,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_recipe_items_updated on recipe_items;
create trigger trg_recipe_items_updated before update on recipe_items
  for each row execute function set_updated_at();

create table if not exists stock_items (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  current numeric(12,2) not null default 0,
  min numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ingredient_id, branch_id)
);
drop trigger if exists trg_stock_items_updated on stock_items;
create trigger trg_stock_items_updated before update on stock_items
  for each row execute function set_updated_at();

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  reason stock_movement_reason not null,
  qty numeric(12,2) not null,
  ref_type text,
  ref_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_stock_movements_updated on stock_movements;
create trigger trg_stock_movements_updated before update on stock_movements
  for each row execute function set_updated_at();
create index if not exists stock_movements_ingredient_idx on stock_movements(ingredient_id, created_at desc);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  number text not null,
  type invoice_type not null default 'A',
  tax_id text,
  invoice_date date not null,
  due_date date,
  payment_method text not null default 'Pendiente',
  subtotal numeric(12,2) not null default 0,
  tax numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  status invoice_lifecycle not null default 'processing',
  confidence numeric(4,2) not null default 0,
  source text not null default 'foto',
  document_url text,
  sender text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_invoices_updated on invoices;
create trigger trg_invoices_updated before update on invoices
  for each row execute function set_updated_at();
create index if not exists invoices_business_idx on invoices(business_id, invoice_date desc);

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text not null,
  qty text not null,
  unit_price numeric(12,2) not null,
  total numeric(12,2) not null,
  matched_ingredient_id uuid references ingredients(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_invoice_items_updated on invoice_items;
create trigger trg_invoice_items_updated before update on invoice_items
  for each row execute function set_updated_at();

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  supplier_id uuid references suppliers(id) on delete set null,
  purchased_at date not null,
  total numeric(12,2) not null,
  payment_method text not null default 'Transferencia',
  invoice_id uuid references invoices(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_purchases_updated on purchases;
create trigger trg_purchases_updated before update on purchases
  for each row execute function set_updated_at();
create index if not exists purchases_business_idx on purchases(business_id, purchased_at desc);

create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  ingredient_id uuid references ingredients(id) on delete set null,
  description text not null,
  qty numeric(12,2) not null,
  unit text not null default 'u',
  unit_price numeric(12,2) not null,
  total numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_purchase_items_updated on purchase_items;
create trigger trg_purchase_items_updated before update on purchase_items
  for each row execute function set_updated_at();

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  channel sales_channel not null,
  amount numeric(12,2) not null,
  occurred_at timestamptz not null default now(),
  product_id uuid references products(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_sales_updated on sales;
create trigger trg_sales_updated before update on sales
  for each row execute function set_updated_at();
create index if not exists sales_business_idx on sales(business_id, occurred_at desc);

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  category text not null default 'Otros',
  amount numeric(12,2) not null,
  due_date date,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_expenses_updated on expenses;
create trigger trg_expenses_updated before update on expenses
  for each row execute function set_updated_at();
create index if not exists expenses_business_idx on expenses(business_id);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  full_name text not null,
  role text not null,
  shift text,
  monthly_hours numeric(6,2) not null default 0,
  monthly_cost numeric(12,2) not null default 0,
  pending_advance numeric(12,2) not null default 0,
  absences int not null default 0,
  late_arrivals int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_employees_updated on employees;
create trigger trg_employees_updated before update on employees
  for each row execute function set_updated_at();
create index if not exists employees_business_idx on employees(business_id);

create table if not exists shifts (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  weekday weekday not null,
  from_time time not null,
  to_time time not null,
  hours numeric(4,1) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_shifts_updated on shifts;
create trigger trg_shifts_updated before update on shifts
  for each row execute function set_updated_at();

create table if not exists advance_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  amount numeric(12,2) not null,
  paid_at date not null default now(),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_advance_payments_updated on advance_payments;
create trigger trg_advance_payments_updated before update on advance_payments
  for each row execute function set_updated_at();

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  channel text,
  visits int not null default 0,
  total_spend numeric(12,2) not null default 0,
  last_visit_at timestamptz,
  segment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_customers_updated on customers;
create trigger trg_customers_updated before update on customers
  for each row execute function set_updated_at();
create index if not exists customers_business_idx on customers(business_id);

create table if not exists daily_closures (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  branch_id uuid references branches(id) on delete set null,
  closure_date date not null,
  raw_text text not null,
  parsed jsonb,
  inconsistencies jsonb default '[]'::jsonb,
  status approval_status not null default 'pending',
  gross_total numeric(12,2) not null default 0,
  net_total numeric(12,2) not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_daily_closures_updated on daily_closures;
create trigger trg_daily_closures_updated before update on daily_closures
  for each row execute function set_updated_at();
create index if not exists daily_closures_business_idx on daily_closures(business_id, closure_date desc);

-- TABLES — IA / WhatsApp / marketing ---------------------------------------

create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  sender_id uuid references profiles(id) on delete set null,
  sender_name text not null,
  sender_role text not null default 'Equipo',
  channel whatsapp_channel not null default 'text',
  raw text not null,
  preview text not null default '',
  media_url text,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_whatsapp_messages_updated on whatsapp_messages;
create trigger trg_whatsapp_messages_updated before update on whatsapp_messages
  for each row execute function set_updated_at();
create index if not exists whatsapp_messages_business_idx on whatsapp_messages(business_id, received_at desc);

create table if not exists ai_extractions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references whatsapp_messages(id) on delete cascade,
  type text not null,
  fields jsonb not null default '{}'::jsonb,
  missing text[] not null default '{}',
  confidence numeric(4,2) not null default 0,
  status approval_status not null default 'pending',
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_ai_extractions_updated on ai_extractions;
create trigger trg_ai_extractions_updated before update on ai_extractions
  for each row execute function set_updated_at();
create index if not exists ai_extractions_message_idx on ai_extractions(message_id);

create table if not exists ai_recommendations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  area text not null,
  priority priority not null default 'medium',
  title text not null,
  detail text not null,
  estimated_impact numeric(12,2) not null default 0,
  confidence numeric(4,2) not null default 0,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_ai_recommendations_updated on ai_recommendations;
create trigger trg_ai_recommendations_updated before update on ai_recommendations
  for each row execute function set_updated_at();
create index if not exists ai_recommendations_business_idx on ai_recommendations(business_id, created_at desc);

create table if not exists campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  channel campaign_channel not null,
  type campaign_type not null,
  audience_segment text not null,
  copy text not null,
  scheduled_for timestamptz,
  status campaign_status not null default 'suggested',
  estimated_impact numeric(12,2) not null default 0,
  confidence numeric(4,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_campaigns_updated on campaigns;
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function set_updated_at();
create index if not exists campaigns_business_idx on campaigns(business_id, created_at desc);


-- #############################################################################
-- # 0002 · HELPERS de seguridad (SECURITY DEFINER) + trigger auth.users
-- #############################################################################

create or replace function user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, auth
as $$
  select organization_id
  from profiles
  where id = auth.uid()
  limit 1;
$$;

create or replace function is_member_of_business(business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from business_members
    where business_id = business
      and user_id = auth.uid()
  );
$$;

create or replace function is_admin_of_business(business uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from business_members
    where business_id = business
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  insert into profiles (id, full_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();


-- #############################################################################
-- # 0003 · RLS POLICIES
-- #############################################################################

-- Habilitar RLS en todas las tablas core ---------------------------------
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

-- profiles -----------------------------------------------------------------
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

-- organizations ------------------------------------------------------------
drop policy if exists "organizations read" on organizations;
create policy "organizations read" on organizations
  for select using (id = user_organization_id());

drop policy if exists "organizations admin update" on organizations;
create policy "organizations admin update" on organizations
  for update using (owner_id = auth.uid());

-- businesses ---------------------------------------------------------------
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

-- branches -----------------------------------------------------------------
drop policy if exists "branches read" on branches;
create policy "branches read" on branches
  for select using (is_member_of_business(business_id));

drop policy if exists "branches write admin" on branches;
create policy "branches write admin" on branches
  for all using (is_admin_of_business(business_id))
  with check (is_admin_of_business(business_id));

-- business_members ---------------------------------------------------------
drop policy if exists "members read own business" on business_members;
create policy "members read own business" on business_members
  for select using (is_member_of_business(business_id));

drop policy if exists "members write admin" on business_members;
create policy "members write admin" on business_members
  for all using (is_admin_of_business(business_id))
  with check (is_admin_of_business(business_id));

-- business_modules ---------------------------------------------------------
drop policy if exists "modules read" on business_modules;
create policy "modules read" on business_modules
  for select using (is_member_of_business(business_id));

drop policy if exists "modules write admin" on business_modules;
create policy "modules write admin" on business_modules
  for all using (is_admin_of_business(business_id))
  with check (is_admin_of_business(business_id));

-- helper macro reutilizable (no usado directamente, dejado por compatibilidad)
create or replace function _policy_business_read_member(business_id uuid)
returns boolean language sql stable as $$
  select is_member_of_business(business_id);
$$;

-- Patrón estándar: políticas para tablas con business_id directo ----------
drop policy if exists "suppliers rw" on suppliers;
create policy "suppliers rw" on suppliers
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "ingredients rw" on ingredients;
create policy "ingredients rw" on ingredients
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "products rw" on products;
create policy "products rw" on products
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

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

drop policy if exists "invoices rw" on invoices;
create policy "invoices rw" on invoices
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

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

drop policy if exists "purchases rw" on purchases;
create policy "purchases rw" on purchases
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

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

drop policy if exists "sales rw" on sales;
create policy "sales rw" on sales
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "expenses rw" on expenses;
create policy "expenses rw" on expenses
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "employees rw" on employees;
create policy "employees rw" on employees
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

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

drop policy if exists "customers rw" on customers;
create policy "customers rw" on customers
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "daily_closures rw" on daily_closures;
create policy "daily_closures rw" on daily_closures
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "whatsapp rw" on whatsapp_messages;
create policy "whatsapp rw" on whatsapp_messages
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

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

drop policy if exists "ai_recommendations rw" on ai_recommendations;
create policy "ai_recommendations rw" on ai_recommendations
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "campaigns rw" on campaigns;
create policy "campaigns rw" on campaigns
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));


-- #############################################################################
-- # 0004 · INBOX ENHANCEMENTS — extender enum + denormalizar business_id
-- #############################################################################

alter type approval_status add value if not exists 'failed';

alter table ai_extractions
  add column if not exists business_id uuid references businesses(id) on delete cascade,
  add column if not exists summary text,
  add column if not exists target_entity text,
  add column if not exists target_record_id uuid,
  add column if not exists source text not null default 'heuristic';

create index if not exists ai_extractions_business_idx
  on ai_extractions(business_id, created_at desc);

-- Backfill defensivo (no-op si no hay filas previas)
update ai_extractions e
   set business_id = m.business_id
  from whatsapp_messages m
 where e.message_id = m.id
   and e.business_id is null;

drop policy if exists "ai_extractions rw" on ai_extractions;
create policy "ai_extractions rw" on ai_extractions
  for all using (
    (business_id is not null and is_member_of_business(business_id))
    or exists (
      select 1 from whatsapp_messages m
      where m.id = ai_extractions.message_id
        and is_member_of_business(m.business_id)
    )
  )
  with check (
    (business_id is not null and is_member_of_business(business_id))
    or exists (
      select 1 from whatsapp_messages m
      where m.id = ai_extractions.message_id
        and is_member_of_business(m.business_id)
    )
  );


-- #############################################################################
-- # 0005 · DEBTS + BALANCES + trigger de recálculo
-- #############################################################################

do $$ begin
  create type debt_status as enum ('active', 'overdue', 'settled');
exception when duplicate_object then null; end $$;

create table if not exists debts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  creditor text not null,
  supplier_id uuid references suppliers(id) on delete set null,
  concept text,
  original_amount numeric(12,2) not null,
  pending_amount numeric(12,2) not null,
  interest_rate numeric(5,2),
  due_date date,
  status debt_status not null default 'active',
  taken_at date not null default current_date,
  settled_at date,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_debts_updated on debts;
create trigger trg_debts_updated before update on debts
  for each row execute function set_updated_at();
create index if not exists debts_business_idx on debts(business_id, status, due_date);

create table if not exists debt_payments (
  id uuid primary key default gen_random_uuid(),
  debt_id uuid not null references debts(id) on delete cascade,
  amount numeric(12,2) not null,
  paid_at date not null default current_date,
  payment_method text not null default 'Transferencia',
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists trg_debt_payments_updated on debt_payments;
create trigger trg_debt_payments_updated before update on debt_payments
  for each row execute function set_updated_at();
create index if not exists debt_payments_debt_idx on debt_payments(debt_id, paid_at desc);

create or replace function recalc_debt_after_payment()
returns trigger
language plpgsql
as $$
declare
  v_paid numeric(12,2);
  v_debt debts;
begin
  select * into v_debt from debts where id = new.debt_id;
  select coalesce(sum(amount), 0) into v_paid
    from debt_payments where debt_id = new.debt_id;

  update debts
     set pending_amount = greatest(v_debt.original_amount - v_paid, 0),
         status = case
           when v_debt.original_amount - v_paid <= 0 then 'settled'::debt_status
           else v_debt.status
         end,
         settled_at = case
           when v_debt.original_amount - v_paid <= 0 and settled_at is null
             then current_date
           else settled_at
         end
   where id = new.debt_id;

  return new;
end;
$$;

drop trigger if exists trg_debt_payments_recalc on debt_payments;
create trigger trg_debt_payments_recalc
  after insert or update or delete on debt_payments
  for each row execute function recalc_debt_after_payment();

create table if not exists balance_snapshots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  period_month date not null,
  sales_total numeric(14,2) not null default 0,
  purchases_total numeric(14,2) not null default 0,
  expenses_total numeric(14,2) not null default 0,
  payroll_total numeric(14,2) not null default 0,
  withdrawals_total numeric(14,2) not null default 0,
  debt_payments_total numeric(14,2) not null default 0,
  debts_pending numeric(14,2) not null default 0,
  stock_valued numeric(14,2) not null default 0,
  cash_estimated numeric(14,2) not null default 0,
  gross_margin_pct numeric(5,2),
  operating_result numeric(14,2),
  net_result numeric(14,2),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, period_month)
);
drop trigger if exists trg_balance_snapshots_updated on balance_snapshots;
create trigger trg_balance_snapshots_updated before update on balance_snapshots
  for each row execute function set_updated_at();

alter table debts enable row level security;
alter table debt_payments enable row level security;
alter table balance_snapshots enable row level security;

drop policy if exists "debts rw" on debts;
create policy "debts rw" on debts
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));

drop policy if exists "debt_payments rw" on debt_payments;
create policy "debt_payments rw" on debt_payments
  for all using (
    exists (
      select 1 from debts d
      where d.id = debt_payments.debt_id
        and is_member_of_business(d.business_id)
    )
  )
  with check (
    exists (
      select 1 from debts d
      where d.id = debt_payments.debt_id
        and is_member_of_business(d.business_id)
    )
  );

drop policy if exists "balance_snapshots rw" on balance_snapshots;
create policy "balance_snapshots rw" on balance_snapshots
  for all using (is_member_of_business(business_id))
  with check (is_member_of_business(business_id));


-- #############################################################################
-- # 0006 · INVOICE OCR — Storage bucket + columnas OCR + matching + logs
-- #############################################################################

-- STORAGE BUCKET `invoices` ------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices',
  'invoices',
  false,
  20 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Storage policies (path: {organization_id}/{business_id}/{uuid}.{ext})
do $$ begin
  drop policy if exists "invoices storage read" on storage.objects;
  create policy "invoices storage read" on storage.objects
    for select using (
      bucket_id = 'invoices'
      and exists (
        select 1 from business_members bm
        where bm.user_id = auth.uid()
          and bm.business_id::text = split_part(name, '/', 2)
      )
    );

  drop policy if exists "invoices storage insert" on storage.objects;
  create policy "invoices storage insert" on storage.objects
    for insert with check (
      bucket_id = 'invoices'
      and exists (
        select 1 from business_members bm
        where bm.user_id = auth.uid()
          and bm.business_id::text = split_part(name, '/', 2)
      )
    );

  drop policy if exists "invoices storage delete" on storage.objects;
  create policy "invoices storage delete" on storage.objects
    for delete using (
      bucket_id = 'invoices'
      and exists (
        select 1 from business_members bm
        where bm.user_id = auth.uid()
          and bm.business_id::text = split_part(name, '/', 2)
          and bm.role in ('owner', 'admin')
      )
    );
exception when others then
  -- Algunos entornos managed requieren crear estas policies desde el panel.
  raise notice 'Storage policies omitidas: %', sqlerrm;
end $$;

-- INVOICES — columnas de procesamiento OCR ---------------------------------
alter table invoices
  add column if not exists storage_path text,
  add column if not exists storage_bucket text not null default 'invoices',
  add column if not exists file_mime text,
  add column if not exists file_size bigint,
  add column if not exists ocr_text text,
  add column if not exists ocr_provider text,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_completed_at timestamptz,
  add column if not exists processing_error text,
  add column if not exists ai_provider text;

alter type invoice_lifecycle add value if not exists 'uploaded';
alter type invoice_lifecycle add value if not exists 'extracted';
alter type invoice_lifecycle add value if not exists 'rejected';
alter type invoice_lifecycle add value if not exists 'failed';

-- INVOICE_ITEMS — columnas de matching con ingredientes --------------------
do $$ begin
  create type item_match_status as enum ('matched', 'ambiguous', 'unmatched', 'manual');
exception when duplicate_object then null; end $$;

alter table invoice_items
  add column if not exists match_status item_match_status not null default 'unmatched',
  add column if not exists match_score numeric(4,3),
  add column if not exists suggested_ingredient_id uuid references ingredients(id) on delete set null,
  add column if not exists unit text not null default 'u',
  add column if not exists qty_numeric numeric(12,3);

-- INVOICE_PROCESSING_LOGS — trazabilidad del pipeline ----------------------
create table if not exists invoice_processing_logs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  stage text not null,
  ok boolean not null,
  message text,
  data jsonb,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists invoice_processing_logs_invoice_idx
  on invoice_processing_logs(invoice_id, created_at desc);

alter table invoice_processing_logs enable row level security;

drop policy if exists "invoice_processing_logs rw" on invoice_processing_logs;
create policy "invoice_processing_logs rw" on invoice_processing_logs
  for all using (
    exists (
      select 1 from invoices i
      where i.id = invoice_processing_logs.invoice_id
        and is_member_of_business(i.business_id)
    )
  )
  with check (
    exists (
      select 1 from invoices i
      where i.id = invoice_processing_logs.invoice_id
        and is_member_of_business(i.business_id)
    )
  );

-- RPC helper: recalc cost para un ingredient -------------------------------
create or replace function recalc_ingredient_cost(p_ingredient_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric(12,2);
begin
  select coalesce(
    case
      when sum(qty) > 0 then sum(unit_price * qty) / sum(qty)
      else null
    end,
    (select avg_unit_cost from ingredients where id = p_ingredient_id)
  )
  into v_avg
  from (
    select pi.unit_price, pi.qty
    from purchase_items pi
    where pi.ingredient_id = p_ingredient_id
    order by pi.created_at desc
    limit 5
  ) recent;

  update ingredients
     set avg_unit_cost = coalesce(v_avg, avg_unit_cost)
   where id = p_ingredient_id;

  return v_avg;
end;
$$;


-- #############################################################################
-- # 0007 · REALTIME + ROLES + activity_logs + notifications + invitaciones
-- #############################################################################

-- Extender enum role_key con marketing + employee --------------------------
alter type role_key add value if not exists 'marketing';
alter type role_key add value if not exists 'employee';

-- ACTIVITY_LOGS — audit trail ----------------------------------------------
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,
  actor_role text,
  action text not null,
  target_type text,
  target_id uuid,
  summary text not null,
  data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_business_idx
  on activity_logs(business_id, created_at desc);
create index if not exists activity_logs_target_idx
  on activity_logs(target_type, target_id);

alter table activity_logs enable row level security;
drop policy if exists "activity_logs read" on activity_logs;
create policy "activity_logs read" on activity_logs
  for select using (is_member_of_business(business_id));
drop policy if exists "activity_logs write" on activity_logs;
create policy "activity_logs write" on activity_logs
  for insert with check (is_member_of_business(business_id));

-- NOTIFICATIONS — por usuario, dentro del negocio --------------------------
do $$ begin
  create type notification_tone as enum ('info', 'success', 'warn', 'danger', 'ai');
exception when duplicate_object then null; end $$;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  recipient_id uuid references profiles(id) on delete cascade,
  tone notification_tone not null default 'info',
  title text not null,
  detail text,
  href text,
  source text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_business_idx
  on notifications(business_id, created_at desc);
create index if not exists notifications_recipient_idx
  on notifications(recipient_id, read_at, created_at desc);

alter table notifications enable row level security;
drop policy if exists "notifications read" on notifications;
create policy "notifications read" on notifications
  for select using (
    is_member_of_business(business_id)
    and (recipient_id is null or recipient_id = auth.uid())
  );
drop policy if exists "notifications mark read" on notifications;
create policy "notifications mark read" on notifications
  for update using (
    is_member_of_business(business_id)
    and (recipient_id is null or recipient_id = auth.uid())
  )
  with check (
    is_member_of_business(business_id)
    and (recipient_id is null or recipient_id = auth.uid())
  );
drop policy if exists "notifications insert" on notifications;
create policy "notifications insert" on notifications
  for insert with check (is_member_of_business(business_id));

-- USER_INVITATIONS — flujo de invitación a un negocio ----------------------
do $$ begin
  create type invitation_status as enum ('pending', 'accepted', 'expired', 'revoked');
exception when duplicate_object then null; end $$;

create table if not exists user_invitations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null,
  role role_key not null default 'employee',
  invited_by uuid references profiles(id) on delete set null,
  status invitation_status not null default 'pending',
  token text not null unique default encode(gen_random_bytes(24), 'hex'),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  unique (business_id, email, status)
);
create index if not exists user_invitations_email_idx
  on user_invitations(email, status);

alter table user_invitations enable row level security;
drop policy if exists "invitations read" on user_invitations;
create policy "invitations read" on user_invitations
  for select using (is_member_of_business(business_id));
drop policy if exists "invitations write admin" on user_invitations;
create policy "invitations write admin" on user_invitations
  for all using (is_admin_of_business(business_id))
  with check (is_admin_of_business(business_id));

-- BRANCH_ASSIGNMENTS — qué sucursales puede ver cada miembro ---------------
create table if not exists branch_assignments (
  id uuid primary key default gen_random_uuid(),
  business_member_id uuid not null references business_members(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (business_member_id, branch_id)
);

alter table branch_assignments enable row level security;
drop policy if exists "branch_assignments rw" on branch_assignments;
create policy "branch_assignments rw" on branch_assignments
  for all using (
    exists (
      select 1 from business_members bm
      where bm.id = branch_assignments.business_member_id
        and is_member_of_business(bm.business_id)
    )
  )
  with check (
    exists (
      select 1 from business_members bm
      where bm.id = branch_assignments.business_member_id
        and is_admin_of_business(bm.business_id)
    )
  );

-- Realtime publication — tablas en vivo ------------------------------------
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'whatsapp_messages',
    'ai_extractions',
    'invoices',
    'invoice_items',
    'notifications',
    'activity_logs',
    'ai_recommendations',
    'stock_items'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when others then
      null;  -- ya está agregada, ignoramos
    end;
  end loop;
end $$;


-- #############################################################################
-- # 0008 · NOTIFICATIONS · priority + category + archived_at + trigger stock
-- #############################################################################

do $$ begin
  create type notification_priority as enum ('high', 'medium', 'low', 'info');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_category as enum (
    'operation', 'ai', 'stock', 'debt',
    'invoice', 'employee', 'marketing', 'system'
  );
exception when duplicate_object then null; end $$;

alter table notifications
  add column if not exists priority notification_priority not null default 'medium',
  add column if not exists category notification_category not null default 'system',
  add column if not exists archived_at timestamptz;

create index if not exists notifications_filter_idx
  on notifications(business_id, archived_at, read_at, priority, category, created_at desc);

-- Backfill básico — heredamos priority desde tone existente
update notifications
   set priority = case
     when tone in ('danger', 'warn') then 'high'::notification_priority
     when tone = 'success' then 'low'::notification_priority
     when tone = 'ai' then 'medium'::notification_priority
     else 'info'::notification_priority
   end
 where priority = 'medium';

-- Trigger SQL: stock crítico → notification ---------------------------------
create or replace function notify_critical_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_ingredient text;
begin
  if new.current >= new.min then return new; end if;
  if old.current < new.current then return new; end if;

  select b.business_id, i.name
    into v_business_id, v_ingredient
    from branches b
    join ingredients i on i.business_id = b.business_id
   where b.id = new.branch_id
     and i.id = new.ingredient_id;

  if v_business_id is null then return new; end if;

  insert into notifications (
    business_id, tone, priority, category, title, detail, href, source
  ) values (
    v_business_id,
    'danger',
    'high',
    'stock',
    format('Stock crítico · %s', v_ingredient),
    format('Quedan %s. Mínimo: %s.', new.current, new.min),
    '/stock',
    'stock'
  );
  return new;
end;
$$;

drop trigger if exists trg_stock_critical on stock_items;
create trigger trg_stock_critical
  after update on stock_items
  for each row execute function notify_critical_stock();


-- #############################################################################
-- # 0009 · BRANCH FILTERING — branch_id en WhatsApp / extractions / invoices
-- #############################################################################

alter table whatsapp_messages
  add column if not exists branch_id uuid references branches(id) on delete set null;
create index if not exists whatsapp_messages_branch_idx
  on whatsapp_messages(branch_id);

alter table ai_extractions
  add column if not exists branch_id uuid references branches(id) on delete set null;
create index if not exists ai_extractions_branch_idx
  on ai_extractions(branch_id);

-- Backfill desde whatsapp_messages
update ai_extractions e
   set branch_id = m.branch_id
  from whatsapp_messages m
 where e.message_id = m.id
   and e.branch_id is null
   and m.branch_id is not null;

alter table invoices
  add column if not exists branch_id uuid references branches(id) on delete set null;
create index if not exists invoices_branch_idx
  on invoices(branch_id);


-- #############################################################################
-- # 0010 · ONBOARDING — estado por business
-- #############################################################################

alter table businesses
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_step int not null default 0,
  add column if not exists onboarding_completed_at timestamptz;


-- #############################################################################
-- # 0011 · ACCOUNTING CATEGORIES — sprint contable (categorías de deuda)
-- #############################################################################

do $$ begin
  create type debt_category as enum (
    'supplier',     -- Proveedor (carne, lácteos, panificados, etc)
    'tax',          -- Impuesto (IVA, Autónomos, IIBB, ARCA)
    'loan',         -- Préstamo bancario o privado
    'rent',         -- Alquiler de local
    'utility',      -- Servicios (luz, gas, agua, internet)
    'payroll',      -- Sueldos y cargas sociales
    'other'         -- Otros
  );
exception when duplicate_object then null; end $$;

alter table debts
  add column if not exists category debt_category not null default 'supplier',
  add column if not exists period text,
  add column if not exists organism text;

create index if not exists debts_category_idx on debts(business_id, category, status);


-- =============================================================================
-- VALIDATION QUERIES
-- =============================================================================
-- Correr cada bloque por separado y comparar con el resultado esperado.
-- Cualquier desviación indica que falta o sobra algo del schema.
-- =============================================================================

-- 1. Total de tablas en public (esperado: 36)
-- -----------------------------------------------------------------------------
select count(*) as public_tables
  from information_schema.tables
 where table_schema = 'public'
   and table_type   = 'BASE TABLE';

-- 2. Tablas SIN RLS habilitado (esperado: 0 filas)
-- -----------------------------------------------------------------------------
select tablename
  from pg_tables
 where schemaname  = 'public'
   and rowsecurity = false
   and tablename not like 'supabase_%';

-- 3. Enums creados (esperado: 21 nombres distintos)
-- -----------------------------------------------------------------------------
-- approval_status, campaign_channel, campaign_status, campaign_type,
-- debt_category, debt_status, industry, invitation_status,
-- invoice_lifecycle, invoice_type, item_match_status, module_key,
-- notification_category, notification_priority, notification_tone,
-- priority, role_key, sales_channel, stock_movement_reason,
-- weekday, whatsapp_channel
select t.typname
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
 where n.nspname = 'public'
   and t.typtype = 'e'
 order by t.typname;

-- 4. Bucket Storage `invoices` privado (esperado: 1 fila, public=false)
-- -----------------------------------------------------------------------------
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id = 'invoices';

-- 5. Helpers SECURITY DEFINER + RPC presentes (esperado: ≥ 6 nombres)
-- -----------------------------------------------------------------------------
-- handle_new_auth_user, is_admin_of_business, is_member_of_business,
-- notify_critical_stock, recalc_debt_after_payment, recalc_ingredient_cost,
-- user_organization_id
select proname, prosecdef as security_definer
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in (
     'user_organization_id',
     'is_member_of_business',
     'is_admin_of_business',
     'handle_new_auth_user',
     'recalc_debt_after_payment',
     'recalc_ingredient_cost',
     'notify_critical_stock',
     'set_updated_at'
   )
 order by proname;

-- 6. Trigger en auth.users que crea profile automáticamente (esperado: 1)
-- -----------------------------------------------------------------------------
select tgname, tgenabled
  from pg_trigger
 where tgrelid = 'auth.users'::regclass
   and tgname  = 'on_auth_user_created';

-- 7. Trigger de recálculo de deudas (esperado: 1)
-- -----------------------------------------------------------------------------
select tgname
  from pg_trigger
 where tgrelid = 'public.debt_payments'::regclass
   and tgname  = 'trg_debt_payments_recalc';

-- 8. Trigger de stock crítico (esperado: 1)
-- -----------------------------------------------------------------------------
select tgname
  from pg_trigger
 where tgrelid = 'public.stock_items'::regclass
   and tgname  = 'trg_stock_critical';

-- 9. Sprint contable aplicado — columnas en debts (esperado: 3 filas)
-- -----------------------------------------------------------------------------
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'debts'
   and column_name in ('category', 'period', 'organism')
 order by column_name;

-- 10. Onboarding aplicado — columnas en businesses (esperado: 3 filas)
-- -----------------------------------------------------------------------------
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'businesses'
   and column_name in (
     'onboarding_completed',
     'onboarding_step',
     'onboarding_completed_at'
   )
 order by column_name;

-- 11. Branch filtering aplicado — branch_id en WA/extractions/invoices (3)
-- -----------------------------------------------------------------------------
select table_name, column_name
  from information_schema.columns
 where table_schema = 'public'
   and column_name  = 'branch_id'
   and table_name in ('whatsapp_messages', 'ai_extractions', 'invoices')
 order by table_name;

-- 12. Inbox enhancements aplicados — columnas en ai_extractions (esperado: 5)
-- -----------------------------------------------------------------------------
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'ai_extractions'
   and column_name in (
     'business_id', 'summary', 'target_entity', 'target_record_id', 'source'
   )
 order by column_name;

-- 13. OCR aplicado — columnas en invoices (esperado: 10)
-- -----------------------------------------------------------------------------
select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name   = 'invoices'
   and column_name in (
     'storage_path', 'storage_bucket', 'file_mime', 'file_size',
     'ocr_text', 'ocr_provider',
     'processing_started_at', 'processing_completed_at', 'processing_error',
     'ai_provider'
   )
 order by column_name;

-- 14. Realtime publication con tablas registradas (esperado: ≥ 8 tablas)
-- -----------------------------------------------------------------------------
select tablename
  from pg_publication_tables
 where pubname = 'supabase_realtime'
   and tablename in (
     'whatsapp_messages', 'ai_extractions', 'invoices', 'invoice_items',
     'notifications', 'activity_logs', 'ai_recommendations', 'stock_items'
   )
 order by tablename;

-- 15. Smoke final · insert + delete como service_role (esperado: 0 errores)
-- -----------------------------------------------------------------------------
-- Sólo correr con la conexión `service_role` (la del SQL Editor lo es).
insert into organizations (name, plan) values ('__smoke__', 'piloto');
delete from organizations where name = '__smoke__';
-- Si la fila se borra y no hay errores, el schema está listo para producción.
-- Bootstrap transaccional e idempotente del primer negocio de un usuario.
-- SECURITY DEFINER es necesario para romper el ciclo de RLS: todavía no hay
-- membership, por lo que el usuario no podría insertar su primer business.
create or replace function public.bootstrap_first_business(
  p_name text,
  p_industry industry,
  p_tax_id text default null,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_modules module_key[] default '{}'::module_key[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_org_id uuid;
  v_business_id uuid;
begin
  if v_user_id is null then
    raise exception 'not_authenticated';
  end if;

  -- Serializa reintentos concurrentes (doble click/dos pestañas).
  perform 1 from profiles where id = v_user_id for update;
  if not found then
    raise exception 'profile_not_found';
  end if;

  select organization_id into v_org_id from profiles where id = v_user_id;
  if v_org_id is null then
    insert into organizations (name, owner_id)
    values (p_name, v_user_id)
    returning id into v_org_id;

    update profiles set organization_id = v_org_id where id = v_user_id;
  end if;

  select bm.business_id into v_business_id
  from business_members bm
  where bm.user_id = v_user_id
  order by bm.created_at
  limit 1;

  if v_business_id is null then
    select b.id into v_business_id
    from businesses b
    join organizations o on o.id = b.organization_id
    where b.organization_id = v_org_id
      and o.owner_id = v_user_id
      and not exists (select 1 from business_members bm where bm.business_id = b.id)
    order by b.created_at
    limit 1;
  end if;

  if v_business_id is null then
    insert into businesses (organization_id, name, industry, tax_id, timezone)
    values (v_org_id, p_name, p_industry, nullif(p_tax_id, ''), p_timezone)
    returning id into v_business_id;
  else
    update businesses
    set name = p_name,
        industry = p_industry,
        tax_id = nullif(p_tax_id, ''),
        timezone = p_timezone
    where id = v_business_id;
  end if;

  insert into business_members (business_id, user_id, role)
  values (v_business_id, v_user_id, 'owner')
  on conflict (business_id, user_id) do update set role = 'owner';

  if not exists (select 1 from branches where business_id = v_business_id and is_main) then
    insert into branches (business_id, name, is_main)
    values (v_business_id, 'Principal', true);
  end if;

  insert into business_modules (business_id, module_key, enabled, suggested)
  select v_business_id, module_key, true, true from unnest(p_modules) module_key
  on conflict (business_id, module_key)
  do update set enabled = true, suggested = true;

  update businesses set onboarding_step = greatest(onboarding_step, 1)
  where id = v_business_id;

  return v_business_id;
end;
$$;

revoke all on function public.bootstrap_first_business(text, industry, text, text, module_key[]) from public;
grant execute on function public.bootstrap_first_business(text, industry, text, text, module_key[]) to authenticated;
