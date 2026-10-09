/** True multi-session regression, for the existing disposable native PostgreSQL runner only.
 * db exposes exec(sql) and session(sql,onOutput)->{process,promise:{code,stdout,stderr}}.
 * Never accepts connection strings, credentials, or a production database.
 */
export async function verifyWhatsAppPendingConcurrency(db) {
  const b='00000000-0000-4000-8000-000000002001',m='00000000-0000-4000-8000-000000002003',c='00000000-0000-4000-8000-000000002004';
  await db.exec(`begin;
    insert into auth.users(id,email) values('00000000-0000-4000-8000-000000002002','pending-concurrency@example.invalid');
    insert into public.organizations(id,name) values('00000000-0000-4000-8000-000000002000','Pending concurrency fixture');
    insert into public.businesses(id,organization_id,name) values('${b}','00000000-0000-4000-8000-000000002000','Pending concurrency');
    insert into public.business_members(id,business_id,user_id,role) values('${m}','${b}','00000000-0000-4000-8000-000000002002','owner');
    insert into public.whatsapp_authorized_conversations(id,business_id,provider,provider_conversation_id,conversation_type) values('${c}','${b}','internal','pending-concurrency','direct'); commit;`);
  const replace=(n)=>`select public.replace_whatsapp_agent_pending('${b}','${m}','${c}','confirmation','debts.createPlan','{"requestId":"operation-${n}"}',now()+interval '10 minutes');`;
  const check=async(session)=>{const result=await session.promise;if(result.code!==0)throw new Error(result.stderr||result.stdout||'Pending concurrency session failed');return result;};
  const observeLock = async (application) => {
    for (let attempt=0;attempt<12;attempt++) {
      const state=await db.exec(`select pg_sleep(0.04);select exists(select 1 from pg_stat_activity where application_name='${application}' and wait_event_type='Lock');`);
      if(state.split("\n").includes('t'))return true;
    }
    return false;
  };
  try {
    let unlock;const held=new Promise(resolve=>{unlock=resolve;});
    const first=db.session(`begin; set local role service_role; ${replace(1)} select 'PENDING_LOCK_HELD'; select pg_sleep(1.5); commit;`,out=>{if(out.includes('PENDING_LOCK_HELD'))unlock();});
    await Promise.race([held,first.promise.then(r=>{throw new Error(r.stderr||'First session ended before taking pending lock');})]);
    const second=db.session(`begin; set local application_name='whatsapp_pending_replace_b';set local role service_role; ${replace(2)} commit;`);
    const replacementWait = await observeLock('whatsapp_pending_replace_b');
    await Promise.all([check(first),check(second)]);
    if(!replacementWait)throw new Error('Second replacement session was never observed waiting for its scope lock');
    await db.exec(`do $$ begin
      if (select count(*) from public.whatsapp_agent_pending_operations where business_id='${b}' and member_id='${m}' and conversation_id='${c}' and consumed_at is null)<>1 then raise exception 'Concurrent replace left multiple live confirmations'; end if;
      if (select arguments->>'requestId' from public.whatsapp_agent_pending_operations where business_id='${b}' and member_id='${m}' and conversation_id='${c}' and consumed_at is null)<>'operation-2' then raise exception 'Newest serialized operation was not retained'; end if;
    end $$;`);
    const consume=`update public.whatsapp_agent_pending_operations set consumed_at=now() where business_id='${b}' and member_id='${m}' and conversation_id='${c}' and consumed_at is null returning id;`;
    let consumeHeld;const consumeMarker=new Promise(resolve=>{consumeHeld=resolve;});
    const consumeFirst=db.session(`begin;set local role service_role;${consume}select 'PENDING_CONSUME_HELD';select pg_sleep(1.5);commit;`,out=>{if(out.includes('PENDING_CONSUME_HELD'))consumeHeld();});
    await Promise.race([consumeMarker,consumeFirst.promise.then(r=>{throw new Error(r.stderr||'Consumer ended before lock marker');})]);
    const consumeSecond=db.session(`begin;set local application_name='whatsapp_pending_consume_b';set local role service_role;${consume}commit;`);
    const consumeWait=await observeLock('whatsapp_pending_consume_b');
    const consumed=await Promise.all([check(consumeFirst),check(consumeSecond)]);
    if(!consumeWait)throw new Error('Second confirmation was never observed waiting for its row lock');
    const ids=consumed.flatMap(r=>r.stdout.split(/\r?\n/).filter(line=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(line)));
    if(ids.length!==1)throw new Error(`Expected one confirmation winner, received ${ids.length}`);
    await db.exec(`do $$ begin if exists(select 1 from public.whatsapp_agent_pending_operations where business_id='${b}' and member_id='${m}' and conversation_id='${c}' and consumed_at is null) then raise exception 'Old pending operation resurfaced after confirmation'; end if;end $$;`);
    console.log('PASS native pending concurrency: two requests serialize to one live confirmation; two confirmations have one winner and no old request resurfaces (observed independent-session lock waits).');
  } finally {
    await db.exec(`delete from public.organizations where id='00000000-0000-4000-8000-000000002000';delete from auth.users where id='00000000-0000-4000-8000-000000002002';`);
  }
}
