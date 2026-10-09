/** Independent connections to the runner's disposable native PostgreSQL only.
 * PGlite intentionally does not run these cases or stand in for lock evidence. */
import { readFile } from 'node:fs/promises';

export async function verifyPurchaseTransportsConcurrency(db) {
  const fixture = await readFile(new URL('../supabase/tests/purchase-transports.sql', import.meta.url), 'utf8');
  const boundary = fixture.indexOf('set local role authenticated;');
  if (boundary < 0 || typeof db.session !== 'function') throw new Error('Native purchase transport fixture/session unavailable');
  await db.exec(`${fixture.slice(0, boundary)}\ncommit;`);
  const b = '00000000-0000-4000-8000-000000000011', actor = '00000000-0000-4000-8000-000000000001';
  const branch = '00000000-0000-4000-8000-000000000021', c = '00000000-0000-4000-8000-000000000801';
  const message = '00000000-0000-4000-8000-000000000802', extraction = '00000000-0000-4000-8000-000000000803';
  const literal = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
  const parse = output => output.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line)).at(-1);
  const assert = (ok, text) => { if (!ok) throw new Error(`Purchase transport concurrency: ${text}`); };
  const service = "set local role service_role;select set_config('request.jwt.claim.sub','',true);";
  const auth = `set local role authenticated;select set_config('request.jwt.claim.sub','${actor}',true);`;
  await db.exec(`insert into public.business_modules(business_id,module_key,enabled) values('${b}','inbox_ai',true) on conflict(business_id,module_key) do update set enabled=true;
    insert into public.whatsapp_authorized_conversations(id,business_id,branch_id,provider,provider_conversation_id,conversation_type) values('${c}','${b}','${branch}','internal','purchase-concurrency','direct');
    insert into public.whatsapp_messages(id,business_id,branch_id,sender_name,channel,raw) values('${message}','${b}','${branch}','Fixture','text','Fictitious purchase');
    insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status) values('${extraction}','${message}','${b}','${branch}','purchase','{"quantity":500,"unit":"g"}','pending');`);
  const member = (await db.exec(`select id from public.business_members where business_id='${b}' and user_id='${actor}';`)).trim();
  assert(/^[0-9a-f-]{36}$/.test(member), 'expected exact fixture member ID');
  const summary = { kind: 'summary', branchId: branch, supplierId: '00000000-0000-4000-8000-000000000040', purchasedAt: '2026-10-09', paymentMethod: 'Efectivo', amount: '45.67' };
  const scopeLock = `select pg_advisory_xact_lock(hashtextextended('whatsapp-pending:${b}:${member}:${c}',0))`;
  const commit = pending => `select public.commit_purchase_atomic('${b}',null,null,'${pending}')`;
  const cancel = pending => `select public.cancel_purchase_pending_execution('${b}','${member}','${c}','${pending}')`;
  let sequence = 0;
  async function pending(n) {
    const args = { ...summary, requestId: `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}` };
    const result = parse(await db.exec(`begin;${service}select public.replace_whatsapp_agent_pending('${b}','${member}','${c}','confirmation','purchases.create',${literal(args)},now()+interval '10 minutes');commit;`));
    assert(result?.ok && result.id, 'confirmation fixture created');
    const claimed = await db.exec(`begin;${service}select public.claim_purchase_pending_execution('${b}','${member}','${c}','${result.id}',false);commit;`);
    assert(claimed.split('\n').includes('t'), 'durable purchase claim');
    return result.id;
  }
  async function race(lock, first, second, { firstRole = service, secondRole = service, error = null } = {}) {
    const application = `purchase_transport_${++sequence}`;
    let signal; const marked = new Promise(resolve => { signal = resolve; });
    const one = db.session(`begin;${lock};select 'TRANSPORT_LOCK_ACQUIRED';select pg_sleep(1.2);${firstRole}${first};commit;`, out => { if (out.includes('TRANSPORT_LOCK_ACQUIRED')) signal(); });
    await Promise.race([marked, one.promise.then(result => { if (!result.stdout.includes('TRANSPORT_LOCK_ACQUIRED')) throw new Error(result.stderr || result.stdout); })]);
    const two = db.session(`begin;set local application_name='${application}';${secondRole}${second};commit;`);
    let waited = false;
    for (let n = 0; n < 20 && !waited; n++) {
      const result = await db.exec(`select pg_sleep(0.04);select exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event_type='Lock');`);
      waited = result.split('\n').includes('t');
    }
    const [a, z] = await Promise.all([one.promise, two.promise]);
    assert(waited, 'second independent connection demonstrably waited on a lock');
    assert(a.code === 0, a.stderr);
    if (error) assert(z.code !== 0 && z.stderr.includes(error), `expected ${error}: ${z.stderr}`);
    else assert(z.code === 0, z.stderr);
    return [parse(a.stdout), z.code === 0 ? parse(z.stdout) : null];
  }
  const firstPending = await pending(1);
  const [created, replayed] = await race(scopeLock, commit(firstPending), commit(firstPending));
  assert(created?.ok && replayed?.replayed && created.id === replayed.id, 'simultaneous WA recovery must return one purchase');
  assert((await db.exec(`select (select count(*) from public.purchases where origin_pending_id='${firstPending}')=1 and (select count(*) from public.purchase_items)=0 and (select count(*) from public.stock_movements)=0 and (select count(*) from public.activity_logs where action='purchase.created')=1;`)).trim() === 't', 'WA summary replay has one audit and no invented detail/stock');
  await db.exec(`begin;${service}${cancel(firstPending)};commit;`);
  const cancelled = await pending(2);
  const [cancellation] = await race(scopeLock, cancel(cancelled), commit(cancelled), { error: 'purchase_pending_forbidden' });
  assert(cancellation?.consumed && cancellation?.resultUncertain, 'cancellation retains uncertainty semantics');
  assert((await db.exec(`select not exists(select 1 from public.purchases where origin_pending_id='${cancelled}');`)).trim() === 't', 'cancellation that wins prevents execution');
  const executed = await pending(3);
  const [success, stopped] = await race(scopeLock, commit(executed), cancel(executed));
  assert(success?.ok && stopped?.consumed && stopped?.resultUncertain, 'execute-first and cancellation serialize without claiming rollback');
  assert((await db.exec(`select count(*)=1 from public.purchases where origin_pending_id='${executed}';`)).trim() === 't', 'cancellation preserves committed purchase');
  const detailed = { ...summary, kind: 'detailed', items: [{ ingredientId: '00000000-0000-4000-8000-000000000070', description: 'Actual flour', qty: '500', unit: 'g', unitPrice: '1.25' }] };
  delete detailed.amount;
  const inbox = id => `select public.commit_purchase_atomic('${b}',${literal({ expectedFields: { quantity: 500, unit: 'g' }, review: detailed })},'${id}',null)`;
  const [inboxCreated, inboxReplay] = await race(`select id from public.ai_extractions where id='${extraction}' for update`, inbox(extraction), inbox(extraction), { firstRole: auth, secondRole: auth });
  assert(inboxCreated?.ok && inboxReplay?.replayed && inboxCreated.id === inboxReplay.id, 'same extraction produces one approved purchase');
  assert((await db.exec(`select (select count(*) from public.stock_movements where source='inbox')=1 and (select current from public.stock_items where ingredient_id='00000000-0000-4000-8000-000000000070')=0.5;`)).trim() === 't', 'concurrent Inbox approval moves exact stock once');
  const changed = '00000000-0000-4000-8000-000000000804';
  await db.exec(`insert into public.ai_extractions(id,message_id,business_id,branch_id,type,fields,status) values('${changed}','${message}','${b}','${branch}','purchase','{"quantity":500,"unit":"g"}','pending');`);
  await race(`select id from public.whatsapp_messages where id='${message}' for update`, `update public.whatsapp_messages set branch_id='00000000-0000-4000-8000-000000000022' where id='${message}'`, inbox(changed), { firstRole: '', secondRole: auth, error: 'purchase_branch_forbidden' });
  assert((await db.exec(`select not exists(select 1 from public.purchases where origin_extraction_id='${changed}');`)).trim() === 't', 'message changed during wait cannot approve stale branch');
  const revoked = await pending(4);
  await race(`select business_id from public.business_modules where business_id='${b}' and module_key='purchases' for update`, `update public.business_modules set enabled=false where business_id='${b}' and module_key='purchases'`, commit(revoked), { firstRole: '', error: 'purchase_module_disabled' });
  assert((await db.exec(`select not exists(select 1 from public.purchases where origin_pending_id='${revoked}');`)).trim() === 't', 'module disabled during lock wait prevents purchase');
  await db.exec(`update public.business_modules set enabled=true where business_id='${b}' and module_key='purchases';`);
  const manager = '00000000-0000-4000-8000-000000000003';
  const managerAuth = `set local role authenticated;select set_config('request.jwt.claim.sub','${manager}',true);`;
  const managerRequest = '00000000-0000-4000-8000-000000000950';
  const managerInput = { ...detailed, requestId: managerRequest };
  const managerCreate = `select public.create_purchase_manual_atomic('${b}',${literal(managerInput)})`;
  await race(`select id from public.business_members where business_id='${b}' and user_id='${manager}' for update`, `update public.business_members set role='viewer' where business_id='${b}' and user_id='${manager}'`, managerCreate, { firstRole: '', secondRole: managerAuth, error: 'purchase_permission_denied' });
  assert((await db.exec(`select not exists(select 1 from public.purchases where manual_request_id='${managerRequest}');`)).trim() === 't', 'private receipt lock rechecks manager membership after revocation wait');
  await db.exec(`update public.business_members set role='manager' where business_id='${b}' and user_id='${manager}';`);
  await race(`select business_id from public.business_modules where business_id='${b}' and module_key='purchases' for update`, `update public.business_modules set enabled=false where business_id='${b}' and module_key='purchases'`, managerCreate, { firstRole: '', secondRole: managerAuth, error: 'purchase_module_disabled' });
  assert((await db.exec(`select not exists(select 1 from public.purchases where manual_request_id='${managerRequest}');`)).trim() === 't', 'private receipt lock rechecks manager module after revocation wait');
  await db.exec(`update public.business_modules set enabled=true where business_id='${b}' and module_key='purchases';`);
  const managerResult = parse(await db.exec(`begin;${managerAuth}${managerCreate};commit;`));
  assert(managerResult?.ok && managerResult.costRefreshPending === true, 'restored manager writes purchase with pending costs, without catalog UPDATE permission');
  console.log('PASS native purchase transport races: WA replay/cancel ordering, Inbox replay/stock once, message change, module/membership revocation after observed lock waits, manager invoker purchase');
}
