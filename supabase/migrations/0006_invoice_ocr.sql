-- =============================================================================
-- OCR & Smart Invoices · extensión de schema
-- =============================================================================
-- Agrega:
--   - Storage bucket `invoices` con policies por business.
--   - Columnas de procesamiento OCR a invoices.
--   - Columnas de matching a invoice_items.
--   - Tabla invoice_processing_logs para trazabilidad.
-- =============================================================================

-- =============================================================================
-- STORAGE BUCKET
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'invoices',
  'invoices',
  false,
  20 * 1024 * 1024,  -- 20 MB max por factura
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Policies — el path tiene el formato {organization_id}/{business_id}/{uuid}.{ext}
-- Sólo miembros del business pueden leer/subir/borrar.
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
  -- Algunos entornos (Supabase managed) requieren ejecutar esto desde el panel.
  raise notice 'Storage policies omitidas: %', sqlerrm;
end $$;

-- =============================================================================
-- INVOICES — columnas de procesamiento OCR
-- =============================================================================
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

-- Sumar valores nuevos al enum invoice_lifecycle para reflejar todo el flujo.
alter type invoice_lifecycle add value if not exists 'uploaded';
alter type invoice_lifecycle add value if not exists 'extracted';
alter type invoice_lifecycle add value if not exists 'rejected';
alter type invoice_lifecycle add value if not exists 'failed';

-- =============================================================================
-- INVOICE_ITEMS — columnas de matching con ingredientes
-- =============================================================================
do $$ begin
  create type item_match_status as enum ('matched', 'ambiguous', 'unmatched', 'manual');
exception when duplicate_object then null; end $$;

alter table invoice_items
  add column if not exists match_status item_match_status not null default 'unmatched',
  add column if not exists match_score numeric(4,3),
  add column if not exists suggested_ingredient_id uuid references ingredients(id) on delete set null,
  add column if not exists unit text not null default 'u',
  add column if not exists qty_numeric numeric(12,3);

-- =============================================================================
-- INVOICE_PROCESSING_LOGS — para debugging y trazabilidad
-- =============================================================================
create table if not exists invoice_processing_logs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  stage text not null,           -- upload | ocr | ai | matching | approval | recalc | error
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

-- =============================================================================
-- RPC helper: recalc cost para un ingredient
-- =============================================================================
create or replace function recalc_ingredient_cost(p_ingredient_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_avg numeric(12,2);
begin
  -- Promedio ponderado por cantidad de los últimos 5 purchase_items.
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
