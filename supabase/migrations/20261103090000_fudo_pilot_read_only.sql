-- O1 Fudo pilot: isolated, service-role-only read staging. No changes to core stock, money or orders.
-- Apply before enabling the Fudo UI. Credentials are encrypted in the application with AES-256-GCM.
create table if not exists public.fudo_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  connection_generation uuid not null default gen_random_uuid(),
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
  connection_generation uuid not null,
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
  connection_generation uuid not null,
  resource_type text not null check (resource_type in ('products','ingredients','providers','orders','sales')),
  -- 0 means that the resource completed this import cycle; next invocation skips it.
  next_page integer not null default 1 check (next_page between 0 and 100000),
  last_complete_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, connection_generation, resource_type)
);

create table if not exists public.fudo_external_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  connection_generation uuid not null,
  provider text not null default 'fudo' check (provider = 'fudo'),
  resource_type text not null check (resource_type in ('products','ingredients','providers','orders','sales')),
  external_id text not null check (length(external_id) between 1 and 256),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  source_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (business_id, connection_generation, resource_type, external_id)
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


-- Fudo lifecycle fencing: serialize sync startup, rotation and disconnection on
-- the same business row in one database transaction. A "running" check from
-- JavaScript followed by a separate mutation is NOT concurrency safe.
--
-- A function can be abandoned by serverless termination. All entrypoints
-- recover runs older than 10 minutes, even if decrypting credentials fails.
-- Each request is bounded by provider timeouts (well below this threshold).

create or replace function public.fudo_recover_stale_runs(p_business_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.fudo_sync_runs
     set status = 'failed', error_code = 'interrupted', finished_at = now()
   where business_id = p_business_id
     and status = 'running'
     and started_at < now() - interval '10 minutes';
end;
$$;

create or replace function public.fudo_replace_connection(
  p_business_id uuid,
  p_actor_id uuid,
  p_ciphertext text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_business_id is null or p_actor_id is null or
     p_ciphertext is null or length(p_ciphertext) not between 50 and 16384
  then return 'invalid_input'; end if;

  -- Serializes all three lifecycle operations for this tenant.
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then return 'not_found'; end if;
  perform public.fudo_recover_stale_runs(p_business_id);
  if exists (select 1 from public.fudo_sync_runs
             where business_id = p_business_id and status = 'running')
  then return 'sync_running'; end if;

  insert into public.fudo_connections (
    business_id, connection_generation, credentials_ciphertext, status,
    last_synced_at, last_sync_status, last_tested_at, last_error_code, updated_by, updated_at
  ) values (
    p_business_id, gen_random_uuid(), p_ciphertext, 'connected',
    null, null, now(), null, p_actor_id, now()
  )
  on conflict (business_id) do update
    set connection_generation = excluded.connection_generation,
        credentials_ciphertext = excluded.credentials_ciphertext,
        status = 'connected',
        last_synced_at = null,
        last_sync_status = null,
        last_tested_at = now(),
        last_error_code = null,
        updated_by = excluded.updated_by,
        updated_at = now();
  return 'connected';
end;
$$;

create or replace function public.fudo_disconnect_connection(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_business_id is null then return 'invalid_input'; end if;
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then return 'not_found'; end if;
  perform public.fudo_recover_stale_runs(p_business_id);
  if exists (select 1 from public.fudo_sync_runs
             where business_id = p_business_id and status = 'running')
  then return 'sync_running'; end if;
  delete from public.fudo_connections where business_id = p_business_id;
  return 'disconnected';
end;
$$;

create or replace function public.fudo_begin_sync(
  p_business_id uuid,
  p_expected_generation uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run_id uuid;
begin
  if p_business_id is null or p_expected_generation is null or p_actor_id is null
  then return jsonb_build_object('code', 'invalid_input'); end if;
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then return jsonb_build_object('code', 'not_found'); end if;
  perform public.fudo_recover_stale_runs(p_business_id);

  if not exists (select 1 from public.fudo_connections
                 where business_id = p_business_id
                   and connection_generation = p_expected_generation
                   and status = 'connected')
  then return jsonb_build_object('code', 'connection_changed'); end if;
  if exists (select 1 from public.fudo_sync_runs
             where business_id = p_business_id and status = 'running')
  then return jsonb_build_object('code', 'sync_running'); end if;
  insert into public.fudo_sync_runs (business_id, connection_generation, status, started_by)
    values (p_business_id, p_expected_generation, 'running', p_actor_id)
    returning id into v_run_id;
  return jsonb_build_object('code', 'started', 'run_id', v_run_id);
end;
$$;

revoke all on function public.fudo_recover_stale_runs(uuid) from public, anon, authenticated;
revoke all on function public.fudo_replace_connection(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.fudo_disconnect_connection(uuid) from public, anon, authenticated;
revoke all on function public.fudo_begin_sync(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.fudo_recover_stale_runs(uuid) to service_role;
grant execute on function public.fudo_replace_connection(uuid,uuid,text) to service_role;
grant execute on function public.fudo_disconnect_connection(uuid) to service_role;
grant execute on function public.fudo_begin_sync(uuid,uuid,uuid) to service_role;
