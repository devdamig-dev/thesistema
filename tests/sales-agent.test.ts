import test from "node:test";
import assert from "node:assert/strict";
import {runAgent} from "../lib/whatsapp-agent/core";
import {interpretHeuristically} from "../lib/whatsapp-agent/interpreter";
import {WHATSAPP_TOOLS} from "../lib/whatsapp-agent/registry";
import {prepareSaleTool,executeSaleTool,validateSaleCall,missingSaleArguments} from "../lib/sales/agent";
import type {AgentActor,AgentDependencies,PendingOperation,IncomingAgentMessage} from "../lib/whatsapp-agent/types";
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor:AgentActor={userId:id(1),memberId:id(2),businessId:id(3),phone:"+0000",name:"Test Operator",role:"owner",enabledModules:["sales"],branchIds:[id(4)]};
const args=()=>({branchId:id(4),occurredAt:"2026-01-01T12:00:00Z",channel:"salon",paymentMethod:"Efectivo",items:[{productId:null,description:"Explicit concept",quantity:"2",unitPrice:"10.25"}]});
const input=(text:string,n=1):IncomingAgentMessage=>({messageId:`sale-message-${n}`,senderPhone:actor.phone,recipientPhone:"+0001",text});
function harness(){
 let pending:PendingOperation|null=null;const executed:any[]=[];let unknown=false;
 const deps:AgentDependencies={resolveActor:async()=>actor,claimMessage:async()=>true,interpret:interpretHeuristically,getPending:async()=>pending,
 claimSalePending:async(_id,_actor,recovery)=>{if(!pending||Boolean(pending.resultUncertain)!==recovery)return false;pending={...pending,resultUncertain:true};return true;},
 cancelSalePending:async()=>{const result={consumed:pending!==null,resultUncertain:pending?.resultUncertain===true};pending=null;return result;},
 savePending:async value=>(pending={...value,id:"pending"}),consumePending:async()=>{if(!pending)return false;pending=null;return true;},
 prepare:async(_actor,call)=>({...call,arguments:{...call.arguments,requestId:id(9)}}),execute:async(_actor,call)=>{executed.push(call);if(unknown)throw new Error("sale_response_unknown");return {id:id(8),version:1};},audit:async()=>{},now:()=>new Date("2026-02-01T12:00:00Z")};
 return {deps,executed,pending:()=>pending,setUnknown:(value:boolean)=>{unknown=value;}};
}
test("WhatsApp sales clarification asks all missing facts without guessing dates/prices/branch",async()=>{
 const h=harness();let reply=await runAgent(input("Registrá una venta"),h.deps);assert.equal(reply.status,"needs_input");assert.match(reply.text,/sucursal/);
 reply=await runAgent(input("Sí",2),h.deps);assert.equal(reply.status,"needs_input");assert.equal(h.executed.length,0);
 assert.deepEqual(missingSaleArguments({name:"sales.create",arguments:{}}),["branchId","occurredAt","channel","paymentMethod","items"]);
});
test("WhatsApp sales review contains complete context and requires one-shot confirmation",async()=>{
 const h=harness();const preview=await runAgent(input(`venta: ${JSON.stringify(args())}`),h.deps);assert.equal(preview.status,"needs_confirmation");
 for(const value of [id(4),"2026-01-01","Explicit concept","2 × 10.25","20,50","moneda no informada","Efectivo"])assert.ok(preview.text.includes(value),value);
 assert.equal(h.executed.length,0);
 const replies=await Promise.all([runAgent(input("Sí",2),h.deps),runAgent(input("Sí",3),h.deps)]);
 assert.deepEqual(replies.map(r=>r.status).sort(),["completed","rejected"]);assert.equal(h.executed.length,1);
});
test("uncertain sale retry retains original operation ID and cancellation does not promise rollback",async()=>{
 const h=harness();await runAgent(input(`venta: ${JSON.stringify(args())}`),h.deps);h.setUnknown(true);
 const failure=await runAgent(input("Sí",2),h.deps);assert.equal(failure.status,"failed");assert.equal(h.pending()?.resultUncertain,true);
 const request=h.pending()?.toolCall.arguments.requestId;h.setUnknown(false);
 const result=await runAgent(input("Sí",3),h.deps);assert.equal(result.status,"completed");assert.equal(h.executed[1].arguments.requestId,request);
 const h2=harness();await runAgent(input(`venta: ${JSON.stringify(args())}`),h2.deps);h2.setUnknown(true);await runAgent(input("Sí",2),h2.deps);
 const cancelled=await runAgent(input("Cancelar",3),h2.deps);assert.match(cancelled.text,/podría haberse guardado/);assert.equal(h2.executed.length,1);
});
test("sales typed tool input rejects tenant/origin injection and malformed item decimals",()=>{
 for(const extra of [{businessId:id(8)},{source:"manual"},{actorId:id(8)}])assert.equal(validateSaleCall({name:"sales.create",arguments:{...args(),...extra}}).issues[0].unexpected,true);
 assert.ok(validateSaleCall({name:"sales.create",arguments:{...args(),items:[{...args().items[0],unitPrice:0.1}]}}).issues.length);
});
test("agent prepare uses fresh ID; execution rechecks conversation branch after confirmation",async()=>{
 const db:any={from:()=>{const q:any={select:()=>q,eq:()=>q,in:()=>q,or:()=>q,maybeSingle:async()=>({data:{id:id(4),business_id:actor.businessId,branch_id:id(4),status:"active",sale_kind:"detailed",version:2},error:null})};return q;},rpc:async()=>({data:{ok:true,id:id(8),version:1},error:null})};
 const call=await prepareSaleTool(db,actor,{name:"sales.create",arguments:{...args(),requestId:id(99)}});assert.notEqual(call.arguments.requestId,id(99));
 assert.equal((await executeSaleTool(db,actor,call)).ok,true);
 await assert.rejects(executeSaleTool(db,{...actor,branchIds:[id(5)]},call),/sale_write_rejected/);
 await assert.rejects(prepareSaleTool(db,{...actor,role:"viewer"},{name:"sales.create",arguments:args()}),/sale_permission_denied/);
});
test("structured and conversational sale commands share the same registry",async()=>{
 for(const [text,name] of [["Registrá una venta","sales.create"],[`Anular venta ${id(8)}`,"sales.void"],[`Editar venta ${id(8)}`,"sales.edit"]])assert.equal((await interpretHeuristically(text,[...WHATSAPP_TOOLS]))?.name,name);
});

test("sales cancellation during RPC timeout never recreates a retired pending operation",async()=>{
 const h=harness();await runAgent(input(`venta: ${JSON.stringify(args())}`),h.deps);
 let release!:()=>void;let started!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const reached=new Promise<void>(resolve=>{started=resolve;});
 h.deps.execute=async()=>{started();await gate;throw new Error("sale_response_unknown");};
 const execution=runAgent(input("Sí",2),h.deps);await reached;
 assert.equal(h.pending()?.resultUncertain,true,"recovery ID must exist before RPC starts");
 const cancelled=await runAgent(input("Cancelar",3),h.deps);assert.match(cancelled.text,/podría haberse guardado/);assert.equal(h.pending(),null);
 release();const result=await execution;assert.equal(result.status,"failed");assert.equal(h.pending(),null,"late timeout must not resurrect cancelled work");assert.match(result.text,/No reactivé/);
});

test("simulated process crash before/after sales RPC retains exact durable recovery request",async()=>{
 const h=harness();await runAgent(input(`venta: ${JSON.stringify(args())}`),h.deps);
 const prepared=h.pending()!;assert.equal(await h.deps.claimSalePending!(prepared.id,actor,false),true);
 // No execute/cleanup follows, modeling process death after the claim, or after
 // database commit while the response is still in transit. A new worker sees it.
 const recovered=h.pending()!;assert.equal(recovered.resultUncertain,true);const originalId=recovered.toolCall.arguments.requestId;
 const reply=await runAgent(input("Sí",20),h.deps);assert.equal(reply.status,"completed");assert.equal(h.executed[0].arguments.requestId,originalId);
});

test("rejected sale execution cannot erase durable marker of a concurrent recovery",async()=>{
 const h=harness();await runAgent(input(`venta: ${JSON.stringify(args())}`),h.deps);
 let n=0;let entered!:()=>void;const firstEntered=new Promise<void>(resolve=>{entered=resolve;});const releases:Array<()=>void>=[];
 h.deps.execute=async()=>{const index=n++;if(index===0)entered();await new Promise<void>(resolve=>{releases[index]=resolve;});throw new Error(index===0?"sale_write_rejected":"sale_response_unknown");};
 const first=runAgent(input("Sí",2),h.deps);await firstEntered;
 const second=runAgent(input("Sí",3),h.deps);while(releases.length<2)await new Promise(resolve=>setImmediate(resolve));
 releases[0]();assert.equal((await first).status,"needs_input");assert.equal(h.pending()?.resultUncertain,true);
 releases[1]();assert.equal((await second).status,"failed");assert.equal(h.pending()?.resultUncertain,true);assert.equal(h.pending()?.toolCall.arguments.requestId,id(9));
});

test("sales interpreter cannot supply durable request IDs, versions or execution markers", async () => {
  for (const extra of [{ requestId: id(99) }, { expectedVersion: 3 }, { __resultUncertain: true }, { __clarificationKey: "notes" }]) {
    const h = harness();
    const reply = await runAgent(input(`venta: ${JSON.stringify({ ...args(), ...extra })}`), h.deps);
    assert.equal(reply.status, "rejected");
    assert.equal(h.executed.length, 0);
    assert.equal(h.pending(), null);
  }
});

test("corrupt sales recovery is retained without rewriting it as a clarification", async () => {
  const h = harness();
  await runAgent(input(`venta: ${JSON.stringify(args())}`), h.deps);
  await h.deps.claimSalePending!(h.pending()!.id, actor, false);
  delete h.pending()!.toolCall.arguments.items;
  const before = structuredClone(h.pending());
  const reply = await runAgent(input("Sí", 2), h.deps);
  assert.equal(reply.status, "needs_input");
  assert.deepEqual(h.pending(), before);
  assert.equal(h.pending()?.kind, "confirmation");
  assert.equal(h.executed.length, 0);
});

test("expired sales confirmation is not consumed from a possibly stale pending read", async () => {
  const h = harness();
  await runAgent(input(`venta: ${JSON.stringify(args())}`), h.deps);
  h.pending()!.expiresAt = "2026-01-01T00:00:00Z";
  let consumed = 0;
  h.deps.consumePending = async () => { consumed++; return true; };
  const before = structuredClone(h.pending());
  const reply = await runAgent(input("Sí", 2), h.deps);
  assert.equal(reply.status, "needs_input");
  assert.equal(consumed, 0);
  assert.deepEqual(h.pending(), before);
  assert.equal(h.executed.length, 0);
  const cancelled = await runAgent(input("Cancelar", 3), h.deps);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(h.pending(), null);
});
