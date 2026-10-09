/** Isolated real Inbox sale review. No provider calls, production database or
 * credentials. BUNDLE_ONLY=1 verifies bundling without claiming browser QA. */
import {assert,root,runUiHarness,noOverflow,viewports} from '../scripts/ui-fixtures/harness.mjs';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const actions=join(root,'.test-artifacts/inbox-sales-actions.mjs');
// Fixture module is intentionally under ignored test artifacts, never app code.
await import('node:fs/promises').then(fs=>fs.mkdir(join(root,'.test-artifacts'),{recursive:true}));
await writeFile(actions,`export async function approveInboxSaleAction(input){window.qa.calls.push(structuredClone(input));if(window.qa.delay)await new Promise(resolve=>window.qa.release=resolve);return window.qa.responses.shift()??{ok:true,persisted:true,id:'00000000-0000-4000-8000-000000000020',version:1};}`);
await runUiHarness({
 name:'inbox-sales',actionModules:{'@/app/actions/sales':actions},
 entry:`import React from 'react';import {createRoot} from 'react-dom/client';import {InboxSaleReviewDialog} from '${root}/app/inbox/sale-review.tsx';
 const review={extractionId:'00000000-0000-4000-8000-000000000001',businessId:'00000000-0000-4000-8000-000000000002',userId:'00000000-0000-4000-8000-000000000003',timezone:'America/Argentina/Buenos_Aires',branchId:'00000000-0000-4000-8000-000000000004',branches:[{id:'00000000-0000-4000-8000-000000000004',name:'QA ficticia'}],expectedFields:{total_amount:30},channels:[{channel:'salon',amount:'20'},{channel:'whatsapp',amount:'10'}],occurredAt:'',paymentMethod:'',notes:''};
 window.qa={calls:[],responses:[],saved:0,closed:0,delay:false};const root=createRoot(document.getElementById('root'));root.render(<InboxSaleReviewDialog review={review} onClose={()=>window.qa.closed++} onSaved={()=>window.qa.saved++}/>);`,
 async run({page,origin,check,screenshot}){
  for(const viewport of viewports){
   await page.setViewportSize({width:viewport.width,height:viewport.height});await page.goto(origin);
   await page.getByRole('heading',{name:'Revisar resumen de ventas'}).waitFor();
   await check(`${viewport.name}: no inferred date or tickets`,async()=>{await noOverflow(page);assert.equal(await page.getByLabel('Fecha y hora del resumen').inputValue(),'');await page.getByRole('button',{name:'Confirmar resumen',exact:true}).click();assert.equal(await page.evaluate(()=>window.qa.calls.length),0);await page.getByRole('alert').waitFor();});
   await page.getByLabel('Fecha y hora del resumen').fill('2026-01-01T12:00');
   await check(`${viewport.name}: uncertain replay freezes exact batch`,async()=>{
    await page.evaluate(()=>window.qa.responses.push({ok:false,persisted:'unknown',error:'Respuesta interrumpida'}));
    await page.getByRole('button',{name:'Confirmar resumen',exact:true}).click();await page.getByRole('button',{name:'Reintentar mismo resumen',exact:true}).waitFor();
    assert.equal(await page.getByLabel('Importe 1').isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Cancelar',exact:true}).isDisabled(),true);await screenshot(`uncertain-${viewport.name}`);
    await page.getByRole('button',{name:'Reintentar mismo resumen',exact:true}).click();await page.waitForFunction(()=>window.qa.saved===1);
    const calls=await page.evaluate(()=>window.qa.calls);assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].review.paymentMethod,null);assert.equal(calls[0].review.kind,'summary');assert.equal(calls[0].review.occurredAt,'2026-01-01T15:00:00.000Z');
   });await screenshot(`review-${viewport.name}`);
  }
 }
});
