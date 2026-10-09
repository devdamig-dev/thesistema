const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const params = new URLSearchParams(location.search);
const initial = { businessId:id(2),userId:id(1),branches:[{id:id(3),name:'Central QA ficticia'},{id:id(4),name:'Norte QA ficticia'}],canManage:!params.has('readonly'),totalVariable:50,grossMarginPct:30,expenses:[{id:id(10),nombre:'Internet QA ficticio',categoria:'Servicios',monto:123.45,amount:'123.45',vencimiento:'2026-10-31',estado:'pending',sucursal:'Central QA ficticia',branchId:id(3),version:1,recordStatus:'active',source:'manual',voidReason:null},{id:id(11),nombre:'Histórico QA ficticio',categoria:'Local',monto:500,amount:'500.00',vencimiento:null,estado:'histórico',sucursal:'Norte QA ficticia',branchId:id(4),version:0,recordStatus:'active',source:null,voidReason:null}],receipts:{},history:{}};
let saved = null;try { saved = JSON.parse(sessionStorage.getItem('expense-qa-backend')); } catch { /* isolated fixture */ }
const qa = window.qa = { ...initial,...saved,canManage:!params.has('readonly'),writes:[],saveCalls:0,voidCalls:0,restoreCalls:0,holdWrites:false,releaseWrites:()=>{},response:'success',readFailure:false };
function snapshot(row) { return { name:row.nombre,category:row.categoria,amount:row.amount,status:row.estado,branch_id:row.branchId,due_date:row.vencimiento,record_status:row.recordStatus,version:row.version,void_reason:row.voidReason }; }
function persist() { sessionStorage.setItem('expense-qa-backend',JSON.stringify({expenses:qa.expenses,receipts:qa.receipts,history:qa.history})); }
export async function getExpensesPageDataAction() { if(qa.readFailure)return {ok:false,error:'QA ficticio: lectura incompleta.'};return {ok:true,data:{...qa,totalFixed:qa.expenses.filter(r=>r.recordStatus==='active').reduce((s,r)=>s+r.monto,0)}}; }
export async function getExpenseHistoryAction(id) { return {ok:true,history:qa.history[id]??[]}; }
async function mutate(kind,input) {
 qa[`${kind}Calls`]++;qa.writes.push({kind,input:structuredClone(input)});
 if(qa.holdWrites)await new Promise(resolve=>{qa.releaseWrites=resolve;});
 if(qa.response==='conflict'){qa.response='success';return {ok:false,persisted:false,error:'El gasto cambió. Recargá antes de continuar.'};}
 if(qa.receipts[input.requestId]) return structuredClone(qa.receipts[input.requestId]);
 const old=qa.expenses.find(r=>r.id===input.id);const before=old?snapshot(old):null;let row;
 if(kind==='save'){row={id:old?.id??crypto.randomUUID(),nombre:input.name,categoria:input.category,monto:Number(input.amount),amount:input.amount,vencimiento:input.dueDate,estado:input.status,sucursal:qa.branches.find(b=>b.id===input.branchId).name,branchId:input.branchId,version:(old?.version??0)+1,recordStatus:'active',source:old?.source??'manual',voidReason:null};}
 else {row={...old,recordStatus:kind==='void'?'voided':'active',version:old.version+1,voidReason:kind==='void'?input.reason:null};}
 qa.expenses=old?qa.expenses.map(r=>r.id===old.id?row:r):[...qa.expenses,row];
 const result={ok:true,persisted:true,expenseId:row.id,version:row.version};qa.receipts[input.requestId]=result;
 qa.history[row.id]=[{request_id:input.requestId,source:'manual',operation:kind,actor_role:'owner',created_at:new Date().toISOString(),before_snapshot:before,after_snapshot:snapshot(row),payload:{input}},...(qa.history[row.id]??[])];persist();
 if(qa.response==='throw-after-commit'){qa.response='success';throw new Error('lost response after commit');}
 return result;
}
export const saveExpenseAction = input=>mutate('save',input);
export const voidExpenseAction = input=>mutate('void',input);
export const restoreExpenseAction = input=>mutate('restore',input);
