-- O1 Fudo: non-destructive provenance for repeated import cycles.
-- Historical staging records stay intact for audit; consumers may only report
-- "seen in this cycle" where the start is known, and "possibly absent from Fudo"
-- only after that resource's entire cycle was successfully read.
--
-- Nullable intentionally: old in-flight progress rows predate cycle tracking.
-- Never fabricate a cycle start for them (we cannot know which pages were read).
alter table public.fudo_sync_progress
  add column if not exists cycle_started_at timestamptz;

comment on column public.fudo_sync_progress.cycle_started_at is
  'Start of the full provider scan for this resource, scoped to business and connection generation. NULL for legacy/incomplete history; do not infer absence.';

-- Index supports aggregate-only reconciliation without exposing provider payloads.
create index if not exists fudo_external_records_cycle_seen_idx
  on public.fudo_external_records (business_id, connection_generation, resource_type, last_seen_at);

-- Rollback plan: revert application first (extra nullable column/index harmless);
-- remove index/column only in a separately reviewed reversible migration.
