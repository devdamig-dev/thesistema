/**
 * Offline populated purchase-upgrade regression. Run:
 *   node tests/purchase-cost-backfill-upgrade.mjs
 * Uses only synthetic rows in disposable in-memory PGlite. No credentials,
 * external database, production data or native concurrency claims.
 */
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const targets = ['manual_purchase_history', 'purchase_void_audit', 'trg_purchases_updated'];
const modeCommand = { O: 'enable', A: 'enable always', R: 'enable replica', D: 'disable' };
const modes = async () => (await db.query("select tgname,tgenabled from pg_trigger where tgrelid='public.purchases'::regclass order by tgname")).rows;
const rows = async () => (await db.query('select to_jsonb(p) as row from public.purchases p order by id')).rows;
const history = async () => (await db.query("select 'activity' as kind,to_jsonb(a) as row from public.activity_logs a union all select 'movement',to_jsonb(m) from public.stock_movements m order by kind,row")).rows;
const setMode = async (name, mode) => {
  assert.ok(modeCommand[mode]);
  await db.exec(`alter table public.purchases ${modeCommand[mode]} trigger ${quote(name)}`);
};

try {
  await db.exec(await readFile(join(root, 'tests/upgrade/supabase-scaffolding.sql'), 'utf8'));
  const files = (await readdir(join(root, 'supabase/migrations'))).filter(f => f.endsWith('.sql')).sort();
  const target = files.find(f => f.endsWith('_purchase_spec_parity.sql'));
  assert.ok(target, 'purchase parity migration exists');
  for (const file of files.filter(f => f < target)) {
    const sql = await readFile(join(root, 'supabase/migrations', file), 'utf8');
    if (file <= '20261007201700_whatsapp_public_status.sql') {
      for (const statement of sql.match(/^alter type [^;]+ add value[^;]+;/gim) ?? []) await db.exec(statement);
      await db.exec(sql);
    } else {
      await db.exec('begin;\n' + sql + '\ncommit;');
    }
  }

  // Create real pre-increment purchase receipts with the already-applied RPCs.
  // One unlinked detail remains unflagged; linked active and voided receipts
  // must retain their financial fields, audit history and original timestamps.
  await db.exec(`
    begin;
    insert into auth.users(id,email) values ('82000000-0000-4000-8000-000000000001','purchase-upgrade@example.invalid');
    insert into public.organizations(id,name) values ('82000000-0000-4000-8000-000000000010','Synthetic upgrade');
    update public.profiles set organization_id='82000000-0000-4000-8000-000000000010' where id='82000000-0000-4000-8000-000000000001';
    insert into public.businesses(id,organization_id,name) values ('82000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000010','Synthetic purchases');
    insert into public.business_members(business_id,user_id,role) values ('82000000-0000-4000-8000-000000000011','82000000-0000-4000-8000-000000000001','owner');
    insert into public.branches(id,business_id,name) values ('82000000-0000-4000-8000-000000000021','82000000-0000-4000-8000-000000000011','Fixture branch');
    insert into public.business_modules(business_id,module_key,enabled) values ('82000000-0000-4000-8000-000000000011','purchases',true);
    insert into public.suppliers(id,business_id,name) values ('82000000-0000-4000-8000-000000000040','82000000-0000-4000-8000-000000000011','Fixture supplier');
    insert into public.ingredients(id,business_id,name,unit) values ('82000000-0000-4000-8000-000000000070','82000000-0000-4000-8000-000000000011','Fixture flour','kg');
    set local role authenticated;
    select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',true);
    select public.create_purchase_manual_atomic('82000000-0000-4000-8000-000000000011','{"requestId":"82000000-0000-4000-8000-000000000091","branchId":"82000000-0000-4000-8000-000000000021","supplierId":"82000000-0000-4000-8000-000000000040","purchasedAt":"2026-10-09","paymentMethod":"Cuenta corriente","items":[{"description":"Unlinked detail","qty":"2","unit":"u","unitPrice":"1.25"}]}');
    select public.create_purchase_manual_atomic('82000000-0000-4000-8000-000000000011','{"requestId":"82000000-0000-4000-8000-000000000092","branchId":"82000000-0000-4000-8000-000000000021","supplierId":"82000000-0000-4000-8000-000000000040","purchasedAt":"2026-10-09","paymentMethod":"Cuenta corriente","items":[{"ingredientId":"82000000-0000-4000-8000-000000000070","description":"Linked voided detail","qty":"500","unit":"g","unitPrice":"1.25"}]}');
    select public.void_purchase_manual_atomic('82000000-0000-4000-8000-000000000011',(select id from public.purchases where manual_request_id='82000000-0000-4000-8000-000000000092'),1,'Synthetic correction');
    select public.create_purchase_manual_atomic('82000000-0000-4000-8000-000000000011','{"requestId":"82000000-0000-4000-8000-000000000093","branchId":"82000000-0000-4000-8000-000000000021","supplierId":"82000000-0000-4000-8000-000000000040","purchasedAt":"2026-10-09","paymentMethod":"Cuenta corriente","items":[{"ingredientId":"82000000-0000-4000-8000-000000000070","description":"Linked active detail","qty":"250","unit":"g","unitPrice":"1.25"}]}');
    commit;
  `);
  const before = await rows();
  assert.equal(before.length, 3, 'populated manual purchase fixture');
  const oldColumns = Object.keys(before[0].row);
  const oldRows = async () => (await db.query(`select to_jsonb(p) as row from (select ${oldColumns.map(quote).join(',')} from public.purchases) p order by id`)).rows;
  const beforeModes = await modes();
  const beforeHistory = await history();
  const sql = await readFile(join(root, 'supabase/migrations', target), 'utf8');
  const block = sql.match(/do \$purchase_cost_backfill\$[\s\S]*?\$purchase_cost_backfill\$;/)?.[0];
  assert.ok(block, 'backfill is one atomic DO statement');
  await db.exec('begin;\n' + sql + '\ncommit;');
  assert.deepEqual(await oldRows(), before, 'full migration preserves every old purchase column');
  assert.deepEqual((await modes()).filter(t => beforeModes.some(old => old.tgname === t.tgname)), beforeModes,
    'full migration preserves every pre-existing trigger mode');
  assert.deepEqual(await history(), beforeHistory, 'backfill invents no audit or stock events');
  assert.deepEqual((await db.query('select right(manual_request_id::text,3) as request,cost_refresh_pending as pending from public.purchases order by manual_request_id')).rows,
    [{ request: '091', pending: false }, { request: '092', pending: true }, { request: '093', pending: true }]);

  // Later in the migration a new actor-context lock is installed. Supply this
  // fixture's owner for isolated block replays; the first full migration above
  // ran as the migration owner with no request identity, as deployment does.
  await db.exec("select set_config('request.jwt.claim.sub','82000000-0000-4000-8000-000000000001',false)");
  // Every affected trigger is exercised in all four PostgreSQL enable modes.
  for (const combination of [['O','O','O'], ['A','R','D'], ['R','D','A'], ['D','A','R']]) {
    for (let i = 0; i < targets.length; i++) await setMode(targets[i], combination[i]);
    const expected = await modes();
    await db.exec(block);
    assert.deepEqual(await modes(), expected, 'ordinary/always/replica/disabled modes restored exactly');
    assert.deepEqual(await oldRows(), before, 'mode variations preserve every original field');
    assert.deepEqual(await history(), beforeHistory, 'mode variations preserve audit and stock history');
  }
  // Reset only the fixture metadata through the same protected maintenance
  // block. The failure must undo real false-to-true changes, not an idempotent
  // replay of flags that were already true.
  const resetBlock = block.replace('set cost_refresh_pending=true', 'set cost_refresh_pending=false');
  assert.notEqual(resetBlock, block, 'fixture reset targets the backfill assignment');
  await db.exec(resetBlock);
  assert.equal((await rows()).filter(({ row }) => row.cost_refresh_pending).length, 0,
    'all fixture flags start false before the failing backfill');
  // Sequence advances survive rollback, proving that the second AFTER UPDATE
  // fired after both linked receipts underwent the intended flag transition.
  await db.exec(`create sequence pg_temp.backfill_failure_count;
    create function pg_temp.reject_purchase_backfill() returns trigger language plpgsql as $$
    begin
      if old.cost_refresh_pending is distinct from false or new.cost_refresh_pending is distinct from true then
        raise exception 'synthetic_backfill_missing_flag_transition';
      end if;
      if nextval('pg_temp.backfill_failure_count')=2 then
        raise exception 'synthetic_purchase_backfill_failure';
      end if;
      return null;
    end $$;
    create trigger zz_reject_purchase_backfill after update on public.purchases for each row execute function pg_temp.reject_purchase_backfill();`);
  const failureModes = await modes();
  const failureRows = await rows();
  await assert.rejects(db.exec(block), /synthetic_purchase_backfill_failure/);
  assert.equal(Number((await db.query('select last_value from pg_temp.backfill_failure_count')).rows[0].last_value), 2,
    'injected failure follows two actual flag changes');
  assert.deepEqual(await modes(), failureModes, 'failed DO restores targeted and unrelated trigger modes');
  assert.deepEqual(await rows(), failureRows, 'failed DO cannot partially change rows');
  assert.deepEqual(await history(), beforeHistory, 'failed DO preserves audit and stock history');
  await db.exec('drop trigger zz_reject_purchase_backfill on public.purchases');

  for (const name of targets) {
    await db.exec(`alter trigger ${quote(name)} on public.purchases rename to ${quote('missing_' + name)}`);
    const expected = await modes();
    await assert.rejects(db.exec(block), /purchase_cost_backfill_expected_triggers_missing/);
    assert.deepEqual(await modes(), expected, 'missing-trigger preflight changes no trigger modes');
    assert.deepEqual(await rows(), failureRows, 'missing-trigger preflight changes no rows');
    await db.exec(`alter trigger ${quote('missing_' + name)} on public.purchases rename to ${quote(name)}`);
  }
  console.log('PASS populated purchase metadata backfill; old fields/history preserved, all four trigger modes restored, failure and missing-trigger rollback verified');
} finally {
  await db.close();
}
