import test from "node:test";
import assert from "node:assert/strict";
import {withSalesRevision} from "../lib/sales/read";
test("paged sales scan rejects same-count mutation using private transaction revision",async()=>{
 const revisions=["7","8"];let reads=0;
 await assert.rejects(withSalesRevision({rpc:async(name,args)=>{assert.equal(name,"get_sales_revision");assert.equal(args.p_business_id,"business");return {data:revisions.shift(),error:null};}},"business",async()=>{reads++;return [{amount:1}];}),/cambiaron/);
 assert.equal(reads,1);
});
test("stable sales revision returns original data and failures are not empty reports",async()=>{
 const rows=[{amount:1}];assert.equal(await withSalesRevision({rpc:async()=>({data:"123",error:null})},"business",async()=>rows),rows);
 for(const data of [null,1,"",{},"NaN"]){await assert.rejects(withSalesRevision({rpc:async()=>({data,error:null})},"business",async()=>rows),/verificar/);}
});
