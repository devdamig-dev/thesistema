-- =============================================================================
-- Sprint 2 · Inbox IA real
-- Pequeñas adiciones a ai_extractions y whatsapp_messages para
-- soportar el flujo end-to-end.
-- =============================================================================

-- Estado "failed" para extracciones que ni Claude ni el heurístico
-- pudieron interpretar — quedan persistidas para revisión manual.
alter type approval_status add value if not exists 'failed';

-- ai_extractions: denormalizamos business_id (RLS más eficiente)
-- y agregamos campos para summary + target_entity.
alter table ai_extractions
  add column if not exists business_id uuid references businesses(id) on delete cascade,
  add column if not exists summary text,
  add column if not exists target_entity text,
  add column if not exists target_record_id uuid,
  add column if not exists source text not null default 'heuristic';

create index if not exists ai_extractions_business_idx
  on ai_extractions(business_id, created_at desc);

-- Backfill business_id desde whatsapp_messages para filas existentes.
update ai_extractions e
   set business_id = m.business_id
  from whatsapp_messages m
 where e.message_id = m.id
   and e.business_id is null;

-- ---------------------------------------------------------------------------
-- Policy ajustada para ai_extractions: lectura por business directo
-- (sigue funcionando la lectura indirecta vía whatsapp_messages que ya
-- existía en 0003).
-- ---------------------------------------------------------------------------
drop policy if exists "ai_extractions rw" on ai_extractions;
create policy "ai_extractions rw" on ai_extractions
  for all using (
    -- por business_id denormalizado
    (business_id is not null and is_member_of_business(business_id))
    or exists (
      -- fallback por la relación con whatsapp_messages
      select 1 from whatsapp_messages m
      where m.id = ai_extractions.message_id
        and is_member_of_business(m.business_id)
    )
  )
  with check (
    (business_id is not null and is_member_of_business(business_id))
    or exists (
      select 1 from whatsapp_messages m
      where m.id = ai_extractions.message_id
        and is_member_of_business(m.business_id)
    )
  );
