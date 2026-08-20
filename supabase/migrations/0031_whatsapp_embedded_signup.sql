-- WhatsApp Business Platform · Embedded Signup
-- Estado seguro visible en businesses + credenciales server-owned separadas.

alter table public.businesses
  add column if not exists whatsapp_waba_id text,
  add column if not exists whatsapp_phone_number_id text,
  add column if not exists whatsapp_connection_status text not null default 'disconnected';

update public.businesses
set whatsapp_connection_status = case
  when whatsapp_connected then 'connected'
  else 'disconnected'
end
where whatsapp_connection_status is null
   or whatsapp_connection_status not in ('disconnected', 'pending', 'connected', 'error');

alter table public.businesses
  drop constraint if exists businesses_whatsapp_connection_status_check;

alter table public.businesses
  add constraint businesses_whatsapp_connection_status_check
  check (whatsapp_connection_status in ('disconnected', 'pending', 'connected', 'error'));

create unique index if not exists businesses_whatsapp_phone_number_id_unique
  on public.businesses (whatsapp_phone_number_id)
  where whatsapp_phone_number_id is not null;

create unique index if not exists businesses_whatsapp_phone_unique
  on public.businesses (regexp_replace(whatsapp_phone, '\\D', '', 'g'))
  where whatsapp_phone is not null and whatsapp_connected = true;

create table if not exists public.whatsapp_integrations (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text,
  access_token text not null,
  token_type text,
  token_expires_at timestamptz,
  status text not null default 'connected' check (status in ('connected', 'disconnected', 'error')),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.whatsapp_integrations enable row level security;

-- La tabla contiene un token de Meta. Nunca se expone al cliente autenticado.
revoke all on table public.whatsapp_integrations from anon, authenticated;
grant select, insert, update, delete on table public.whatsapp_integrations to service_role;

create index if not exists idx_whatsapp_integrations_waba_id
  on public.whatsapp_integrations(waba_id);
