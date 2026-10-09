import test from "node:test";
import assert from "node:assert/strict";
import {parseSaveSaleInput,parseVoidSaleInput,saleLineCents,saleTotalCents,timestamp} from "../lib/sales/validation";
import {mutateSale,saleRpcResult} from "../lib/sales/service";
import {parseInboxSaleApproval} from "../lib/sales/inbox";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const input=()=>({requestId:id(1),businessId:id(2),userId:id(3),id:null,expectedVersion:null,branchId:id(4),occurredAt:"2026-01-01T12:00:00-03:00",channel:"salon",paymentMethod:"Efectivo",customerId:null,notes:null,items:[{productId:null,description:"Producto declarado",quantity:"2",unitPrice:"10.25"}]});
test("sale money uses exact cents and explicit per-line half-up rounding",()=>{
 assert.equal(saleLineCents({quantity:"0.5",unitPrice:"0.01"}),1n);
 assert.equal(saleLineCents({quantity:"0.499999",unitPrice:"0.01"}),0n);
 assert.equal(saleTotalCents([{productId:null,description:"A",quantity:"1",unitPrice:"0.1"},{productId:null,description:"B",quantity:"1",unitPrice:"0.2"}]),30);
 assert.equal(saleLineCents({quantity:"999999999999.999999",unitPrice:"0"}),0n);
});
test("sale domain rejects invented identity/origin/stock and malformed runtime inputs",()=>{
 for(const value of [null,[],{}, {...input(),source:"whatsapp"},{...input(),stock:true},{...input(),amount:1},{...input(),requestId:"bad"},{...input(),expectedVersion:1},{...input(),id:id(6)},{...input(),paymentMethod:""},{...input(),channel:"unknown"},{...input(),items:[]},{...input(),items:Array.from({length:101},()=>input().items[0])}])assert.throws(()=>parseSaveSaleInput(value));
 for(const quantity of [0,1,NaN,Infinity,"0","-1","1e3","1,5","1.0000001","01","1000000000000"]){assert.throws(()=>parseSaveSaleInput({...input(),items:[{...input().items[0],quantity}]}));}
 for(const unitPrice of [1,"-1","0.001","10000000000","1,00"]){assert.throws(()=>parseSaveSaleInput({...input(),items:[{...input().items[0],unitPrice}]}));}
 assert.throws(()=>parseSaveSaleInput({...input(),items:[{...input().items[0],quantity:"999999999999",unitPrice:"1"}]}));
 assert.throws(()=>parseVoidSaleInput({requestId:id(1),businessId:id(2),userId:id(3),id:id(4),expectedVersion:1,reason:""}));
});
test("sales dates require real civil date and timezone, never implicit current time",()=>{
 for(const date of ["2026-01-01","2026-01-01T10:00:00","2026-02-30T12:00:00Z","2026-01-01T24:00:00Z","2026-01-01T12:60:00Z"]){assert.throws(()=>timestamp(date));}
 assert.equal(timestamp("2024-02-29T23:30:00-03:00"),"2024-02-29T23:30:00-03:00");
});
test("all transports pass identical validated sales to shared SQL and keep replay identity",async()=>{
 const calls:any[]=[];const db={rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{ok:true,id:id(9),version:1},error:null};}};
 const value=parseSaveSaleInput(input());const context={businessId:value.businessId,userId:value.userId};
 assert.equal((await mutateSale(db,{...context,source:"manual"},"save",value)).ok,true);
 assert.equal((await mutateSale(db,{...context,source:"whatsapp"},"save",value)).ok,true);
 assert.deepEqual(calls.map(c=>c.args.p_input),[value,value]);assert.deepEqual(calls.map(c=>c.name),["save_sale_atomic","mutate_sale_for_agent"]);
 await mutateSale(db,{...context,source:"manual"},"save",value);assert.equal(calls[2].args.p_input.requestId,value.requestId);
});
test("changed session or business blocks sales before RPC",async()=>{
 let called=0;const db={rpc:async()=>{called++;return {data:null,error:null};}};
 for(const context of [{businessId:id(9),userId:id(3)},{businessId:id(2),userId:id(9)}])assert.equal((await mutateSale(db,{...context,source:"manual"},"save",input())).ok,false);
 assert.equal(called,0);
});
test("sale response uncertainty is never described as rollback or automatic retry",async()=>{
 for(const response of [{data:null,error:null},{data:{ok:true},error:null},{data:{ok:false,error:"sale_conflict"},error:{code:"network"}}])assert.equal(saleRpcResult(response).ok?true:saleRpcResult(response).persisted,"unknown");
 const rejected=saleRpcResult({data:{ok:false,error:"sale_conflict"},error:null});assert.equal(rejected.ok?true:rejected.persisted,false);
 let calls=0;const result=await mutateSale({rpc:async()=>{calls++;throw new Error("lost after commit");}},{businessId:id(2),userId:id(3),source:"manual"},"save",input());assert.equal(result.ok?true:result.persisted,"unknown");assert.equal(calls,1);
});
test("Inbox requires explicitly reviewed summary and channel amounts; no invented detail",()=>{
 const request={extractionId:id(1),businessId:id(2),userId:id(3),expectedFields:{total_amount:20},review:{kind:"summary",branchId:id(4),occurredAt:"2026-01-01T12:00:00Z",paymentMethod:null,notes:null,channels:[{channel:"salon",amount:"20"}]}};
 assert.equal(parseInboxSaleApproval(request).review.paymentMethod,null);
 for(const patch of [{kind:"detailed"},{channels:[]},{channels:[{channel:"salon",amount:20}]},{channels:[{channel:"unknown",amount:"20"}]},{channels:[{channel:"salon",amount:"20"},{channel:"salon",amount:"20"}]}])assert.throws(()=>parseInboxSaleApproval({...request,review:{...request.review,...patch}}));
});
