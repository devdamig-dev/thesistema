-- Read consistency only. No stock mutation, historical replay, or new access to
-- source tables. Version changes commit atomically with the underlying mutation.
create schema replenishment_private;
revoke all on schema replenishment_private from public,anon,authenticated,service_role;
create table replenishment_private.revisions (
 business_id uuid not null references public.businesses(id) on delete cascade,
 source_table text not null, source_id text not null,
 revision bigint not null check(revision>=0),
 primary key(business_id,source_table,source_id)
);
revoke all on replenishment_private.revisions from public,anon,authenticated,service_role;

create function replenishment_private.bump() returns trigger
language plpgsql security definer set search_path='' as $$
declare payload jsonb; business uuid; targets uuid[]:='{}'; identity_key text;
begin
 -- Capture old AND new parents, even on reparenting/deletion. Parent mutations
 -- also carry triggers, so cascade deletion cannot silently erase a revision.
 for payload in select value from jsonb_array_elements(case tg_op when 'INSERT' then jsonb_build_array(to_jsonb(new)) when 'DELETE' then jsonb_build_array(to_jsonb(old)) else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end)
 loop
  if tg_table_name='profiles' then
   targets:=targets||array(select business_id from public.business_members where user_id=(payload->>'id')::uuid);
  elsif tg_table_name='businesses' then
   targets:=array_append(targets,(payload->>'id')::uuid);
  elsif tg_table_name='branch_assignments' then
   select business_id into business from public.business_members where id=(payload->>'business_member_id')::uuid;
   targets:=array_append(targets,business);
  elsif tg_table_name='purchase_items' then
   select business_id into business from public.purchases where id=(payload->>'purchase_id')::uuid;
   targets:=array_append(targets,business);
  elsif tg_table_name in ('stock_items','stock_movements') then
   select business_id into business from public.branches where id=(payload->>'branch_id')::uuid;
   targets:=array_append(targets,business);
   select business_id into business from public.ingredients where id=(payload->>'ingredient_id')::uuid;
   targets:=array_append(targets,business);
  else
   targets:=array_append(targets,(payload->>'business_id')::uuid);
  end if;
 end loop;
 -- A per-source-row counter never takes one business-wide write lock. A global
 -- counter could deadlock a purchase (revision then ingredient) against a stock
 -- movement (ingredient then revision). Deleted rows retain their tombstone.
 payload:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 identity_key:=coalesce(payload->>'id',payload->>'business_member_id'||':'||(payload->>'branch_id'));
 if identity_key is null then raise exception 'replenishment_revision_identity_missing'; end if;
 -- Stable ordering prevents inversions for mutations with two business parents.
 for business in select distinct t from unnest(targets) t where t is not null order by t loop
  if exists(select 1 from public.businesses where id=business) then
   insert into replenishment_private.revisions(business_id,source_table,source_id,revision) values(business,tg_table_name,identity_key,1)
    on conflict(business_id,source_table,source_id) do update set revision=replenishment_private.revisions.revision+1;
  end if;
 end loop;
 return null;
end $$;
revoke all on function replenishment_private.bump() from public,anon,authenticated,service_role;

do $$ declare tab text; begin
 foreach tab in array array['ingredients','stock_items','stock_movements','sales','sale_items','purchases','purchase_items','branches','businesses','business_members','business_modules','branch_assignments','profiles'] loop
  execute format('create trigger replenishment_revision after insert or update or delete on public.%I for each row execute function replenishment_private.bump()',tab);
 end loop;
end $$;

create function public.get_replenishment_revision(p_business_id uuid,p_actor_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare version numeric;
begin
 if p_actor_id is null or (not (current_setting('role',true)='service_role' or session_user='service_role') and p_actor_id is distinct from auth.uid()) then
  raise exception 'replenishment_actor_forbidden' using errcode='42501';
 end if;
 if not exists(select 1 from public.business_members m join public.profiles p on p.id=m.user_id
   where m.business_id=p_business_id and m.user_id=p_actor_id and p.active
    and m.role::text in ('owner','admin','manager','employee','kitchen','cashier','waiter','delivery','viewer'))
   or not exists(select 1 from public.business_modules where business_id=p_business_id and module_key='stock' and enabled)
 then raise exception 'replenishment_access_forbidden' using errcode='42501'; end if;
 select sum(revision) into version from replenishment_private.revisions where business_id=p_business_id;
 return coalesce(version,0)::text;
end $$;
revoke all on function public.get_replenishment_revision(uuid,uuid) from public,anon;
grant execute on function public.get_replenishment_revision(uuid,uuid) to authenticated,service_role;
