-- Cover the foreign keys added by the authorized-conversation routing layer.
-- IF NOT EXISTS keeps this compatible with fresh installs where the original
-- table migration already creates the same indexes.
create index if not exists whatsapp_authorized_conversations_branch_id_idx
  on public.whatsapp_authorized_conversations(branch_id);
create index if not exists whatsapp_authorized_conversations_created_by_idx
  on public.whatsapp_authorized_conversations(created_by);
create index if not exists whatsapp_agent_messages_conversation_id_idx
  on public.whatsapp_agent_messages(conversation_id);
create index if not exists whatsapp_agent_pending_operations_conversation_id_idx
  on public.whatsapp_agent_pending_operations(conversation_id);
create index if not exists whatsapp_agent_audit_logs_conversation_id_idx
  on public.whatsapp_agent_audit_logs(conversation_id);
