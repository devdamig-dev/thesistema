-- =============================================================================
-- Notificaciones, Auditoría y Permisos · profundización
-- =============================================================================
-- Extiende `notifications` con priority + category + archivado, y agrega
-- índices para que /notificaciones pueda filtrar rápido.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type notification_priority as enum ('high', 'medium', 'low', 'info');
exception when duplicate_object then null; end $$;

do $$ begin
  create type notification_category as enum (
    'operation', 'ai', 'stock', 'debt',
    'invoice', 'employee', 'marketing', 'system'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Notifications · nuevas columnas
-- ---------------------------------------------------------------------------
alter table notifications
  add column if not exists priority notification_priority not null default 'medium',
  add column if not exists category notification_category not null default 'system',
  add column if not exists archived_at timestamptz;

create index if not exists notifications_filter_idx
  on notifications(business_id, archived_at, read_at, priority, category, created_at desc);

-- Backfill básico — heredamos un priority razonable desde el tone existente.
update notifications
   set priority = case
     when tone in ('danger', 'warn') then 'high'::notification_priority
     when tone = 'success' then 'low'::notification_priority
     when tone = 'ai' then 'medium'::notification_priority
     else 'info'::notification_priority
   end
 where priority = 'medium';

-- ---------------------------------------------------------------------------
-- Trigger SQL: stock crítico → notification
-- (Se dispara cuando current < min en un stock_item.)
-- ---------------------------------------------------------------------------
create or replace function notify_critical_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business_id uuid;
  v_ingredient text;
begin
  if new.current >= new.min then return new; end if;
  if old.current < new.current then return new; end if;  -- subió, no alertamos

  select b.business_id, i.name
    into v_business_id, v_ingredient
    from branches b
    join ingredients i on i.business_id = b.business_id
   where b.id = new.branch_id
     and i.id = new.ingredient_id;

  if v_business_id is null then return new; end if;

  insert into notifications (
    business_id, tone, priority, category, title, detail, href, source
  ) values (
    v_business_id,
    'danger',
    'high',
    'stock',
    format('Stock crítico · %s', v_ingredient),
    format('Quedan %s. Mínimo: %s.', new.current, new.min),
    '/stock',
    'stock'
  );
  return new;
end;
$$;

drop trigger if exists trg_stock_critical on stock_items;
create trigger trg_stock_critical
  after update on stock_items
  for each row execute function notify_critical_stock();
