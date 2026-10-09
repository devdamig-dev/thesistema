/**
 * Offline PostgreSQL sales/RLS regression suite. No credentials, network, or
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
import { verifyExpensesConcurrency } from "./verify-expenses-concurrency.mjs";


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
const native = process.argv.includes("--native-concurrency") || process.argv.includes("--native-docker");
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

  stage = "supabase/tests/expenses.sql";
  await db.exec(await readFile(join(root, stage), "utf8"));

  if (native) await verifyExpensesConcurrency(db);
  console.log(`PASS expenses SQL suite (${files.length} real migrations, isolated PostgreSQL, rolled-back fixtures)`);
} catch (error) {
  console.error(`FAIL ${stage}: ${error.message}`);
  if (error.position) { const source = await readFile(join(migrations, stage), "utf8").catch(() => ""); console.error(`Position: ${error.position}: ${source.slice(Math.max(0, Number(error.position)-200), Number(error.position)+200)}`); }
  if (error.detail) console.error(`Detail: ${error.detail}`);
  if (error.where) console.error(`Where: ${error.where}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
