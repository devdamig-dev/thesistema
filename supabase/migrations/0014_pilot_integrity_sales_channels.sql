alter table public.businesses add column if not exists sales_channels text[] not null default '{}'::text[];
