/** Exact bank case component QA: node tests/bank-installment-ui.browser.mjs
 * Requires the local QA tools esbuild + playwright, not production dependencies.
 * Bundles the real component with inert action/router substitutes; no DB/network writes.
 */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { prepareFixtureFont } from '../scripts/prepare-fixture-font.mjs';
import { assertFixtureBundle, isolateFixturePage, ensureInter, fixtureCsp } from '../scripts/ui-fixtures/isolation.mjs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const cwd = process.cwd();
const dir = join(cwd, '.test-artifacts/bank-installment-ui');
await rm(dir,{recursive:true,force:true});
await mkdir(dir,{recursive:true});
execFileSync(process.execPath,[join(cwd,'node_modules/tailwindcss/lib/cli.js'),'-i','app/globals.css','-o',join(dir,'style.css'),'--minify'],{cwd,stdio:'inherit'});
await prepareFixtureFont(cwd,dir);
const fontFiles=new Set((await readdir(join(dir,'fonts'))).filter(name=>/^[A-Za-z0-9_.-]+\.woff2$/.test(name)));
const actionStub = `export const cancelDebtPlanRecordAction=(p)=>window.__action('cancel',p);export const verifyDebtSessionAction=async()=>({ok:true});export const getDebtOperationResultAction=(p)=>window.__lookup(p);export const editDebtPlanAction=(p)=>window.__action('edit',p);export const createDebtPlanAction=(p)=>window.__action('create',p);export const registerDebtPlanPaymentAction=(p)=>window.__action('pay',p);export const registerLegacyDebtPaymentAction=(p)=>window.__action('legacy',p);export const voidDebtPlanPaymentAction=(p)=>window.__action('void',p);`;
const entry = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import Component from '${cwd}/app/deudas/database-debts-client';
import { mapDebtView } from '${cwd}/app/deudas/plan-data';
import { generateDebtPlan, allocateDebtPayment, projectDebtCommitments, cancelDebtRecord } from '${cwd}/lib/debts/plans';
const bid='10000000-0000-4000-8000-000000000001',branch='20000000-0000-4000-8000-000000000001',actor='70000000-0000-4000-8000-000000000001';
const id='30000000-0000-4000-8000-000000000001',today='2026-10-09';
const access={actorId:actor,businessId:bid,branchIds:null,permissions:['debts.view','debts.create','debts.pay']};
let row=null, parts=[], payments=[], allocations=[];
const root=createRoot(document.getElementById('root'));
function current(){return row ? mapDebtView(row,parts,payments,allocations,[],today,access) : null;}
window.__render=()=>{
  const view=current();
  window.__snapshot=view;
  root.render(<Component debts={view?[view]:[]} branches={[{id:branch,name:'Principal'}]} access={access} asOfDate={today} timeZone='America/Argentina/Buenos_Aires'/>);
};
window.__calls=[];
window.__receipts={};
window.__lookup=async(p)=>window.__receipts[p.requestId]??{ok:true,found:false};
// In-memory action substitutes exercise the real UI/domain only. The SQL suite
// separately proves persisted balances, allocations, RLS and idempotency.
window.__action=async(kind,payload)=>{
  window.__calls.push({kind,payload});
  if(kind==='create'){
    if(row) throw new Error('Fixture received duplicate plan creation');
    const plan=generateDebtPlan(payload.planInput);
    row={id,business_id:bid,branch_id:branch,creditor:payload.creditor,creditor_type:payload.creditorType,
      concept:payload.concept??null,currency:plan.currency,original_amount:plan.originalAmountCents/100,
      pending_amount:plan.totalFinancedCents/100,taken_at:payload.takenAt,due_date:plan.installments[0].dueDate,
      status:'active',origin:'manual',category:null,reference:null,notes:null,expected_payment_method:null,
      total_financed_amount:plan.totalFinancedCents/100,down_payment_amount:null,mode:plan.mode,plan_version:0,
      plan_definition:plan,created_by:actor,created_at:today+'T12:00:00Z'};
    parts=plan.installments.map(part=>({id:'50000000-0000-4000-8000-00000000000'+part.installmentNumber,
      business_id:bid,branch_id:branch,debt_id:id,installment_number:part.installmentNumber,due_date:part.dueDate,
      total_amount:part.totalAmountCents/100,capital_amount:null,interest_amount:null,fees_amount:null,notes:null}));
  }else if(kind==='pay'){
    const result=allocateDebtPayment(current().ledger,{debtId:id,businessId:bid,branchId:branch,paymentId:payload.requestId,
      currency:'ARS',expectedVersion:payload.expectedVersion,amountCents:payload.amountCents,paidAt:payload.paidAt,
      paymentMethod:payload.paymentMethod,origin:'manual',allocation:payload.allocation},access);
    const projection=projectDebtCommitments(result.snapshot,today,access);
    payments.push({id:payload.requestId,business_id:bid,branch_id:branch,debt_id:id,currency:'ARS',amount:payload.amountCents/100,
      paid_at:payload.paidAt,payment_method:payload.paymentMethod,created_by:actor,created_at:today+'T12:00:00Z',origin:'manual',
      reference:null,notes:null,allocation_rule:payload.allocation.rule,selected_installment_id:payload.allocation.installmentId??null,
      voided_at:null,voided_on:null,voided_by:null,void_reason:null});
    allocations.push(...result.payment.allocations.map(part=>({business_id:bid,branch_id:branch,debt_id:id,
      payment_id:payload.requestId,installment_id:part.installmentId,amount:part.amountCents/100})));
    row={...row,pending_amount:result.pendingAmountCents/100,plan_version:result.snapshot.version,
      status:projection.status==='paid'?'settled':'active',due_date:projection.nextDueDate};
  }else if(kind==='cancel'){
    const cancelled=cancelDebtRecord(current().ledger,{debtId:id,businessId:bid,branchId:branch,
      expectedVersion:payload.expectedVersion,cancelledAt:today,reason:payload.reason},access);
    row={...row,status:'cancelled',due_date:null,plan_version:cancelled.version,cancelled_at:today+'T12:00:00Z',
      cancelled_on:today,cancelled_by:actor,cancel_reason:payload.reason};
  }else throw new Error('Unexpected fixture action: '+kind);
  window.__receipts[payload.requestId]={ok:true,found:true,debtId:id};
  window.__render();
  if(window.__throwAfterCommit){window.__throwAfterCommit=false;throw new Error('Fixture lost committed cancellation reply');}
  return {ok:true,persisted:true,debtId:id,...(kind==='pay'?{paymentId:payload.requestId}:{}),version:row.plan_version};
};
window.__render();`;
const bundle=await build({metafile:true, stdin: { contents: entry, loader: 'tsx', resolveDir: cwd }, bundle: true, outfile: join(dir,'bundle.js'), platform: 'browser', jsx:'automatic', define:{'process.env.NODE_ENV':'"production"'}, plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'qa'}));b.onResolve({filter:/^@\/app\/actions\/debt-plans$/},()=>({path:'actions',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:args.path==='actions'?actionStub:`const router={refresh:()=>window.__render()};export const useRouter=()=>router;`,loader:'js'}));}}], alias:{'@':cwd} });
assertFixtureBundle(bundle);
if (process.env.BUNDLE_ONLY === '1') {  console.log('PASS: production UI bundle with isolated action/router substitutes. Browser interaction not run.'); process.exit(0); }
const server=createServer(async(req,res)=>{
 try {
  if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  res.setHeader('Content-Security-Policy',fixtureCsp);
  if(req.url?.startsWith('/fonts/')&&fontFiles.has(req.url.slice(7))){res.setHeader('Content-Type','font/woff2');res.end(await readFile(join(dir,'fonts',req.url.slice(7))));return;}
  if(req.url==='/bundle.js'||req.url==='/style.css'||req.url==='/font.css'){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(await readFile(join(dir,req.url.slice(1))));return;}
  if(req.url!=='/'){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="es" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/font.css"></head><body class="font-sans p-4"><div id="root"></div><script src="/bundle.js"></script></body></html>');
 }catch{res.statusCode=500;res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try { browser=await chromium.launch({headless:true}); } catch (error) { await new Promise(resolve=>server.close(resolve));  throw error; }
const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const verifyIsolation=await isolateFixturePage(page,'http://127.0.0.1:'+server.address().port,['/','/bundle.js','/style.css','/font.css',...Array.from(fontFiles,file=>'/fonts/'+file)]);
let browserPassed=false;
const button=(name)=>page.getByRole('button',{name,exact:true});
const schedule=()=>page.locator('section').filter({has:page.getByRole('heading',{name:'Cronograma',exact:true})});
async function openPayment(){
  await button('Registrar pago parcial, anticipado o global').click();
  await page.getByLabel('Importe pagado *',{exact:false}).waitFor();
}
async function reviewPayment(amount,installment=null){
  await page.getByLabel('Importe pagado *',{exact:false}).fill(amount);
  await page.getByLabel('Método usado *',{exact:false}).fill('Transferencia registrada en fixture');
  await page.getByRole('combobox',{name:'Regla de imputación *',exact:true}).selectOption(installment?'selected_installment':'oldest_due');
  if(installment) await page.getByRole('combobox',{name:'Cuota *',exact:true}).selectOption('50000000-0000-4000-8000-00000000000'+installment);
  await button('Revisar pago e imputación').click();
  await button('Confirmar registro del pago').waitFor();
}
async function confirmPayment(version){
  await button('Confirmar registro del pago').click();
  await page.waitForFunction(v=>window.__snapshot?.ledger.version===v,version);
  await page.getByRole('heading',{name:'Cronograma',exact:true}).waitFor();
}
async function createBankPlan(screenshots=false){
  await button('Nueva deuda').click();
  await page.getByLabel('Acreedor *',{exact:true}).fill('Banco caso 3 x 200000');
  await page.getByRole('combobox',{name:'Tipo de acreedor *',exact:true}).selectOption('bank');
  await page.getByRole('combobox',{name:'Sucursal *',exact:true}).selectOption({label:'Principal'});
  await page.getByLabel('Moneda *',{exact:false}).fill('ARS');
  await page.getByRole('combobox',{name:'Modalidad *',exact:true}).selectOption('installments');
  await page.getByLabel('Monto original *',{exact:false}).fill('600000');
  await page.getByRole('combobox',{name:'Cómo se define el saldo *',exact:true}).selectOption('installment');
  await page.getByLabel('Importe por cuota *',{exact:true}).fill('200000');
  await page.getByLabel('Cantidad de cuotas *',{exact:true}).fill('3');
  await page.getByRole('combobox',{name:'Periodicidad *',exact:true}).selectOption('monthly');
  await page.getByLabel('Primer vencimiento *',{exact:true}).fill('2026-11-10');
  await button('Revisar cronograma antes de guardar').click();
  assert.equal(await page.getByRole('cell',{name:'ARS 200.000,00',exact:true}).count(),3);
  await page.getByText('Total a pagar en este cronograma: ARS 600.000,00',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.__calls)).length,0,'plan preview never records a debt');
  if(screenshots) await page.screenshot({path:join(dir,'bank-plan-preview-desktop.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await button('Confirmar y guardar cronograma').scrollIntoViewIfNeeded();
  if(screenshots) await page.screenshot({path:join(dir,'bank-plan-preview-mobile.png'),animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile bank preview does not overflow');
  await page.setViewportSize({width:1440,height:1000});
  await button('Confirmar y guardar cronograma').click();
  await page.waitForFunction(()=>window.__snapshot?.pendingCents===60000000);
  const create=(await page.evaluate(()=>window.__calls))[0];
  assert.equal(create.kind,'create');
  assert.equal(create.payload.creditorType,'bank');
  assert.deepEqual(create.payload.planInput.financing,{installmentAmountCents:20000000});
  assert.equal(create.payload.planInput.installmentCount,3);
  await button('Ver detalle').click();
  await schedule().getByRole('cell',{name:'ARS 200.000,00',exact:true}).first().waitFor();
  assert.equal(await schedule().getByText('Pendiente',{exact:true}).count(),3);
}
try {
  await page.goto('http://127.0.0.1:'+server.address().port);
  await ensureInter(page);
  await createBankPlan(true);

  await openPayment();
  await reviewPayment('100000',1);
  await page.getByText('Cuota 1 · ARS 100.000,00',{exact:true}).waitFor();
  assert.equal((await page.evaluate(()=>window.__calls)).length,1,'partial preview has no action side effect');
  await confirmPayment(1);
  assert.equal((await page.evaluate(()=>window.__snapshot)).pendingCents,50000000);
  assert.equal(await schedule().getByText('Parcial',{exact:true}).count(),1);
  assert.equal(await schedule().getByText('Pendiente',{exact:true}).count(),2);
  await page.screenshot({path:join(dir,'bank-partial-payment.png'),animations:'disabled'});

  await openPayment();
  await reviewPayment('200000',2);
  await page.getByText('Cuota 2 · ARS 200.000,00',{exact:true}).waitFor();
  await confirmPayment(2);
  assert.equal((await page.evaluate(()=>window.__snapshot)).pendingCents,30000000);
  assert.equal(await schedule().getByText('Pagada',{exact:true}).count(),1);
  assert.equal(await schedule().getByText('Parcial',{exact:true}).count(),1);
  assert.equal(await schedule().getByText('Pendiente',{exact:true}).count(),1);

  await openPayment();
  await reviewPayment('300000');
  await page.getByText('Cuota 1 · ARS 100.000,00',{exact:true}).waitFor();
  await page.getByText('Cuota 3 · ARS 200.000,00',{exact:true}).waitFor();
  await confirmPayment(3);
  const final=await page.evaluate(()=>window.__snapshot);
  assert.equal(final.pendingCents,0);
  assert.equal(final.status,'paid');
  assert.equal(final.projection.paidInstallmentCount,3);
  assert.equal(final.projection.nextDueDate,null);
  assert.equal(final.payments.length,3);
  assert.equal(await schedule().getByText('Pagada',{exact:true}).count(),3);
  assert.equal(await button('Registrar pago parcial, anticipado o global').count(),0,'settled debt cannot receive another payment in UI');
  await page.screenshot({path:join(dir,'bank-settled-desktop.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:join(dir,'bank-settled-mobile.png'),animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'settled mobile debt does not overflow');
  const calls=await page.evaluate(()=>window.__calls);
  assert.deepEqual(calls.map(call=>call.kind),['create','pay','pay','pay']);
  assert.deepEqual(calls.slice(1).map(call=>[call.payload.amountCents,call.payload.expectedVersion]),[[10000000,0],[20000000,1],[30000000,2]]);
  assert.equal(new Set(calls.map(call=>call.payload.requestId)).size,4);
  // A fresh fixture run exercises cancellation with an unpaid balance and a
  // retained partial payment; it must not masquerade as the settlement above.
  await page.setViewportSize({width:1440,height:1000});
  await page.reload();
  await ensureInter(page);
  await createBankPlan();
  await openPayment();
  await reviewPayment('100000',1);
  await confirmPayment(1);
  await button('Cancelar registro administrativamente').click();
  await page.getByLabel('Motivo de cancelación *',{exact:true}).fill('Plan cargado por duplicado');
  await page.getByRole('checkbox').check();
  await button('Revisar cancelación administrativa').click();
  assert.equal((await page.evaluate(()=>window.__calls)).length,2,'cancellation preview does not cancel');
  await page.getByText('Se conservarán el cronograma, todos los pagos y el saldo histórico de ARS 500.000,00.',{exact:true}).waitFor();
  await page.evaluate(()=>{window.__throwAfterCommit=true;});
  await button('Confirmar cancelación administrativa').click();
  await button('Comprobar / reintentar la misma cancelación').waitFor();
  assert.equal(await button('Volver a revisar cancelación').isDisabled(),true);
  const cancellationRequest=(await page.evaluate(()=>window.__calls)).at(-1).payload.requestId;
  await button('Cerrar').last().click();
  await page.getByRole('button',{name:'Recuperar cancelación administrativa · Banco caso 3 x 200000',exact:true}).click();
  await button('Comprobar / reintentar la misma cancelación').click();
  await page.getByText('Registro cancelado administrativamente',{exact:true}).waitFor();
  const cancelled=await page.evaluate(()=>window.__snapshot);
  assert.equal(cancelled.status,'cancelled');
  assert.equal(cancelled.pendingCents,50000000,'historical unpaid balance is preserved');
  assert.equal(cancelled.payments.length,1,'existing payment is preserved');
  assert.equal(cancelled.ledger.installments.length,3,'all installments are preserved');
  assert.equal(cancelled.projection.nextDueDate,null);
  assert.equal(cancelled.projection.next60DaysCents,0);
  assert.equal((await page.evaluate(()=>window.__calls)).filter(call=>call.kind==='cancel').length,1,'lost cancellation reply reconciles without a second mutation');
  assert.equal((await page.evaluate(()=>window.__calls)).at(-1).payload.requestId,cancellationRequest);
  assert.equal(await button('Registrar pago parcial, anticipado o global').count(),0);
  assert.equal(await button('Editar notas de la deuda').count(),0);
  await page.screenshot({path:join(dir,'bank-cancelled-history-desktop.png'),animations:'disabled'});
  await button('Cerrar').last().click();
  await page.getByRole('combobox',{name:'Estado',exact:true}).selectOption('pending');
  assert.equal(await button('Ver detalle').count(),0,'cancelled balance is absent from pending records');
  await page.getByRole('combobox',{name:'Estado',exact:true}).selectOption('cancelled');
  await button('Ver detalle').waitFor();
  assert.equal(await page.getByText('Total registrado · ARS: ARS 500.000,00',{exact:true}).count(),0,'cancelled balance is excluded from active creditor totals');
  await page.setViewportSize({width:390,height:844});
  await button('Ver detalle').click();
  await page.getByText('Registro cancelado administrativamente',{exact:true}).waitFor();
  await page.screenshot({path:join(dir,'bank-cancelled-history-mobile.png'),animations:'disabled'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'cancelled history stays within mobile viewport');
  verifyIsolation();
  assert.deepEqual(errors,[]);
  browserPassed=true;
  console.log('PASS: exact bank UI case, 3 x ARS 200000 loaded from per-installment amount, ARS 100000 partial, ARS 200000 full selected installment, ARS 300000 final settlement, administrative cancellation with preserved history and same-UUID lost-reply recovery, desktop/mobile, isolated fixtures only.');
}catch(error){
  await page.screenshot({path:join(dir,'failure.png'),animations:'disabled'}).catch(()=>{});
  throw error;
}finally{
  await writeFile(join(dir,'browser-result.json'),JSON.stringify({passed:browserPassed,fixturesOnly:true,pageErrors:errors,case:'bank 3 x ARS 200000'},null,2));
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
