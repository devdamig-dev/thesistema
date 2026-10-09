import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { generateDebtPlan, type DebtPlanInput } from "../lib/debts/plans";
import { parseCreatePlanRequest } from "../app/deudas/plan-contract";
import { prepareDebtTool, executeDebtTool, readDebtView } from "../lib/whatsapp-agent/debt-adapter";
import { createPlanRequest, planInputFromArguments } from "../lib/whatsapp-agent/debt-contract";
import { validateToolCall } from "../lib/whatsapp-agent/validation";
import { WHATSAPP_TOOLS } from "../lib/whatsapp-agent/registry";
import { interpretHeuristically, getMissingArguments } from "../lib/whatsapp-agent/interpreter";
import { interpretDebtCall } from "../lib/whatsapp-agent/debt-interpreter";
import { runAgent } from "../lib/whatsapp-agent/core";
import { prepareInboxDebt, executeInboxDebt } from "../lib/whatsapp-agent/inbox-debts";
import type { AgentActor, AgentDependencies, PendingOperation, ToolCall } from "../lib/whatsapp-agent/types";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const businessId=id(1), branchId=id(2), actorId=id(3), debtId=id(4), requestId=id(5), paymentId=id(6);
const actor: AgentActor = { userId: actorId, memberId: id(7), businessId, phone: "5491111111111", name: "Ana", role: "owner", enabledModules: ["debts"], branchIds: [branchId] };
const planInput: DebtPlanInput = { mode: "installments", currency: "ARS", originalAmountCents: 90000000, financing: { totalFinancedCents: 90000000 }, installmentCount: 3, schedule: { periodicity: "monthly", firstDueDate: "2026-11-10" } };
const plan = generateDebtPlan(planInput);
const createCall = (): ToolCall => ({ name: "debts.createPlan", arguments: { creditor: "Banco Nación", creditorType: "bank", takenAt: "2026-10-09", mode: "installments", currency: "ARS", originalAmountCents: 90000000, totalFinancedCents: 90000000, installmentCount: 3, periodicity: "monthly", firstDueDate: "2026-11-10" } });
const payCall = (): ToolCall => ({ name: "debts.registerPlanPayment", arguments: { creditor: "Banco Nación", amountCents: 1000000, paidAt: "2026-10-09", paymentMethod: "Efectivo", allocationRule: "selected_installment", installmentNumber: 2 } });
function fixture() {
  const debt = { id: debtId, business_id: businessId, branch_id: branchId, creditor: "Banco Nación", creditor_type: "bank", currency: "ARS", original_amount: "900000.00", pending_amount: "900000.00", total_financed_amount: "900000.00", plan_version: 0, plan_definition: plan, mode: "installments", status: "active", taken_at: "2026-10-09", due_date: "2026-11-10", down_payment_amount: null, concept: null, origin: "manual", category: null, reference: null, notes: null, expected_payment_method: null, created_by: actorId, created_at: "2026-10-09T00:00:00Z" };
  const rows: Record<string, any[]> = { businesses: [{ id: businessId, timezone: "America/Argentina/Buenos_Aires" }], branches: [{ id: branchId, business_id: businessId }], debts: [debt], debt_installments: plan.installments.map(p => ({ id: id(20+p.installmentNumber), business_id: businessId, branch_id: branchId, debt_id: debtId, installment_number: p.installmentNumber, due_date: p.dueDate, total_amount: String(p.totalAmountCents/100), capital_amount: null, interest_amount: null, fees_amount: null, notes: null })), debt_payments: [], debt_payment_allocations: [], whatsapp_messages: [{id: id(99), business_id: businessId, branch_id: branchId}] };
  const calls: { name: string; args: any }[]=[]; const queries: { table: string; filters: [string,string,unknown][] }[]=[]; const persisted = new Map<string, any>(); let loseResponse = false;
  const db: any = { from(table: string) { const filters: [string,string,unknown][]=[]; let take=Infinity; let offset=0; let end=Infinity;
    const result=() => ({ error: null, data: (rows[table] ?? []).filter(r => filters.every(([op,key,v]) => op === "eq" ? r[key]===v : op==="neq" ? r[key]!==v : op === "in" ? (v as unknown[]).includes(r[key]) : String(r[key]).toLowerCase()===String(v).toLowerCase())).slice(offset,Math.min(end+1,offset+take)) });
    const q: any = { select(){return q;}, eq(k:string,v:unknown){filters.push(["eq",k,v]);return q;}, neq(k:string,v:unknown){filters.push(["neq",k,v]);return q;}, ilike(k:string,v:unknown){filters.push(["ilike",k,v]);return q;}, in(k:string,v:unknown){filters.push(["in",k,v]);return q;}, limit(n:number){take=n;return q;}, range(a:number,b:number){offset=a;end=b;return q;}, order(){return q;}, maybeSingle(){const r=result();return Promise.resolve({...r,data:r.data[0]??null});}, then(resolve:any,reject:any){queries.push({table,filters});return Promise.resolve(result()).then(resolve,reject);} }; return q; },
    async rpc(name:string,args:any){ calls.push({name,args:structuredClone(args)}); const key=`${name}:${args.p_idempotency_key ?? args.p_extraction_id}`; let value=persisted.get(key); if (!value) {value={ok:true,debt_id:debtId,payment_id:paymentId,version:1};persisted.set(key,value);} if(loseResponse){loseResponse=false;throw new Error("lost");}return {data:value,error:null};} };
  return {db, rows, debt, calls, queries, persisted, lose:()=>{loseResponse=true;}};
}
function harness(f: ReturnType<typeof fixture>, operation: ToolCall) {
  let pending: PendingOperation|null=null; const seen=new Set<string>(); let sequence=88;
  const deps: AgentDependencies = { resolveActor:async()=>actor, claimMessage:async(input)=>{if(seen.has(input.messageId))return false;seen.add(input.messageId);return true;}, interpret:async()=>operation, getPending:async()=>pending, savePending:async value=>pending={...value,id:id(sequence++)}, consumePending:async pendingId=>{if(!pending || pending.id!==pendingId)return false;pending=null;return true;}, claimDebtPending:async(pendingId,_actor,recovery)=>{if(!pending || pending.id!==pendingId || Boolean(pending.resultUncertain)!==recovery)return false;pending={...pending,resultUncertain:true};return true;}, cancelDebtPending:async pendingId=>{if(!pending || pending.id!==pendingId)return {consumed:false,resultUncertain:false};const resultUncertain=!!pending.resultUncertain;pending=null;return {consumed:true,resultUncertain};}, prepare:(a,c)=>prepareDebtTool(f.db,a,c), execute:(a,c)=>executeDebtTool(f.db,a,c), audit:async()=>{}, now:()=>new Date("2026-10-09T12:00:00Z") };
  const send=(text:string,messageId=text)=>runAgent({text,messageId,senderPhone:actor.phone,recipientPhone:"5491122222222"},deps);
  return {deps,send,pending:()=>pending};
}

test("WhatsApp create uses exact manual plan contract/RPC with only transport origin and verified actor changed", async()=>{
  const f=fixture();const prepared=await prepareDebtTool(f.db,actor,createCall());assert.equal(f.calls.length,0);
  const ui=parseCreatePlanRequest({requestId:prepared.arguments.requestId,branchId,creditor:"Banco Nación",creditorType:"bank",takenAt:"2026-10-09",planInput,scheduleConfirmed:true});
  assert.deepEqual(createPlanRequest(prepared.arguments),ui);assert.deepEqual(planInputFromArguments(prepared.arguments),planInput);
  await executeDebtTool(f.db,actor,prepared);assert.deepEqual(f.calls[0],{name:"create_debt_installment_plan",args:{p_actor_id:actorId,p_idempotency_key:ui.requestId,p_plan:{business_id:businessId,branch_id:branchId,creditor:"Banco Nación",creditor_type:"bank",taken_at:"2026-10-09",origin:"whatsapp",plan}}});
});
test("single obligation uses the same plan RPC without inventing a due date or interest",async()=>{const f=fixture();const call:ToolCall={name:"debts.createPlan",arguments:{creditor:"Persona",creditorType:"person",takenAt:"2026-10-09",mode:"single",currency:"USD",originalAmountCents:10001,totalFinancedCents:10001}};await executeDebtTool(f.db,actor,await prepareDebtTool(f.db,actor,call));assert.equal(f.calls[0].args.p_plan.plan.installments[0].dueDate,null);assert.equal(f.calls[0].args.p_plan.plan.interestRate,null);});
test("plan version zero is recognized; selected partial payment pins debt, installment, version and operation ID",async()=>{const f=fixture();const p=await prepareDebtTool(f.db,actor,payCall());assert.equal(p.arguments.expectedVersion,0);assert.equal(p.arguments.installmentId,id(22));await executeDebtTool(f.db,actor,p);assert.deepEqual(f.calls[0].args.p_payment,{amountCents:1000000,paidAt:"2026-10-09",paymentMethod:"Efectivo",allocation:{rule:"selected_installment",installmentId:id(22)},origin:"whatsapp"});assert.equal(f.calls[0].args.p_actor_id,actorId);});
test("global payment never defaults an allocation; oldest_due is explicit",async()=>{const missing={...payCall(),arguments:{...payCall().arguments,allocationRule:undefined,installmentNumber:undefined}};assert.ok(getMissingArguments(missing,WHATSAPP_TOOLS).includes("allocationRule"));const f=fixture();const p=await prepareDebtTool(f.db,actor,{name:missing.name,arguments:{...missing.arguments,allocationRule:"oldest_due"}});await executeDebtTool(f.db,actor,p);assert.deepEqual(f.calls[0].args.p_payment.allocation,{rule:"oldest_due"});});
test("create WRITE and payments are not executed before preview confirmation; concurrent confirms execute once",async()=>{for(const op of [createCall(),payCall()]){const f=fixture();const h=harness(f,op);const preview=await h.send("request");assert.equal(preview.status,"needs_confirmation");assert.equal(f.calls.length,0);assert.match(preview.text,/Banco Nación/);if(op.name==="debts.createPlan"){assert.match(preview.text,/2026-11-10/);assert.match(preview.text,/2027-01-10/);}const res=await Promise.all([h.send("Sí","yes1"),h.send("Sí","yes2")]);assert.equal(f.calls.length,1);assert.deepEqual(res.map(r=>r.status).sort(),["completed","rejected"]);}});
test("lost RPC response retries identical operation ID and payload; duplicate webhook and cancellation never write",async()=>{const f=fixture();const h=harness(f,payCall());await h.send("request");f.lose();const r=await h.send("Sí","yes1");assert.equal(r.status,"failed");assert.match(r.text,/podría haberse guardado/);assert.ok(h.pending());assert.equal((await h.send("Sí","yes2")).status,"completed");assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.persisted.size,1);assert.equal((await h.send("Sí","yes2")).status,"duplicate");const f2=fixture();const h2=harness(f2,createCall());await h2.send("request");assert.equal((await h2.send("Cancelar")).status,"cancelled");assert.equal(f2.calls.length,0);});
test("debt validation rejects forged tenant/actor/origin and omitted payment facts or unknown nested finance fields",async()=>{for(const forbidden of ["businessId","actorId","origin","scheduleConfirmed","__clarificationKey"]){const v=validateToolCall({name:createCall().name,arguments:{...createCall().arguments,[forbidden]:"x"}});assert.ok(v.issues.some(i=>i.unexpected));}for(const field of ["paidAt","paymentMethod","amountCents","allocationRule"]){const c=payCall();delete c.arguments[field];assert.ok(getMissingArguments(c,WHATSAPP_TOOLS).includes(field));const f=fixture();await assert.rejects(()=>prepareDebtTool(f.db,actor,c),/debt_missing_fields/);assert.equal(f.calls.length,0);}assert.ok(validateToolCall({name:createCall().name,arguments:{...createCall().arguments,confirmedBalance:{confirmed:true,downPaymentCents:0,interestCents:0,feesCents:0,actorId}}}).issues.length);});
test("read/write role, module, tenant, ambiguous creditor and branch boundaries fail closed",async()=>{for(const bad of [{...actor,role:"employee" as const},{...actor,enabledModules:[]},{...actor,businessId:id(9)},{...actor,branchIds:[] as string[]}]){const f=fixture();await assert.rejects(()=>prepareDebtTool(f.db,bad,payCall()));assert.equal(f.calls.length,0);}const f=fixture();f.rows.debts.push({...f.debt,id:id(40)});await assert.rejects(()=>prepareDebtTool(f.db,actor,payCall()),/debt_not_unambiguous/);const b=fixture();b.rows.branches.push({id:id(41),business_id:businessId});await assert.rejects(()=>prepareDebtTool(b.db,{...actor,branchIds:null},createCall()),/branch_ambiguous/);});
test("installment cannot cross debts; due reads preserve currencies and scope, and verify ledger balances",async()=>{const f=fixture();await assert.rejects(()=>prepareDebtTool(f.db,actor,{...payCall(),arguments:{...payCall().arguments,installmentId:id(999)}}),/installment_not_found/);const due:any=await executeDebtTool(f.db,actor,{name:"debts.listDue",arguments:{from:"2026-11-01",to:"2026-11-30"}});assert.equal(due.debts[0].installments.length,1);assert.equal(due.debts[0].currency,"ARS");assert.equal("total" in due,false);assert.ok(f.queries.filter(q=>q.table!=="branches").every(q=>q.filters.some(([,k,v])=>k==="business_id"&&v===businessId)));f.debt.pending_amount="1.00";await assert.rejects(()=>readDebtView(f.db,actor,f.debt as any,"2026-10-09"),/ledger_balance_mismatch/);});
test("void and edits use exact RPC contracts, immutable financial terms and explicit reasons",async()=>{for(const operation of [{name:"debts.voidPlanPayment",arguments:{requestId,debtId,expectedVersion:0,paymentId,reason:"Duplicado"}},{name:"debts.editPlan",arguments:{requestId,debtId,expectedVersion:0,kind:"notes",notes:"Nota revisada"}},{name:"debts.editPlan",arguments:{requestId,debtId,expectedVersion:0,kind:"installment",installmentId:id(22),dueDate:"2027-01-15",notes:null}}]){const f=fixture();await executeDebtTool(f.db,actor,operation);assert.equal(f.calls[0].args.p_idempotency_key,requestId);assert.equal(f.calls[0].args.p_actor_id,actorId);assert.ok(["void_debt_plan_payment","update_debt_plan_notes","edit_debt_installment"].includes(f.calls[0].name));}assert.ok(validateToolCall({name:"debts.editPlan",arguments:{debtId,kind:"notes",notes:"x",originalAmountCents:1}}).issues.some(i=>i.unexpected));});
test("natural-language debt requests do not infer year, currency, origin date, financing or payment amount",async()=>{const c=await interpretHeuristically("Le debo al Banco Nación $900.000 y acordé pagarlo en 3 cuotas mensuales desde el 10 de noviembre.",[...WHATSAPP_TOOLS]);assert.equal(c?.name,"debts.createPlan");assert.equal(c?.arguments.creditor,"Banco Nación");assert.equal(c?.arguments.originalAmountCents,90000000);for(const field of ["firstDueDate","currency","takenAt","totalFinancedCents"])assert.equal(c?.arguments[field],undefined);const p=await interpretHeuristically("Registrá el pago de la cuota 2 del Banco Nación.",[...WHATSAPP_TOOLS]);assert.equal(p?.name,"debts.registerPlanPayment");assert.equal(p?.arguments.installmentNumber,2);assert.equal(p?.arguments.amountCents,undefined);assert.equal(p?.arguments.paidAt,undefined);assert.equal(p?.arguments.paymentMethod,undefined);});
test("relative read-only month/week ranges use the business civil date",()=>{assert.deepEqual(interpretDebtCall("¿Qué deudas vencen este mes?",[...WHATSAPP_TOOLS],new Date("2026-10-01T01:00:00Z"),"America/Argentina/Buenos_Aires")?.arguments,{from:"2026-09-01",to:"2026-09-30"});assert.deepEqual(interpretDebtCall("¿Cuánto tengo que pagar la semana que viene?",[...WHATSAPP_TOOLS],new Date("2026-10-09T12:00:00Z"),"America/Argentina/Buenos_Aires")?.arguments,{from:"2026-10-12",to:"2026-10-18"});});
const ctx={isAuthenticated:true,userId:actorId,businessId,role:"owner" as const,enabledModules:actor.enabledModules,assignedBranchIds:[branchId]};
const extraction=()=>({id:requestId,message_id:id(99),business_id:businessId,branch_id:branchId,type:"debt_created",fields:{planRequest:{branchId,creditor:"Banco Nación",creditorType:"bank",takenAt:"2026-10-09",planInput}}});
test("Inbox complete payload previews and executes same plan with extraction id and authenticated-session actor",async()=>{const f=fixture();const ext=extraction();const p=await prepareInboxDebt(f.db,ctx,ext);assert.equal(f.calls.length,0);assert.deepEqual(p.preview.schedule,plan);await executeInboxDebt(f.db,ctx,ext,p.preview.digest);assert.equal(f.calls[0].name,"approve_debt_extraction_atomic");assert.equal(f.calls[0].args.p_extraction_id,requestId);assert.equal(f.calls[0].args.p_payload.origin,"whatsapp");assert.equal("p_actor_id" in f.calls[0].args,false);assert.equal(f.calls[0].args.p_payload.business_id,businessId);});
test("Inbox refuses generic employee approval, missing legacy fields, spoofed confirmation and stale review",async()=>{const f=fixture();for(const context of [{...ctx,role:"employee" as const},{...ctx,businessId:id(8)},{...ctx,assignedBranchIds:[]},{...ctx,enabledModules:[]}])await assert.rejects(()=>prepareInboxDebt(f.db,context,extraction()));await assert.rejects(()=>prepareInboxDebt(f.db,ctx,{...extraction(),fields:{creditor:"Banco",original_amount:900000}}),/missing_fields_for_creation/);await assert.rejects(()=>executeInboxDebt(f.db,ctx,extraction(),undefined),/debt_review_required/);const p=await prepareInboxDebt(f.db,ctx,extraction());const changed=extraction();changed.fields.planRequest.creditor="Otro banco";await assert.rejects(()=>executeInboxDebt(f.db,ctx,changed,p.preview.digest),/debt_review_required/);assert.equal(f.calls.length,0);});
test("Inbox payment partial/global contracts require explicit allocation/date/method; retry idempotency remains stable",async()=>{const f=fixture();const ext={...extraction(),type:"debt_payment",fields:{paymentRequest:{debtId,expectedVersion:0,amountCents:100,paidAt:"2026-10-09",paymentMethod:"Efectivo",allocation:{rule:"oldest_due"}}}};const p=await prepareInboxDebt(f.db,ctx,ext);f.lose();await assert.rejects(()=>executeInboxDebt(f.db,ctx,ext,p.preview.digest),/debt_response_unknown/);await executeInboxDebt(f.db,ctx,ext,p.preview.digest);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.persisted.size,1);assert.equal(f.calls[0].name,"approve_debt_extraction_atomic");assert.deepEqual(f.calls[0].args.p_payload.payment.allocation,{rule:"oldest_due"});});
test("legacy payment cannot accidentally pay a planned debt and Inbox no longer inserts debt directly",()=>{const s=readFileSync("lib/whatsapp-agent/supabase-adapter.ts","utf8");assert.match(s,/throw new Error\("legacy_payment_requires_review"\)/);const inbox=readFileSync("app/actions/inbox.ts","utf8");assert.doesNotMatch(inbox,/async function createDebt\(/);assert.doesNotMatch(inbox,/p_actor_id: null/);const ui=readFileSync("app/inbox/inbox-client.tsx","utf8");assert.match(ui,/First click is read-only/);assert.match(ui,/Confirmar este detalle/);});

test("legacy create alias cannot bypass plan facts or confirmation and never inserts debts",async()=>{
  const c:ToolCall={name:"debts.create",arguments:{creditor:"Banco",amount:900000}};
  const valid=validateToolCall(c);assert.equal(valid.call.name,"debts.createPlan");assert.equal(valid.call.arguments.originalAmountCents,90000000);assert.ok(getMissingArguments(valid.call,WHATSAPP_TOOLS).includes("currency"));
  const f=fixture();const h=harness(f,c);assert.equal((await h.send("crear deuda")).status,"needs_input");assert.equal(f.calls.length,0);
  const complete={name:"debts.create",arguments:{...createCall().arguments}};const h2=harness(f,complete);assert.equal((await h2.send("crear completa")).status,"needs_confirmation");assert.equal(f.calls.length,0);assert.equal((await h2.send("Sí")).status,"completed");assert.equal(f.calls[0].name,"create_debt_installment_plan");
  assert.doesNotMatch(readFileSync("lib/whatsapp-agent/supabase-adapter.ts","utf8"),/\.from\("debts"\)[\s\S]{0,40}\.insert/);
});
test("cancelling an uncertain RPC stops retries without claiming the original write rolled back",async()=>{const f=fixture();const h=harness(f,payCall());await h.send("request");f.lose();await h.send("Sí","confirm");assert.equal(h.pending()?.resultUncertain,true);const result=await h.send("Cancelar");assert.equal(result.status,"cancelled");assert.match(result.text,/podría haberse guardado/);assert.doesNotMatch(result.text,/No se realizó ningún cambio/);assert.equal(f.persisted.size,1);});
test("repeated confirmation failures retain original uncertain payment identity",async()=>{const f=fixture();const h=harness(f,payCall());await h.send("request");f.lose();await h.send("Sí","confirm1");const original=h.pending()?.toolCall.arguments.requestId;h.deps.execute=async()=>{throw new Error("permission_denied")};const result=await h.send("Sí","confirm2");assert.equal(result.status,"failed");assert.match(result.text,/podría haberse guardado/);assert.equal(h.pending()?.toolCall.arguments.requestId,original);assert.equal(h.pending()?.resultUncertain,true);});
test("read ambiguity prompts for an exact debt and never selects the first creditor match",async()=>{const f=fixture();f.rows.debts.push({...f.debt,id:id(40)});const h=harness(f,{name:"debts.getPlan",arguments:{creditor:"Banco Nación"}});const result=await h.send("saldo");assert.equal(result.status,"needs_input");assert.equal(h.pending()?.clarificationKey,"debtId");const resolved=await interpretHeuristically(debtId,[...WHATSAPP_TOOLS],h.pending());assert.equal(resolved?.arguments.debtId,debtId);assert.equal(resolved?.arguments.creditor,undefined);assert.equal(f.calls.length,0);});

test("acknowledgements during clarification never invent payment method, creditor or other financial facts",async()=>{
 for(const field of ["paymentMethod","creditor","paidAt","amountCents","allocationRule"]){
  const call=payCall();delete call.arguments[field];
  const pending:PendingOperation={id:id(500),actor,kind:"clarification",toolCall:call,expiresAt:"2099-01-01T00:00:00Z"};
  for(const answer of ["Sí","confirmo","dale","ok","confirmar"]){const result=await interpretHeuristically(answer,[...WHATSAPP_TOOLS],pending);assert.equal(result?.arguments[field],undefined,`${field} from ${answer}`);assert.ok(getMissingArguments(result!,WHATSAPP_TOOLS).includes(field));}
 }
 const f=fixture();const call=payCall();delete call.arguments.paymentMethod;const h=harness(f,call);h.deps.interpret=interpretHeuristically;
 h.deps.getPending=async()=>({id:id(501),actor,kind:"clarification",toolCall:call,expiresAt:"2099-01-01T00:00:00Z"});
 assert.equal((await h.send("Sí")).status,"needs_input");assert.equal(f.calls.length,0);
});

test("progressive WhatsApp create asks each missing fact and then confirms the generated schedule",async()=>{const f=fixture();const h=harness(f,createCall());h.deps.interpret=interpretHeuristically;for(const [text,key]of [["Le debo al Banco Nación $900.000 y acordé pagarlo en 3 cuotas mensuales desde el 10 de noviembre.","takenAt"],["2026-10-09","currency"],["ARS","totalFinancedCents"],["$900.000","firstDueDate"]]){const result=await h.send(text);assert.equal(result.status,"needs_input");assert.ok(getMissingArguments(h.pending()!.toolCall,WHATSAPP_TOOLS).includes(key));assert.equal(f.calls.length,0);}assert.equal((await h.send("2026-11-10")).status,"needs_confirmation");assert.equal(f.calls.length,0);assert.equal((await h.send("Sí")).status,"completed");assert.equal(f.calls[0].args.p_plan.plan.totalFinancedCents,90000000);});
test("an installment number or calendar date in a money clarification cannot become an amount",async()=>{const c=payCall();delete c.arguments.amountCents;const p:PendingOperation={id:id(600),actor,kind:"clarification",toolCall:c,expiresAt:"2099-01-01T00:00:00Z"};for(const answer of ["cuota 2","2026-10-09","primero el 10/11/2026"]){const result=await interpretHeuristically(answer,[...WHATSAPP_TOOLS],p);assert.equal(result?.arguments.amountCents,undefined,answer);}});

test("malformed RPC envelopes and success IDs remain uncertain and retain the same payment request",async()=>{
 for(const response of [null,[],{data:null,error:null},{data:{ok:true,debt_id:"",version:1,payment_id:paymentId},error:null},{data:{ok:true,debt_id:"not-a-uuid",version:1,payment_id:paymentId},error:null},{data:{ok:true,debt_id:debtId,version:1},error:null},{data:{ok:true,debt_id:debtId,payment_id:paymentId},error:null},{data:{ok:true,debt_id:id(900),version:1,payment_id:paymentId},error:null}]){
  const f=fixture();const h=harness(f,payCall());await h.send("request");const request=h.pending()!.toolCall.arguments.requestId;f.db.rpc=async()=>response;const result=await h.send("Sí");assert.equal(result.status,"failed");assert.match(result.text,/podría haberse guardado/);assert.equal(h.pending()?.toolCall.arguments.requestId,request);assert.equal(h.pending()?.resultUncertain,true);
 }
});
test("Inbox payment without a returned payment ID cannot become an approved success",async()=>{const f=fixture();const ext={...extraction(),type:"debt_payment",fields:{paymentRequest:{debtId,expectedVersion:0,amountCents:100,paidAt:"2026-10-09",paymentMethod:"Efectivo",allocation:{rule:"oldest_due"}}}};const preview=await prepareInboxDebt(f.db,ctx,ext);f.db.rpc=async()=>({data:{ok:true,debt_id:debtId,version:1},error:null});await assert.rejects(()=>executeInboxDebt(f.db,ctx,ext,preview.preview.digest),/debt_response_unknown/);});
test("creation intent outranks due-date reads and capital is never inferred from financed or installment amounts",()=>{
 const partial=interpretDebtCall("Registrá una deuda con Banco Nación, total financiado ARS 900 en 3 cuotas mensuales desde 2026-11-10, origen 2026-10-09.",[...WHATSAPP_TOOLS])!;assert.equal(partial.name,"debts.createPlan");assert.equal(partial.arguments.originalAmountCents,undefined);assert.ok(getMissingArguments(partial,WHATSAPP_TOOLS).includes("originalAmountCents"));
 const single=interpretDebtCall("Crea una deuda de Banco Nación ARS 1000 con total financiado ARS 1200, pago único, origen 2026-10-09 y vencimiento 2026-11-10.",[...WHATSAPP_TOOLS])!;assert.equal(single.name,"debts.createPlan");assert.equal(single.arguments.originalAmountCents,100000);assert.equal(single.arguments.totalFinancedCents,120000);assert.equal(single.arguments.dueDate,"2026-11-10");
 const named=interpretDebtCall("Le debo al Banco Arsenal $1000 en 3 cuotas mensuales.",[...WHATSAPP_TOOLS])!;assert.equal(named.arguments.currency,undefined);
});
test("correcting an invalid optional due date preserves the response instead of dropping the date",async()=>{
 const f=fixture();const call:ToolCall={name:"debts.createPlan",arguments:{creditor:"Banco",creditorType:"bank",takenAt:"2026-10-09",mode:"single",currency:"ARS",originalAmountCents:10000,totalFinancedCents:10000,dueDate:"2026-02-30"}};const h=harness(f,call);assert.equal((await h.send("request")).status,"needs_input");assert.equal(h.pending()?.clarificationKey,"dueDate");h.deps.interpret=interpretHeuristically;const result=await h.send("2026-03-01");assert.equal(result.status,"needs_confirmation");assert.equal(h.pending()?.toolCall.arguments.dueDate,"2026-03-01");assert.match(result.text,/2026-03-01/);assert.doesNotMatch(result.text,/sin vencimiento/);assert.equal(f.calls.length,0);
});
test("legacy payment command stays blocked even with complete metadata; caller cannot reach the unsafe historical RPC",async()=>{const f=fixture();const h=harness(f,{name:"debts.registerPayment",arguments:{creditor:"Banco Nación",amount:10,paidAt:"2026-10-09",paymentMethod:"Efectivo"}});const result=await h.send("request");assert.equal(result.status,"needs_input");assert.match(result.text,/revisión manual/);assert.equal(f.calls.length,0);assert.equal(h.pending(),null);});

test("acknowledging an invalid optional date cannot skip its pending clarification",async()=>{const f=fixture();const h=harness(f,{name:"debts.createPlan",arguments:{creditor:"Banco",creditorType:"bank",takenAt:"2026-10-09",mode:"single",currency:"ARS",originalAmountCents:10000,totalFinancedCents:10000,dueDate:"2026-02-30"}});await h.send("request");h.deps.interpret=interpretHeuristically;for(const answer of ["Sí","ok","confirmo","dale"]){assert.equal((await h.send(answer)).status,"needs_input");assert.equal(h.pending()?.clarificationKey,"dueDate");assert.equal(f.calls.length,0);}assert.equal((await h.send("2026-03-01")).status,"needs_confirmation");assert.equal(h.pending()?.toolCall.arguments.dueDate,"2026-03-01");});

function recoveryOperations(f: ReturnType<typeof fixture>): ToolCall[] {
  f.rows.debt_payments.push({ id: paymentId, business_id: businessId, branch_id: branchId, debt_id: debtId, amount: "1000.00", currency: "ARS", paid_at: "2026-10-09", payment_method: "Efectivo", created_by: actorId, created_at: "2026-10-09T00:00:00Z", origin: "manual", allocation_rule: "oldest_due", selected_installment_id: null, voided_at: null });
  f.rows.debt_payment_allocations.push({ business_id: businessId, branch_id: branchId, debt_id: debtId, payment_id: paymentId, installment_id: id(21), amount: "1000.00" });
  f.debt.pending_amount = "899000.00";
  return [createCall(), { ...createCall(), name: "debts.create" }, payCall(),
    { name: "debts.voidPlanPayment", arguments: { debtId, paymentId, reason: "Pago duplicado" } },
    { name: "debts.editPlan", arguments: { debtId, kind: "notes", notes: "Nota revisada" } },
    { name: "debts.editPlan", arguments: { debtId, kind: "installment", installmentNumber: 2, dueDate: "2026-12-11", notes: null } },
  ];
}
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test("all debt mutations recover the durable UUID after process death before or after financial commit", async () => {
  for (const afterCommit of [false, true]) for (let index=0; index<6; index++) {
    const f=fixture(); const operation=recoveryOperations(f)[index]; const h=harness(f,operation);
    assert.equal((await h.send("request")).status,"needs_confirmation",operation.name);
    const saved=structuredClone(h.pending()!);
    if(operation.name==="debts.create")assert.equal(saved.toolCall.name,"debts.createPlan","safe alias is canonical before persistence");
    assert.equal(await h.deps.claimDebtPending!(saved.id,actor,false),true);
    assert.equal(h.pending()?.resultUncertain,true,"marker committed before financial call");
    if (afterCommit) await h.deps.execute(actor,saved.toolCall);
    // Deliberately omit response handling and cleanup: a new request sees only storage.
    const restarted={...h.deps,prepare:async()=>{throw new Error("recovery must never prepare a new UUID");}};
    const reply=await runAgent({text:"Sí",messageId:"restart",senderPhone:actor.phone,recipientPhone:"5491122222222"},restarted);
    assert.equal(reply.status,"completed",operation.name);
    assert.equal(f.calls.length,afterCommit?2:1);
    assert.ok(f.calls.every(call=>call.args.p_idempotency_key===saved.toolCall.arguments.requestId));
    if(afterCommit)assert.deepEqual(f.calls[0],f.calls[1]);
    assert.equal(f.persisted.size,1); assert.equal(h.pending(),null);
  }
});

test("simultaneous recovery confirmations use identical debt payload and one financial identity", async () => {
  const f=fixture(); const h=harness(f,payCall()); await h.send("request");
  const initial=structuredClone(h.pending()!); await h.deps.claimDebtPending!(initial.id,actor,false);
  const replies=await Promise.all([h.send("Sí","recovery-a"),h.send("Sí","recovery-b")]);
  assert.ok(replies.every(reply=>reply.status==="completed"));
  assert.equal(f.calls.length,2); assert.deepEqual(f.calls[0],f.calls[1]); assert.equal(f.persisted.size,1);
  assert.equal(f.calls[0].args.p_idempotency_key,initial.toolCall.arguments.requestId);
});

test("lost claim response never executes in that worker and retains the durable recovery identity", async () => {
  const f=fixture(); const h=harness(f,createCall()); await h.send("request");
  const initial=structuredClone(h.pending()!); const claim=h.deps.claimDebtPending!;
  h.deps.claimDebtPending=async(...args)=>{await claim(...args);throw new Error("claim response lost");};
  const reply=await h.send("Sí","claim-lost");
  assert.equal(reply.status,"failed"); assert.equal(f.calls.length,0); assert.equal(h.pending()?.resultUncertain,true);
  assert.match(reply.text,new RegExp(String(initial.toolCall.arguments.requestId))); assert.doesNotMatch(reply.text,/No se realizó ningún cambio/);
  h.deps.claimDebtPending=claim;
  assert.equal((await h.send("Sí","recover")).status,"completed");
  assert.equal(f.calls[0].args.p_idempotency_key,initial.toolCall.arguments.requestId);
});

test("cancellation wins before claim and a stale confirmation cannot resurrect the request", async () => {
  const f=fixture(); const h=harness(f,payCall()); await h.send("request");
  const claim=h.deps.claimDebtPending!;
  h.deps.claimDebtPending=async(...args)=>{await h.deps.cancelDebtPending!(args[0],actor);return claim(...args);};
  assert.equal((await h.send("Sí")).status,"rejected"); assert.equal(f.calls.length,0); assert.equal(h.pending(),null);
});

test("stale cancellation reads the post-claim uncertainty rather than promising rollback", async () => {
  const f=fixture(); const h=harness(f,payCall()); await h.send("request");
  const stale=structuredClone(h.pending()!); await h.deps.claimDebtPending!(stale.id,actor,false);
  h.deps.getPending=async()=>stale;
  const reply=await h.send("Cancelar"); assert.equal(reply.status,"cancelled");
  assert.match(reply.text,/podría haberse guardado/); assert.doesNotMatch(reply.text,/No se realizó ningún cambio/); assert.equal(h.pending(),null);
});

test("late failure or success cannot resurrect cancelled work or consume a newer debt operation", async () => {
  for(const succeeds of [false,true]) {
    const f=fixture(); const h=harness(f,payCall()); await h.send("request");
    const original=structuredClone(h.pending()!); const entered=deferred(); const release=deferred(); const execute=h.deps.execute;
    h.deps.execute=async(...args)=>{entered.resolve();await release.promise;if(!succeeds)throw new Error("debt_response_unknown");return execute(...args);};
    const running=h.send("Sí","first-confirm"); await entered.promise;
    assert.equal(h.pending()?.resultUncertain,true); assert.equal(h.pending()?.id,original.id);
    const cancelled=await h.send("Cancelar","cancel-during"); assert.equal(cancelled.status,"cancelled"); assert.match(cancelled.text,/podría haberse guardado/);
    assert.equal((await h.send("new request","new-request")).status,"needs_confirmation");
    const newer=structuredClone(h.pending()!); assert.notEqual(newer.id,original.id); assert.notEqual(newer.toolCall.arguments.requestId,original.toolCall.arguments.requestId);
    release.resolve(); const reply=await running;
    assert.equal(reply.status,succeeds?"completed":"failed"); if(!succeeds)assert.match(reply.text,/No reactivé/);
    assert.deepEqual(h.pending(),newer,"late handler cannot mutate replacement");
  }
});

test("a rejected concurrent recovery cannot erase another in-flight attempt", async () => {
  const f=fixture(); const h=harness(f,payCall()); await h.send("request");
  const entered=deferred(); const recoveryEntered=deferred(); const release=deferred(); let calls=0;
  h.deps.execute=async()=>{const first=calls++===0;if(first)entered.resolve();else recoveryEntered.resolve();await release.promise;throw new Error(first?"stale_version":"debt_response_unknown");};
  const initial=h.send("Sí","initial"); await entered.promise; const saved=structuredClone(h.pending()!);
  const recovery=h.send("Sí","recovery");await recoveryEntered.promise;release.resolve();
  const replies=await Promise.all([initial,recovery]);assert.deepEqual(replies.map(r=>r.status),["needs_input","failed"]);
  assert.deepEqual(h.pending(),saved);assert.ok(replies.every(r=>!r.text.includes("No se registró este intento")));
});

test("cleanup and audit failures after confirmed commit report success and retain retry without rollback claims", async () => {
  const f=fixture(); const h=harness(f,payCall()); await h.send("request"); const saved=structuredClone(h.pending()!);
  h.deps.consumePending=async()=>{throw new Error("cleanup unavailable");};h.deps.audit=async()=>{throw new Error("audit unavailable");};
  const reply=await h.send("Sí"); assert.equal(reply.status,"completed"); assert.match(reply.text,/incidencia interna/);
  assert.doesNotMatch(reply.text,/No se realizó ningún cambio/);assert.equal(f.persisted.size,1);
  assert.equal(h.pending()?.id,saved.id);assert.equal(h.pending()?.resultUncertain,true);
});

test("expired stale debt confirmation cannot auto-consume a concurrently claimed recovery", async () => {
  const f=fixture();const h=harness(f,payCall());await h.send("request");const stale=structuredClone(h.pending()!);
  await h.deps.claimDebtPending!(stale.id,actor,false);stale.expiresAt="2026-10-08T00:00:00Z";
  h.deps.getPending=async()=>stale;
  const reply=await h.send("new operation");assert.equal(reply.status,"needs_input");assert.equal(f.calls.length,0);
  assert.equal(h.pending()?.resultUncertain,true);assert.equal(h.pending()?.id,stale.id);
  const cancelled=await h.send("Cancelar");assert.match(cancelled.text,/podría haberse guardado/);
});

test("untrusted interpretation cannot adopt request IDs, snapshots or pending execution markers", async () => {
  for(const field of ["requestId","expectedVersion","__resultUncertain","__clarificationKey"]) {
    const f=fixture();const op=createCall();op.arguments[field]=field==="requestId"?requestId:field==="expectedVersion"?0:true;
    const h=harness(f,op);const reply=await h.send("request");assert.equal(reply.status,"rejected",field);assert.equal(h.pending(),null);assert.equal(f.calls.length,0);
  }
});

test("missing durable-claim dependency fails closed without falling back to consume-before-write", async () => {
  const f=fixture();const h=harness(f,createCall());await h.send("request");const original=structuredClone(h.pending()!);
  delete h.deps.claimDebtPending;
  assert.equal((await h.send("Sí")).status,"rejected");assert.equal(f.calls.length,0);assert.deepEqual(h.pending(),original);
});

test("a damaged confirmed recovery is retained for review and never rewritten as a clarification", async () => {
  const f=fixture();const h=harness(f,payCall());await h.send("request");const original=h.pending()!;
  await h.deps.claimDebtPending!(original.id,actor,false);
  const damaged=structuredClone(h.pending()!);delete damaged.toolCall.arguments.paymentMethod;
  h.deps.getPending=async()=>damaged;h.deps.savePending=async()=>{throw new Error("must not rewrite recovery");};
  const reply=await h.send("Sí");assert.equal(reply.status,"needs_input");assert.equal(f.calls.length,0);assert.equal(h.pending()?.id,original.id);assert.equal(h.pending()?.resultUncertain,true);
  assert.doesNotMatch(reply.text,/No se realizó ningún cambio/);
});


test("relative debt periods honor verified business timezone and never fall back silently", async () => {
 const now=new Date("2026-10-01T01:00:00Z");
 assert.deepEqual(interpretDebtCall("¿Qué deudas vencen este mes?",[...WHATSAPP_TOOLS],now,"Asia/Tokyo")?.arguments,{from:"2026-10-01",to:"2026-10-31"});
 assert.deepEqual(interpretDebtCall("¿Qué deudas vencen este mes?",[...WHATSAPP_TOOLS],now)?.arguments,{});
 assert.deepEqual(interpretDebtCall("¿Qué deudas vencen este mes?",[...WHATSAPP_TOOLS],now,"invalid/timezone")?.arguments,{});
 assert.deepEqual((await interpretHeuristically("¿Qué deudas vencen este mes?",[...WHATSAPP_TOOLS],null,{timezone:"Asia/Tokyo",now}))?.arguments,{from:"2026-10-01",to:"2026-10-31"});
 const f=fixture();f.rows.businesses[0].timezone="invalid/timezone";
 await assert.rejects(()=>executeDebtTool(f.db,actor,{name:"debts.listDue",arguments:{from:"2026-11-01",to:"2026-11-30"}}),/debt_timezone_unavailable/);
 f.rows.businesses=[];
 await assert.rejects(()=>prepareDebtTool(f.db,actor,payCall()),/debt_timezone_unavailable/);
});


test("due reads omit administratively cancelled debt without hiding its stored history", async () => {
 const f=fixture();f.debt.status="cancelled";
 const result:any=await executeDebtTool(f.db,actor,{name:"debts.listDue",arguments:{from:"2026-11-01",to:"2026-11-30"}});
 assert.deepEqual(result.debts,[]);assert.equal(f.debt.pending_amount,"900000.00");assert.equal(f.calls.length,0);
});
