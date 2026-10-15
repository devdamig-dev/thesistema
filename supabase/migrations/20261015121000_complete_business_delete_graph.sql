-- Complete the destructive business lifecycle with the actual FK graph.
-- The function remains service-role only and refuses shared businesses.

create or replace function public.delete_owned_business(
  p_business_id uuid,
  p_actor_id uuid,
  p_confirmation_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_business public.businesses%rowtype;
  v_role text;
  v_owner_count integer;
  v_member_count integer;
begin
  select * into v_business
  from public.businesses
  where id = p_business_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','not_found');
  end if;

  select role::text into v_role
  from public.business_members
  where business_id = p_business_id and user_id = p_actor_id;

  if v_role <> 'owner' then
    return jsonb_build_object('ok',false,'error','owner_required');
  end if;

  if btrim(coalesce(p_confirmation_name,'')) <> btrim(v_business.name) then
    return jsonb_build_object('ok',false,'error','confirmation_mismatch');
  end if;

  select count(*) into v_owner_count
  from public.business_members
  where business_id = p_business_id and role = 'owner';

  select count(*) into v_member_count
  from public.business_members
  where business_id = p_business_id;

  if v_owner_count <> 1 then
    return jsonb_build_object('ok',false,'error','shared_ownership');
  end if;
  if v_member_count <> 1 then
    return jsonb_build_object('ok',false,'error','business_has_members');
  end if;

  -- Private Inbox receipts hold RESTRICT references to messages,
  -- extractions, activity logs and advances.
  delete from advances_private.inbox_receipts where business_id = p_business_id;
  delete from closures_private.inbox_receipts where business_id = p_business_id;
  delete from expenses_private.inbox_receipts where business_id = p_business_id;
  delete from sales_private.inbox_receipts where business_id = p_business_id;

  -- Mutation journals hold RESTRICT references to their domain rows and audit.
  delete from public.closure_mutations where business_id = p_business_id;
  delete from public.expense_mutations where business_id = p_business_id;
  delete from public.invoice_mutations where business_id = p_business_id;
  delete from public.sale_mutations where business_id = p_business_id;

  -- Debt ledger: allocations reference both payments and installments.
  delete from public.debt_payment_allocations where business_id = p_business_id;
  delete from public.debt_payments where business_id = p_business_id;
  delete from public.debt_plan_mutations where business_id = p_business_id;
  delete from public.debt_installments where business_id = p_business_id;
  delete from public.debts where business_id = p_business_id;

  -- Sales children reference both sale and product with RESTRICT.
  delete from public.sale_items where business_id = p_business_id;
  delete from public.sales where business_id = p_business_id;

  -- Purchases reference extractions/pending agent operations with RESTRICT.
  delete from public.purchases where business_id = p_business_id;

  -- Stock movements reference stock_items and business with RESTRICT.
  delete from public.stock_movements where business_id = p_business_id;
  delete from public.stock_items
  where branch_id in (select id from public.branches where business_id = p_business_id);

  -- Other branch/business RESTRICT rows.
  delete from public.advance_payments where business_id = p_business_id;
  delete from public.expenses where business_id = p_business_id;
  delete from public.employees where business_id = p_business_id;
  delete from public.user_invitations where business_id = p_business_id;
  delete from public.whatsapp_authorized_conversations where business_id = p_business_id;

  -- Parents referenced by private receipts or purchases are now safe.
  delete from public.ai_extractions where business_id = p_business_id;
  delete from public.whatsapp_agent_pending_operations where business_id = p_business_id;
  delete from public.whatsapp_messages where business_id = p_business_id;
  delete from public.activity_logs where business_id = p_business_id;

  -- Remaining business-owned rows use CASCADE/SET NULL paths from businesses.
  delete from public.businesses where id = p_business_id;

  return jsonb_build_object('ok',true,'business_id',p_business_id);
end;
$$;

revoke all on function public.delete_owned_business(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.delete_owned_business(uuid,uuid,text) to service_role;
