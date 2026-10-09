/** Optional isolated component-browser QA: node tests/debt-plan-ui.browser.mjs
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
const dir = join(cwd, '.test-artifacts/debt-ui');
await rm(dir,{recursive:true,force:true});
await mkdir(dir,{recursive:true});
execFileSync(process.execPath,[join(cwd,'node_modules/tailwindcss/lib/cli.js'),'-i','app/globals.css','-o',join(dir,'style.css'),'--minify'],{cwd,stdio:'inherit'});
await prepareFixtureFont(cwd,dir);
const fontFiles=new Set((await readdir(join(dir,'fonts'))).filter(name=>/^[A-Za-z0-9_.-]+\.woff2$/.test(name)));
const actionStub = `export const verifyDebtSessionAction=async()=>({ok:true});export const getDebtOperationResultAction=(p)=>window.__lookup(p);export const editDebtPlanAction=(p)=>window.__action('edit',p);export const createDebtPlanAction=(p)=>window.__action('create',p);export const registerDebtPlanPaymentAction=(p)=>window.__action('pay',p);export const registerLegacyDebtPaymentAction=(p)=>window.__action('legacy',p);export const voidDebtPlanPaymentAction=(p)=>window.__action('void',p);`;
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import Component from '${cwd}/app/deudas/database-debts-client'; import {mapDebtView} from '${cwd}/app/deudas/plan-data';import {generateDebtPlan} from '${cwd}/lib/debts/plans';
const bid='10000000-0000-4000-8000-000000000001',branch='20000000-0000-4000-8000-000000000001',actor='70000000-0000-4000-8000-000000000001';
const access={actorId:actor,businessId:bid,branchIds:null,permissions:['debts.view','debts.create','debts.pay']};
function debt(n,creditor,currency,history=false,legacy=false){const id='30000000-0000-4000-8000-00000000000'+n;const plan=generateDebtPlan({mode:'installments',currency,originalAmountCents:90000,financing:{totalFinancedCents:90000},installmentCount:3,schedule:{periodicity:'monthly',firstDueDate:'2026-11-10'}});const parts=plan.installments.map((part,i)=>({id:'50000000-0000-4000-8000-0000000000'+n+i,business_id:bid,branch_id:branch,debt_id:id,installment_number:part.installmentNumber,due_date:part.dueDate,total_amount:part.totalAmountCents/100,capital_amount:null,interest_amount:null,fees_amount:null,notes:null}));const payments=history?[1,2].map(i=>({id:'40000000-0000-4000-8000-0000000000'+n+i,business_id:bid,branch_id:branch,debt_id:id,currency,amount:50,paid_at:'2026-10-09',payment_method:'Efectivo '+i,created_by:actor,created_at:'2026-10-09T12:00:00Z',origin:'manual',reference:null,notes:null,allocation_rule:'oldest_due',selected_installment_id:null,voided_at:null,voided_on:null,voided_by:null,void_reason:null})):[];const allocations=payments.map(p=>({business_id:bid,branch_id:branch,debt_id:id,payment_id:p.id,installment_id:parts[0].id,amount:50}));return mapDebtView({id,business_id:bid,branch_id:branch,creditor,creditor_type:'bank',concept:'Capital de trabajo',currency:legacy?null:currency,original_amount:900,pending_amount:history?800:900,taken_at:'2026-10-09',due_date:'2026-11-10',status:'active',origin:'manual',category:null,reference:null,notes:null,expected_payment_method:null,total_financed_amount:900,down_payment_amount:null,mode:'installments',plan_version:history?2:0,plan_definition:legacy?null:plan,created_by:actor,created_at:'2026-10-09T12:00:00Z'},legacy?[]:parts,payments,legacy?[]:allocations,[],'2026-10-09',access);}
const debts=[debt(1,'Banco A','ARS'),debt(2,'Banco B','USD',true),debt(3,'Histórica C','ARS',false,true)];window.__calls=[];window.__responses=[];window.__lookupResponses=[];window.__lookup=async(p)=>window.__lookupResponses.shift()??{ok:true,found:false};window.__action=async(kind,payload)=>{window.__calls.push({kind,payload});let reply=window.__responses.shift();if(reply==='throw')throw new Error('connection lost');return reply??{ok:true,persisted:true,debtId:payload.debtId??debts[0].id,paymentId:payload.paymentId??'40000000-0000-4000-8000-000000000099',version:1};};const root=createRoot(document.getElementById('root'));window.__render=(readOnly=false)=>root.render(<Component debts={debts} branches={[{id:branch,name:'Principal'}]} access={readOnly?{...access,permissions:['debts.view']}:access} asOfDate='2026-10-09' timeZone='America/Argentina/Buenos_Aires'/>);window.__render();`;
const bundle=await build({metafile:true, stdin: { contents: entry, loader: 'tsx', resolveDir: cwd }, bundle: true, outfile: join(dir,'bundle.js'), platform: 'browser', jsx:'automatic', define:{'process.env.NODE_ENV':'"production"'}, plugins:[{name:'stubs',setup(b){b.onResolve({filter:/^next\/navigation$/},()=>({path:'navigation',namespace:'qa'}));b.onResolve({filter:/^@\/app\/actions\/debt-plans$/},()=>({path:'actions',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:args.path==='actions'?actionStub:`const router={refresh:()=>{window.__refreshes=(window.__refreshes??0)+1}};export const useRouter=()=>router;`,loader:'js'}));}}], alias:{'@':cwd} });
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
async function close(){await button('Cerrar').last().click();await page.waitForTimeout(500);}
async function detail(name){await page.getByRole('row').filter({has:page.getByText(name,{exact:true})}).getByRole('button',{name:'Ver detalle'}).click();}
async function payment(name){await detail(name);await button('Registrar pago parcial, anticipado o global').click();await page.waitForTimeout(500);}
async function reviewPay(amount='100'){await page.getByLabel('Importe pagado *',{exact:false}).fill(amount);await page.getByLabel('Método usado *',{exact:false}).fill('Transferencia confirmada');await page.getByRole('combobox',{name:'Regla de imputación *',exact:true}).selectOption('oldest_due');await button('Revisar pago e imputación').click();}
try {
 await page.goto('http://127.0.0.1:'+server.address().port);
 await ensureInter(page);
 await page.getByText('Deudas y planes de pago',{exact:true}).waitFor();
 assert.equal(await page.getByText('Compromisos confirmados · ARS · 1 deudas',{exact:true}).count(),1); assert.equal(await page.getByText('Compromisos confirmados · USD · 1 deudas',{exact:true}).count(),1);
 await button('Nueva deuda').click();await page.getByLabel('Acreedor *',{exact:true}).fill('Banco Nuevo');await close();await button('Nueva deuda').click();assert.equal(await page.getByLabel('Acreedor *',{exact:true}).inputValue(),'Banco Nuevo');
 await page.getByRole('combobox',{name:'Tipo de acreedor *',exact:true}).selectOption('bank');await page.getByRole('combobox',{name:'Sucursal *',exact:true}).selectOption({label:'Principal'});await page.getByLabel('Moneda *',{exact:false}).fill('ARS');await page.getByRole('combobox',{name:'Modalidad *',exact:true}).selectOption('installments');await page.getByLabel('Monto original *',{exact:false}).fill('900000');await page.getByLabel('Total financiado / a pagar *',{exact:false}).fill('900000');await page.getByLabel('Cantidad de cuotas *',{exact:true}).fill('3');await page.getByRole('combobox',{name:'Periodicidad *',exact:true}).selectOption('monthly');await page.getByLabel('Primer vencimiento *',{exact:true}).fill('2026-11-10');await button('Revisar cronograma antes de guardar').click();
 assert.equal(await page.getByRole('cell',{name:'ARS 300.000,00',exact:true}).count(),3);assert.equal((await page.evaluate(()=>window.__calls)).length,0);
 await button('Confirmar y guardar cronograma').scrollIntoViewIfNeeded();
 await page.screenshot({path:join(dir,'plan-preview-desktop.png'),fullPage:false,animations:'disabled'});await page.setViewportSize({width:390,height:844});await button('Confirmar y guardar cronograma').scrollIntoViewIfNeeded();await page.screenshot({path:join(dir,'plan-preview-mobile.png'),fullPage:false,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile plan overflow');await page.setViewportSize({width:1440,height:1000});
 await button('Confirmar y guardar cronograma').dblclick();await page.waitForTimeout(500);assert.equal((await page.evaluate(()=>window.__calls)).length,1);
 await payment('Banco A');assert.equal(await page.getByLabel('Método usado *',{exact:false}).inputValue(),'');await reviewPay();await page.evaluate(()=>window.__responses.push('throw'));await button('Confirmar registro del pago').click();await page.getByText('La conexión se interrumpió.',{exact:false}).waitFor();let calls=await page.evaluate(()=>window.__calls);const lostId=calls.at(-1).payload.requestId;await page.evaluate(()=>window.__lookupResponses.push({ok:false,error:'Sesión temporalmente no disponible'}));await button('Comprobar / reintentar el mismo pago').click();assert.equal(await button('Volver a revisar').isDisabled(),true);assert.equal((await page.evaluate(()=>window.__calls)).at(-1).payload.requestId,lostId);await close();
 await payment('Banco B');await page.getByLabel('Importe pagado *',{exact:false}).fill('23');await close();await payment('Banco A');await button('Comprobar / reintentar el mismo pago').click();await page.waitForTimeout(500);calls=await page.evaluate(()=>window.__calls);assert.equal(calls.at(-1).payload.requestId,lostId);await close();
 await payment('Banco B');assert.equal(await page.getByLabel('Importe pagado *',{exact:false}).inputValue(),'23');await close();
 await detail('Banco B');await page.getByRole('button',{name:'Anular con motivo',exact:true}).first().click();await page.getByLabel('Motivo obligatorio',{exact:true}).fill('Corregir pago A');await button('Revisar anulación').click();await close();await detail('Banco B');await page.getByRole('button',{name:'Anular con motivo',exact:true}).last().click();await page.getByLabel('Motivo obligatorio',{exact:true}).fill('Corregir pago B');await button('Revisar anulación').click();await button('Confirmar anulación').click();await page.waitForTimeout(500);calls=await page.evaluate(()=>window.__calls);assert.equal(calls.at(-1).payload.paymentId,'40000000-0000-4000-8000-000000000022');assert.equal(calls.at(-1).payload.reason,'Corregir pago B');await close();
 await payment('Histórica C');await reviewPay('20');await page.evaluate(()=>window.__responses.push('throw'));await button('Confirmar registro del pago').click();await close();await payment('Banco B');await close();await payment('Histórica C');assert.equal(await button('Confirmar pago histórico verificado').count(),1);assert.equal(await button('Confirmar registro del pago').count(),0);await close();
 await page.evaluate(()=>window.__render(true));assert.equal(await button('Nueva deuda').count(),0);await detail('Banco A');assert.equal(await button('Registrar pago parcial, anticipado o global').count(),0);
 verifyIsolation();assert.deepEqual(errors,[]);browserPassed=true;console.log('PASS: real debt UI, separated currencies, preview before commit, draft close/reopen, double click, lost-response identity across debt switching, void target identity, legacy retry gate, read-only permissions.');
}catch(error){await page.screenshot({path:join(dir,'failure.png'),fullPage:false,animations:'disabled'}).catch(()=>{});throw error;}finally{await writeFile(join(dir,'browser-result.json'),JSON.stringify({passed:browserPassed,fixturesOnly:true,pageErrors:errors},null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
