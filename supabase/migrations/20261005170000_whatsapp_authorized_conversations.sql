-- Authorized WhatsApp conversations: provider-neutral routing allowlist.
-- Unknown/disabled conversations are ignored before Agent Core intent/tool execution.
create table if not exists public.whatsapp_authorized_conversations (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 branch_id uuid references public.branches(id) on delete restrict,
 provider text not null default 'meta',
 provider_conversation_id text not null,
 conversation_type text not null check (conversation_type in ('direct','group')),
 display_name text,
 enabled boolean not null default true,
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(business_id, provider, provider_conversation_id)
);
create index if not exists whatsapp_authorized_conversations_business_enabled on public.whatsapp_authorized_conversations(business_id,enabled);
create or replace function public.enforce_whatsapp_conversation_branch_business() returns trigger language plpgsql set search_path='' as $$
begin
 if new.branch_id is not null and not exists(select 1 from public.branches b where b.id=new.branch_id and b.business_id=new.business_id) then
  raise exception 'conversation_branch_business_mismatch';
 end if;
 return new;
end $$;
revoke all on function public.enforce_whatsapp_conversation_branch_business() from public,anon,authenticated;
grant execute on function public.enforce_whatsapp_conversation_branch_business() to service_role;
drop trigger if exists whatsapp_conversation_branch_business on public.whatsapp_authorized_conversations;
create trigger whatsapp_conversation_branch_business before insert or update of business_id,branch_id on public.whatsapp_authorized_conversations for each row execute function public.enforce_whatsapp_conversation_branch_business();
alter table public.whatsapp_authorized_conversations enable row level security;
revoke all on public.whatsapp_authorized_conversations from anon,authenticated;
drop policy if exists "whatsapp conversations admin read" on public.whatsapp_authorized_conversations;
create policy "whatsapp conversations admin read" on public.whatsapp_authorized_conversations
 for select to authenticated
 using (public.is_admin_of_business(business_id));
grant select on public.whatsapp_authorized_conversations to authenticated;
grant select,insert,update,delete on public.whatsapp_authorized_conversations to service_role;
alter table public.whatsapp_agent_messages add column if not exists conversation_id uuid references public.whatsapp_authorized_conversations(id) on delete set null;
alter table public.whatsapp_agent_pending_operations add column if not exists conversation_id uuid references public.whatsapp_authorized_conversations(id) on delete cascade;
alter table public.whatsapp_agent_audit_logs add column if not exists conversation_id uuid references public.whatsapp_authorized_conversations(id) on delete set null;
