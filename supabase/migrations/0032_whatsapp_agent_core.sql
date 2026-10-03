-- WhatsApp Agent Core: deduplicación, contexto corto, confirmaciones y auditoría.
-- Son tablas server-owned: el cliente autenticado no puede escribirlas ni leerlas.

create table if not exists public.whatsapp_agent_messages (
  id uuid primary key default gen_random_uuid(),
  provider_message_id text not null unique,
  business_id uuid not null references public.businesses(id) on delete cascade,
  member_id uuid not null references public.business_members(id) on delete cascade,
  sender_phone text not null,
  recipient_phone text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.whatsapp_agent_pending_operations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  member_id uuid not null references public.business_members(id) on delete cascade,
  kind text not null check (kind in ('clarification', 'confirmation')),
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_agent_pending_lookup on public.whatsapp_agent_pending_operations(business_id, member_id, created_at desc) where consumed_at is null;

create table if not exists public.whatsapp_agent_audit_logs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  member_id uuid references public.business_members(id) on delete set null,
  phone text not null,
  message_id text not null,
  message text not null,
  intent text,
  module_key text,
  tool_name text,
  arguments jsonb,
  result jsonb,
  error text,
  confirmation_required boolean not null default false,
  confirmed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_agent_audit_business_created on public.whatsapp_agent_audit_logs(business_id, created_at desc);

alter table public.whatsapp_agent_messages enable row level security;
alter table public.whatsapp_agent_pending_operations enable row level security;
alter table public.whatsapp_agent_audit_logs enable row level security;
revoke all on public.whatsapp_agent_messages, public.whatsapp_agent_pending_operations, public.whatsapp_agent_audit_logs from anon, authenticated;
grant select, insert, update, delete on public.whatsapp_agent_messages, public.whatsapp_agent_pending_operations, public.whatsapp_agent_audit_logs to service_role;

-- RPC atómica y tenant-scoped para el adaptador server-side. No queda expuesta a clientes.
create or replace function public.adjust_stock_for_agent(
  p_business_id uuid, p_ingredient_id uuid, p_branch_id uuid,
  p_operation text, p_quantity numeric
) returns table(new_current numeric, delta numeric)
language plpgsql security definer set search_path = public
as $$
declare v_current numeric; v_new numeric; v_delta numeric;
begin
  if auth.role() <> 'service_role' then raise exception 'forbidden'; end if;
  if p_operation not in ('in','out','set') or p_quantity < 0 then raise exception 'invalid_stock_operation'; end if;
  if not exists(select 1 from ingredients where id=p_ingredient_id and business_id=p_business_id)
     or not exists(select 1 from branches where id=p_branch_id and business_id=p_business_id) then raise exception 'not_found'; end if;
  insert into stock_items(ingredient_id, branch_id, current, min)
  values(p_ingredient_id,p_branch_id,0,0) on conflict (ingredient_id, branch_id) do nothing;
  select current into v_current from stock_items where ingredient_id=p_ingredient_id and branch_id=p_branch_id for update;
  v_new := case p_operation when 'in' then v_current+p_quantity when 'out' then v_current-p_quantity else p_quantity end;
  if v_new < 0 then raise exception 'insufficient_stock'; end if;
  v_delta := v_new-v_current;
  update stock_items set current=v_new, updated_at=now() where ingredient_id=p_ingredient_id and branch_id=p_branch_id;
  insert into stock_movements(ingredient_id, branch_id, reason, qty, ref_type)
  values(p_ingredient_id,p_branch_id,'manual_adjust',v_delta,'whatsapp_agent');
  return query select v_new,v_delta;
end $$;
revoke all on function public.adjust_stock_for_agent(uuid,uuid,uuid,text,numeric) from public, anon, authenticated;
grant execute on function public.adjust_stock_for_agent(uuid,uuid,uuid,text,numeric) to service_role;
