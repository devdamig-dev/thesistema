/**
 * Offline PostgreSQL debt-plan/RLS regression suite. No credentials, network, or
 * external database are used: PGlite lives only in memory and closes on exit.
 * Supabase's managed auth/storage scaffolding is represented below; application
 * tables, grants, RLS, functions and triggers come from real migration files.
 * This is not a multi-session concurrency or full Supabase service emulator.
 */
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { nativeDatabase } from "./native-postgres.mjs";
import { verifyWhatsAppPendingConcurrency } from "./verify-whatsapp-pending-concurrency.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const migrations = join(root, "supabase", "migrations");
const scaffolding = `
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema storage;
    create table storage.buckets (
      id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]
    );
    create table storage.objects (id uuid primary key, bucket_id text, name text);
    create schema auth;
    create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.role() returns text language sql stable as $$
      select current_user::text
    $$;
    grant usage on schema public, auth to authenticated, anon, service_role;
    grant execute on function auth.uid(), auth.role() to authenticated, anon, service_role;
    alter default privileges in schema public grant all on tables to authenticated, service_role;
    create publication supabase_realtime;
  `;
const native = process.argv.some((arg) => ["--native-concurrency", "--native-docker", "--native"].includes(arg));
const db = native ? await nativeDatabase({ docker: process.argv.includes("--native-docker") }) : new PGlite({ extensions: { pgcrypto, pg_trgm } });
let stage = "managed Supabase scaffolding";

try {
  await db.exec(scaffolding);

  const files = (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort();
  for (const file of files) {
    stage = file;
    const sql = await readFile(join(migrations, file), "utf8");
    // Historical migrations contain ADD VALUE followed by use of that value.
    // Commit those idempotent enum additions first, matching statement-wise
    // migration execution and avoiding PostgreSQL's unsafe-new-enum-value rule.
    const enumAdds = sql.match(/^alter type [^;]+ add value[^;]+;/gim) ?? [];
    for (const statement of enumAdds) await db.exec(statement);
    await db.exec(sql);
    console.log(`Applied locally: ${file}`);
  }

  stage = "supabase/tests/debt-plans.sql";
  await db.exec(await readFile(join(root, stage), "utf8"));
  stage = "supabase/tests/debt-inbox.sql";
  await db.exec(await readFile(join(root, stage), "utf8"));
  stage = "supabase/tests/whatsapp-pending.sql";
  await db.exec(await readFile(join(root, stage), "utf8"));
  if (native) { await verifyConcurrentSessions(db); await verifyWhatsAppPendingConcurrency(db); }
  console.log(`PASS debt plans SQL suite (${files.length} real migrations, isolated PostgreSQL, rolled-back fixtures)`);
} catch (error) {
  console.error(`FAIL ${stage}: ${error.message}`);
  if (error.position) { const source = await readFile(join(migrations, stage), "utf8").catch(() => ""); console.error(`Position: ${error.position}: ${source.slice(Math.max(0, Number(error.position)-200), Number(error.position)+200)}`); }
  if (error.detail) console.error(`Detail: ${error.detail}`);
  if (error.where) console.error(`Where: ${error.where}`);
  process.exitCode = 1;
} finally {
  await db.close();
}

/**
 * Optional true multi-session run, entirely ephemeral and offline:
 *   PG_BIN=/usr/lib/postgresql/17/bin node scripts/run-debt-plans-sql.mjs --native-concurrency
 * Requires PostgreSQL 17 binaries and pgcrypto/pg_trgm extensions.
 * No URL, password or production connection is accepted. initdb creates a
 * disposable cluster with a private Unix socket and TCP disabled. The separate
 * --native-docker flag uses the verified local Docker socket with an isolated
 * official PostgreSQL 17 container; it never accepts an external Docker context.
 */
async function verifyConcurrentSessions(db) {
  const full = await readFile(join(root, "supabase/tests/debt-plans.sql"), "utf8");
  const prefix = full.slice(0, full.indexOf("\ndo $$\ndeclare r jsonb;"));
  if (!prefix.includes("set local role authenticated")) throw new Error("Concurrency fixture boundary missing");
  await db.exec(`create schema debt_test; grant usage on schema debt_test to authenticated;\n${prefix.replaceAll("pg_temp.", "debt_test.")}\ncommit;`);
  const auth = `set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);`;
  const newDebt = async () => {
    const out = await db.exec(`begin; ${auth} select public.create_debt_installment_plan(debt_test.payload(),gen_random_uuid()); commit;`);
    const result = out.split("\n").filter((line) => line.startsWith("{" )).map((line) => JSON.parse(line)).at(-1);
    if (!result?.ok) throw new Error(`Concurrency create failed: ${out}`);
    return result.debt_id;
  };
  const parsed = (out) => out.split("\n").filter((line) => line.startsWith("{")).map((line) => JSON.parse(line)).at(-1);
  const assert = (condition, message) => { if (!condition) throw new Error(`CONCURRENCY ASSERTION: ${message}`); };
  const race = async (debtId, firstSql, secondSql) => {
    let sawMarker;
    const marker = new Promise((resolve) => { sawMarker = resolve; });
    const first = db.session(`begin; ${auth} select id from public.debts where id='${debtId}' for update; select 'LOCK_ACQUIRED'; select pg_sleep(1); ${firstSql}; commit;`, (out) => { if (out.includes("LOCK_ACQUIRED")) sawMarker(); });
    await Promise.race([marker, first.promise.then((result) => { if (!result.stdout.includes("LOCK_ACQUIRED")) throw new Error(`First session failed before lock: ${result.stderr}`); })]);
    const second = db.session(`begin; set local application_name='debt_plan_race_b'; ${auth} ${secondSql}; commit;`);
    let observedLock = false;
    for (let attempt = 0; attempt < 12 && !observedLock; attempt++) {
      const state = await db.exec("select pg_sleep(0.04); select exists(select 1 from pg_stat_activity where application_name='debt_plan_race_b' and wait_event_type='Lock');");
      observedLock = state.split("\n").includes("t");
    }
    const [a, b] = await Promise.all([first.promise, second.promise]);
    assert(observedLock, "second independent PostgreSQL session actually waited on a lock");
    assert(a.code === 0, a.stderr);
    return [a, b];
  };
  let id = await newDebt();
  let [a, b] = await race(id,
    `select public.register_debt_plan_payment('${id}',0,debt_test.payment(6000),gen_random_uuid())`,
    `select public.register_debt_plan_payment('${id}',0,debt_test.payment(6000),gen_random_uuid())`);
  assert(parsed(a.stdout)?.ok && parsed(b.stdout)?.error === "stale_version", "competing CAS payments serialize with one stale result");
  await db.exec(`select debt_test.assert_true((select pending_amount=40 and plan_version=1 from public.debts where id='${id}'),'one payment committed');`);
  id = await newDebt();
  const request = "00000000-0000-4000-8000-000000000091";
  const same = `select public.register_debt_plan_payment('${id}',0,debt_test.payment(6000),'${request}')`;
  [a, b] = await race(id, same, same);
  assert(parsed(a.stdout)?.ok && parsed(b.stdout)?.idempotent, "concurrent retry is idempotent");
  await db.exec(`select debt_test.assert_true((select count(*)=1 from public.debt_payments where debt_id='${id}'),'one idempotent payment');`);
  id = await newDebt();
  const direct = `insert into public.debt_payments(debt_id,business_id,branch_id,currency,amount,paid_at,payment_method,origin,allocation_rule,request_id) values('${id}','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','ARS',60,current_date,'Transferencia','manual','oldest_due',gen_random_uuid())`;
  [a, b] = await race(id, direct, direct);
  assert(b.code !== 0 && b.stderr.includes("amount_exceeds_pending"), "direct Data API writes cannot overpay concurrently");
  await db.exec(`select debt_test.assert_true((select pending_amount=40 from public.debts where id='${id}'),'direct race balance consistent');`);
  id = await newDebt();
  const payment = parsed(await db.exec(`begin; ${auth} select public.register_debt_plan_payment('${id}',0,debt_test.payment(6000),gen_random_uuid()); commit;`));
  assert(payment?.ok, "prepare void race");
  [a, b] = await race(id,
    `select public.void_debt_plan_payment('${id}','${payment.payment_id}',1,'Race test',gen_random_uuid())`,
    `select public.register_debt_plan_payment('${id}',1,debt_test.payment(4000),gen_random_uuid())`);
  assert(parsed(a.stdout)?.ok && parsed(b.stdout)?.error === "stale_version", "void/payment race respects parent CAS");
  await db.exec(`select debt_test.assert_true((select pending_amount=100 and plan_version=2 from public.debts where id='${id}'),'void race reopened consistent balance');`);
  console.log("PASS native multi-session concurrency: CAS, concurrent retries, direct-write overpay, void/payment race (observed lock waits)");
}
