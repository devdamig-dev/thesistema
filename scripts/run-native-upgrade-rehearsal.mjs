/** Synthetic populated upgrade on the existing isolated PG17 harness; never accepts a database URL. */
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { nativeDatabase } from './native-postgres.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const validationOnly=process.argv.includes('--validate-pglite');
const drift=process.argv.includes('--legacy-debt-drift');
const files=(await readdir(join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort();
const baseline=files.filter(f=>f<='20261007201700_whatsapp_public_status.sql');
const pending=files.filter(f=>!baseline.includes(f));
assert.equal(baseline.length,52); assert.ok(pending.length>=19);
const chunks=[];
const addFile=async path=>chunks.push(await readFile(join(root,path),'utf8'));
await addFile('tests/upgrade/supabase-scaffolding.sql');
async function migration(file,transactional=false){
 const sql=await readFile(join(root,'supabase/migrations',file),'utf8');
 if(transactional) chunks.push('begin;\n'+sql+'\ncommit;');
 else {
  for(const statement of sql.match(/^alter type [^;]+ add value[^;]+;/gim)??[]) chunks.push(statement);
  chunks.push(sql);
 }
}
for(const file of baseline) await migration(file);
await addFile('tests/upgrade/baseline-fixtures.sql');
if(drift) chunks.push("update public.debts set status='active',pending_amount=645.50 where id=pg_temp.u(233); alter table public.debt_payments enable always trigger trg_debt_payments_updated;");
chunks.push(`
create temporary table upgrade_original_rows(table_name text primary key,column_list text,rows jsonb);
do $$ declare t record; original jsonb; begin
 for t in select table_name,string_agg(quote_ident(column_name),',' order by ordinal_position) cols
 from information_schema.columns where table_schema='public' and table_name in(select tablename from pg_tables where schemaname='public') group by table_name loop
 execute format('select coalesce(jsonb_agg(row order by row::text),''[]''::jsonb) from (select to_jsonb(t) row from (select %s from public.%I) t) rows',t.cols,t.table_name) into original;
 insert into upgrade_original_rows values(t.table_name,t.cols,original);
 end loop;
end $$;
create temporary table upgrade_trigger_modes as select tgname,tgenabled from pg_trigger where tgrelid='public.debt_payments'::regclass;
`);
for(const file of pending) await migration(file,true);
const preservation=`do $$ declare t record; current_rows jsonb; begin
 for t in select * from upgrade_original_rows loop
 execute format('select coalesce(jsonb_agg(row order by row::text),''[]''::jsonb) from (select to_jsonb(t) row from (select %s from public.%I) t) rows',t.column_list,t.table_name) into current_rows;
 if current_rows is distinct from t.rows then raise exception 'Historical columns changed in %',t.table_name; end if;
 end loop;
 if exists(select 1 from upgrade_trigger_modes m left join pg_trigger p on p.tgrelid='public.debt_payments'::regclass and p.tgname=m.tgname where p.tgenabled is distinct from m.tgenabled) then raise exception 'Historical trigger mode changed'; end if;
end $$;`;
chunks.push(preservation);
await addFile('tests/upgrade/post-upgrade.sql');
chunks.push(preservation);
chunks.push("select 'UPGRADE_PRESERVATION_OK';");
const db=validationOnly?new PGlite({extensions:{pgcrypto,pg_trgm}}):await nativeDatabase({docker:true});
try {
 if(validationOnly){for(const chunk of chunks) await db.exec(chunk);}
 else {
  // One psql session retains pg_temp helpers and snapshots. psql autocommit
  // commits each statement, matching actual migration execution semantics.
  const output=await db.exec(chunks.join('\n'));
  assert.ok(output.includes('UPGRADE_PRESERVATION_OK'));
 }
 const report={ok:true,engine:validationOnly?'PGlite validation of native SQL plan':'Isolated PostgreSQL17',fixture:drift?'legacy-debt-drift':'representative-legacy',baseline:baseline.length,pending:pending.length,scope:'Synthetic repository-shaped upgrade; not a production schema clone',preserved:'All baseline public columns and rows, debt payment trigger modes, plus post-upgrade legacy authorization contracts'};
 const directory=join(root,'.test-artifacts',`upgrade-${validationOnly?'plan':'native'}${drift?'-drift':''}`);
 await mkdir(directory,{recursive:true}); await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
 console.log('PASS',JSON.stringify(report));
} finally {await db.close();}
