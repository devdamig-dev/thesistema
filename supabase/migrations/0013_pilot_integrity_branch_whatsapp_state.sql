alter table public.branches add column if not exists branch_type text not null default 'local';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'branches_branch_type_check'
  ) then
    alter table public.branches add constraint branches_branch_type_check
      check (branch_type in ('local','foodtruck','dark_kitchen','feria'));
  end if;
end $$;

alter table public.businesses add column if not exists whatsapp_connected boolean not null default false;
alter table public.businesses add column if not exists whatsapp_phone text;
alter table public.businesses add column if not exists whatsapp_connected_at timestamptz;
