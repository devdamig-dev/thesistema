-- Required by onboarding saveBranchStep(), which upserts branches with
-- onConflict: "business_id,name". PostgreSQL needs a matching UNIQUE
-- constraint for that upsert target.
--
-- Production received the equivalent migration on 2026-08-12 after the
-- onboarding wizard surfaced branch_save_failed. Keep the repository schema
-- in sync so fresh environments and future restores behave the same way.

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.branches'::regclass
      and conname = 'branches_business_id_name_key'
  ) then
    alter table public.branches
      add constraint branches_business_id_name_key unique (business_id, name);
  end if;
end
$$;
