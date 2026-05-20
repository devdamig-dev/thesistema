-- =============================================================================
-- GastroPilot AI · Schema inicial
-- Sprint 0 backend foundation.
-- =============================================================================

-- Extensiones ----------------------------------------------------------------
create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";

-- =============================================================================
-- ENUMS
-- =============================================================================
do $$ begin
  create type industry as enum (
    'hamburgueseria', 'foodtruck', 'cafeteria', 'pizzeria',
    'bar', 'heladeria', 'panaderia', 'restaurante', 'dark_kitchen'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type role_key as enum (
    'owner', 'admin', 'manager', 'accountant',
    'kitchen', 'cashier', 'waiter', 'delivery', 'viewer'
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
    'processing', 'needs_review', 'approved', 'sent_to_accountant'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_status as enum (
    'pending', 'needs_review', 'approved', 'rejected'
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

-- =============================================================================
-- TRIGGER: updated_at automático
-- =============================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- =============================================================================
-- TABLES — multi-tenant
-- =============================================================================

-- profiles ↔ auth.users (1:1)
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
create trigger trg_profiles_updated before update on profiles
  for each row execute function set_updated_at();

-- organizations
create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid references profiles(id) on delete set null,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_organizations_updated before update on organizations
  for each row execute function set_updated_at();

-- FK profile.organization_id → organizations
alter table profiles
  add constraint profiles_organization_fk
  foreign key (organization_id) references organizations(id) on delete set null;

-- businesses
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
create trigger trg_businesses_updated before update on businesses
  for each row execute function set_updated_at();
create index if not exists businesses_org_idx on businesses(organization_id);

-- branches
create table if not exists branches (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  address text,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_branches_updated before update on branches
  for each row execute function set_updated_at();
create index if not exists branches_business_idx on branches(business_id);

-- business_members (rol del usuario por negocio)
create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role role_key not null default 'manager',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);
create trigger trg_business_members_updated before update on business_members
  for each row execute function set_updated_at();
create index if not exists business_members_user_idx on business_members(user_id);

-- business_modules (qué módulos están activos por negocio)
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
create trigger trg_business_modules_updated before update on business_modules
  for each row execute function set_updated_at();

-- =============================================================================
-- TABLES — operación
-- =============================================================================

-- suppliers
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
create trigger trg_suppliers_updated before update on suppliers
  for each row execute function set_updated_at();
create index if not exists suppliers_business_idx on suppliers(business_id);

-- ingredients
create table if not exists ingredients (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null,
  unit text not null,
  avg_unit_cost numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_ingredients_updated before update on ingredients
  for each row execute function set_updated_at();
create index if not exists ingredients_business_idx on ingredients(business_id);

-- products
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
create trigger trg_products_updated before update on products
  for each row execute function set_updated_at();
create index if not exists products_business_idx on products(business_id);

-- recipes
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id)
);
create trigger trg_recipes_updated before update on recipes
  for each row execute function set_updated_at();

-- recipe_items
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
create trigger trg_recipe_items_updated before update on recipe_items
  for each row execute function set_updated_at();

-- stock_items (un stock por sucursal+insumo)
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
create trigger trg_stock_items_updated before update on stock_items
  for each row execute function set_updated_at();

-- stock_movements
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
create trigger trg_stock_movements_updated before update on stock_movements
  for each row execute function set_updated_at();
create index if not exists stock_movements_ingredient_idx on stock_movements(ingredient_id, created_at desc);

-- invoices (OCR)
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
create trigger trg_invoices_updated before update on invoices
  for each row execute function set_updated_at();
create index if not exists invoices_business_idx on invoices(business_id, invoice_date desc);

-- invoice_items
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
create trigger trg_invoice_items_updated before update on invoice_items
  for each row execute function set_updated_at();

-- purchases
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
create trigger trg_purchases_updated before update on purchases
  for each row execute function set_updated_at();
create index if not exists purchases_business_idx on purchases(business_id, purchased_at desc);

-- purchase_items
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
create trigger trg_purchase_items_updated before update on purchase_items
  for each row execute function set_updated_at();

-- sales
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
create trigger trg_sales_updated before update on sales
  for each row execute function set_updated_at();
create index if not exists sales_business_idx on sales(business_id, occurred_at desc);

-- expenses
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
create trigger trg_expenses_updated before update on expenses
  for each row execute function set_updated_at();
create index if not exists expenses_business_idx on expenses(business_id);

-- employees
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
create trigger trg_employees_updated before update on employees
  for each row execute function set_updated_at();
create index if not exists employees_business_idx on employees(business_id);

-- shifts (turno semanal por empleado)
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
create trigger trg_shifts_updated before update on shifts
  for each row execute function set_updated_at();

-- advance_payments (adelantos a empleados)
create table if not exists advance_payments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  amount numeric(12,2) not null,
  paid_at date not null default now(),
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_advance_payments_updated before update on advance_payments
  for each row execute function set_updated_at();

-- customers
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
create trigger trg_customers_updated before update on customers
  for each row execute function set_updated_at();
create index if not exists customers_business_idx on customers(business_id);

-- daily_closures (cierres operativos)
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
create trigger trg_daily_closures_updated before update on daily_closures
  for each row execute function set_updated_at();
create index if not exists daily_closures_business_idx on daily_closures(business_id, closure_date desc);

-- =============================================================================
-- TABLES — IA / WhatsApp / marketing
-- =============================================================================

-- whatsapp_messages
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
create trigger trg_whatsapp_messages_updated before update on whatsapp_messages
  for each row execute function set_updated_at();
create index if not exists whatsapp_messages_business_idx on whatsapp_messages(business_id, received_at desc);

-- ai_extractions (resultado de la IA sobre un mensaje)
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
create trigger trg_ai_extractions_updated before update on ai_extractions
  for each row execute function set_updated_at();
create index if not exists ai_extractions_message_idx on ai_extractions(message_id);

-- ai_recommendations
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
create trigger trg_ai_recommendations_updated before update on ai_recommendations
  for each row execute function set_updated_at();
create index if not exists ai_recommendations_business_idx on ai_recommendations(business_id, created_at desc);

-- campaigns
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
create trigger trg_campaigns_updated before update on campaigns
  for each row execute function set_updated_at();
create index if not exists campaigns_business_idx on campaigns(business_id, created_at desc);
