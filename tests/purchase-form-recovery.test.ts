/** Executes the real form handlers with deterministic hooks and local storage.
 * This complements, rather than replaces, the browser fixture recovery tests. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const scope="fixture:user:business",journalKey=`gastropilot:purchase-attempt:${scope}`;
const legacy={requestId:"00000000-0000-4000-8000-000000000010",branchId:"branch",supplierId:"supplier",purchasedAt:"2026-10-09",paymentMethod:"Efectivo",description:"Compra anterior",qty:2,unit:"kg",unitPrice:100};
function fixture(saved:unknown,onSubmit:(input:any)=>Promise<boolean|null>){
 const storage=new Map<string,string>();if(saved)storage.set(journalKey,JSON.stringify(saved));
 let hooks:any[]=[],index=0;
 const react={
  useState(initial:any){const i=index++;if(!(i in hooks))hooks[i]=typeof initial==="function"?initial():initial;return [hooks[i],(value:any)=>{hooks[i]=typeof value==="function"?value(hooks[i]):value;}];},
  useRef(initial:any){const i=index++;return hooks[i]??(hooks[i]={current:initial});},
  useMemo(fn:()=>any){return fn();},useEffect(){},useTransition(){return [false,(f:()=>any)=>f()];},
  isValidElement(){return false;},cloneElement(value:any){return value;}
 };
 const jsx=(_type:any,props:any)=>({type:_type,props});
 const loaded={exports:{} as any};
 const source=ts.transpileModule(readFileSync("app/compras/page.tsx","utf8")+"\nexport { PurchaseForm };",{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const sandbox={module:loaded,exports:loaded.exports,process:{env:{NEXT_PUBLIC_APP_MODE:"database"}},window:{},sessionStorage:{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)},crypto:{randomUUID:()=>legacy.requestId},require:(name:string)=>name==="react"?react:name==="react/jsx-runtime"?{jsx,jsxs:jsx}:name==="@/lib/env"?{isDatabaseMode:()=>true}:name==="@/lib/format"?{formatARS:(v:number)=>String(v)}:new Proxy({},{get:(_target,key)=>String(key)})};
 vm.runInNewContext(source,sandbox);
 const props={pending:false,suppliers:[],branches:[],ingredients:[],scope,correction:null,canCreateSupplier:false,onCancel(){},onCreateSupplier(){},onSubmit};
 function render(){index=0;return loaded.exports.PurchaseForm(props);}
 async function submit(){render().props.onSubmit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));return render();}
 function reopen(){hooks=[];return render();}
 function setField(label:string,value:string){
  function find(node:any):any {if(!node)return null;if(Array.isArray(node))return node.map(find).find(Boolean);if(node.props?.label===label)return node;return find(node.props?.children);}
  const field=find(render());assert.ok(field,`field ${label}`);field.props.children.props.onChange({target:{value}});
 }
 return {storage,render,submit,reopen,setField};
}
function allText(node:any):string {if(typeof node==="string")return node;if(!node)return "";if(Array.isArray(node))return node.map(allText).join(" ");return allText(node.props?.children);}

test("v1 committed/lost-response journal survives upgrade rejection and replays only its original input",async()=>{
 const ledger=new Map([[legacy.requestId,JSON.stringify(legacy)]]);const calls:any[]=[];let response:"reject"|"success"="reject";
 const f=fixture({key:legacy.requestId,input:legacy},async(input)=>{
  calls.push(JSON.parse(JSON.stringify(input)));
  if(response==="reject")return false; // Revoked supplier/preflight or rejected receipt lookup.
  assert.equal(ledger.get(input.requestId),JSON.stringify(input));return true;
 });
 const rejected=await f.submit();assert.equal(rejected.props.children[0].props.disabled,true);
 assert.match(allText(rejected),/Se conserva la misma referencia/);
 assert.deepEqual(JSON.parse(f.storage.get(journalKey)!),{key:legacy.requestId,input:legacy});
 f.reopen();response="success";await f.submit();
 assert.deepEqual(calls,[legacy,legacy]);assert.equal(Object.hasOwn(calls[1],"kind"),false);assert.equal(ledger.size,1);assert.equal(f.storage.has(journalKey),false);
});

test("new uncertain commit remains locked after later rejection, including after closing and reopening",async()=>{
 const receipts=new Map<string,any>();const replies:(boolean|null)[]=[null,false,true];const calls:any[]=[];
 const f=fixture(null,async(input)=>{
  calls.push(JSON.parse(JSON.stringify(input)));if(!receipts.has(input.requestId))receipts.set(input.requestId,input);
  return replies.shift()!;
 });
 for(const [label,value] of [["Sucursal *",legacy.branchId],["Proveedor *",legacy.supplierId],["Descripción *",legacy.description],["Precio unitario *","100"]])f.setField(label,value);
 await f.submit();await f.submit();assert.equal(f.storage.has(journalKey),true);assert.equal(f.render().props.children[0].props.disabled,true);
 f.reopen();await f.submit();assert.equal(receipts.size,1);assert.deepEqual(calls,[calls[0],calls[0],calls[0]]);assert.equal(f.storage.has(journalKey),false);
});

test("unexpected transport exceptions retain a restored journal for the same UUID",async()=>{
 const f=fixture({key:legacy.requestId,input:legacy},async()=>{throw new Error("transport lost");});
 await f.submit();assert.deepEqual(JSON.parse(f.storage.get(journalKey)!),{key:legacy.requestId,input:legacy});assert.equal(f.render().props.children[0].props.disabled,true);
});


test("a first definitive rejection without previous uncertainty still unlocks the new draft",async()=>{
 const f=fixture(null,async()=>false);
 for(const [label,value] of [["Sucursal *",legacy.branchId],["Proveedor *",legacy.supplierId],["Descripción *",legacy.description],["Precio unitario *","100"]])f.setField(label,value);
 await f.submit();assert.equal(f.storage.has(journalKey),false);assert.equal(f.render().props.children[0].props.disabled,false);
});
