/**
 * Independent-session debt pending races, called only by the disposable native
 * PostgreSQL runner. This file cannot connect to a URL or production database.
 * A PGlite pass does not execute or prove these concurrency checks.
 */
import { readFile } from "node:fs/promises";

export async function verifyDebtPendingConcurrency(db) {
  const business = "00000000-0000-4000-8000-000000003001";
  const member = "00000000-0000-4000-8000-000000003003";
  const conversation = "00000000-0000-4000-8000-000000003004";
  const actor = "00000000-0000-4000-8000-000000003002";
  const branch = "00000000-0000-4000-8000-000000003005";
  const fixtures = await readFile(new URL("../supabase/tests/debt-pending.sql", import.meta.url), "utf8");
  const boundary = fixtures.indexOf("-- DEBT_PENDING_FIXTURE_END");
  if (boundary < 0) throw new Error("Debt pending concurrency fixture boundary missing");
  const prefix = fixtures.slice(0, boundary).replaceAll("pg_temp.", "debt_pending_test.");
  await db.exec(`create schema debt_pending_test; grant usage on schema debt_pending_test to service_role; ${prefix} commit;`);
  const assert = (ok, message) => { if (!ok) throw new Error(`DEBT PENDING CONCURRENCY: ${message}`); };
  const objects = (output) => output.split(/\r?\n/).filter((line) => line.startsWith("{")).map((line) => JSON.parse(line));
  const last = (output) => objects(output).at(-1);
  const service = (sql) => db.exec(`begin; set local role service_role; ${sql} commit;`);
  const claim = (id, recovery = false) => `select jsonb_build_object('claim',public.claim_debt_pending_execution('${business}','${member}','${conversation}','${id}',${recovery}));`;
  const cancel = (id) => `select public.cancel_debt_pending_execution('${business}','${member}','${conversation}','${id}');`;
  const scopeLock = `select pg_advisory_xact_lock(hashtextextended('whatsapp-pending:${business}:${member}:${conversation}',0));`;
  const fresh = async () => {
    const result = last(await service(`select jsonb_build_object('id',debt_pending_test.debt_pending_new());`));
    assert(typeof result?.id === "string", "fixture creates an exact pending ID");
    return result.id;
  };
  const current = async (id) => last(await db.exec(`select jsonb_build_object('id',id,'request',arguments->>'requestId','uncertain',arguments->'__resultUncertain','consumed',consumed_at is not null) from public.whatsapp_agent_pending_operations where id='${id}';`));
  const requireSession = async (session) => {
    const result = await session.promise;
    assert(result.code === 0, result.stderr || result.stdout || "session failed");
    return result;
  };
  const observeLock = async (application) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = await db.exec(`select pg_sleep(0.04); select exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event_type='Lock');`);
      if (state.split(/\r?\n/).includes("t")) return true;
    }
    return false;
  };
  // The first transaction holds the real lock acquired by its SQL, and a second
  // independently connected PostgreSQL backend must be observed waiting on it.
  const race = async (label, firstSql, secondSql) => {
    let markerSeen;
    const marker = new Promise((resolve) => { markerSeen = resolve; });
    const first = db.session(`begin; set local role service_role; ${firstSql} select 'DEBT_PENDING_LOCK_HELD'; select pg_sleep(1.5); commit;`, (out) => {
      if (out.includes("DEBT_PENDING_LOCK_HELD")) markerSeen();
    });
    await Promise.race([marker, first.promise.then((result) => {
      if (!result.stdout.includes("DEBT_PENDING_LOCK_HELD")) throw new Error(result.stderr || "First debt pending session failed before its lock marker");
    })]);
    const application = `debt_pending_${label}`;
    const second = db.session(`begin; set local application_name='${application}'; set local role service_role; ${secondSql} commit;`);
    const observed = await observeLock(application);
    const results = await Promise.all([requireSession(first), requireSession(second)]);
    assert(observed, `${label}: the independent second session actually waited on a lock`);
    return results.map((result) => objects(result.stdout));
  };
  try {
    let id = await fresh();
    let [first, second] = await race("fresh", claim(id), claim(id));
    assert(first[0]?.claim === true && second[0]?.claim === false, "fresh confirmations have exactly one CAS winner");
    assert((await current(id)).uncertain === true && !(await current(id)).consumed, "winner leaves a durable reference before any RPC");
    await service(cancel(id));

    id = await fresh();
    [first, second] = await race("cancel_first", cancel(id), claim(id));
    assert(first[0]?.consumed === true && first[0]?.resultUncertain === false && second[0]?.claim === false, "cancel before claim prevents any start");

    id = await fresh();
    [first, second] = await race("claim_first", claim(id), cancel(id));
    assert(first[0]?.claim === true && second[0]?.consumed === true && second[0]?.resultUncertain === true, "cancel after claim reads current uncertainty, not its old snapshot");
    assert(last(await service(claim(id, true)))?.claim === false, "canceled recovery cannot resurrect its ID");

    id = await fresh();
    assert(last(await service(claim(id)))?.claim === true, "crash fixture retains a committed marker before financial RPC");
    const snapshot = await current(id);
    [first, second] = await race("recovery", claim(id, true), claim(id, true));
    assert(first[0]?.claim === true && second[0]?.claim === true, "both recoveries reuse the original pending ID");
    assert((await current(id)).request === snapshot.request, "concurrent recovery preserves prepared request UUID");
    // Both recovery claims committed. Now race the real financial RPC in two
    // independent transactions; observing the domain lock proves idempotency,
    // rather than merely serializing the calls behind the pending-scope lock.
    const rpc = `select public.create_debt_installment_plan(debt_pending_test.debt_pending_plan(),'${snapshot.request}','${actor}');`;
    [first, second] = await race("financial_rpc", rpc, rpc);
    assert(first[0]?.ok === true && second[0]?.ok === true && second[0]?.idempotent === true && first[0]?.debt_id === second[0]?.debt_id,
      "simultaneous recovery RPCs return one debt identity and an idempotent replay");
    const persisted = last(await db.exec(`select jsonb_build_object(
      'debts',(select count(*) from public.debts where business_id='${business}' and plan_request_id='${snapshot.request}'),
      'audits',(select count(*) from public.activity_logs where target_id='${first[0].debt_id}' and action='debt.plan.created'));
    `));
    assert(persisted?.debts === 1 && persisted?.audits === 1, "one committed financial row and one audit after simultaneous recovery");
    assert(last(await service(claim(id, true)))?.claim === true, "crash after financial commit still recovers original reference");
    const afterCommit = last(await service(rpc));
    assert(afterCommit?.ok === true && afterCommit?.idempotent === true && afterCommit?.debt_id === first[0]?.debt_id, "post-commit lost reply does not create another financial record");

    // Late results for the old reference must not consume or claim the request
    // installed after cancellation. Both operations share the replacement lock.
    const oldId = id;
    [first, second] = await race("replace_stale", `${cancel(oldId)} select jsonb_build_object('id',debt_pending_test.debt_pending_new());`, `${claim(oldId, true)} ${cancel(oldId)}`);
    id = first.find((result) => result.id)?.id;
    assert(typeof id === "string" && id !== oldId, "replacement has a distinct pending ID");
    assert(second[0]?.claim === false && second[1]?.consumed === false, "late recovery and cancellation cannot operate on replacement");
    const replacement = await current(id);
    assert(replacement?.uncertain === null && replacement?.consumed === false, "new request remains untouched by old results");
    await service(cancel(id));

    // A claimant that started before expiry must still fail if it waits past
    // expiry on the scope lock; now() alone would use the transaction start.
    id = await fresh();
    [first, second] = await race("expiry_wait", `${scopeLock} update public.whatsapp_agent_pending_operations set expires_at=clock_timestamp()+interval '0.3 seconds' where id='${id}';`, claim(id));
    assert(second[0]?.claim === false && (await current(id)).uncertain === null, "expiry is rechecked using wall-clock time after the lock wait");
    await service(cancel(id));

    const revocations = [
      { label: "role", revoke: `update public.business_members set role='viewer' where id='${member}';`, restore: `update public.business_members set role='owner' where id='${member}';`, recovery: false },
      { label: "module", revoke: `update public.business_modules set enabled=false where business_id='${business}' and module_key='debts';`, restore: `update public.business_modules set enabled=true where business_id='${business}' and module_key='debts';`, recovery: true, cancelAllowed: true },
      { label: "profile", revoke: `update public.profiles set active=false where id='${actor}';`, restore: `update public.profiles set active=true where id='${actor}';`, recovery: true },
      { label: "conversation", revoke: `update public.whatsapp_authorized_conversations set enabled=false where id='${conversation}';`, restore: `update public.whatsapp_authorized_conversations set enabled=true where id='${conversation}';`, recovery: true },
      { label: "branch", revoke: `update public.whatsapp_authorized_conversations set branch_id='00000000-0000-4000-8000-000000003006' where id='${conversation}';`, restore: `update public.whatsapp_authorized_conversations set branch_id='${branch}' where id='${conversation}';`, recovery: true },
    ];
    for (const change of revocations) {
      id = await fresh();
      if (change.recovery) assert(last(await service(claim(id)))?.claim === true, "revocation fixture starts uncertain");
      [first, second] = await race(`revoke_${change.label}`, `${scopeLock} ${change.revoke}`, `${claim(id, change.recovery)} ${cancel(id)}`);
      assert(second[0]?.claim === false && second[1]?.consumed === Boolean(change.cancelAllowed), `${change.label} revocation is observed after lock wait for claim and cancellation`);
      if (change.cancelAllowed) assert(second[1]?.resultUncertain === true, "module pause permits stopping recovery without a rollback promise");
      await db.exec(change.restore);
      await service(cancel(id));
    }
    console.log("PASS native durable debt pending: fresh CAS, cancellation before/after claim, simultaneous recovery plus real same-UUID financial RPC, lost commit reply, protected replacement, expiry and permission revocation after observed independent-session lock waits.");
  } finally {
    // Financial history intentionally cannot be deleted. The owning native
    // runner destroys this entire disposable cluster in its finally block.
    await db.exec("drop schema debt_pending_test cascade;");
  }
}
