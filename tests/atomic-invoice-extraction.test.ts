import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync("app/actions/invoices.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20261004223412_atomic_invoice_extraction.sql",
  "utf8",
);

test("invoice extraction finalization is atomic and retry-safe", () => {
  assert.match(migration, /from public\.invoices invoice[\s\S]*for update;/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /already_finalized/);
  assert.match(migration, /insert into public\.suppliers/);
  assert.match(migration, /delete from public\.invoice_items/);
  assert.match(migration, /insert into public\.invoice_items/);
  assert.match(migration, /update public\.invoices/);
  assert.match(migration, /insert into public\.invoice_processing_logs/);
});

test("invoice extraction RPC validates tenant, actor and untrusted AI data", () => {
  assert.match(migration, /member\.business_id = p_business_id/);
  assert.match(migration, /member\.user_id = p_actor_id/);
  assert.match(migration, /profile\.active = true/);
  assert.match(migration, /cardinality\(v_roles\), 0\) <> 1/);
  assert.match(migration, /v_roles\[1\] not in \('owner', 'admin', 'manager'\)/);
  assert.match(migration, /v_confidence is null/);
  assert.match(migration, /coalesce\(item->>'match_status', ''\) not in/);
  assert.match(migration, /ingredient\.business_id = p_business_id/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
});

test("upload action delegates final persistence to the atomic RPC", () => {
  assert.match(action, /rpc\("finalize_invoice_extraction_atomic"/);
  assert.doesNotMatch(action, /from\("invoice_items"\)\s*\.insert/);
  assert.match(action, /finalizationWasCommitted/);
  assert.match(action, /markInvoiceFailed/);
  assert.match(action, /removeUploadedObject/);
});
