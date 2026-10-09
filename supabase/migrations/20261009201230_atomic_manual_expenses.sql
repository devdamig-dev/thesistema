-- Manual expense bookkeeping only: no payment provider, transfer or ledger payment.
-- Preserve legacy values/source. Voids are recoverable and never delete records.
alter table public.expenses
 add column version integer not null default 0 check(version>=0),
 add column source text check(source in ('manual','whatsapp','inbox','api','system')),
 add column created_by uuid,
 add column record_status text not null default 'active' check(record_status in ('active','voided')),
 add column void_reason text,
 add column voided_at timestamptz,
 add column voided_by uuid,
 add constraint expenses_scope_identity unique(id,business_id),
 add constraint expenses_void_complete check((record_status='active' and void_reason is null and voided_at is null and voided_by is null)
 or (record_status='voided' and length(btrim(void_reason)) between 1 and 1000 and voided_at is not null and voided_by is not null));
alter table public.balance_snapshots add column expenses_data_stale boolean not null default false;
create index expenses_active_idx on public.expenses(business_id,branch_id,id) where record_status='active';
create table public.expense_mutations (
 request_id uuid not null, business_id uuid not null, branch_id uuid not null, expense_id uuid not null,
 actor_id uuid not null, actor_role text not null, source text not null, operation text not null,
 payload jsonb not null, result jsonb not null, before_snapshot jsonb, after_snapshot jsonb not null,
 activity_log_id uuid not null references public.activity_logs(id) on delete restrict,
 created_at timestamptz not null default now(), primary key(business_id,request_id),
 foreign key(expense_id,business_id) references public.expenses(id,business_id) on delete restrict
);
create index expense_mutations_history_idx on public.expense_mutations(expense_id,created_at,request_id);
create index expense_mutations_activity_idx on public.expense_mutations(activity_log_id);
alter table public.expense_mutations enable row level security;
revoke all on public.expense_mutations from public,anon,authenticated,service_role;
grant select on public.expense_mutations to authenticated,service_role;
revoke insert,update,delete,truncate,references,trigger on public.expenses from public,anon,authenticated,service_role;
create policy expenses_active_reader on public.expenses as restrictive for select to authenticated using(
 exists(select 1 from public.profiles where id=auth.uid() and active)
 and public.has_business_write_role(business_id,array['owner','admin','manager','accountant'])
 and exists(select 1 from public.business_modules where business_id=expenses.business_id and module_key='fixed_expenses' and enabled));
create policy expense_mutations_read on public.expense_mutations for select to authenticated using(
 exists(select 1 from public.expenses e where e.id=expense_id and e.business_id=expense_mutations.business_id)
 and public.can_access_business_branch(business_id,branch_id)
 and (before_snapshot is null or public.can_access_business_branch(business_id,(before_snapshot->>'branch_id')::uuid)));
create schema expenses_private;
revoke all on schema expenses_private from public,anon;
grant usage on schema expenses_private to authenticated,service_role;
create table expenses_private.revisions(business_id uuid primary key references public.businesses(id) on delete cascade,revision bigint not null);
revoke all on expenses_private.revisions from public,anon,authenticated,service_role;

create function expenses_private.actor_role(p_business uuid,p_branch uuid,p_actor uuid) returns text
language plpgsql set search_path='' as $$
declare m public.business_members%rowtype;
begin
 if p_actor is null then raise exception 'expense_permission_denied'; end if;
 perform 1 from public.profiles where id=p_actor and active for share;
 if not found then raise exception 'expense_permission_denied'; end if;
 select * into m from public.business_members where business_id=p_business and user_id=p_actor for share;
 if m.id is null or m.role::text not in ('owner','admin','manager') then raise exception 'expense_permission_denied'; end if;
 perform 1 from public.business_modules where business_id=p_business and module_key='fixed_expenses' and enabled for share;
 if not found then raise exception 'expense_module_disabled'; end if;
 perform 1 from public.branches where id=p_branch and business_id=p_business for share;
 if not found then raise exception 'expense_branch_forbidden'; end if;
 return m.role::text;
end $$;
create function expenses_private.require_keys(p jsonb,allowed text[]) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(p) is distinct from 'object' or (select count(*) from jsonb_object_keys(p))<>cardinality(allowed)
 or exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed)) then raise exception 'expense_invalid_input'; end if;
end $$;
create function expenses_private.can_read_log(p_log uuid) returns boolean language plpgsql stable security definer set search_path='' as $$
declare m public.expense_mutations%rowtype;
begin
 select * into m from public.expense_mutations where activity_log_id=p_log;
 if not found then return true; end if;
 return auth.uid() is not null and exists(select 1 from public.profiles where id=auth.uid() and active)
 and public.has_business_write_role(m.business_id,array['owner','admin','manager','accountant'])
 and public.can_access_business_branch(m.business_id,m.branch_id)
 and (m.before_snapshot is null or public.can_access_business_branch(m.business_id,(m.before_snapshot->>'branch_id')::uuid));
end $$;
create policy expense_log_scope on public.activity_logs as restrictive for select to authenticated using(expenses_private.can_read_log(id));

-- Only identity-bound private entrypoints may invoke this transaction engine.
create function expenses_private.mutate(p_business uuid,p_actor uuid,p_source text,p_operation text,p_input jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare v_id uuid; v_request uuid; v_branch uuid; v_role text; v_expense public.expenses%rowtype;
 v_receipt public.expense_mutations%rowtype; v_payload jsonb; v_result jsonb; v_before jsonb; v_after jsonb;
 v_amount numeric; v_due date; v_log uuid;
begin
 if p_source not in ('manual','whatsapp','inbox') or p_operation not in ('save','void','restore') then raise exception 'expense_invalid_input'; end if;
 if p_operation='save' then
  perform expenses_private.require_keys(p_input,array['requestId','businessId','userId','id','expectedVersion','branchId','name','category','amount','dueDate','status']);
 else perform expenses_private.require_keys(p_input,array['requestId','businessId','userId','id','expectedVersion','reason']); end if;
 if (p_input->>'businessId')::uuid is distinct from p_business or (p_input->>'userId')::uuid is distinct from p_actor then raise exception 'expense_context_changed'; end if;
 if jsonb_typeof(p_input->'requestId') is distinct from 'string' or p_input->>'requestId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'expense_invalid_input'; end if;
 v_request:=(p_input->>'requestId')::uuid; v_id:=(p_input->>'id')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(p_business::text||v_request::text,0));
 v_payload:=jsonb_build_object('operation',p_operation,'source',p_source,'input',p_input);
 select * into v_receipt from public.expense_mutations where business_id=p_business and request_id=v_request;
 if found then
  perform expenses_private.actor_role(p_business,v_receipt.branch_id,p_actor);
  if v_receipt.before_snapshot is not null then perform expenses_private.actor_role(p_business,(v_receipt.before_snapshot->>'branch_id')::uuid,p_actor); end if;
  if v_receipt.actor_id<>p_actor or v_receipt.payload<>v_payload then raise exception 'expense_idempotency_conflict'; end if;
  return v_receipt.result;
 end if;
 if v_id is not null then
  select * into v_expense from public.expenses where id=v_id and business_id=p_business for update;
  if not found then raise exception 'expense_not_found'; end if;
  v_role:=expenses_private.actor_role(p_business,v_expense.branch_id,p_actor);
  if jsonb_typeof(p_input->'expectedVersion') is distinct from 'number' or p_input->>'expectedVersion' !~ '^[0-9]+$' or (p_input->>'expectedVersion')::numeric<>v_expense.version then raise exception 'expense_conflict'; end if;
  if (p_operation='restore' and v_expense.record_status<>'voided') or (p_operation<>'restore' and v_expense.record_status<>'active') then raise exception 'expense_state_conflict'; end if;
  v_before:=to_jsonb(v_expense)||jsonb_build_object('amount',v_expense.amount::text);
 elsif p_operation<>'save' or p_input->>'expectedVersion' is not null then raise exception 'expense_invalid_input'; end if;
 if p_operation in ('void','restore') then
  if jsonb_typeof(p_input->'reason') is distinct from 'string' or length(btrim(p_input->>'reason')) not between 1 and 1000 or p_input->>'reason' ~ '[[:cntrl:]]' then raise exception 'expense_invalid_input'; end if;
  v_branch:=v_expense.branch_id;
  update public.expenses set record_status=case when p_operation='void' then 'voided' else 'active' end,
   void_reason=case when p_operation='void' then btrim(p_input->>'reason') end,
   voided_at=case when p_operation='void' then clock_timestamp() end,
   voided_by=case when p_operation='void' then p_actor end,version=version+1 where id=v_id returning * into v_expense;
 else
  v_branch:=(p_input->>'branchId')::uuid;
  v_role:=expenses_private.actor_role(p_business,v_branch,p_actor);
  if jsonb_typeof(p_input->'name') is distinct from 'string' or length(btrim(p_input->>'name')) not between 1 and 200 or p_input->>'name' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_input->'category') is distinct from 'string' or length(btrim(p_input->>'category')) not between 1 and 80 or p_input->>'category' ~ '[[:cntrl:]]'
   or jsonb_typeof(p_input->'amount') is distinct from 'string' or p_input->>'amount' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
   or jsonb_typeof(p_input->'status') is distinct from 'string' or p_input->>'status' not in ('pending','scheduled','paid') then raise exception 'expense_invalid_input'; end if;
  v_amount:=(p_input->>'amount')::numeric;
  if v_amount<=0 or v_amount>=10000000000 then raise exception 'expense_invalid_input'; end if;
  if p_input->>'dueDate' is not null then
   if jsonb_typeof(p_input->'dueDate') is distinct from 'string' or p_input->>'dueDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'expense_invalid_input'; end if;
   v_due:=(p_input->>'dueDate')::date;
   if not isfinite(v_due) or to_char(v_due,'YYYY-MM-DD')<>p_input->>'dueDate' then raise exception 'expense_invalid_input'; end if;
  end if;
  if v_id is null then
   insert into public.expenses(business_id,branch_id,name,category,amount,due_date,status,version,source,created_by)
    values(p_business,v_branch,btrim(p_input->>'name'),btrim(p_input->>'category'),v_amount,v_due,p_input->>'status',1,p_source,p_actor) returning * into v_expense;
   v_id:=v_expense.id;
  else
   update public.expenses set branch_id=v_branch,name=btrim(p_input->>'name'),category=btrim(p_input->>'category'),amount=v_amount,due_date=v_due,status=p_input->>'status',version=version+1
    where id=v_id returning * into v_expense;
  end if;
 end if;
 -- Expenses have no accounting period. Invalidate stored snapshots rather than
 -- guessing historical attribution or recalculating unrelated financial totals.
 update public.balance_snapshots set expenses_data_stale=true where business_id=p_business;
 v_after:=to_jsonb(v_expense)||jsonb_build_object('amount',v_expense.amount::text);
 v_result:=jsonb_build_object('ok',true,'id',v_id,'version',v_expense.version);
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
  select p_business,p_actor,full_name,v_role,case when p_operation='void' then 'expense.voided' when p_operation='restore' then 'expense.restored' when v_before is null then 'expense.created' else 'expense.updated' end,
   'expenses',v_id,case when p_operation='void' then 'Gasto anulado con historial conservado' when p_operation='restore' then 'Gasto restaurado' when v_before is null then 'Gasto registrado' else 'Gasto actualizado' end,
   jsonb_build_object('source',p_source,'branch_id',v_branch,'result','success','request_id',v_request,'version',v_expense.version,'payment_execution','none')
  from public.profiles where id=p_actor returning id into v_log;
 insert into public.expense_mutations(request_id,business_id,branch_id,expense_id,actor_id,actor_role,source,operation,payload,result,before_snapshot,after_snapshot,activity_log_id)
  values(v_request,p_business,v_branch,v_id,p_actor,v_role,p_source,p_operation,v_payload,v_result,v_before,v_after,v_log);
 insert into expenses_private.revisions values(p_business,1) on conflict(business_id) do update set revision=expenses_private.revisions.revision+1;
 return v_result;
end $$;

create function expenses_private.manual(p_business uuid,p_operation text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or current_setting('role',true)<>'authenticated' then raise exception 'expense_permission_denied'; end if;
 return expenses_private.mutate(p_business,auth.uid(),'manual',p_operation,p_input);
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'expense_%' then sqlerrm else 'expense_invalid_input' end);
end $$;
create function expenses_private.agent(p_business uuid,p_actor uuid,p_operation text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if current_setting('role',true)<>'service_role' and session_user<>'service_role' then raise exception 'expense_permission_denied'; end if;
 return expenses_private.mutate(p_business,p_actor,'whatsapp',p_operation,p_input);
exception when others then return jsonb_build_object('ok',false,'error',case when sqlerrm like 'expense_%' then sqlerrm else 'expense_invalid_input' end);
end $$;
create function expenses_private.revision(p_business uuid) returns text language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active)
 or not public.has_business_write_role(p_business,array['owner','admin','manager','accountant'])
 or not exists(select 1 from public.business_modules where business_id=p_business and module_key='fixed_expenses' and enabled) then raise exception 'expense_permission_denied'; end if;
 return coalesce((select revision::text from expenses_private.revisions where business_id=p_business),'0');
end $$;
revoke all on all functions in schema expenses_private from public,anon,authenticated,service_role;
grant execute on function expenses_private.manual(uuid,text,jsonb),expenses_private.revision(uuid),expenses_private.can_read_log(uuid) to authenticated;
grant execute on function expenses_private.agent(uuid,uuid,text,jsonb) to service_role;
create function public.save_expense_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select expenses_private.manual(p_business_id,'save',p_input) $$;
create function public.void_expense_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select expenses_private.manual(p_business_id,'void',p_input) $$;
create function public.restore_expense_atomic(p_business_id uuid,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select expenses_private.manual(p_business_id,'restore',p_input) $$;
create function public.mutate_expense_for_agent(p_business_id uuid,p_actor_id uuid,p_operation text,p_input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select expenses_private.agent(p_business_id,p_actor_id,p_operation,p_input) $$;
create function public.get_expenses_revision(p_business_id uuid) returns text language sql security invoker set search_path='' as $$ select expenses_private.revision(p_business_id) $$;
revoke all on function public.save_expense_atomic(uuid,jsonb),public.void_expense_atomic(uuid,jsonb),public.restore_expense_atomic(uuid,jsonb),public.mutate_expense_for_agent(uuid,uuid,text,jsonb),public.get_expenses_revision(uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_expense_atomic(uuid,jsonb),public.void_expense_atomic(uuid,jsonb),public.restore_expense_atomic(uuid,jsonb),public.get_expenses_revision(uuid) to authenticated;
grant execute on function public.mutate_expense_for_agent(uuid,uuid,text,jsonb) to service_role;
