import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20261004215902_atomic_invoice_approval.sql",
  "utf8",
);

test("invoice approval migration serializes and deduplicates effects", () => {
  assert.match(migration, /create unique index if not exists purchases_invoice_id_unique/);
  assert.match(migration, /for update;/);
  assert.match(migration, /already_approved/);
  assert.match(migration, /insert into public\.purchases/);
  assert.match(migration, /insert into public\.purchase_items/);
  assert.match(migration, /insert into public\.stock_movements/);
  assert.match(migration, /update public\.invoices/);
});

test("invoice approval RPC enforces actor and is server-only", () => {
  assert.match(migration, /member\.user_id = p_actor_id/);
  assert.match(migration, /v_role not in \('owner', 'admin'\)/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
});
