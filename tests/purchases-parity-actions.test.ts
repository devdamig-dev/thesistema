import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { hasPermission } from "../lib/permissions";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const state={role:"owner",branches:null as string[]|null,pending:false,readError:false,source:"whatsapp",invoice:null as string|null,kind:"detailed",rpcs:[] as any[], queries:[] as any[],rpcError:null as null|{code:string;message:string},receipts:new Map<string,any>(),loseResponse:false};
const ctx=()=>({isAuthenticated:true,userId:id(1),businessId:id(2),role:state.role,assignedBranchIds:state.branches});
function database(){return {
 from(table:string){const filters:Record<string,unknown>={}; const q:any={
  select(){return q;},eq(k:string,v:unknown){filters[k]=v;return q;},in(){return q;},order(){return q;},range(){return q;},limit(){return q;},
  result(single=false){state.queries.push({table,filters});let rows:any[]=[];
   if(table==="purchases"&&filters.cost_refresh_pending===true)return {data:state.readError?null:state.pending?[{id:id(6)}]:[],error:state.readError?{message:"unavailable"}:null};
   if(table==="products")rows=[{id:id(3),name:"Pan",category:"Panadería",price:100,cost:20,active:true}];
   if(table==="suppliers"||table==="branches")rows=[{id:filters.id,name:"Fixture"}];
   if(table==="purchases")rows=[{id:id(6),branch_id:id(4),supplier_id:id(5),purchased_at:"2026-10-09",payment_method:"Efectivo",version:1,record_status:"active",source:state.source,invoice_id:state.invoice,purchase_kind:state.kind,total:25,receipt_reference:"Ticket A-123"}];
   if(table==="purchase_items"&&state.kind!=="summary")rows=[{ingredient_id:id(7),description:"Harina",qty:2,unit:"kg",unit_price:12.5}];
   return {data:single?rows[0]??null:rows,error:null,count:rows.length};
  },async maybeSingle(){return q.result(true);},then(resolve:any){return Promise.resolve(q.result()).then(resolve);}
 };return q;},
 async rpc(name:string,args:any){state.rpcs.push({name,args});
  if(state.rpcError)return {data:null,error:state.rpcError};
  if(name==="create_purchase_manual_atomic"){
   const previous=state.receipts.get(args.p_input.requestId);
   if(previous&&JSON.stringify(previous)!==JSON.stringify(args.p_input))return {data:null,error:{code:"23505",message:"purchase_idempotency_conflict"}};
   state.receipts.set(args.p_input.requestId,structuredClone(args.p_input));
   if(state.loseResponse){state.loseResponse=false;throw new Error("lost after commit");}
  }
  if(name==="read_product_catalog_snapshot") return {data:state.readError?null:{businessId:id(2),costRefreshPending:state.pending,products:[{id:id(3),name:"Pan",category:"Panadería",price:100,cost:20,active:true,recipeId:null,ingredientCount:0,recipeNeedsReview:false}]},error:state.readError?{message:"unavailable"}:null};
  return {data:name==="refresh_purchase_costs_atomic"?{ok:true,refreshed:2,pending:1}:{ok:true,id:id(6),costRefreshPending:true},error:null};}
};}
const loader=Module as any,original=loader._load;
loader._load=function(name:string,...args:any[]){
 const mocks:Record<string,any>={"next/cache":{revalidatePath(){}},"@/lib/env":{isDatabaseMode:()=>true},"@/lib/data/auth":{getCurrentUserContext:async()=>ctx()},"@/lib/supabase/server":{createSupabaseServerClient:async()=>database()},"@/lib/permissions":{hasPermission}};
 for(const local of ["permissions/server-action","catalog/pagination"])if(name===`@/lib/${local}`)return original.call(this,require.resolve(`../lib/${local}`),...args);
 return name in mocks?mocks[name]:original.call(this,name,...args);
};
const purchases=require("../app/actions/purchases-page"),products=require("../app/actions/products-page");loader._load=original;
function reset(){state.role="owner";state.branches=null;state.pending=false;state.readError=false;state.source="whatsapp";state.invoice=null;state.kind="detailed";state.rpcs=[];state.queries=[];state.rpcError=null;state.receipts.clear();state.loseResponse=false;}
const input=()=>({requestId:id(8),branchId:id(4),supplierId:id(5),purchasedAt:"2026-10-09",paymentMethod:"Efectivo",description:"Harina",qty:2,unit:"kg",unitPrice:12.5});

test("product readmodel hides current cost and margin whenever purchase evidence cannot be certified",async()=>{
 for(const setup of [()=>{state.pending=true;},()=>{state.branches=[id(4)];}]){
  reset();setup();const result=await products.getProductsPageDataAction();assert.equal(result.ok,true);assert.equal(result.data[0].costRefreshPending,true);
 }
 reset();const result=await products.getProductsPageDataAction();assert.equal(result.data[0].costRefreshPending,false);
 assert.deepEqual(state.rpcs,[{name:"read_product_catalog_snapshot",args:{p_business_id:id(2)}}]);
 assert.deepEqual(state.queries,[]);
 reset();state.readError=true;assert.equal((await products.getProductsPageDataAction()).ok,false);
});

test("summary action preserves optional text reference without inventing physical lines",async()=>{
 reset();const result=await purchases.createPurchaseAction({...input(),kind:"summary",amount:"25.00",receiptReference:" Ticket A-123 "});
 assert.equal(result.ok,true);assert.equal(result.costRefreshPending,true);assert.equal(state.rpcs.length,1);
 assert.equal(state.rpcs[0].name,"create_purchase_manual_atomic");assert.equal(state.rpcs[0].args.p_input.receiptReference,"Ticket A-123");assert.equal(state.rpcs[0].args.p_input.amount,"25.00");assert.equal(Object.hasOwn(state.rpcs[0].args.p_input,"items"),false);
});

test("purchase reference rejects oversized multiline or file-shaped values before writes",async()=>{
 for(const receiptReference of ["x".repeat(201),"Ticket\n123",{file:"receipt.pdf"}]){reset();assert.equal((await purchases.createPurchaseAction({...input(),receiptReference})).ok,false);assert.equal(state.rpcs.length,0);}
});

test("noninvoice WhatsApp and Inbox purchases can be prepared for audited correction",async()=>{
 for(const source of ["manual","whatsapp","inbox"]){reset();state.source=source;const result=await purchases.getPurchaseCorrectionAction(id(6));assert.equal(result.ok,true);assert.equal(result.input.replacesPurchaseId,id(6));assert.equal(result.input.receiptReference,"Ticket A-123");assert.equal(result.input.items[0].qty,2);}
 reset();state.kind="summary";const result=await purchases.getPurchaseCorrectionAction(id(6));assert.equal(result.ok,true);assert.equal(result.input.kind,"summary");assert.equal(result.input.amount,"25");assert.deepEqual(result.input.items,[]);
 reset();state.invoice=id(9);assert.equal((await purchases.getPurchaseCorrectionAction(id(6))).ok,false);
 reset();state.branches=[id(99)];assert.equal((await purchases.getPurchaseCorrectionAction(id(6))).ok,false);
});

test("only authorized owner/admin refresh costs and still report missing active evidence",async()=>{
 for(const role of ["manager","viewer","employee","marketing"]){reset();state.role=role;assert.equal((await purchases.refreshPurchaseCostsAction()).ok,false);assert.equal(state.rpcs.length,0);}
 for(const role of ["owner","admin"]){reset();state.role=role;assert.deepEqual(await purchases.refreshPurchaseCostsAction(),{ok:true,refreshed:2,pending:1});assert.deepEqual(state.rpcs,[{name:"refresh_purchase_costs_atomic",args:{p_business_id:id(2)}}]);}
});


test("v1 journal replay after an upgrade preserves an already committed payload without kind",async()=>{
 reset();const legacy=input();
 const exactOldPayload={requestId:legacy.requestId,branchId:legacy.branchId,supplierId:legacy.supplierId,purchasedAt:legacy.purchasedAt,paymentMethod:legacy.paymentMethod,items:[{ingredientId:null,description:"Harina",qty:"2",unit:"kg",unitPrice:"12.5"}]};
 // This is the exact pre-upgrade receipt left by a commit followed by a lost reply.
 state.receipts.set(legacy.requestId,structuredClone(exactOldPayload));state.loseResponse=true;
 const first=await purchases.createPurchaseAction(legacy);assert.equal(first.persisted,null);
 const replay=await purchases.createPurchaseAction(JSON.parse(JSON.stringify(legacy)));
 assert.equal(replay.ok,true);assert.equal(state.receipts.size,1);
 assert.deepEqual(state.rpcs.map(call=>call.args.p_input),[exactOldPayload,exactOldPayload]);
 assert.equal(Object.hasOwn(state.rpcs[1].args.p_input,"kind"),false);
});

test("idempotency conflicts never assert that the previous attempt was not persisted",async()=>{
 reset();state.rpcError={code:"23505",message:"purchase_idempotency_conflict"};
 assert.equal((await purchases.createPurchaseAction(input())).persisted,null);
});
