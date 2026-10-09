/** Independent-session MVCC regression. Only the disposable native test DB. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const business = "10000000-0000-4000-8000-000000000021";
const actor = "10000000-0000-4000-8000-000000000001";
const product = "10000000-0000-4000-8000-000000000061";
const asOwner = (sql) => `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${actor}',true); ${sql}; commit;`;
const jsonLine = (result) => JSON.parse(result.trim().split("\n").findLast(line => line.startsWith("{")));

export async function runCatalogSnapshotConcurrency(db) {
  await db.exec("begin;" + await readFile(new URL("../supabase/tests/catalog-snapshot-fixtures.sql",import.meta.url),"utf8") + "commit;");
  // A test-only restrictive policy pauses the reader after its statement
  // snapshot exists. The refresh session is not paused and uses the real RPC.
  await db.exec(`
    create function public.catalog_snapshot_test_pause() returns boolean language plpgsql volatile security invoker as $$ begin
      if current_setting('application_name')='catalog_snapshot_reader' then perform pg_advisory_xact_lock(872341); end if;
      return true;
    end $$;
    create policy catalog_snapshot_test_pause on public.products as restrictive for select to authenticated
      using(public.catalog_snapshot_test_pause());
  `);
  let holder, reader;
  try {
    const legacyCost=jsonLine(await db.exec(asOwner(`select jsonb_build_object('cost',cost) from public.products where id='${product}'`))).cost;
    holder=db.session("set application_name='catalog_snapshot_holder'; select pg_advisory_lock(872341); select pg_sleep(30);");
    const waitFor = async (sql,label) => {
      for(let attempt=0;attempt<150;attempt++) {
        if((await db.exec(sql)).trim()==="t") return;
        await new Promise(resolve=>setTimeout(resolve,40));
      }
      throw new Error(`Timed out waiting for ${label}`);
    };
    await waitFor("select exists(select 1 from pg_stat_activity where application_name='catalog_snapshot_holder' and wait_event='PgSleep');","holder lock");
    reader=db.session(`set application_name='catalog_snapshot_reader'; set statement_timeout='15s'; ${asOwner(`select public.read_product_catalog_snapshot('${business}')`)}`);
    await waitFor("select exists(select 1 from pg_stat_activity where application_name='catalog_snapshot_reader' and wait_event='advisory');","reader paused in its snapshot");
    await db.exec(asOwner(`select public.refresh_purchase_costs_atomic('${business}')`));
    const legacyPending=jsonLine(await db.exec(asOwner(`select jsonb_build_object('pending',exists(select 1 from public.purchases where business_id='${business}' and cost_refresh_pending))`))).pending;
    assert.deepEqual([legacyCost,legacyPending],[10,false],"the original split-read race is genuinely reproduced");
    const fresh=jsonLine(await db.exec(asOwner(`select public.read_product_catalog_snapshot('${business}')`)));
    assert.deepEqual([fresh.products[0].cost,fresh.costRefreshPending],[20,false],"refresh commits matching new cost and warning state");
    await db.exec("select pg_terminate_backend(pid) from pg_stat_activity where application_name='catalog_snapshot_holder';");
    const old=await reader.promise;
    assert.equal(old.code,0,old.stderr);
    const snapshot=jsonLine(old.stdout);
    assert.deepEqual([snapshot.products[0].cost,snapshot.costRefreshPending],[10,true],"in-flight catalog retains both values from its original snapshot");
    assert.equal(snapshot.products[0].ingredientCount,1);
    assert.equal(snapshot.products[1].recipeNeedsReview,true);
    console.log("PASS catalog snapshot independent-session refresh race (legacy mismatch reproduced; atomic old/new pairs verified)");
  } finally {
    await db.exec("select pg_terminate_backend(pid) from pg_stat_activity where application_name in ('catalog_snapshot_holder','catalog_snapshot_reader');");
    await Promise.all([holder?.promise,reader?.promise]);
    await db.exec("drop policy catalog_snapshot_test_pause on public.products; drop function public.catalog_snapshot_test_pause();");
  }
}
