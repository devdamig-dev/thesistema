-- Isolated synthetic fixtures only. No email is sent; every mutation rolls back.
begin;
create function pg_temp.invite_assert(p_ok boolean, p_message text)
returns void language plpgsql as $$ begin
  if p_ok is distinct from true then raise exception 'ASSERTION FAILED: %', p_message; end if;
end; $$;

insert into auth.users(id,email) values
 ('e0000000-0000-4000-8000-000000000001','invite-owner@example.invalid'),
 ('e0000000-0000-4000-8000-000000000002','invite-admin@example.invalid'),
 ('e0000000-0000-4000-8000-000000000003','invite-viewer@example.invalid'),
 ('e0000000-0000-4000-8000-000000000004','other-owner@example.invalid'),
 ('e0000000-0000-4000-8000-000000000005','brother@example.invalid');
insert into public.organizations(id,name) values
 ('e0000000-0000-4000-8000-000000000010','Invitation regression fixtures');
update public.profiles set organization_id='e0000000-0000-4000-8000-000000000010'
 where id in ('e0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000002',
 'e0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000005');
insert into public.businesses(id,organization_id,name) values
 ('e0000000-0000-4000-8000-000000000011','e0000000-0000-4000-8000-000000000010','Invitation business A'),
 ('e0000000-0000-4000-8000-000000000012','e0000000-0000-4000-8000-000000000010','Invitation business B');
insert into public.business_members(business_id,user_id,role) values
 ('e0000000-0000-4000-8000-000000000011','e0000000-0000-4000-8000-000000000001','owner'),
 ('e0000000-0000-4000-8000-000000000011','e0000000-0000-4000-8000-000000000002','admin'),
 ('e0000000-0000-4000-8000-000000000011','e0000000-0000-4000-8000-000000000003','viewer'),
 ('e0000000-0000-4000-8000-000000000012','e0000000-0000-4000-8000-000000000004','owner');

-- These writes use the same authenticated/RLS path as inviteUserAction and revokeInvitationAction.
set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
insert into public.user_invitations(id,business_id,email,role,invited_by,token) values
 ('e0000000-0000-4000-8000-000000000101','e0000000-0000-4000-8000-000000000011','brother@example.invalid','admin','e0000000-0000-4000-8000-000000000001','fixture-revoked-one');
update public.user_invitations set status='revoked'
 where id='e0000000-0000-4000-8000-000000000101' and business_id='e0000000-0000-4000-8000-000000000011' and status='pending';
insert into public.user_invitations(id,business_id,email,role,invited_by,token) values
 ('e0000000-0000-4000-8000-000000000102','e0000000-0000-4000-8000-000000000011','brother@example.invalid','admin','e0000000-0000-4000-8000-000000000001','fixture-revoked-two');
-- Reproduces the pilot error on old main: UNIQUE(business_id,email,status) rejects this second revoke.
update public.user_invitations set status='revoked'
 where id='e0000000-0000-4000-8000-000000000102' and business_id='e0000000-0000-4000-8000-000000000011' and status='pending';
select pg_temp.invite_assert((select count(*)=2 from public.user_invitations where email='brother@example.invalid' and status='revoked'),'both revoked invitations retain their history');

-- Expired history must also be repeatable, without freeing a live pending token.
insert into public.user_invitations(business_id,email,role,invited_by,status,token) values
 ('e0000000-0000-4000-8000-000000000011','brother@example.invalid','admin','e0000000-0000-4000-8000-000000000001','expired','fixture-expired-one'),
 ('e0000000-0000-4000-8000-000000000011','brother@example.invalid','admin','e0000000-0000-4000-8000-000000000001','expired','fixture-expired-two');
insert into public.user_invitations(id,business_id,email,role,invited_by,token,expires_at) values
 ('e0000000-0000-4000-8000-000000000103','e0000000-0000-4000-8000-000000000011','brother@example.invalid','admin','e0000000-0000-4000-8000-000000000001','fixture-live-token',now()+interval '1 day');
do $$ begin
  begin
    insert into public.user_invitations(business_id,email,role,invited_by) values
    ('e0000000-0000-4000-8000-000000000011','BROTHER@example.invalid','admin','e0000000-0000-4000-8000-000000000001');
  exception when unique_violation then return;
  end;
  raise exception 'ASSERTION FAILED: a second live token differing only by email case was accepted';
end; $$;
select pg_temp.invite_assert((select count(*)=1 from public.user_invitations where lower(email)='brother@example.invalid' and status='pending'),'one pending token only');
with changed as (update public.user_invitations set status='revoked' where id='e0000000-0000-4000-8000-000000000101' and status='pending' returning id)
select pg_temp.invite_assert((select count(*)=0 from changed),'a stale revoke must not mutate historical rows');

-- A viewer and an owner of another business cannot revoke A's pending token.
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000003',true);
with changed as (update public.user_invitations set status='revoked' where id='e0000000-0000-4000-8000-000000000103' and status='pending' returning id)
select pg_temp.invite_assert((select count(*)=0 from changed),'viewer cannot revoke');
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000004',true);
with changed as (update public.user_invitations set status='revoked' where id='e0000000-0000-4000-8000-000000000103' and status='pending' returning id)
select pg_temp.invite_assert((select count(*)=0 from changed),'other business cannot revoke');
insert into public.user_invitations(business_id,email,role,invited_by,token) values
 ('e0000000-0000-4000-8000-000000000012','brother@example.invalid','admin','e0000000-0000-4000-8000-000000000004','fixture-business-b');

-- Admin can perform successive revoke/reinvite cycles too.
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000002',true);
insert into public.user_invitations(id,business_id,email,role,invited_by) values
 ('e0000000-0000-4000-8000-000000000104','e0000000-0000-4000-8000-000000000011','admin-target@example.invalid','admin','e0000000-0000-4000-8000-000000000002');
update public.user_invitations set status='revoked' where id='e0000000-0000-4000-8000-000000000104' and status='pending';
insert into public.user_invitations(id,business_id,email,role,invited_by) values
 ('e0000000-0000-4000-8000-000000000105','e0000000-0000-4000-8000-000000000011','admin-target@example.invalid','admin','e0000000-0000-4000-8000-000000000002');
update public.user_invitations set status='revoked' where id='e0000000-0000-4000-8000-000000000105' and status='pending';
select pg_temp.invite_assert((select count(*)=2 from public.user_invitations where email='admin-target@example.invalid' and status='revoked'),'admin retains both revocations');
reset role;

-- Acceptance uses the real atomic server-only RPC, not a simulated membership.
set local role service_role;
select pg_temp.invite_assert(public.accept_user_invitation('fixture-revoked-one','e0000000-0000-4000-8000-000000000005','brother@example.invalid')->>'error'='invitation_revoked','old link cannot be accepted');
select pg_temp.invite_assert(public.accept_user_invitation('fixture-revoked-two','e0000000-0000-4000-8000-000000000005','brother@example.invalid')->>'error'='invitation_revoked','second revoked link cannot be accepted');
select pg_temp.invite_assert(public.accept_user_invitation('fixture-expired-one','e0000000-0000-4000-8000-000000000005','brother@example.invalid')->>'error'='invitation_expired','expired link cannot be accepted');
select pg_temp.invite_assert(public.accept_user_invitation('fixture-live-token','e0000000-0000-4000-8000-000000000005','wrong@example.invalid')->>'error'='invitation_email_mismatch','wrong email cannot consume the live link');
select pg_temp.invite_assert((public.accept_user_invitation('fixture-live-token','e0000000-0000-4000-8000-000000000005','brother@example.invalid')->>'ok')::boolean,'new invitation is accepted');
select pg_temp.invite_assert((select count(*)=1 from public.business_members where user_id='e0000000-0000-4000-8000-000000000005' and business_id='e0000000-0000-4000-8000-000000000011' and role='admin'),'brother joins the correct existing business');
select pg_temp.invite_assert((select count(*)=2 from public.businesses where organization_id='e0000000-0000-4000-8000-000000000010'),'acceptance did not create another business');
select pg_temp.invite_assert(public.accept_user_invitation('fixture-live-token','e0000000-0000-4000-8000-000000000005','brother@example.invalid')->>'error'='invitation_accepted','accepted link cannot be reused');
select pg_temp.invite_assert(public.accept_user_invitation('fixture-business-b','e0000000-0000-4000-8000-000000000005','brother@example.invalid')->>'error'='business_already_assigned','existing membership is not silently moved to another business');
reset role;
rollback;
