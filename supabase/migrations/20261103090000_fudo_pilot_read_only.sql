-- O1 Fudo pilot: isolated, service-role-only read staging. No changes to core stock, money or orders.
-- Apply before enabling the Fudo UI. Credentials are encrypted in the application with AES-256-GCM.
create table if not exists public.fudo_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  credentials_ciphertext text not null check (length(credentials_ciphertext) between 50 and 16384),
  status text not null default 'connected' check (status in ('connected','error')),
  last_tested_at timestamptz,
  last_synced_at timestamptz,
  last_sync_status text check (last_sync_status in ('completed','partial','failed')),
  last_error_code text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fudo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  status text not null check (status in ('running','completed','partial','failed')),
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  error_code text,
  started_by uuid references auth.users(id) on delete set null,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists fudo_sync_runs_history_idx
  on public.fudo_sync_runs (business_id, started_at desc);
-- At most one live sync per tenant, including concurrent serverless invocations.
create unique index if not exists fudo_sync_runs_one_running_per_business_idx
  on public.fudo_sync_runs (business_id) where status = 'running';

create table if not exists public.fudo_sync_progress (
  business_id uuid not null references public.businesses(id) on delete cascade,
  resource_type text not null check (resource_type in ('products','ingredients','providers','orders','sales')),
  next_page integer not null default 1 check (next_page between 1 and 100000),
  last_complete_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, resource_type)
);

create table if not exists public.fudo_external_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  provider text not null default 'fudo' check (provider = 'fudo'),
  resource_type text not null check (resource_type in ('products','ingredients','providers','orders','sales')),
  external_id text not null check (length(external_id) between 1 and 256),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (business_id, resource_type, external_id)
);
create index if not exists fudo_external_records_resource_idx
  on public.fudo_external_records (business_id, resource_type, last_seen_at desc);

-- Raw provider payload may contain customers, fiscal values and private business data.
-- No direct authenticated or anonymous read/writes: only the vetted server adapter may query.
alter table public.fudo_connections enable row level security;
alter table public.fudo_sync_runs enable row level security;
alter table public.fudo_sync_progress enable row level security;
alter table public.fudo_external_records enable row level security;
revoke all on table public.fudo_connections, public.fudo_sync_runs,
 public.fudo_sync_progress, public.fudo_external_records from public, anon, authenticated;
grant select, insert, update, delete on table public.fudo_connections, public.fudo_sync_runs,
 public.fudo_sync_progress, public.fudo_external_records to service_role;
