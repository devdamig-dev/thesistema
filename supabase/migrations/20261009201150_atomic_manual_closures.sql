-- Manual operational summaries only: no sales, expenses, stock or payments are posted.
-- Historical source/text/parsed/status remain factual and are never backfilled.
alter table public.daily_closures
 add column source text check (source in ('manual','inbox','whatsapp','api','system')),
 add column manual_note text,
 add column version integer not null default 0 check(version >= 0),
 add column archived_at timestamptz,
 add column archived_by uuid,
 add column archive_reason text,
 add constraint closure_archive_complete check (
  (archived_at is null and archived_by is null and archive_reason is null) or
  (archived_at is not null and archived_by is not null and length(btrim(archive_reason)) between 1 and 1000)),
 add constraint closure_scope_identity unique(id,business_id);
create index closures_active_scope_idx on public.daily_closures(business_id,branch_id,closure_date,id) where archived_at is null;
create table public.closure_mutations (
 business_id uuid not null, request_id uuid not null, closure_id uuid not null, branch_id uuid,
 actor_id uuid not null, actor_role text not null, operation text not null check(operation in('save','archive')),
 reason text, payload jsonb not null, result jsonb not null, before_snapshot jsonb, after_snapshot jsonb not null,
 activity_log_id uuid not null references public.activity_logs(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(business_id,request_id),
 foreign key(closure_id,business_id) references public.daily_closures(id,business_id) on delete restrict
);
create index closure_mutations_history_idx on public.closure_mutations(closure_id,created_at,request_id);
create index closure_mutations_activity_idx on public.closure_mutations(activity_log_id);
alter table public.closure_mutations enable row level security;
revoke all on public.closure_mutations from public,anon,authenticated,service_role;
grant select on public.closure_mutations to authenticated,service_role;
-- Preserve the existing server-only Inbox insertion path; authenticated users
-- cannot bypass the atomic manual command by writing through the Data API.
revoke insert,update,delete,truncate,references,trigger on public.daily_closures from public,anon,authenticated;
create schema closures_private;
revoke all on schema closures_private from public,anon,service_role;
grant usage on schema closures_private to authenticated;
create function closures_private.can_read(p_business uuid,p_branch uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists (
  select 1 from public.business_members m join public.profiles p on p.id=m.user_id
  join public.business_modules mod on mod.business_id=m.business_id and mod.module_key='daily_closures' and mod.enabled
  where m.business_id=p_business and m.user_id=auth.uid() and p.active
  and (m.role::text in ('owner','admin','manager') or
   (m.role::text in ('employee','kitchen','cashier') and p_branch is not null and exists(
    select 1 from public.branch_assignments ba join public.branches b on b.id=ba.branch_id
    where ba.business_member_id=m.id and ba.branch_id=p_branch and b.business_id=p_business)))
 )
$$;
create policy closures_active_access on public.daily_closures as restrictive for select to authenticated
 using(closures_private.can_read(business_id,branch_id));
create policy closure_mutations_read on public.closure_mutations for select to authenticated
 using(closures_private.can_read(business_id,branch_id));
create function closures_private.can_read_log(p_id uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare m public.closure_mutations%rowtype;
begin
 select * into m from public.closure_mutations where activity_log_id=p_id;
 if not found then return true; end if;
 return closures_private.can_read(m.business_id,m.branch_id);
end $$;
create policy closure_log_scope on public.activity_logs as restrictive for select to authenticated using(closures_private.can_read_log(id));

create function closures_private.actor(p_business uuid,p_branch uuid,p_actor uuid,p_allow_null boolean default false) returns text
language plpgsql set search_path='' as $$
declare m public.business_members%rowtype;
begin
 perform 1 from public.profiles where id=p_actor and active for share;
 if p_actor is null or not found then raise exception 'closure_permission_denied'; end if;
 select * into m from public.business_members where business_id=p_business and user_id=p_actor for share;
 if not found or m.role::text not in ('owner','admin','manager','employee','kitchen','cashier') then raise exception 'closure_permission_denied'; end if;
 perform 1 from public.business_modules where business_id=p_business and module_key='daily_closures' and enabled for share;
 if not found then raise exception 'closure_module_disabled'; end if;
 if p_branch is null then
  if not p_allow_null or m.role::text not in ('owner','admin','manager') then raise exception 'closure_branch_forbidden'; end if;
 else
  perform 1 from public.branches where id=p_branch and business_id=p_business for share;
  if not found then raise exception 'closure_branch_forbidden'; end if;
  if m.role::text not in ('owner','admin','manager') then
   perform 1 from public.branch_assignments where business_member_id=m.id and branch_id=p_branch for share;
   if not found then raise exception 'closure_branch_forbidden'; end if;
  end if;
 end if;
 return m.role::text;
end $$;
create function closures_private.mutate(p_business uuid,p_actor uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare
 v_row public.daily_closures%rowtype; v_receipt public.closure_mutations%rowtype;
 v_id uuid; v_request uuid; v_branch uuid; v_role text; v_date date; v_before jsonb; v_after jsonb;
 v_result jsonb; v_payload jsonb; v_log uuid; v_keys text[]; v_reason text;
begin
 if p_operation is null or p_operation not in ('save','archive') then raise exception 'closure_invalid_input'; end if;
 v_keys:=case when p_operation='save' then array['requestId','businessId','userId','id','expectedVersion','branchId','closureDate','grossTotal','netTotal','note','reason'] else array['requestId','businessId','userId','id','expectedVersion','reason'] end;
 if jsonb_typeof(p_input) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_input))<>cardinality(v_keys)
  or exists(select 1 from jsonb_object_keys(p_input) k where not k=any(v_keys)) then raise exception 'closure_invalid_input'; end if;
 if (p_input->>'businessId')::uuid is distinct from p_business or (p_input->>'userId')::uuid is distinct from p_actor then raise exception 'closure_context_changed'; end if;
 v_id:=(p_input->>'id')::uuid; v_request:=(p_input->>'requestId')::uuid;
 if v_request is null then raise exception 'closure_invalid_input'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_business::text||v_request::text,0));
 v_payload:=jsonb_build_object('operation',p_operation,'input',p_input);
 select * into v_receipt from public.closure_mutations where business_id=p_business and request_id=v_request;
 if found then
  perform closures_private.actor(p_business,v_receipt.branch_id,p_actor,true);
  if v_receipt.actor_id<>p_actor or v_receipt.payload<>v_payload then raise exception 'closure_idempotency_conflict'; end if;
  return v_receipt.result;
 end if;
 if v_id is not null then
  select * into v_row from public.daily_closures where id=v_id and business_id=p_business for update;
  if not found then raise exception 'closure_not_found'; end if;
  v_role:=closures_private.actor(p_business,v_row.branch_id,p_actor,true);
  if jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or p_input->>'expectedVersion' !~ '^[0-9]+$' or (p_input->>'expectedVersion')::numeric<>v_row.version then raise exception 'closure_conflict'; end if;
  if v_row.archived_at is not null then raise exception 'closure_archived'; end if;
  v_before:=to_jsonb(v_row); v_branch:=v_row.branch_id;
 elsif p_operation='archive' or p_input->>'expectedVersion' is not null then raise exception 'closure_invalid_input';
 end if;
 if v_id is not null and (jsonb_typeof(p_input->'reason') is distinct from 'string' or length(btrim(p_input->>'reason')) not between 1 and 1000) then raise exception 'closure_invalid_input'; end if;
 if p_input->>'reason' is not null and (jsonb_typeof(p_input->'reason')<>'string' or length(p_input->>'reason')>1000 or translate(p_input->>'reason',E'\n\r\t','') ~ '[[:cntrl:]]') then raise exception 'closure_invalid_input'; end if;
 v_reason:=nullif(btrim(p_input->>'reason'),'');
 if p_operation='archive' then
  update public.daily_closures set archived_at=clock_timestamp(),archived_by=p_actor,archive_reason=v_reason,version=version+1 where id=v_id returning * into v_row;
 else
  v_branch:=(p_input->>'branchId')::uuid;
  if v_id is not null and v_branch is distinct from v_row.branch_id then raise exception 'closure_branch_immutable'; end if;
  v_role:=closures_private.actor(p_business,v_branch,p_actor,v_id is not null);
  if jsonb_typeof(p_input->'closureDate') is distinct from 'string' or p_input->>'closureDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'closure_invalid_date'; end if;
  v_date:=(p_input->>'closureDate')::date;
  if v_date<'1900-01-01'::date or v_date>(clock_timestamp() at time zone (select timezone from public.businesses where id=p_business))::date then raise exception 'closure_invalid_date'; end if;
  if jsonb_typeof(p_input->'grossTotal') is distinct from 'string' or p_input->>'grossTotal' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
   or jsonb_typeof(p_input->'netTotal') is distinct from 'string' or p_input->>'netTotal' !~ '^-?(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
   or jsonb_typeof(p_input->'note') is distinct from 'string' or length(p_input->>'note')>4000 or translate(p_input->>'note',E'\n\r\t','') ~ '[[:cntrl:]]' then raise exception 'closure_invalid_input'; end if;
  if v_id is null then
   insert into public.daily_closures(business_id,branch_id,closure_date,raw_text,parsed,gross_total,net_total,created_by,source,manual_note,version)
   values(p_business,v_branch,v_date,p_input->>'note',null,(p_input->>'grossTotal')::numeric,(p_input->>'netTotal')::numeric,p_actor,'manual',nullif(btrim(p_input->>'note'),''),1) returning * into v_row;
   v_id:=v_row.id;
  else
   update public.daily_closures set closure_date=v_date,gross_total=(p_input->>'grossTotal')::numeric,net_total=(p_input->>'netTotal')::numeric,manual_note=nullif(btrim(p_input->>'note'),''),version=version+1 where id=v_id returning * into v_row;
  end if;
 end if;
 v_after:=to_jsonb(v_row); v_result:=jsonb_build_object('ok',true,'id',v_id,'version',v_row.version);
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 select p_business,p_actor,full_name,v_role,case when p_operation='archive' then 'closure.archived' when v_before is null then 'closure.created' else 'closure.corrected' end,'daily_closures',v_id,
  case when p_operation='archive' then 'Cierre archivado' when v_before is null then 'Cierre manual registrado' else 'Cierre corregido con historial' end,
  jsonb_build_object('source','manual','branch_id',v_branch,'request_id',v_request,'version',v_row.version,'accounting_effect','none') from public.profiles where id=p_actor returning id into v_log;
 insert into public.closure_mutations(business_id,request_id,closure_id,branch_id,actor_id,actor_role,operation,reason,payload,result,before_snapshot,after_snapshot,activity_log_id)
 values(p_business,v_request,v_id,v_branch,p_actor,v_role,p_operation,v_reason,v_payload,v_result,v_before,v_after,v_log);
 return v_result;
end $$;
create function closures_private.manual(p_business uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or current_setting('role',true)<>'authenticated' then raise exception 'closure_permission_denied'; end if;
 return closures_private.mutate(p_business,auth.uid(),p_operation,p_input);
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'closure_%' then sqlerrm else 'closure_invalid_input' end);
end $$;
revoke all on all functions in schema closures_private from public,anon,authenticated,service_role;
grant execute on function closures_private.can_read(uuid,uuid),closures_private.can_read_log(uuid),closures_private.manual(uuid,text,jsonb) to authenticated;
create function public.save_closure_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select closures_private.manual(p_business_id,'save',p_input) $$;
create function public.archive_closure_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select closures_private.manual(p_business_id,'archive',p_input) $$;
revoke all on function public.save_closure_atomic(uuid,jsonb),public.archive_closure_atomic(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_closure_atomic(uuid,jsonb),public.archive_closure_atomic(uuid,jsonb) to authenticated;

-- Every insertion path (including the legacy Inbox) participates in read
-- consistency. Readers reject an interleaved edit instead of showing a mixture.
create table closures_private.revisions(business_id uuid primary key,revision bigint not null);
revoke all on closures_private.revisions from public,anon,authenticated,service_role;
create function closures_private.bump_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into closures_private.revisions(business_id,revision) values(coalesce(new.business_id,old.business_id),1)
 on conflict(business_id) do update set revision=closures_private.revisions.revision+1;
 if tg_op='UPDATE' and old.business_id<>new.business_id then
  insert into closures_private.revisions(business_id,revision) values(old.business_id,1) on conflict(business_id) do update set revision=closures_private.revisions.revision+1;
 end if;
 return coalesce(new,old);
end $$;
revoke all on function closures_private.bump_revision() from public,anon,authenticated,service_role;
create trigger closure_revision after insert or update or delete on public.daily_closures for each row execute function closures_private.bump_revision();
create function closures_private.revision(p_business uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p join public.business_members m on m.user_id=p.id join public.business_modules b on b.business_id=m.business_id and b.module_key='daily_closures' and b.enabled where p.id=auth.uid() and p.active and m.business_id=p_business and m.role::text in ('owner','admin','manager','employee','kitchen','cashier')) then raise exception 'closure_permission_denied'; end if;
 return coalesce((select revision::text from closures_private.revisions where business_id=p_business),'0');
end $$;
revoke all on function closures_private.revision(uuid) from public,anon,authenticated,service_role;
grant execute on function closures_private.revision(uuid) to authenticated;
create function public.get_closures_revision(p_business_id uuid) returns text language sql security invoker set search_path='' as $$ select closures_private.revision(p_business_id) $$;
revoke all on function public.get_closures_revision(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_closures_revision(uuid) to authenticated;
-- Legacy transport may insert original fields, but cannot forge manual origin,
-- revisions, archives or mutate a closure outside the audited command engine.
revoke insert,update,delete,truncate,references,trigger on public.daily_closures from service_role;
grant insert(id,business_id,branch_id,closure_date,raw_text,parsed,inconsistencies,status,gross_total,net_total,created_by,created_at,updated_at) on public.daily_closures to service_role;
