-- Manual supplier management reuses suppliers. Archiving never destroys history.
alter table public.suppliers
  add column active boolean not null default true,
  add column notes text,
  add column payment_terms text;

create function public.supplier_validate_and_version()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op='DELETE' and not exists(select 1 from public.businesses where id=old.business_id) then return old; end if;
  if current_user::text='authenticated' and not exists(select 1 from public.profiles where id=auth.uid() and active) then
    raise exception 'supplier_actor_inactive' using errcode='42501';
  end if;
  if tg_op='DELETE' then raise exception 'supplier_archive_required' using errcode='23514'; end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.business_id is distinct from old.business_id then
      raise exception 'supplier_identity_immutable' using errcode = '23514';
    end if;
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  end if;
  new.name := btrim(new.name);
  new.tax_id := nullif(btrim(new.tax_id), '');
  new.category := nullif(btrim(new.category), '');
  new.phone := nullif(btrim(new.phone), '');
  new.email := nullif(btrim(new.email), '');
  new.notes := nullif(btrim(new.notes), '');
  new.payment_terms := nullif(btrim(new.payment_terms), '');
  if new.name is null or length(new.name) not between 1 and 200
    or length(coalesce(new.tax_id, '')) > 40
    or length(coalesce(new.category, '')) > 120
    or length(coalesce(new.phone, '')) > 40
    or length(coalesce(new.email, '')) > 254
    or length(coalesce(new.notes, '')) > 4000
    or length(coalesce(new.payment_terms, '')) > 1000
    or (new.email is not null and new.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
    or (new.phone is not null and (new.phone !~ '^[+0-9(). /-]+$' or length(regexp_replace(new.phone, '[^0-9]', '', 'g')) not between 3 and 20))
    or new.name ~ '[[:cntrl:]]' or coalesce(new.tax_id, '') ~ '[[:cntrl:]]'
    or coalesce(new.category, '') ~ '[[:cntrl:]]' or coalesce(new.email, '') ~ '[[:cntrl:]]'
    or coalesce(new.payment_terms, '') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
    or coalesce(new.notes, '') ~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
  then raise exception 'invalid_supplier' using errcode = '23514'; end if;
  return new;
end;
$$;
drop trigger trg_suppliers_updated on public.suppliers;
create trigger supplier_validate_and_version before insert or update or delete on public.suppliers
  for each row execute function public.supplier_validate_and_version();

-- Narrow, non-callable trigger bridge; clients still cannot insert activity logs.
create schema if not exists supplier_private;
revoke all on schema supplier_private from public, anon, authenticated, service_role;
create function supplier_private.audit_supplier_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_name text; v_role text; v_action text;
begin
  select p.full_name, m.role::text into v_name, v_role
  from public.business_members m left join public.profiles p on p.id = m.user_id
  where m.business_id = new.business_id and m.user_id = v_actor;
  if v_actor is not null and v_role is null then
    raise exception 'supplier_audit_actor_forbidden' using errcode = '42501';
  end if;
  v_action := case when tg_op = 'INSERT' then 'supplier.created'
    when new.active is distinct from old.active then
      case when new.active then 'supplier.restored' else 'supplier.archived' end
    else 'supplier.updated' end;
  insert into public.activity_logs(business_id, actor_id, actor_name, actor_role,
    action, target_type, target_id, summary, data)
  values (new.business_id, v_actor, v_name, v_role, v_action, 'suppliers', new.id,
    case v_action when 'supplier.created' then 'Proveedor registrado · '
      when 'supplier.archived' then 'Proveedor archivado · '
      when 'supplier.restored' then 'Proveedor restaurado · '
      else 'Proveedor actualizado · ' end || new.name,
    jsonb_build_object('source',case when v_actor is null then 'system' when current_setting('app.supplier_source',true)='manual' then 'manual' else 'api' end,'result','success','business_id',new.business_id,'branch_id',null,'before', case when tg_op = 'UPDATE' then to_jsonb(old) else null end, 'after', to_jsonb(new)));
  return new;
end;
$$;
revoke all on function supplier_private.audit_supplier_change() from public, anon, authenticated, service_role;
create trigger supplier_audit after insert or update on public.suppliers
  for each row execute function supplier_private.audit_supplier_change();

-- A stable client-generated UUID is the create request key. Repeating the exact
-- request returns the original row and never inserts a second supplier/log.
create function public.create_supplier_manual(
  p_business_id uuid, p_id uuid, p_name text, p_tax_id text default null,
  p_category text default null, p_phone text default null, p_email text default null,
  p_payment_terms text default null, p_notes text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_supplier public.suppliers%rowtype; v_source text;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and active) or not public.has_business_write_role(p_business_id, array['owner','admin','manager']) then
    raise exception 'supplier_forbidden' using errcode = '42501';
  end if;
  if p_id is null then raise exception 'invalid_supplier_id' using errcode = '22023'; end if;
  v_source:=current_setting('app.supplier_source',true); perform set_config('app.supplier_source','manual',true);
  insert into public.suppliers(id, business_id, name, tax_id, category, phone, email, payment_terms, notes)
    values(p_id, p_business_id, p_name, p_tax_id, p_category, p_phone, p_email, p_payment_terms, p_notes)
    on conflict (id) do nothing returning * into v_supplier;
  if not found then
    select * into v_supplier from public.suppliers where id = p_id and business_id = p_business_id;
    if not found or v_supplier.name is distinct from btrim(p_name)
      or v_supplier.tax_id is distinct from nullif(btrim(p_tax_id), '')
      or v_supplier.category is distinct from nullif(btrim(p_category), '')
      or v_supplier.phone is distinct from nullif(btrim(p_phone), '')
      or v_supplier.email is distinct from nullif(btrim(p_email), '')
      or v_supplier.payment_terms is distinct from nullif(btrim(p_payment_terms), '')
      or v_supplier.notes is distinct from nullif(btrim(p_notes), '') then
      raise exception 'supplier_request_conflict' using errcode = '23505';
    end if;
  end if;
  perform set_config('app.supplier_source',coalesce(v_source,''),true);
  return to_jsonb(v_supplier);
end;
$$;

create function public.update_supplier_manual(
  p_business_id uuid, p_id uuid, p_expected_updated_at timestamptz, p_name text,
  p_tax_id text default null, p_category text default null, p_phone text default null,
  p_email text default null, p_payment_terms text default null, p_notes text default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_supplier public.suppliers%rowtype; v_source text;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and active) or not public.has_business_write_role(p_business_id, array['owner','admin','manager']) then
    raise exception 'supplier_forbidden' using errcode = '42501';
  end if;
  select * into v_supplier from public.suppliers where id = p_id and business_id = p_business_id for update;
  if not found then raise exception 'supplier_not_found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or v_supplier.updated_at is distinct from p_expected_updated_at then
    raise exception 'supplier_stale_version' using errcode = '40001';
  end if;
  v_source:=current_setting('app.supplier_source',true); perform set_config('app.supplier_source','manual',true);
  update public.suppliers set name = p_name, tax_id = p_tax_id, category = p_category,
    phone = p_phone, email = p_email, payment_terms = p_payment_terms, notes = p_notes
    where id = p_id and business_id = p_business_id returning * into v_supplier;
  perform set_config('app.supplier_source',coalesce(v_source,''),true);
  return to_jsonb(v_supplier);
end;
$$;

create function public.set_supplier_active_manual(
  p_business_id uuid, p_id uuid, p_expected_updated_at timestamptz, p_active boolean
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_supplier public.suppliers%rowtype; v_source text;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id = auth.uid() and active) or not public.has_business_write_role(p_business_id, array['owner','admin','manager']) then
    raise exception 'supplier_forbidden' using errcode = '42501';
  end if;
  if p_active is null then raise exception 'invalid_supplier_status' using errcode = '22023'; end if;
  select * into v_supplier from public.suppliers where id = p_id and business_id = p_business_id for update;
  if not found then raise exception 'supplier_not_found' using errcode = 'P0002'; end if;
  if p_expected_updated_at is null or v_supplier.updated_at is distinct from p_expected_updated_at then
    raise exception 'supplier_stale_version' using errcode = '40001';
  end if;
  v_source:=current_setting('app.supplier_source',true); perform set_config('app.supplier_source','manual',true);
  if v_supplier.active is distinct from p_active then
    update public.suppliers set active = p_active where id = p_id and business_id = p_business_id returning * into v_supplier;
  end if;
  perform set_config('app.supplier_source',coalesce(v_source,''),true);
  return to_jsonb(v_supplier);
end;
$$;

-- New purchase references must be active, even when submitted from a stale UI.
-- Unchanged historical references remain readable/editable. SHARE serializes
-- new purchases with archive; no historical FK or purchase row is rewritten.
create function public.guard_purchase_supplier_active()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_supplier public.suppliers%rowtype; v_source text;
begin
  if new.supplier_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.supplier_id is not distinct from old.supplier_id
    and new.business_id is not distinct from old.business_id then return new; end if;
  select * into v_supplier from public.suppliers where id = new.supplier_id and business_id = new.business_id for share;
  if not found or not v_supplier.active then
    raise exception 'supplier_inactive_or_unavailable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger purchase_supplier_active before insert or update of supplier_id, business_id on public.purchases
  for each row execute function public.guard_purchase_supplier_active();

revoke all on function public.create_supplier_manual(uuid, uuid, text, text, text, text, text, text, text) from public, anon, service_role;
revoke all on function public.update_supplier_manual(uuid, uuid, timestamptz, text, text, text, text, text, text, text) from public, anon, service_role;
revoke all on function public.set_supplier_active_manual(uuid, uuid, timestamptz, boolean) from public, anon, service_role;
grant execute on function public.create_supplier_manual(uuid, uuid, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.update_supplier_manual(uuid, uuid, timestamptz, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.set_supplier_active_manual(uuid, uuid, timestamptz, boolean) to authenticated;
revoke all on function public.supplier_validate_and_version(), public.guard_purchase_supplier_active() from public, anon, authenticated, service_role;
