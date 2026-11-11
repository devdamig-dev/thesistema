import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", VIEWER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table public.businesses(id uuid primary key);
    create table public.profiles(id uuid primary key,active boolean not null default true);
    create table public.business_members(business_id uuid references businesses(id),user_id uuid references profiles(id),role text,primary key(business_id,user_id));`);
  for (const file of ["20261014010000_managed_ai_gateway.sql", "20261014013000_managed_ai_gateway_hardening.sql", "20261102210000_ai_commercial_plans.sql", "20261111001000_ai_credit_reservations.sql", "20261111002000_ai_billing_sandbox.sql"]) {
    await db.exec(readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8"));
  }
  await db.exec(`insert into businesses values('${A}'),('${B}'); insert into profiles(id) values('${OWNER}'),('${OTHER}'),('${VIEWER}');
    insert into business_members values('${A}','${OWNER}','owner'),('${A}','${VIEWER}','viewer'),('${B}','${OTHER}','admin');`);
  return db;
}
type Reservation = { ok: boolean; allowed: boolean; usage_id: string; existing?: boolean; error?: string };
async function reserve(db: PGlite, credits: number, request = randomUUID(), business = A) {
  const result = await db.query<{ value: Reservation }>("select public.reserve_ai_usage($1,$2,null,'business_query','web','openai','fixture-model',$3,'{}') as value", [business, request, credits]);
  return result.rows[0].value;
}
async function balance(db: PGlite, business = A) {
  return Number((await db.query<{ value: number | string }>("select public.ai_business_available_credits($1) value", [business])).rows[0].value);
}
async function finalize(db: PGlite, id: string, status: string, business = A) {
  return (await db.query<{ value: { ok: boolean; idempotent?: boolean; error?: string } }>("select public.finalize_ai_usage($1,$2,$3,10,0,5,100,null) value", [business, id, status])).rows[0].value;
}
type Order = { id: string; product_code: string; credit_amount: number; amount_minor: number; status: string };
async function order(db: PGlite, requestId = randomUUID(), business = A, actor = OWNER) {
  return (await db.query<{ value: { created: boolean; order: Order } }>("select public.ai_billing_create_sandbox_order($1,$2,$3,'starter',10000,'12345') value", [business, actor, requestId])).rows[0].value;
}
async function payment(db: PGlite, id: string, options: { paymentId?: string; amount?: number; currency?: string; live?: boolean; status?: string; when?: string; refunded?: number } = {}) {
  return (await db.query<{ value: { recorded: boolean; idempotent?: boolean; stale?: boolean; credits_activated?: boolean; status?: string } }>(
    "select public.ai_billing_record_sandbox_payment($1,$2,'12345',$3,$4,$5,$6,$7,$8) value",
    [id, options.paymentId ?? "98765", options.amount ?? 10000, options.currency ?? "ARS", options.status ?? "approved", options.when ?? "2026-01-01T00:00:00Z", options.live ?? false, options.refunded ?? 0],
  )).rows[0].value;
}

test("SQL credit ledger: monthly + expiring packs, holds, refunds, deduplication and isolation", async () => {
  const db = await fixture();
  try {
    await db.exec(`update ai_business_plans set monthly_credits=2 where business_id='${A}';
      insert into ai_business_credit_grants(business_id,source_type,source_code,credits,expires_at) values
      ('${A}','pack','early',4,now()+interval '1 day'),('${A}','pack','later',10,now()+interval '10 days'),('${A}','pack','expired',100,now()-interval '1 day');`);
    assert.equal(await balance(db), 16);
    const request = randomUUID(); const first = await reserve(db, 5, request);
    assert.equal(first.allowed, true); assert.equal(await balance(db), 11);
    const duplicate = await reserve(db, 5, request);
    assert.equal(duplicate.existing, true); assert.equal(duplicate.usage_id, first.usage_id); assert.equal(await balance(db), 11);
    assert.equal((await finalize(db, first.usage_id, "completed", B)).error, "usage_not_found");
    assert.equal((await finalize(db, first.usage_id, "failed")).ok, true); assert.equal(await balance(db), 16);
    assert.equal((await finalize(db, first.usage_id, "failed")).idempotent, true); assert.equal(await balance(db), 16);
    const completed = await reserve(db, 5); await finalize(db, completed.usage_id, "completed");
    await finalize(db, completed.usage_id, "completed"); assert.equal(await balance(db), 11);
    const grants = await db.query<{ source_code: string; consumed_credits: number; reserved_credits: number }>("select source_code,consumed_credits,reserved_credits from ai_business_credit_grants order by source_code");
    assert.equal(grants.rows.find((g) => g.source_code === "early")?.consumed_credits, 3);
    assert.equal(grants.rows.find((g) => g.source_code === "later")?.consumed_credits, 0);
    assert.equal((await reserve(db, 12)).allowed, false); assert.equal(await balance(db), 11);
    assert.equal((await reserve(db, 1, randomUUID(), B)).allowed, false);
    const held = await reserve(db, 2); assert.equal(held.allowed, true);
    await db.exec(`update ai_business_credit_grants set expires_at=now()-interval '1 day' where source_code='early';`);
    assert.equal((await finalize(db, held.usage_id, "completed")).ok, true);
    assert.equal(await balance(db), 9);
  } finally { await db.close(); }
});

test("SQL billing: authenticated owner only, immutable order and sandbox never grants real credit", async () => {
  const db = await fixture();
  try {
    await assert.rejects(order(db, randomUUID(), A, VIEWER), /billing_forbidden/);
    await assert.rejects(order(db, randomUUID(), B, OWNER), /billing_forbidden/);
    const request = randomUUID(); const first = await order(db, request);
    assert.equal(first.created, true); assert.equal(first.order.credit_amount, 5000);
    const duplicate = await order(db, request); assert.equal(duplicate.created, false); assert.equal(duplicate.order.id, first.order.id);
    await assert.rejects(db.query("select ai_billing_create_sandbox_order($1,$2,$3,'starter',9999,'12345')", [A, OWNER, request]), /billing_request_conflict/);
    await assert.rejects(payment(db, first.order.id, { live: true }), /billing_invalid_payment/);
    await assert.rejects(payment(db, first.order.id, { amount: 9999 }), /billing_payment_mismatch/);
    await assert.rejects(payment(db, first.order.id, { currency: "USD" }), /billing_payment_mismatch/);
    const approved = await payment(db, first.order.id); assert.equal(approved.credits_activated, false);
    assert.equal((await payment(db, first.order.id)).idempotent, true);
    assert.equal(await balance(db), 0);
    assert.equal(Number((await db.query<{ n: string }>("select count(*) n from ai_business_credit_grants")).rows[0].n), 0);
    const foreign = await order(db, randomUUID(), B, OTHER);
    await assert.rejects(payment(db, foreign.order.id), /billing_payment_mismatch/);
    const stale = await payment(db, first.order.id, { status: "pending", when: "2025-12-31T23:00:00Z" }); assert.equal(stale.stale, true);
    const refund = await payment(db, first.order.id, { status: "refunded", refunded: 10000, when: "2026-01-02T00:00:00Z" }); assert.equal(refund.status, "refunded");
    await assert.rejects(payment(db, first.order.id, { when: "2026-01-03T00:00:00Z" }), /billing_refund_regression|billing_terminal_payment/);
    await db.exec(`update profiles set active=false where id='${OWNER}';`);
    await assert.rejects(order(db), /billing_forbidden/);
  } finally { await db.close(); }
});

test("SQL billing: secondary approvals require review and pending attempts cannot overwrite approval", async () => {
  const db = await fixture();
  try {
    const first = await order(db);
    assert.equal((await payment(db, first.order.id)).status, "approved");
    assert.equal((await payment(db, first.order.id, { paymentId: "98766", status: "rejected" })).status, "approved");
    assert.equal((await payment(db, first.order.id, { paymentId: "98767" })).status, "review");
    assert.equal((await payment(db, first.order.id, { status: "refunded", refunded: 10000, when: "2026-01-02T00:00:00Z" })).status, "review");
  } finally { await db.close(); }
});

test("SQL access: private payment/allocation tables and service RPCs cannot be called by clients", async () => {
  const db = await fixture();
  try {
    await db.exec(`update ai_business_plans set monthly_credits=9 where business_id='${A}';
      select set_config('request.jwt.claim.sub','${OTHER}',false); set role authenticated;`);
    const balances = await db.query<{ business_id: string; available_credits: number }>("select * from get_my_ai_credit_balance()");
    assert.deepEqual(balances.rows.map((r) => r.business_id), [B]);
    for (const table of ["ai_billing_orders", "ai_billing_payments", "ai_credit_allocations"]) await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
    await assert.rejects(order(db), /permission denied/);
    await assert.rejects(reserve(db, 1), /permission denied/);
    await db.exec("reset role; set role anon;");
    await assert.rejects(db.query("select * from get_my_ai_credit_balance()"), /permission denied/);
    await db.exec("reset role");
    const rls = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where relname in ('ai_billing_orders','ai_billing_payments','ai_credit_allocations')");
    assert.equal(rls.rows.length, 3); assert.ok(rls.rows.every((r) => r.relrowsecurity));
  } finally { await db.close(); }
});
