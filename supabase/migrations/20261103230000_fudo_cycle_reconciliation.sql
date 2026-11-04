-- O1 Fudo: non-destructive provenance for repeated import cycles.
-- Historical staging records stay intact for audit; consumers may report
-- "seen in this cycle" only when the importer supplies a stable cycle UUID,
-- and "possibly absent from Fudo" only after the resource's full cycle ends.
--
-- Nullable intentionally: old progress and staging rows predate cycle tracking.
-- Never fabricate a cycle identity for incomplete legacy imports.
alter table public.fudo_sync_progress
  add column if not exists cycle_id uuid,
  add column if not exists cycle_started_at timestamptz;

alter table public.fudo_external_records
  add column if not exists last_seen_cycle_id uuid;

comment on column public.fudo_sync_progress.cycle_id is
  'Stable read-only import cycle UUID for this tenant, connection generation and resource. NULL means unknown legacy cycle.';

comment on column public.fudo_sync_progress.cycle_started_at is
  'Informational start time. Presence must be compared with cycle UUID, never wall-clock timestamps.';

comment on column public.fudo_external_records.last_seen_cycle_id is
  'Last full-scan cycle UUID in which this provider ID was observed; historical rows are never deleted automatically.';

create index if not exists fudo_external_records_cycle_seen_idx
  on public.fudo_external_records
  (business_id, connection_generation, resource_type, last_seen_cycle_id);

-- Rollback: revert the app first; leave nullable columns/index until a
-- separately reviewed migration removes them (no destructive migration here).
