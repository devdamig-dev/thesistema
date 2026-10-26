-- Cover the tenant-aware conversation reference used by group membership lookups.
create index whatsapp_group_members_conversation
  on public.whatsapp_group_members(conversation_id,business_id);
