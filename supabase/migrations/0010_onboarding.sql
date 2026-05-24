-- =============================================================================
-- Onboarding & first-use
-- =============================================================================

-- Estado de onboarding por business.
alter table businesses
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists onboarding_step int not null default 0,
  add column if not exists onboarding_completed_at timestamptz;
