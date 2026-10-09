import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readProductCatalogSnapshot } from "../lib/catalog/snapshot";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const businessId = id(21);
const product = () => ({ id: id(61), name: "Pan", category: "Food", price: 100, cost: 80, active: true, recipeId: id(71), ingredientCount: 1, recipeNeedsReview: false });
const snapshot = () => ({ businessId, costRefreshPending: false, products: [product()] });

test("catalog read uses exactly one tenant-scoped RPC and never table pagination", async () => {
  const calls: unknown[] = [];
  const db = { from() { throw new Error("independent catalog reads are unsafe"); }, async rpc(name: string,args: unknown) { calls.push({name,args}); return {data:snapshot(),error:null}; } };
  const result = await readProductCatalogSnapshot(db,businessId,false);
  assert.equal(result.ok,true);
  assert.deepEqual(calls,[{name:"read_product_catalog_snapshot",args:{p_business_id:businessId}}]);
  if (result.ok) assert.equal(result.data[0].costRefreshPending,false);
});

test("both live snapshot and restricted context veto freshness certification", async () => {
  for (const [pending,restricted] of [[true,false],[false,true],[true,true]]) {
    const result = await readProductCatalogSnapshot({rpc:async()=>({data:{...snapshot(),costRefreshPending:pending}})},businessId,restricted);
    assert.equal(result.ok,true);
    if (result.ok) assert.equal(result.data[0].costRefreshPending,true);
  }
});

test("snapshot read fails closed on errors, missing warning, truncation, invalid rows, or wrong tenant", async () => {
  const bad: unknown[] = [null,[],{}, {...snapshot(),businessId:id(22)}, {...snapshot(),costRefreshPending:undefined},
    {...snapshot(),costRefreshPending:"false"},{...snapshot(),products:null},{...snapshot(),products:Array(50001).fill(product())},
    {...snapshot(),products:[product(),product()]},
    ...["cost","price","active","ingredientCount","recipeNeedsReview","recipeId"].map(key=>({...snapshot(),products:[{...product(),[key]:undefined}]})),
    ...[null,NaN,Infinity,-1,"80"].map(cost=>({...snapshot(),products:[{...product(),cost}]})),
    {...snapshot(),products:[{...product(),recipeId:null}]},
  ];
  for (const data of bad) assert.equal((await readProductCatalogSnapshot({rpc:async()=>({data})},businessId,false)).ok,false);
  assert.equal((await readProductCatalogSnapshot({rpc:async()=>({data:snapshot(),error:{message:"read denied"}})},businessId,false)).ok,false);
  assert.equal((await readProductCatalogSnapshot({rpc:async()=>{throw new Error("timeout");}},businessId,false)).ok,false);
});

test("atomic response remains self-consistent when refresh finishes before response delivery", async () => {
  let state = {...snapshot(),costRefreshPending:true,products:[{...product(),cost:10}]};
  const db = { async rpc() { const result=structuredClone(state); state={...snapshot(),products:[{...product(),cost:20}]}; return {data:result}; } };
  const first=await readProductCatalogSnapshot(db,businessId,false);
  assert.equal(first.ok,true);
  if(first.ok) assert.deepEqual([first.data[0].cost,first.data[0].costRefreshPending],[10,true]);
  const next=await readProductCatalogSnapshot(db,businessId,false);
  if(next.ok) assert.deepEqual([next.data[0].cost,next.data[0].costRefreshPending],[20,false]);
});

const state = { response: {data:snapshot(),error:null} as any, sent: [] as any[], calls: [] as any[], duplicate:false, database:true };
const db = { async rpc(name: string,args: unknown) { state.calls.push({name,args}); return state.response; },
  from(table:string) { assert.equal(table,"notifications"); const query:any={select(){return query;},eq(){return query;},gte(){return query;},limit(){return query;},async maybeSingle(){return {data:state.duplicate?{id:id(99)}:null};}};return query; }
};
const loader=Module as any, original=loader._load;
loader._load=function(name:string,...args:any[]) {
  const mocks:Record<string,unknown>={"@/lib/supabase/admin":{createSupabaseAdminClient:()=>db},"@/lib/env":{isDatabaseMode:()=>state.database},"@/lib/data/notifications":{createNotification:async(input:unknown)=>{state.sent.push(input);}}};
  return name in mocks?mocks[name]:original.call(this,name,...args);
};
const {checkCriticalMarginForBusiness}=require("../lib/data/notification-checks");loader._load=original;
function reset(){state.response={data:snapshot(),error:null};state.sent=[];state.calls=[];state.duplicate=false;state.database=true;}

test("current margin notifications suppress pending and last-active-receipt-void costs", async()=>{
  for(const condition of ["pending manager purchase","last receipt voided; refresh cannot certify"]){
    reset();state.response.data.costRefreshPending=true;
    assert.equal((await checkCriticalMarginForBusiness(businessId)).created,0,condition);assert.deepEqual(state.sent,[]);
    assert.deepEqual(state.calls,[{name:"read_product_catalog_snapshot",args:{p_business_id:businessId}}]);
  }
});
test("current margin notifications suppress incomplete, inactive, zero-price and failed snapshots", async()=>{
  for(const productOverride of [{recipeNeedsReview:true},{active:false},{price:0}]){
    reset();state.response.data.products=[{...product(),...productOverride}];
    assert.equal((await checkCriticalMarginForBusiness(businessId)).created,0);assert.deepEqual(state.sent,[]);
  }
  for(const response of [{data:null,error:null},{data:snapshot(),error:{message:"RPC missing"}},{data:{...snapshot(),businessId:id(22)},error:null}]){
    reset();state.response=response;assert.equal((await checkCriticalMarginForBusiness(businessId)).created,0);assert.deepEqual(state.sent,[]);
  }
});
test("certified critical margin notification preserves dedup and tenant destination", async()=>{
  reset();assert.equal((await checkCriticalMarginForBusiness(businessId)).created,1);assert.equal(state.sent.length,1);
  assert.equal(state.sent[0].businessId,businessId);assert.match(state.sent[0].title,/1 producto/);assert.match(state.sent[0].detail,/Pan/);
  reset();state.duplicate=true;assert.deepEqual(await checkCriticalMarginForBusiness(businessId),{created:0,skipped:1});assert.deepEqual(state.sent,[]);
});
