import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseConversationInput } from "../lib/whatsapp/conversation-input";
const valid = { memberId: "00000000-0000-4000-8000-000000000001", branchId: null, phone: "+54 9 11 1234-5678", enabled: true, confirmed: true };
test("conversation enrollment requires explicit confirmation and a valid international phone", () => {
  assert.equal(parseConversationInput(valid).phone, "5491112345678");
  for (const value of [{ ...valid, confirmed: false }, { ...valid, enabled: "yes" }, { ...valid, phone: "call me" }, { ...valid, phone: "001234567890" }, { ...valid, business_id: "other" }, { ...valid, branchId: "other" }]) assert.throws(() => parseConversationInput(value));
});
test("connection commit is server-only, scoped, serial and audit-atomic", () => {
  const sql = readFileSync("supabase/migrations/20261007201500_whatsapp_signup_sessions.sql", "utf8");
  for (const expected of ["service_role_required", "and business_id = p_business_id and user_id = p_actor_id for update", "s.consumed_at is not null", "s.expires_at <= now()", "existing_connection_must_not_be_replaced", "phone_already_assigned", "insert into public.activity_logs", "access_token=null", "from public,anon,authenticated"]) assert.ok(sql.includes(expected), expected);
});
test("conversation enrollment enforces tenant, active identity, branch and non-ambiguous phone", () => {
  const sql = readFileSync("supabase/migrations/20261007201600_whatsapp_member_conversation.sql", "utf8");
  for (const expected of ["service_role_required", "m.business_id=p_business_id", "p.active=true", "branch_not_authorized", "branch_assignments", "profile_phone_change_requires_review", "phone_ambiguous", "pg_advisory_xact_lock", "insert into public.activity_logs"]) assert.ok(sql.includes(expected), expected);
});
test("real webhook has no unauthenticated Inbox extraction fallback", () => {
  const source = readFileSync("app/api/webhooks/whatsapp/route.ts", "utf8");
  assert.ok(source.includes('reply.status === "ignored" || reply.status === "rejected"'));
  assert.ok(source.includes('.eq("phone_number_id", message.phoneNumberId).eq("waba_id", message.accountId)'));
  assert.equal(source.includes('.from("ai_extractions")'), false);
});
