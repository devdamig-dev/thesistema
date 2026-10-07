-- Versioned multi-account contract. Preserve any earlier whatsapp_signup_sessions draft unchanged.
create table if not exists public.whatsapp_connection_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  mode text not null check (mode in ('business_app', 'cloud_api')),
  access_token text,
  token_expires_at timestamptz,
  choices jsonb not null default '[]'::jsonb check (jsonb_typeof(choices) = 'array'),
  expires_at timestamptz not null default now() + interval '10 minutes',
  claimed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.whatsapp_connection_sessions enable row level security;
revoke all on public.whatsapp_connection_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp_connection_sessions to service_role;
create index if not exists whatsapp_connection_sessions_business_idx on public.whatsapp_connection_sessions(business_id);
create index if not exists whatsapp_connection_sessions_user_idx on public.whatsapp_connection_sessions(user_id);
create index if not exists whatsapp_connection_sessions_expiry_idx on public.whatsapp_connection_sessions(expires_at);

create or replace function public.complete_whatsapp_signup(
  p_session_id uuid, p_business_id uuid, p_actor_id uuid, p_phone_id text, p_display_phone text
) returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  s public.whatsapp_connection_sessions%rowtype;
  selected jsonb;
  current_phone text;
  member_role text;
  actor_name text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'service_role_required'; end if;
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then raise exception 'business_not_found'; end if;
  select m.role::text, p.full_name into member_role, actor_name
    from public.business_members m join public.profiles p on p.id = m.user_id
    where m.business_id = p_business_id and m.user_id = p_actor_id and p.active = true
    and m.role::text in ('owner','admin');
  if not found then raise exception 'permission_denied'; end if;
  select * into s from public.whatsapp_connection_sessions where id = p_session_id
    and business_id = p_business_id and user_id = p_actor_id for update;
  if not found or s.consumed_at is not null or s.claimed_at is null
    or s.expires_at <= now() or s.access_token is null
    or (s.token_expires_at is not null and s.token_expires_at <= now()) then
    raise exception 'signup_session_unavailable';
  end if;
  select item into selected from jsonb_array_elements(s.choices) item
    where item->>'id' = p_phone_id and item->>'selectable' = 'true';
  if selected is null or p_phone_id !~ '^[0-9]{5,30}$' or selected->>'accountId' !~ '^[0-9]{5,30}$'
    or p_display_phone is null or length(p_display_phone) < 8 then raise exception 'phone_not_authorized'; end if;
  select phone_number_id into current_phone from public.whatsapp_integrations where business_id = p_business_id for update;
  if current_phone is not null and current_phone <> p_phone_id then raise exception 'existing_connection_must_not_be_replaced'; end if;
  if exists (select 1 from public.whatsapp_integrations where phone_number_id = p_phone_id and business_id <> p_business_id) then raise exception 'phone_already_assigned'; end if;
  insert into public.whatsapp_integrations(business_id, waba_id, phone_number_id, display_phone_number, access_token, token_expires_at, status, connected_at, updated_at)
    values(p_business_id, selected->>'accountId', p_phone_id, p_display_phone, s.access_token, s.token_expires_at, 'connected', now(), now())
    on conflict(business_id) do update set waba_id=excluded.waba_id, phone_number_id=excluded.phone_number_id,
      display_phone_number=excluded.display_phone_number, access_token=excluded.access_token,
      token_expires_at=excluded.token_expires_at, status='connected', connected_at=now(), updated_at=now();
  update public.businesses set whatsapp_connected=true, whatsapp_phone=p_display_phone,
    whatsapp_connected_at=now(), whatsapp_waba_id=selected->>'accountId', whatsapp_phone_number_id=p_phone_id,
    whatsapp_connection_status='connected' where id=p_business_id;
  insert into public.activity_logs(business_id, actor_id, actor_name, actor_role, action, target_type, summary, data)
    values(p_business_id, p_actor_id, actor_name, member_role, 'whatsapp.connected', 'whatsapp',
      'Cuenta de WhatsApp vinculada; prueba de mensajes pendiente',
      jsonb_build_object('phone_number_id',p_phone_id,'waba_id',selected->>'accountId','mode',s.mode,'signup_session_id',s.id));
  update public.whatsapp_connection_sessions set consumed_at=now(), access_token=null, choices='[]'::jsonb where id=s.id;
end $$;
revoke all on function public.complete_whatsapp_signup(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.complete_whatsapp_signup(uuid,uuid,uuid,text,text) to service_role;
