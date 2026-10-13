/**
 * Populated baseline upgrade rehearsal, exclusively in an in-memory PGlite DB.
 * No credentials, network, sockets, external database or production data.
 * Historical repository chain is NOT claimed to equal deployed production schema.
 */
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const db=new PGlite({extensions:{pgcrypto,pg_trgm}});
const baselineEnd='20261007201700_whatsapp_public_status.sql';
const report={scope:'Repository baseline-shaped synthetic upgrade; not a production-schema clone',baselineEnd,baseline:[],pending:[],tables:[],preservation:[],suites:[],contracts:[],limitations:['Managed auth/storage scaffolding is simulated.','PGlite does not validate native multi-session concurrency, PostgREST, managed Supabase or production schema drift.','This uses 52 repository baseline migrations and is not a deployed-schema clone.']};
const driftProbe=process.argv.includes('--legacy-debt-drift');
report.fixtureVariant=driftProbe?'legacy-debt-drift':'representative-legacy';
const outputDirectory=join(root,'.test-artifacts',driftProbe?'upgrade-debt-drift':'upgrade');
let stage='scaffolding';
const quote=x=>'"'+x.replaceAll('"','""')+'"';
async function apply(file, list){
  stage=file;
  const sql=await readFile(join(root,'supabase/migrations',file),'utf8');
  if(file<=baselineEnd){
   for(const statement of sql.match(/^alter type [^;]+ add value[^;]+;/gim)??[]) await db.exec(statement);
   await db.exec(sql);
  } else {
   // Every new migration must work as one transaction, as the deployment RPC does.
   await db.exec('begin;\n'+sql+'\ncommit;');
  }
  list.push({file,sha256:createHash('sha256').update(sql).digest('hex')});
}
async function verifyBackfillSafety(){
 const sql=await readFile(join(root,'supabase/migrations/20261009004420_debt_installment_plans.sql'),'utf8');
 const block=sql.match(/do \$backfill\$[\s\S]*?\$backfill\$;/)?.[0];
 assert.ok(block,'metadata backfill must be a single atomic DO statement');
 const readModes=async()=>(await db.query("select tgname,tgenabled from pg_trigger where tgrelid='public.debt_payments'::regclass order by tgname")).rows;
 const modes=await readModes();
 const targetNames=['trg_debt_payments_recalc','trg_debt_payments_updated'];
 const modeCommand={O:'enable',A:'enable always',R:'enable replica',D:'disable'};
 const setMode=async(name,mode)=>{assert.ok(modeCommand[mode]);await db.exec(`alter table public.debt_payments ${modeCommand[mode]} trigger ${quote(name)}`);};
 const readOldRows=async()=>(await db.query("select to_jsonb(p)-array['business_id','branch_id'] as row from public.debt_payments p order by id")).rows;
 const paymentRows=await readOldRows();
 const debtRows=(await db.query('select to_jsonb(d) as row from public.debts d order by id')).rows;
 await db.exec('alter table public.debt_payments add column business_id uuid,add column branch_id uuid');
 // Exercise every documented enable mode, without touching other triggers.
 for(const pair of [['O','O'],['A','R'],['R','D'],['D','A']]){
  for(let i=0;i<targetNames.length;i++) await setMode(targetNames[i],pair[i]);
  const expectedModes=await readModes();
  await db.exec(block);
  assert.deepEqual(await readModes(),expectedModes,'successful backfill restores ordinary/always/replica/disabled modes');
  assert.deepEqual(await readOldRows(),paymentRows,'successful scope backfill preserves all old payment columns');
  assert.deepEqual((await db.query('select to_jsonb(d) as row from public.debts d order by id')).rows,debtRows,'successful scope backfill preserves all old debt columns');
 }
 for(const row of modes.filter(t=>targetNames.includes(t.tgname))) await setMode(row.tgname,row.tgenabled);
 await db.exec(`create function pg_temp.reject_upgrade_scope() returns trigger language plpgsql as $$ begin raise exception 'synthetic_scope_backfill_failure'; end $$;
  create trigger zz_reject_upgrade_scope before update on public.debt_payments for each row execute function pg_temp.reject_upgrade_scope();`);
 const before=(await db.query('select to_jsonb(p) as row from public.debt_payments p order by id')).rows;
 await assert.rejects(db.exec(block),/synthetic_scope_backfill_failure/);
 assert.deepEqual((await db.query('select to_jsonb(p) as row from public.debt_payments p order by id')).rows,before,'failed backfill cannot partially change rows');
 await db.exec('drop trigger zz_reject_upgrade_scope on public.debt_payments');
 assert.deepEqual(await readModes(),modes,'failed atomic block must restore every original trigger state');
 await db.exec('alter trigger trg_debt_payments_updated on public.debt_payments rename to temporarily_missing_upgrade_trigger');
 await assert.rejects(db.exec(block),/debt_scope_backfill_expected_legacy_triggers_missing/);
 await db.exec('alter trigger temporarily_missing_upgrade_trigger on public.debt_payments rename to trg_debt_payments_updated');
 assert.deepEqual(await readModes(),modes,'missing-trigger failure must leave trigger states unchanged');
 await db.exec('alter table public.debt_payments drop column business_id,drop column branch_id');
 report.contracts.push('Backfill preserves all four trigger modes; injected failure and missing-trigger preflight leave data/states unchanged');
}
async function snapshot(tables){
 const result={};
 for(const {table,columns} of tables){
  const {rows}=await db.query(`select to_jsonb(t) as row from (select ${columns.map(quote).join(',')} from public.${quote(table)}) t order by to_jsonb(t)::text`);
  result[table]=rows.map(r=>r.row);
 }
 return result;
}
try{
 await db.exec(await readFile(join(root,'tests/upgrade/supabase-scaffolding.sql'),'utf8'));
 const files=(await readdir(join(root,'supabase/migrations'))).filter(f=>f.endsWith('.sql')).sort();
 const baseline=files.filter(f=>f<=baselineEnd); const pending=files.filter(f=>f>baselineEnd);
 assert.equal(baseline.length,52); assert.ok(pending.length>=19,"management upgrade migrations must be present");
 for(const f of baseline) await apply(f,report.baseline);
 report.engine=(await db.query('select version()')).rows[0].version;
 stage='baseline synthetic seed';
 await db.exec(await readFile(join(root,'tests/upgrade/baseline-fixtures.sql'),'utf8'));
 if(driftProbe) await db.exec("update public.debts set status='active',pending_amount=645.50 where id=pg_temp.u(233); alter table public.debt_payments enable always trigger trg_debt_payments_updated");
 const triggerModes=(await db.query("select tgname,tgenabled from pg_trigger where tgrelid='public.debt_payments'::regclass and tgname in ('trg_debt_payments_updated','trg_debt_payments_recalc') order by tgname")).rows;
 const {rows:tables}=await db.query(`select table_name as table, array_agg(column_name order by ordinal_position) as columns from information_schema.columns where table_schema='public' and table_name in(select tablename from pg_tables where schemaname='public') group by table_name order by table_name`);
 report.tables=tables;
 const columnShape=(await db.query(`select table_name, string_agg(column_name||':'||udt_name||case when is_nullable='YES' then '?' else '' end,', ' order by ordinal_position) as columns from information_schema.columns where table_schema='public' group by table_name order by table_name`)).rows;
 const metadataFlag=process.argv.indexOf('--metadata');
 if(metadataFlag!==-1){
  const production=JSON.parse(await readFile(process.argv[metadataFlag+1],'utf8'));
  report.columnComparison=production.map(p=>({table:p.table_name,match:columnShape.find(t=>t.table_name===p.table_name)?.columns===p.columns,baseline:columnShape.find(t=>t.table_name===p.table_name)?.columns??null,observed:p.columns}));
  console.log('Observed column shape matches:',report.columnComparison.filter(p=>p.match).length,'/',production.length);
 }
 stage='backfill safety probes';
 await verifyBackfillSafety();
 const before=await snapshot(tables);
 report.seedCounts=Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.length]).filter(([,v])=>v));
 console.log(`Seeded ${Object.values(report.seedCounts).reduce((a,b)=>a+b,0)} synthetic rows across ${Object.keys(report.seedCounts).length} baseline tables`);
 for(const f of pending){await apply(f,report.pending);console.log(`Upgrade applied: ${f}`);}
 stage='preservation comparison';
 const after=await snapshot(tables);
 for(const {table} of tables){
  const oldRows=before[table],newRows=after[table];
  assert.equal(newRows.length,oldRows.length,`${table}: historical row count`);
  const changed=[];
  for(const old of oldRows){
   const now=newRows.find(r=>r.id===old.id);
   assert.ok(now,`${table}: ${old.id} preserved`);
   for(const key of Object.keys(old)) if(JSON.stringify(old[key])!==JSON.stringify(now[key])) changed.push({id:old.id,column:key,before:old[key],after:now[key]});
  }
  report.preservation.push({table,rows:oldRows.length,changed});
 }
 const changed=report.preservation.filter(p=>p.changed.length);
 console.log('Historical changes:',JSON.stringify(changed,null,2));
 assert.deepEqual(changed,[],'all historical columns, including debt amounts/status and timestamps, must be unchanged');
 assert.deepEqual((await db.query("select tgname,tgenabled from pg_trigger where tgrelid='public.debt_payments'::regclass and tgname in ('trg_debt_payments_updated','trg_debt_payments_recalc') order by tgname")).rows,triggerModes,'backfill restores exact trigger modes');
 report.preservedTriggerModes=triggerModes;
 report.preservedBusinessFields=true;
 stage='upgrade contracts';
 await db.exec(await readFile(join(root,'tests/upgrade/post-upgrade.sql'),'utf8'));
 report.contracts.push('Post-upgrade legacy contracts passed');
 assert.deepEqual(await snapshot(tables),after,'rolled-back legacy-contract tests preserve upgraded fixtures');
 // Existing suites intentionally assert global counts and require an empty DB.
 // Clear ONLY this disposable in-memory fixture database after preservation has
 // been proved. Retain the schema installed over populated baseline tables.
 stage='clear isolated synthetic rows for existing regression suites';
 await db.exec('TRUNCATE TABLE '+tables.map(t=>'public.'+quote(t.table)).concat('auth.users').join(',')+' CASCADE');
 report.regressionFixtureMode='Synthetic legacy rows removed from disposable PGlite only after preservation checks; upgraded schema retained. Each existing suite rolls back its own fixtures.';
 for(const suite of ['catalog','catalog-products','catalog-snapshot','stock-ledger','replenishment','customers','suppliers','debt-plans','debt-inbox','debt-pending','whatsapp-pending','sales','employees','closures','expenses','expense-operating-fields','purchases','invoice-manual','purchase-transports','purchase-spec-parity','inbox-advances']){
  stage=`supabase/tests/${suite}.sql`;
  const prefix=suite==='catalog-snapshot'?'begin;\n'+await readFile(join(root,'supabase/tests/catalog-snapshot-fixtures.sql'),'utf8'):'';
  await db.exec(prefix+await readFile(join(root,stage),'utf8'));
  report.suites.push(suite); console.log(`PASS post-upgrade ${suite}`);
 }
 assert.ok(Object.values(await snapshot(tables)).every(rows=>rows.length===0),'regression fixtures rolled back');
 report.ok=true;
 console.log(`PASS populated baseline ${baseline.length} + upgrade ${pending.length}; ${report.suites.length} SQL suites`);
}catch(error){report.ok=false;report.failure={stage,message:error.message,detail:error.detail,where:error.where};console.error('FAIL',JSON.stringify(report.failure,null,2));process.exitCode=1;}
finally{await mkdir(outputDirectory,{recursive:true});await writeFile(join(outputDirectory,'report.json'),JSON.stringify(report,null,2));await db.close();}
