-- Passive WhatsApp information sources, independent of Team membership.
-- Sources can populate the Inbox but can NEVER invoke the command/confirmation agent.
create table if not exists public.whatsapp_read_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  phone_number_id text not null,
  sender_phone text not null check (sender_phone ~ '^[1-9][0-9]{7,14}$'),
  label text not null check (char_length(label) between 1 and 100),
  branch_id uuid not null references public.branches(id),
  enabled boolean not null default true,
  consent_confirmed_at timestamptz not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  last_message_at timestamptz,
  unique (business_id, sender_phone)
);
create index if not exists whatsapp_read_sources_lookup
  on public.whatsapp_read_sources (business_id, phone_number_id, sender_phone)
  where enabled;

create table if not exists public.whatsapp_read_receipts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  source_id uuid not null references public.whatsapp_read_sources(id) on delete cascade,
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 512),
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (business_id, provider_message_id)
);

alter table public.whatsapp_read_sources enable row level security;
alter table public.whatsapp_read_receipts enable row level security;
revoke all on public.whatsapp_read_sources, public.whatsapp_read_receipts from public, anon, authenticated;
-- Owner/admin can inspect only their own read sources. Data API has no write grants.
grant select on public.whatsapp_read_sources to authenticated;
create policy "whatsapp read sources owner admin only"
  on public.whatsapp_read_sources for select to authenticated
  using (exists (
    select 1 from public.business_members m
    where m.business_id = whatsapp_read_sources.business_id
      and m.user_id = (select auth.uid()) and m.role in ('owner', 'admin')
  ));
-- All source configuration/reads pass through the authenticated server route.
-- This dedicated ingest RPC is service-role only and executes atomically.
create or replace function public.ingest_whatsapp_read_source(
  p_business_id uuid,
  p_phone_number_id text,
  p_sender_phone text,
  p_provider_message_id text,
  p_sender_name text,
  p_text text,
  p_sent_at timestamptz,
  p_type text,
  p_fields jsonb,
  p_missing text[],
  p_confidence numeric,
  p_summary text
) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_source public.whatsapp_read_sources%rowtype;
  v_receipt uuid;
  v_message uuid;
begin
  if p_business_id is null or p_phone_number_id is null or p_sender_phone is null
     or p_provider_message_id is null or length(p_provider_message_id) not between 1 and 512
     or p_text is null or length(p_text) not between 1 and 4096
     or p_sent_at is null or p_sent_at > now() + interval '5 minutes'
  then return 'ignored'; end if;

  select s.* into v_source
  from public.whatsapp_read_sources s
  join public.whatsapp_integrations wi
    on wi.business_id = s.business_id and wi.phone_number_id = s.phone_number_id
       and wi.status = 'connected'
  join public.branches b on b.id = s.branch_id and b.business_id = s.business_id
  where s.business_id = p_business_id and s.phone_number_id = p_phone_number_id
    and s.sender_phone = p_sender_phone and s.enabled
  limit 1;
  if not found or p_sent_at < greatest(v_source.created_at, v_source.consent_confirmed_at) - interval '1 second'
  then return 'ignored'; end if;

  insert into public.whatsapp_read_receipts (business_id, source_id, provider_message_id)
  values (p_business_id, v_source.id, p_provider_message_id)
  on conflict (business_id, provider_message_id) do nothing
  returning id into v_receipt;
  if v_receipt is null then return 'duplicate'; end if;

  insert into public.whatsapp_messages
    (business_id, branch_id, sender_name, sender_role, channel, raw, preview, received_at)
  values
    (p_business_id, v_source.branch_id, left(coalesce(nullif(p_sender_name, ''), v_source.label), 100),
     'Fuente WhatsApp · lectura', 'text', p_text, left(p_text, 120), p_sent_at)
  returning id into v_message;

  insert into public.ai_extractions
    (business_id, branch_id, message_id, type, fields, missing, confidence, status, summary, source)
  values
    (p_business_id, v_source.branch_id, v_message, left(coalesce(nullif(p_type, ''), 'unknown'), 64),
     coalesce(p_fields, '{}'::jsonb), coalesce(p_missing, '{}'::text[]),
     greatest(0, least(1, coalesce(p_confidence, 0))), 'pending',
     left(coalesce(p_summary, p_text), 400), 'heuristic');

  update public.whatsapp_read_receipts set message_id = v_message where id = v_receipt;
  update public.whatsapp_read_sources set last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at)
  where id = v_source.id;
  return 'ingested';
end;
$$;
revoke all on function public.ingest_whatsapp_read_source(uuid,text,text,text,text,text,timestamptz,text,jsonb,text[],numeric,text) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp_read_source(uuid,text,text,text,text,text,timestamptz,text,jsonb,text[],numeric,text) to service_role;
