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
