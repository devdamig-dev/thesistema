// Real components, isolated fixture actions. No Supabase/Meta credentials or network writes.
import { build } from 'esbuild';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out=path.join(root,'.test-artifacts/catalog-ui');
await fs.mkdir(out,{recursive:true});
execFileSync(process.execPath,[path.join(root,'node_modules/tailwindcss/lib/cli.js'),'-i','app/globals.css','-o',path.join(out,'style.css'),'--minify'],{cwd:root,stdio:'inherit'});
const catalog=`
const state=window.qa={canEdit:true,delay:0,holdRecipe:false,releaseRecipe:null,recipeCalls:0,ingredientCalls:0,conflict:false};
const ingredients=[{id:'ing',name:'Harina',unit:'kg',unitCost:1200,active:true,supplierId:null,stock:[{branchId:'branch',branchName:'Central',current:20,minimum:5}]}];
export const getCatalogDataAction=async()=>({ok:true,data:{ingredients,suppliers:[],branches:[{id:'branch',name:'Central'}],canEdit:state.canEdit}});
export const getRecipeAction=async(productId)=>({ok:true,data:{productId,recipeId:'rec',updatedAt:'2026-10-09T00:00:00Z',items:[{ingredientId:'ing',quantity:250,unit:'g',name:'Harina'}]}});
export const saveRecipeAction=async(productId,input)=>{state.recipeCalls++;state.lastRecipe=input;if(state.holdRecipe)await new Promise(r=>{state.releaseRecipe=r});await new Promise(r=>setTimeout(r,state.delay));return state.conflict?{ok:false,error:'La información cambió mientras editabas. Volvé a cargarla antes de guardar.'}:{ok:true,persisted:true,cost:300};};
export const saveIngredientAction=async(id,input)=>{state.ingredientCalls++;state.lastIngredient=input;await new Promise(r=>setTimeout(r,state.delay));return {ok:true,persisted:true,id:id||'new'};};
`;
const products=`export const getProductsPageDataAction=async()=>({ok:true,data:[{id:'prod',name:'Pan casero',category:'Panadería',price:1500,cost:300,active:true,recipeId:'rec',ingredientCount:1}]});export const createProductAction=async()=>({ok:true,persisted:true,productId:'prod'});export const updateProductAction=async()=>({ok:true,persisted:true,productId:'prod'});`;
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Page from '${root}/app/productos/database-products-page.tsx';import {ToastProvider} from '${root}/components/ui/toast.tsx';createRoot(document.getElementById('root')).render(<ToastProvider><Page/></ToastProvider>);`,loader:'tsx',resolveDir:root},outfile:out+'/app.js',bundle:true,platform:'browser',jsx:'automatic',nodePaths:[root+'/node_modules'],tsconfig:root+'/tsconfig.json',plugins:[{name:'test-actions',setup(b){b.onResolve({filter:/^@\/app\/actions\/(catalog|products-page)$/},args=>({path:args.path,namespace:'qa'}));b.onResolve({filter:/^next\/link$/},()=>({path:'next/link',namespace:'qa'}));b.onLoad({filter:/.*/,namespace:'qa'},args=>({contents:args.path.endsWith('/catalog')?catalog:args.path.endsWith('/products-page')?products:`import React from 'react';export default function Link({children,...props}){return React.createElement('a',props,children)}`,loader:'jsx',resolveDir:root}));}}]});
await fs.writeFile(out+'/index.html','<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root" class="p-4"></div><script src="/app.js"></script></body></html>');
const server=http.createServer(async(req,res)=>{try{const f=req.url==='/'?'index.html':req.url.slice(1);res.setHeader('Content-Type',f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':'text/html');res.end(await fs.readFile(out+'/'+f));}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');
await new Promise(resolve=>server.once('listening',resolve));
const port=server.address().port;
let browser;
try { browser=await chromium.launch({headless:true}); } catch(error) { server.close(); throw error; }
const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));const results=[];
async function check(name,fn){console.log('CHECK '+name);await fn();results.push(name);console.log('PASS '+name)}
async function settleDrawer(){await page.waitForFunction(()=>{const panel=document.querySelector('aside');return panel&&Math.abs(panel.getBoundingClientRect().right-window.innerWidth)<1});}
try{
 await page.goto(`http://127.0.0.1:${port}`);await page.getByRole('button',{name:'Composición',exact:true}).waitFor();
 await check('composition converts 250 g at ARS 1200/kg to ARS 300 and 80% margin',async()=>{await page.getByRole('button',{name:'Composición',exact:true}).click();await page.getByRole('button',{name:'Guardar composición'}).waitFor();await page.getByText(/^80(?:,0)?%$/).last().waitFor();await page.locator('aside').getByText(/^\$\s*300,00$/).waitFor();await settleDrawer();});
 await page.screenshot({path:out+'/composition-desktop.png',fullPage:true});
 await check('incompatible quantity units block save',async()=>{await page.getByLabel('Unidad utilizada').selectOption('ml');await page.getByRole('button',{name:'Guardar composición'}).click();if(await page.evaluate(()=>window.qa.recipeCalls)!==0)throw Error('invalid recipe saved');await page.getByLabel('Unidad utilizada').selectOption('g');});
 await check('pending submission rejects duplicate clicks and dismissal',async()=>{await page.evaluate(()=>{window.qa.holdRecipe=true});await page.getByRole('button',{name:'Guardar composición'}).dblclick({delay:20});await page.getByRole('button',{name:'Cerrar',exact:true}).click();if(!await page.getByRole('heading',{name:'Composición · Pan casero'}).isVisible())throw Error('closed pending');if(await page.evaluate(()=>window.qa.recipeCalls)!==1)throw Error('duplicate');await page.evaluate(()=>{window.qa.holdRecipe=false;window.qa.releaseRecipe()});await page.locator('aside').waitFor({state:'detached'});});
 await check('conflict retains draft and offers explicit reload',async()=>{await page.evaluate(()=>{window.qa.delay=0;window.qa.conflict=true});await page.getByRole('button',{name:'Composición',exact:true}).click();await page.getByRole('button',{name:'Guardar composición'}).click();await page.getByRole('button',{name:'Descartar cambios y recargar'}).waitFor();await page.getByRole('button',{name:'Descartar cambios y recargar'}).click();await page.getByRole('button',{name:'Guardar composición'}).waitFor();await page.getByRole('button',{name:'Cancelar',exact:true}).click();await page.locator('aside').waitFor({state:'detached'});});
 await check('ingredient editor sets minimum without changing current stock',async()=>{await page.getByRole('tab',{name:'Insumos',exact:true}).click();await page.getByRole('button',{name:'Editar',exact:true}).click();await page.getByLabel('Stock mínimo en Central').fill('8');await page.getByRole('button',{name:'Guardar insumo',exact:true}).click();await page.locator('aside').waitFor({state:'detached'});const s=await page.evaluate(()=>window.qa.lastIngredient);if(s.minimums[0].minimum!==8||'current'in s)throw Error('stock payload invalid');});
 await check('new ingredient has no invented base cost',async()=>{await page.getByRole('button',{name:'Nuevo insumo',exact:true}).click();if(await page.getByLabel(/Costo por unidad/).inputValue()!=='')throw Error('cost not empty');await page.getByRole('button',{name:'Cancelar',exact:true}).click();});
 await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'Productos',exact:true}).click();await page.getByRole('button',{name:'Composición',exact:true}).click();await page.getByRole('button',{name:'Guardar composición'}).waitFor();await settleDrawer();await page.screenshot({path:out+'/composition-mobile.png',fullPage:true});
 await check('mobile editor has no page horizontal overflow',async()=>{if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw Error('mobile overflow');});
 if(errors.length)throw Error(errors.join('\n'));
 console.log(JSON.stringify({passed:results.length,tests:results,pageErrors:errors}));
}catch(error){console.error('Browser page errors:',JSON.stringify(errors));console.error('Visible fixture text:',await page.locator('body').innerText());await page.screenshot({path:out+'/failure.png',fullPage:true});throw error;}finally{await browser.close();server.close();}
