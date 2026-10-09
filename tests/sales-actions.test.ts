import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import {hasPermission,canSeeModule} from "../lib/permissions";
import * as service from "../lib/sales/service";
import * as inbox from "../lib/sales/inbox";
import * as reporting from "../app/ventas/reporting";
import {applyAdminBranchScope} from "../lib/data/branch-scope";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const state={database:true,authenticated:true,role:"owner",userId:id(1),businessId:id(2),enabled:["sales","inbox_ai"],failure:"",throwRefresh:false,calls:[] as any[],paths:[] as string[]};
const input=()=>({requestId:id(9),businessId:id(2),userId:id(1),id:null,expectedVersion:null,branchId:id(3),occurredAt:"2026-01-01T12:00:00Z",channel:"salon",paymentMethod:"Efectivo",customerId:null,notes:null,items:[{productId:null,description:"concept",quantity:"1",unitPrice:"1"}]});
const selections:any[]=[];
const db:any={from:(table:string)=>{
 let single=false;const filters:Record<string,unknown>={};let fields="";
 const q:any={select:(value:string)=>{fields=value;selections.push({table,fields});return q;},eq:(k:string,v:unknown)=>{filters[k]=v;return q;},in:()=>q,or:()=>q,order:()=>q,range:()=>q,maybeSingle:()=>{single=true;return q;},then:(resolve:any)=>{
 const rows=table==="profiles"?[{active:true}]:table==="businesses"?[{timezone:"UTC"}]:table==="branches"?[{id:id(3),name:"Branch"}]:table==="sales"?[{id:id(10),business_id:id(2),branch_id:id(3),status:"active",sale_kind:"detailed",amount:1,occurred_at:"2026-01-01T12:00:00Z"}]:table==="sale_items"?[{id:id(11),sale_id:id(10),business_id:id(2),position:1,product_id:null,quantity:"999999999999.123456",unit_price:"0.00",total:"0.00"}]:[];
 return Promise.resolve({data:single?rows[0]??null:rows,error:null,count:rows.length}).then(resolve);}};return q;},rpc:async(name:string,args:any)=>{state.calls.push({name,args});if(name==="get_sales_revision")return {data:"0",error:null};if(state.failure==="throw")throw new Error("network");return state.failure==="unknown"?{data:null,error:{code:"timeout"}}:state.failure?{data:{ok:false,error:state.failure},error:null}:{data:{ok:true,id:id(10),version:1},error:null};}};
const loader=Module as any;const original=loader._load;
loader._load=function(name:string,...args:any[]){const mocks:any={"next/cache":{revalidatePath:(path:string)=>{state.paths.push(path);if(state.throwRefresh)throw new Error("cache unavailable");}},"@/lib/data/auth":{getCurrentUserContext:async()=>({isAuthenticated:state.authenticated,userId:state.userId,businessId:state.businessId,role:state.role,enabledModules:state.enabled,assignedBranchIds:null})},"@/lib/supabase/server":{createSupabaseServerClient:async()=>db},"@/lib/env":{isDatabaseMode:()=>state.database},"@/lib/permissions":{hasPermission,canSeeModule},"@/lib/sales/service":service,"@/lib/sales/inbox":inbox,"@/app/ventas/reporting":reporting,"@/lib/data/branch-scope":{applyAdminBranchScope}};return name in mocks?mocks[name]:original.call(this,name,...args);};
const actions=require("../app/actions/sales") as typeof import("../app/actions/sales");loader._load=original;
function reset(){Object.assign(state,{database:true,authenticated:true,role:"owner",userId:id(1),businessId:id(2),enabled:["sales","inbox_ai"],failure:"",throwRefresh:false,calls:[],paths:[]});}
test("manual sale action uses exactly one domain RPC and invalidates every affected report",async()=>{
 reset();assert.equal((await actions.saveSaleAction(input())).ok,true);assert.equal(state.calls.length,1);assert.equal(state.calls[0].name,"save_sale_atomic");assert.deepEqual(state.calls[0].args.p_input.items[0],{...input().items[0],id:null});
 for(const path of ["/ventas","/","/clientes","/auditoria","/inbox","/balances","/gastos"])assert.ok(state.paths.includes(path));
});
test("sales action refuses missing session, disabled module, forbidden role and changed identity before write",async()=>{
 for(const setup of [()=>{state.database=false;},()=>{state.authenticated=false;},()=>{state.role="viewer";},()=>{state.role="accountant";},()=>{state.enabled=[];},()=>{state.userId=id(22);},()=>{state.businessId=id(22);}]){reset();setup();assert.equal((await actions.saveSaleAction(input())).ok,false);assert.equal(state.calls.length,0);}
});
test("SQL rejection and network uncertainty remain distinct, cache failure never reverses confirmed sale",async()=>{
 reset();state.failure="sale_conflict";let result=await actions.saveSaleAction(input());assert.equal(result.ok?true:result.persisted,false);
 for(const failure of ["throw","unknown"]){reset();state.failure=failure;result=await actions.saveSaleAction(input());assert.equal(result.ok?true:result.persisted,"unknown");assert.equal(state.calls.length,1);}
 reset();state.throwRefresh=true;assert.equal((await actions.saveSaleAction(input())).ok,true);
});
test("Inbox approval shares engine wrapper with reviewed fields and no guessed origin",async()=>{
 reset();const review={extractionId:id(8),businessId:id(2),userId:id(1),expectedFields:{total_amount:5},review:{kind:"summary",branchId:id(3),occurredAt:"2026-01-01T12:00:00Z",paymentMethod:null,notes:null,channels:[{channel:"salon",amount:"5"}]}};
 assert.equal((await actions.approveInboxSaleAction(review)).ok,true);assert.equal(state.calls[0].name,"approve_sale_extraction_atomic");assert.equal(state.calls[0].args.p_actor_id,id(1));assert.deepEqual(state.calls[0].args.p_expected_fields,{total_amount:5});
 reset();state.userId=id(20);assert.equal((await actions.approveInboxSaleAction(review)).ok,false);assert.equal(state.calls.length,0);
});

test("sales workspace requests textual quantities and preserves precise decimals",async()=>{
 reset();selections.length=0;const result=await actions.getSalesWorkspaceAction();assert.equal(result.ok,true);if(!result.ok)return;
 assert.equal(result.data.sales[0].items[0].quantity,"999999999999.123456");
 assert.ok(selections.find(q=>q.table==="sale_items").fields.includes("quantity::text"));
 assert.equal(state.calls.filter(c=>c.name==="get_sales_revision").length,2);
});
