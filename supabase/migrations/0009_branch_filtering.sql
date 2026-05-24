-- =============================================================================
-- Branch-level filtering · refuerzo de schema
-- =============================================================================
-- Agrega branch_id donde hace falta para que el filtering por sucursal
-- funcione en repos sin tener que hacer joins.
-- =============================================================================

-- whatsapp_messages — branch opcional (un mensaje puede no tener sucursal)
alter table whatsapp_messages
  add column if not exists branch_id uuid references branches(id) on delete set null;

create index if not exists whatsapp_messages_branch_idx
  on whatsapp_messages(branch_id);

-- ai_extractions — denormalizado para queries rápidas
alter table ai_extractions
  add column if not exists branch_id uuid references branches(id) on delete set null;

create index if not exists ai_extractions_branch_idx
  on ai_extractions(branch_id);

-- Backfill desde whatsapp_messages → ai_extractions
update ai_extractions e
   set branch_id = m.branch_id
  from whatsapp_messages m
 where e.message_id = m.id
   and e.branch_id is null
   and m.branch_id is not null;

-- invoices — opcional (algunas facturas son del business sin sucursal específica)
alter table invoices
  add column if not exists branch_id uuid references branches(id) on delete set null;

create index if not exists invoices_branch_idx
  on invoices(branch_id);
