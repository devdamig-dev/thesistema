// Real production component, isolated FB + backend adapters. No Meta credentials or external traffic.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const out=path.join(root,'.test-artifacts','whatsapp-connect-ui');
await rm(out,{recursive:true,force:true});await mkdir(out,{recursive:true});
await build({
 stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {WhatsAppConnectButton} from './app/ajustes/whatsapp/connect-button';createRoot(document.getElementById('root')).render(<WhatsAppConnectButton appId='123456789' configId='987654321' apiVersion='v25.0'/>);`,resolveDir:root,loader:'tsx'},
 outfile:path.join(out,'app.js'),bundle:true,platform:'browser',jsx:'automatic',tsconfig:path.join(root,'tsconfig.json'),
 define:{'process.env.NODE_ENV':'"development"'},
 plugins:[{name:'isolated-next',setup(b){
 b.onResolve({filter:/^next\/(script|navigation)$/},({path:p})=>({path:p,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},({path:p})=>({contents:p==='next/script'?'export default function Script(){return null;}':'export function useRouter(){return {refresh(){window.qa.refreshes++}};}',loader:'js'}));
 }}]
});
if(process.env.BUNDLE_ONLY==='1'){console.log(JSON.stringify({name:'whatsapp-connect',stage:'bundle-only',browserExecuted:false}));process.exit(0);}
const server=http.createServer(async(req,res)=>{
 const file=req.url==='/'?null:req.url==='/app.js'?'app.js':null;
 if(req.url==='/'){res.setHeader('content-type','text/html');res.end('<html><body><div id="root"></div><script src="/app.js"></script></body></html>');}
 else if(file){res.setHeader('content-type','text/javascript');res.end(await readFile(path.join(out,file)));}
 else res.writeHead(404).end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const { chromium }=await import('playwright');
let browser;const checks=[];const errors=[];const blocked=[];
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext();
 await context.addInitScript(()=>{
  window.qa={callbacks:[],requests:[],refreshes:0,failConnect:false};
  window.FB={init(){},login(callback){window.qa.callbacks.push(callback);}};
 });
 await context.route('**/*',async(route)=>{
  const r=route.request();const u=new URL(r.url());
  if(u.origin===origin&&u.pathname==='/api/integrations/whatsapp/complete'&&r.method()==='POST'){
   const body=r.postDataJSON();const page=route.request().frame().page();
   await page.evaluate(b=>window.qa.requests.push(b),body);
   const fail=await page.evaluate(()=>window.qa.failConnect);
   const response=body.action==='prepare'?{ok:true,phase:'choose_number',sessionId:'00000000-0000-4000-8000-000000000001',choices:[{id:'111111111',accountId:'222222222',name:'Fixture negocio',phone:'+541100000000',selectable:true,reason:null}]}:
     body.action==='cancel'?{ok:true,phase:'cancelled'}:fail?{ok:false,code:'connection_failed',recovery:'check_status',error:'No se pudo confirmar la vinculación.'}:{ok:true,phase:'linked',message:'Cuenta vinculada. Fixture controlado.'};
   await route.fulfill({status:fail&&body.action==='connect'?502:200,json:response});return;
  }
  if(u.origin===origin&&['/','/app.js'].includes(u.pathname)&&r.method()==='GET'){await route.continue();return;}
  blocked.push(r.url());await route.abort();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
 const begin=async()=>{await page.goto(origin);await page.getByRole('button',{name:'Continuar con Meta',exact:true}).click();};
 const finish=async()=>page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:'https://www.facebook.com',data:JSON.stringify({type:'WA_EMBEDDED_SIGNUP',event:'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING',data:{waba_id:'222222222',phone_number_id:'111111111'}})})));
 const code=async(index=0)=>page.evaluate(i=>window.qa.callbacks[i]({authResponse:{code:'fixture-not-a-real-code'}}),index);
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});await page.clock.install();await begin();
  await page.clock.fastForward(4*60_000);await finish();await code();
  await page.getByText('Números compartidos por Meta',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.qa.requests.length),1);
  assert.equal(await page.evaluate(()=>window.qa.refreshes),0);
  assert.equal(await page.getByRole('button',{name:'Confirmar número y vincular'}).isDisabled(),true);
  await page.locator('input[name="whatsapp-number"]').check();
  await page.getByRole('button',{name:'Confirmar número y vincular'}).click();
  await page.getByText('Cuenta vinculada. Fixture controlado.',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.qa.refreshes),1);
  assert.deepEqual(await page.evaluate(()=>window.qa.requests.map(r=>r.action)),['prepare','connect']);
  checks.push(`${width}: Meta completion after four minutes is processed and still requires explicit phone confirmation`);
 }
 await begin();await finish();assert.equal(await page.evaluate(()=>window.qa.requests.length),0);
 assert.equal(await page.evaluate(()=>window.qa.refreshes),0);
 await page.getByRole('button',{name:'Cancelar',exact:true}).click();await code();
 assert.equal(await page.evaluate(()=>window.qa.requests.length),0);
 await page.getByRole('button',{name:'Continuar con Meta',exact:true}).click();
 await code(0);assert.equal(await page.evaluate(()=>window.qa.requests.length),0);
 await finish();await code(1);await page.getByText('Números compartidos por Meta',{exact:true}).waitFor();
 checks.push('FINISH alone cannot link; explicit cancellation and newer attempt reject stale callbacks');
 await page.evaluate(()=>window.qa.failConnect=true);await page.locator('input[name="whatsapp-number"]').check();
 await page.getByRole('button',{name:'Confirmar número y vincular'}).click();
 await page.getByText('No se pudo confirmar la vinculación.',{exact:true}).waitFor();
 assert.equal(await page.getByText('Cuenta vinculada. Fixture controlado.',{exact:true}).count(),0);
 checks.push('Failed backend persistence is not presented as connected');
 assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);
 await writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,checks,errors,blocked,fixturesOnly:true,browserExecuted:true},null,2));
 console.log(JSON.stringify({passed:true,checks,fixturesOnly:true}));
}catch(error){await writeFile(path.join(out,'result.json'),JSON.stringify({passed:false,checks,errors,blocked,error:String(error)},null,2));throw error;}
finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
