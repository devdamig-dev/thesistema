-- Employee records stay in the existing payroll table. Legacy rows are never
-- assigned to a guessed branch; new manual records require a real branch.
alter table public.balance_snapshots add column payroll_data_stale boolean not null default false;

alter table public.employees add column branch_id uuid references public.branches(id) on delete restrict;
create index employees_business_branch_active_name_idx on public.employees(business_id,branch_id,active,full_name,id);

create function public.can_read_employee_scope(p_business uuid,p_branch uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active)
 and public.has_business_write_role(p_business,array['owner','admin','manager','viewer'])
 and public.can_access_business_branch(p_business,p_branch)
 and (p_branch is not null or public.has_business_write_role(p_business,array['owner','admin','manager']));
$$;
revoke all on function public.can_read_employee_scope(uuid,uuid) from public,anon;
grant execute on function public.can_read_employee_scope(uuid,uuid) to authenticated,service_role;
drop policy "employees read" on public.employees;
drop policy "employees write admin" on public.employees;
create policy employees_scoped_read on public.employees for select to authenticated using(public.can_read_employee_scope(business_id,branch_id));
create policy employees_scoped_insert on public.employees for insert to authenticated with check(public.can_read_employee_scope(business_id,branch_id) and public.has_business_write_role(business_id,array['owner','admin']));
create policy employees_scoped_update on public.employees for update to authenticated using(public.can_read_employee_scope(business_id,branch_id) and public.has_business_write_role(business_id,array['owner','admin'])) with check(public.can_read_employee_scope(business_id,branch_id) and public.has_business_write_role(business_id,array['owner','admin']));
-- No employee DELETE policy: archive preserves shifts/advances and audit history.

create function public.employee_validate_and_version()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if not exists(select 1 from public.businesses where id=old.business_id) then return old; end if;
  raise exception 'employee_archive_required' using errcode='23514';
 end if;
 if auth.uid() is not null and not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception 'employee_actor_inactive' using errcode='42501'; end if;
 if tg_op='UPDATE' then
  if new.id is distinct from old.id or new.business_id is distinct from old.business_id or new.created_at is distinct from old.created_at then raise exception 'employee_identity_immutable' using errcode='23514'; end if;
  new.updated_at:=greatest(clock_timestamp(),old.updated_at+interval '1 microsecond');
 end if;
 if new.branch_id is null then
  if tg_op='INSERT' or old.branch_id is not null then raise exception 'employee_branch_required' using errcode='23514'; end if;
 elsif not exists(select 1 from public.branches where id=new.branch_id and business_id=new.business_id) then raise exception 'employee_branch_business_mismatch' using errcode='23514'; end if;
 new.full_name:=btrim(new.full_name); new.role:=btrim(new.role); new.shift:=nullif(btrim(new.shift),'');
 if new.full_name is null or length(new.full_name) not between 1 and 200 or new.full_name ~ '[[:cntrl:]]'
  or new.role is null or length(new.role) not between 1 and 120 or new.role ~ '[[:cntrl:]]'
  or length(coalesce(new.shift,''))>120 or coalesce(new.shift,'') ~ '[[:cntrl:]]'
  or new.monthly_hours is null or new.monthly_hours not between 0 and 744
  or new.monthly_cost is null or new.monthly_cost not between 0 and 9999999999.99
  or new.pending_advance is null or new.pending_advance not between 0 and 9999999999.99
  or new.absences is null or new.absences not between 0 and 31
  or new.late_arrivals is null or new.late_arrivals not between 0 and 31
  or new.active is null then raise exception 'invalid_employee' using errcode='23514'; end if;
 return new;
end $$;
drop trigger trg_employees_updated on public.employees;
create trigger employee_validate_and_version before insert or update or delete on public.employees for each row execute function public.employee_validate_and_version();
revoke all on function public.employee_validate_and_version() from public,anon,authenticated,service_role;

create schema employee_private;
revoke all on schema employee_private from public,anon,authenticated,service_role;
create function employee_private.audit_employee_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_name text; v_role text; v_action text;
begin
 select p.full_name,m.role::text into v_name,v_role from public.business_members m left join public.profiles p on p.id=m.user_id where m.business_id=new.business_id and m.user_id=v_actor;
 if v_actor is not null and v_role is null then raise exception 'employee_audit_actor_forbidden' using errcode='42501'; end if;
 v_action:=case when tg_op='INSERT' then 'employee.created' when new.active is distinct from old.active then case when new.active then 'employee.restored' else 'employee.archived' end else 'employee.updated' end;
 insert into public.activity_logs(business_id,actor_id,actor_name,actor_role,action,target_type,target_id,summary,data)
 values(new.business_id,v_actor,v_name,v_role,v_action,'employees',new.id,
  case v_action when 'employee.created' then 'Empleado registrado · ' when 'employee.archived' then 'Empleado archivado · ' when 'employee.restored' then 'Empleado restaurado · ' else 'Empleado actualizado · ' end||new.full_name,
  jsonb_build_object('source',case when v_actor is null then 'system' when current_setting('app.employee_source',true)='manual' then 'manual' else 'api' end,'result','success','business_id',new.business_id,'branch_id',new.branch_id,'before',case when tg_op='UPDATE' then to_jsonb(old) else null end,'after',to_jsonb(new)));
 -- Employees store undated current totals. Conservatively invalidate all
 -- payroll snapshots for this business without rewriting historical amounts.
 update public.balance_snapshots set payroll_data_stale=true where business_id=new.business_id and not payroll_data_stale;
 return new;
end $$;
revoke all on function employee_private.audit_employee_change() from public,anon,authenticated,service_role;
create trigger employee_audit after insert or update on public.employees for each row execute function employee_private.audit_employee_change();
-- Salary audit snapshots require both the previous and current branch. A move
-- cannot expose the old payroll to a viewer assigned only to the new branch.
create policy employees_audit_scope on public.activity_logs as restrictive for select to authenticated using(
 target_type is distinct from 'employees' or (
  public.can_read_employee_scope(business_id,(data->'after'->>'branch_id')::uuid)
  and (data->'before' is null or data->'before'='null'::jsonb or public.can_read_employee_scope(business_id,(data->'before'->>'branch_id')::uuid))
 ));

-- Existing shifts/advance policies derive visibility from employees and now
-- inherit the active-profile, employee-role and branch restrictions above.

create function public.create_employee_manual(p_business_id uuid,p_id uuid,p_branch_id uuid,p_full_name text,p_role text,p_shift text,p_monthly_hours numeric,p_monthly_cost numeric,p_pending_advance numeric,p_absences integer,p_late_arrivals integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.employees%rowtype; v_source text;
begin
 if auth.uid() is null or not public.can_read_employee_scope(p_business_id,p_branch_id) or not public.has_business_write_role(p_business_id,array['owner','admin']) then raise exception 'employee_forbidden' using errcode='42501'; end if;
 if p_id is null or p_branch_id is null or scale(p_monthly_hours)>2 or scale(p_monthly_cost)>2 or scale(p_pending_advance)>2 then raise exception 'invalid_employee_input' using errcode='22023'; end if;
 v_source:=current_setting('app.employee_source',true); perform set_config('app.employee_source','manual',true);
 insert into public.employees(id,business_id,branch_id,full_name,role,shift,monthly_hours,monthly_cost,pending_advance,absences,late_arrivals)
 values(p_id,p_business_id,p_branch_id,p_full_name,p_role,p_shift,p_monthly_hours,p_monthly_cost,p_pending_advance,p_absences,p_late_arrivals)
 on conflict(id) do nothing returning * into v_row;
 if not found then
  select * into v_row from public.employees where id=p_id and business_id=p_business_id;
  if not found or not v_row.active or v_row.branch_id is distinct from p_branch_id or v_row.full_name is distinct from btrim(p_full_name) or v_row.role is distinct from btrim(p_role) or v_row.shift is distinct from nullif(btrim(p_shift),'')
   or v_row.monthly_hours is distinct from p_monthly_hours or v_row.monthly_cost is distinct from p_monthly_cost or v_row.pending_advance is distinct from p_pending_advance or v_row.absences is distinct from p_absences or v_row.late_arrivals is distinct from p_late_arrivals then raise exception 'employee_request_conflict' using errcode='23505'; end if;
 end if;
 perform set_config('app.employee_source',coalesce(v_source,''),true); return to_jsonb(v_row);
end $$;

create function public.update_employee_manual(p_business_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_branch_id uuid,p_full_name text,p_role text,p_shift text,p_monthly_hours numeric,p_monthly_cost numeric,p_pending_advance numeric,p_absences integer,p_late_arrivals integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.employees%rowtype; v_source text;
begin
 if auth.uid() is null or not public.can_read_employee_scope(p_business_id,p_branch_id) or not public.has_business_write_role(p_business_id,array['owner','admin']) then raise exception 'employee_forbidden' using errcode='42501'; end if;
 if p_branch_id is null or scale(p_monthly_hours)>2 or scale(p_monthly_cost)>2 or scale(p_pending_advance)>2 then raise exception 'invalid_employee_input' using errcode='22023'; end if;
 select * into v_row from public.employees where id=p_id and business_id=p_business_id for update;
 if not found then raise exception 'employee_not_found' using errcode='P0002'; end if;
 if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then raise exception 'employee_stale_version' using errcode='40001'; end if;
 v_source:=current_setting('app.employee_source',true); perform set_config('app.employee_source','manual',true);
 update public.employees set branch_id=p_branch_id,full_name=p_full_name,role=p_role,shift=p_shift,monthly_hours=p_monthly_hours,monthly_cost=p_monthly_cost,pending_advance=p_pending_advance,absences=p_absences,late_arrivals=p_late_arrivals where id=p_id and business_id=p_business_id returning * into v_row;
 perform set_config('app.employee_source',coalesce(v_source,''),true); return to_jsonb(v_row);
end $$;

create function public.set_employee_active_manual(p_business_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_active boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_row public.employees%rowtype; v_source text;
begin
 if auth.uid() is null or not exists(select 1 from public.profiles where id=auth.uid() and active) or not public.has_business_write_role(p_business_id,array['owner','admin']) then raise exception 'employee_forbidden' using errcode='42501'; end if;
 if p_active is null then raise exception 'invalid_employee_status' using errcode='22023'; end if;
 select * into v_row from public.employees where id=p_id and business_id=p_business_id for update;
 if not found then raise exception 'employee_not_found' using errcode='P0002'; end if;
 if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then raise exception 'employee_stale_version' using errcode='40001'; end if;
 v_source:=current_setting('app.employee_source',true); perform set_config('app.employee_source','manual',true);
 if v_row.active is distinct from p_active then update public.employees set active=p_active where id=p_id and business_id=p_business_id returning * into v_row; end if;
 perform set_config('app.employee_source',coalesce(v_source,''),true); return to_jsonb(v_row);
end $$;

create function public.employee_manual_summary(p_business_id uuid,p_search text default '',p_active boolean default true,p_branch_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('count',count(*),'activeCount',count(*) filter(where active),'totalMonthlyCost',coalesce(sum(monthly_cost) filter(where active),0),'pendingAdvances',coalesce(sum(pending_advance),0),'totalAbsences',coalesce(sum(absences),0),'totalLateArrivals',coalesce(sum(late_arrivals),0)) from public.employees
 where business_id=p_business_id and (p_active is null or active=p_active) and (p_branch_id is null or branch_id=p_branch_id) and strpos(lower(full_name),lower(coalesce(p_search,'')))>0;
$$;
revoke all on function public.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer),public.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer),public.set_employee_active_manual(uuid,uuid,timestamptz,boolean),public.employee_manual_summary(uuid,text,boolean,uuid) from public,anon,service_role;
grant execute on function public.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer),public.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer),public.set_employee_active_manual(uuid,uuid,timestamptz,boolean),public.employee_manual_summary(uuid,text,boolean,uuid) to authenticated;
