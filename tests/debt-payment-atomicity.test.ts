import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261007034647_atomic_debt_payments.sql",
  "utf8",
);
const actions = readFileSync("app/actions/debts.ts", "utf8");
const inbox = readFileSync("app/actions/inbox.ts", "utf8");
const adapter = readFileSync("lib/whatsapp-agent/supabase-adapter.ts", "utf8");

test("debt payments lock the debt and reject concurrent overpayment", () => {
  assert.match(migration, /create or replace function public\.enforce_debt_payment_balance/);
  assert.match(migration, /from public\.debts debt[\s\S]*for update/);
  assert.match(migration, /v_other_payments \+ new\.amount > v_debt\.original_amount/);
  assert.match(migration, /debt_payment_exceeds_pending/);
});

test("payment recalculation handles deletion and reopens a debt", () => {
  assert.match(migration, /coalesce\(new\.debt_id, old\.debt_id\)/);
  assert.match(migration, /when v_debt\.due_date is not null[\s\S]*'overdue'/);
  assert.match(migration, /else null[\s\S]*end[\s\S]*where id = v_debt_id/);
});

test("all product payment entry points use the audited atomic RPC", () => {
  assert.match(actions, /db\.rpc\("register_debt_payment_atomic"/);
  assert.match(inbox, /db\.rpc\("register_debt_payment_atomic"/);
  assert.match(adapter, /db\.rpc\("register_debt_payment_atomic"/);
  assert.doesNotMatch(adapter, /if \(call\.name === "debts\.registerPayment"\)[\s\S]*\.from\("debt_payments"\)[\s\S]*\.insert/);
});

test("atomic registration validates actor, business, amount, date and method", () => {
  assert.match(migration, /p_actor_id <> auth\.uid\(\)/);
  assert.match(migration, /register_debt_payment_atomic[\s\S]*security invoker/);
  assert.match(migration, /member\.business_id = p_business_id/);
  assert.match(migration, /v_member\.role not in \('owner', 'admin', 'manager'\)/);
  assert.match(migration, /p_amount > v_debt\.pending_amount/);
  assert.match(migration, /p_paid_at < date '2000-01-01'/);
  assert.match(migration, /length\(p_payment_method\) > 80/);
});
