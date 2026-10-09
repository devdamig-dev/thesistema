-- Payroll writes require the versioned RPC contract even for business owners.
-- Table grants cannot distinguish a direct REST edit from an invoker function,
-- so the three narrow mutation kernels run in a non-exposed private schema.
-- They keep their own live actor/tenant/branch/CAS validation. No stock service
-- or session impersonation is involved.
revoke insert,update,delete,truncate,references,trigger on public.employees from public,anon,authenticated,service_role;

create or replace function public.can_read_employee_scope(p_business uuid,p_branch uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and active)
 and exists(select 1 from public.business_modules where business_id=p_business and module_key='employees' and enabled)
 and public.has_business_write_role(p_business,array['owner','admin','manager','viewer'])
 and public.can_access_business_branch(p_business,p_branch)
 and (p_branch is not null or public.has_business_write_role(p_business,array['owner','admin','manager']));
$$;

alter function public.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer) set schema employee_private;
alter function employee_private.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer) security definer;
alter function public.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer) set schema employee_private;
alter function employee_private.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer) security definer;
alter function public.set_employee_active_manual(uuid,uuid,timestamptz,boolean) set schema employee_private;
alter function employee_private.set_employee_active_manual(uuid,uuid,timestamptz,boolean) security definer;
-- Archive/restore had no branch input, so explicitly require the employees
-- module before selecting the target. The kernel derives its actor from auth.
create or replace function employee_private.set_employee_active_manual(p_business_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_active boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.employees%rowtype; v_source text;
begin
 if auth.uid() is null or current_setting('role',true)<>'authenticated'
  or not exists(select 1 from public.profiles where id=auth.uid() and active)
  or not exists(select 1 from public.business_modules where business_id=p_business_id and module_key='employees' and enabled)
  or not public.has_business_write_role(p_business_id,array['owner','admin']) then raise exception 'employee_forbidden' using errcode='42501'; end if;
 if p_active is null then raise exception 'invalid_employee_status' using errcode='22023'; end if;
 select * into v_row from public.employees where id=p_id and business_id=p_business_id for update;
 if not found then raise exception 'employee_not_found' using errcode='P0002'; end if;
 if not public.can_read_employee_scope(v_row.business_id,v_row.branch_id) then raise exception 'employee_forbidden' using errcode='42501'; end if;
 if p_expected_updated_at is null or v_row.updated_at is distinct from p_expected_updated_at then raise exception 'employee_stale_version' using errcode='40001'; end if;
 v_source:=current_setting('app.employee_source',true); perform set_config('app.employee_source','manual',true);
 if v_row.active is distinct from p_active then update public.employees set active=p_active where id=p_id and business_id=p_business_id returning * into v_row; end if;
 perform set_config('app.employee_source',coalesce(v_source,''),true); return to_jsonb(v_row);
end $$;
-- EXECUTE is granted only to the authenticated role. Both moved kernels still
-- enforce auth.uid(), active profile, business role, branch and module themselves.
grant usage on schema employee_private to authenticated;
revoke all on function employee_private.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer),employee_private.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer),employee_private.set_employee_active_manual(uuid,uuid,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function employee_private.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer),employee_private.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer),employee_private.set_employee_active_manual(uuid,uuid,timestamptz,boolean) to authenticated;

create function public.create_employee_manual(p_business_id uuid,p_id uuid,p_branch_id uuid,p_full_name text,p_role text,p_shift text,p_monthly_hours numeric,p_monthly_cost numeric,p_pending_advance numeric,p_absences integer,p_late_arrivals integer)
returns jsonb language sql security invoker set search_path='' as $$ select employee_private.create_employee_manual(p_business_id,p_id,p_branch_id,p_full_name,p_role,p_shift,p_monthly_hours,p_monthly_cost,p_pending_advance,p_absences,p_late_arrivals) $$;
create function public.update_employee_manual(p_business_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_branch_id uuid,p_full_name text,p_role text,p_shift text,p_monthly_hours numeric,p_monthly_cost numeric,p_pending_advance numeric,p_absences integer,p_late_arrivals integer)
returns jsonb language sql security invoker set search_path='' as $$ select employee_private.update_employee_manual(p_business_id,p_id,p_expected_updated_at,p_branch_id,p_full_name,p_role,p_shift,p_monthly_hours,p_monthly_cost,p_pending_advance,p_absences,p_late_arrivals) $$;
create function public.set_employee_active_manual(p_business_id uuid,p_id uuid,p_expected_updated_at timestamptz,p_active boolean)
returns jsonb language sql security invoker set search_path='' as $$ select employee_private.set_employee_active_manual(p_business_id,p_id,p_expected_updated_at,p_active) $$;
revoke all on function public.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer),public.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer),public.set_employee_active_manual(uuid,uuid,timestamptz,boolean) from public,anon,authenticated,service_role;
grant execute on function public.create_employee_manual(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,integer,integer),public.update_employee_manual(uuid,uuid,timestamptz,uuid,text,text,text,numeric,numeric,numeric,integer,integer),public.set_employee_active_manual(uuid,uuid,timestamptz,boolean) to authenticated;
