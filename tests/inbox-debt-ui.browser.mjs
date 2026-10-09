/** Isolated browser verification of the real Inbox component; inert actions, no provider/DB calls. */
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { prepareFixtureFont } from '../scripts/prepare-fixture-font.mjs';
import { assertFixtureBundle, isolateFixturePage, ensureInter, fixtureCsp } from '../scripts/ui-fixtures/isolation.mjs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const cwd=process.cwd(),dir=join(cwd,'.test-artifacts/inbox-debt-ui');
await rm(dir,{recursive:true,force:true});
await mkdir(dir,{recursive:true});
execFileSync(process.execPath,[join(cwd,'node_modules/tailwindcss/lib/cli.js'),'-i','app/globals.css','-o',join(dir,'style.css'),'--minify'],{cwd,stdio:'inherit'});
await prepareFixtureFont(cwd,dir);
const fontFiles=new Set((await readdir(join(dir,'fonts'))).filter(name=>/^[A-Za-z0-9_.-]+\.woff2$/.test(name)));
const entry=`import React from 'react';import{createRoot}from'react-dom/client';import Inbox from '${cwd}/app/inbox/inbox-client';
const item={id:'m-fixture',extractionId:'00000000-0000-4000-8000-000000000005',sender:'Ana',role:'Owner',channel:'texto',receivedAt:new Date(),status:'pendiente',preview:'Deuda de Banco Nación',raw:'Deuda completa confirmada por revisar.',extracted:{tipo:'Nueva deuda',fecha:'2026-10-09',confidence:1}};
window.__preview={digest:'review-v1',operation:'create',requestId:item.extractionId,creditor:'Banco Nación',branchId:'00000000-0000-4000-8000-000000000002',currency:'ARS',creation:{takenAt:'2026-10-09',creditorType:'bank',concept:'Capital de trabajo'},schedule:{originalAmountCents:90000000,totalFinancedCents:90000000,downPaymentCents:null,interestRate:null,installments:[{installmentNumber:1,totalAmountCents:30000000,dueDate:'2026-11-10'},{installmentNumber:2,totalAmountCents:30000000,dueDate:'2026-12-10'},{installmentNumber:3,totalAmountCents:30000000,dueDate:'2027-01-10'}]}};
window.__calls=[];window.__toasts=[];window.__responses=[];window.__previewCount=0;const root=createRoot(document.getElementById('root'));window.__render=()=>root.render(<Inbox items={[item]}/>);window.__render();`;
const bundle=await build({metafile:true,stdin:{contents:entry,loader:'tsx',resolveDir:cwd},outfile:join(dir,'bundle.js'),bundle:true,platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},alias:{'@':cwd},plugins:[{name:'qa',setup(b){b.onResolve({filter:/^next\/navigation$|^next\/link$|^@\/app\/actions\/inbox$|^@\/components\/ui\/toast$|^@\/lib\/realtime\/use-presence$/},args=>({path:args.path,namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},({path})=>({loader:'jsx',resolveDir:cwd,contents:path==='@/lib/realtime/use-presence'?`export const usePresence=()=>{throw new Error('Realtime presence must not run in the isolated debt Inbox fixture')};`:path==='next/navigation'?`export const useRouter=()=>({refresh:()=>{}});`:path==='next/link'?`export default function Link(p){return <a {...p}/>;}`:path.endsWith('/toast')?`export const useToast=()=>({toast:v=>window.__toasts.push(v)});export const ToastPresets=new Proxy({},{get:()=>()=>({title:'fixture'})});`:`export const previewInboxDebtAction=async()=>{window.__previewCount++;return {ok:true,preview:structuredClone(window.__preview)}};export const approveExtractionAction=async(id,digest)=>{window.__calls.push({id,digest});return window.__responses.shift()??{ok:true,persisted:true,target_entity:'debts'}};export const rejectExtractionAction=async()=>({ok:true});export const requestMoreInfoAction=async()=>({ok:true});` }));}}]});
assertFixtureBundle(bundle);
if(process.env.BUNDLE_ONLY==='1'){console.log('PASS: real Inbox UI bundle with inert action/router fixtures. Browser interactions not run.');process.exit(0);}
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
try{browser=await chromium.launch({headless:true});}catch(error){await new Promise(resolve=>server.close(resolve));throw error;}
const page=await browser.newPage({viewport:{width:1400,height:1200},serviceWorkers:'block'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
const verifyIsolation=await isolateFixturePage(page,'http://127.0.0.1:'+server.address().port,['/','/bundle.js','/style.css','/font.css',...Array.from(fontFiles,file=>'/fonts/'+file)]);
let browserPassed=false;
const button=name=>page.getByRole('button',{name,exact:true});
try{
 await page.goto('http://127.0.0.1:'+server.address().port);
 await ensureInter(page);
 await button('Aprobar').click();await page.getByRole('heading',{name:'Revisá antes de guardar'}).waitFor();
 assert.equal((await page.evaluate(()=>window.__calls)).length,0);
 await page.screenshot({path:join(dir,'preview-desktop.png'),fullPage:true,animations:'disabled'});
 assert.equal(await page.getByRole('list',{name:'Cronograma completo'}).getByRole('listitem').count(),3);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(dir,'preview-mobile.png'),fullPage:true,animations:'disabled'});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'mobile preview overflow');await page.setViewportSize({width:1400,height:1200});
 await button('Cancelar revisión').click();assert.equal(await button('Confirmar este detalle').count(),0);assert.equal((await page.evaluate(()=>window.__calls)).length,0);
 await button('Aprobar').click();await page.getByRole('heading',{name:'Revisá antes de guardar'}).waitFor();
 await page.evaluate(()=>window.__responses.push({ok:false,persisted:false,error:'debt_review_required'}));
 await button('Confirmar este detalle').click();await button('Aprobar').waitFor();assert.equal(await button('Confirmar este detalle').count(),0);
 await page.evaluate(()=>{window.__preview.digest='review-v2';window.__preview.schedule.installments[2].dueDate='2027-02-10';});
 await button('Aprobar').click();await page.getByText('Cuota 3: ARS 300.000,00 · 2027-02-10',{exact:true}).waitFor();
 await page.evaluate(()=>window.__responses.push({ok:false,persisted:false,error:'debt_response_unknown'}));
 await button('Confirmar este detalle').click();await page.waitForTimeout(100);assert.equal(await button('Confirmar este detalle').count(),1);
 await button('Confirmar este detalle').dblclick();await button('Aprobado').waitFor();
 const calls=await page.evaluate(()=>window.__calls);assert.equal(calls.length,3);assert.equal(calls[0].digest,'review-v1');assert.equal(calls[1].digest,'review-v2');assert.equal(calls[2].digest,'review-v2');verifyIsolation();assert.deepEqual(errors,[]);browserPassed=true;
 console.log('PASS: Inbox real preview is read-only, full schedule, cancel, stale-snapshot review reset, same snapshot retry after uncertain result, repeated-click protection.');
}catch(error){await page.screenshot({path:join(dir,'failure.png'),fullPage:false,animations:'disabled'}).catch(()=>{});throw error;}finally{await writeFile(join(dir,'browser-result.json'),JSON.stringify({passed:browserPassed,fixturesOnly:true,pageErrors:errors},null,2));await browser.close();await new Promise(resolve=>server.close(resolve));}
