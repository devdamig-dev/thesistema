-- =============================================================================
-- Realtime + Multiusuario + Roles
-- =============================================================================
-- Sumamos los roles que faltaban, tablas de actividad/notificaciones/
-- invitaciones, y habilitamos realtime en las tablas clave.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Extender enum role_key con marketing + employee
-- ---------------------------------------------------------------------------
alter type role_key add value if not exists 'marketing';
alter type role_key add value if not exists 'employee';

-- ---------------------------------------------------------------------------
-- ACTIVITY_LOGS — audit trail
-- ---------------------------------------------------------------------------
create table if not exists activity_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  actor_name text,                    -- snapshot del nombre al momento del evento
  actor_role text,                    -- snapshot del rol
  action text not null,               -- approval.invoice / debt.payment.registered / etc
  target_type text,                   -- invoices | debts | inbox | products | ...
  target_id uuid,
  summary text not null,              -- una línea legible
  data jsonb,                         -- payload arbitrario para drill-down
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

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS — por usuario, dentro del negocio
-- ---------------------------------------------------------------------------
do $$ begin
  create type notification_tone as enum ('info', 'success', 'warn', 'danger', 'ai');
exception when duplicate_object then null; end $$;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  -- Si recipient_id es null, la notificación es para todo el business
  -- (la consume cualquier miembro con permiso).
  recipient_id uuid references profiles(id) on delete cascade,
  tone notification_tone not null default 'info',
  title text not null,
  detail text,
  href text,                          -- link de la acción sugerida
  source text,                        -- inbox | invoices | debts | stock | ai
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

-- ---------------------------------------------------------------------------
-- USER_INVITATIONS — flujo de invitación a un negocio
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- BRANCH_ASSIGNMENTS — qué sucursales puede ver cada miembro
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Realtime publication — habilita tablas para subscriptions de Supabase
-- ---------------------------------------------------------------------------
-- Nota: en Supabase managed la publication 'supabase_realtime' ya existe.
-- Si no, se crea acá.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- Agregamos las tablas que queremos transmitir en vivo
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
      -- ya está, no pasa nada
      null;
    end;
  end loop;
end $$;
