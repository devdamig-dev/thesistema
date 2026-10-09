import { applyAdminBranchScope } from "../data/branch-scope";
import { randomUUID } from "node:crypto";
import { hasPermission } from "../permissions";
import { mutateSale, type SalesDatabase } from "./service";
import { parseItems, parseSaveSaleInput, parseVoidSaleInput, record, saleTotalCents, timestamp, uuid, text as saleText, version } from "./validation";
import { SALES_CHANNELS } from "./types";
import type { AgentActor, PendingOperation, ToolCall, ToolDefinition } from "../whatsapp-agent/types";
export const isSaleWrite=(name:string)=>["sales.create","sales.edit","sales.void"].includes(name);
export function missingSaleArguments(call:ToolCall):string[]{
 const a=call.arguments;return (call.name==="sales.void"?["saleId","reason"]:call.name==="sales.edit"?["saleId","branchId","occurredAt","channel","paymentMethod","items"]:["branchId","occurredAt","channel","paymentMethod","items"]).filter(key=>a[key]===undefined||a[key]===null||a[key]==="");
}
export function validateSaleCall(call:ToolCall){
 const issues:Array<{key:string;message:string;unexpected?:boolean}>=[]; const clean:Record<string,unknown>={};
 let args:Record<string,unknown>;try{args=record(call.arguments);}catch{return {call:{...call,arguments:{}},issues:[{key:"arguments",message:"deben ser datos de venta válidos",unexpected:true}]};}
 const allowed=call.name==="sales.void"?["saleId","reason","requestId","expectedVersion"]:["saleId","branchId","occurredAt","channel","paymentMethod","items","customerId","notes","requestId","expectedVersion"];
 for(const [key,value] of Object.entries(args)){
  if(!allowed.includes(key)||call.name==="sales.create"&&["saleId","expectedVersion"].includes(key)){issues.push({key,message:"no está permitido",unexpected:true});continue;}
  if(value===undefined)continue;
  try{
   if(["saleId","branchId","requestId"].includes(key))clean[key]=uuid(value);
   else if(key==="customerId")clean[key]=value===null?null:uuid(value);
   else if(key==="expectedVersion")clean[key]=version(value);
   else if(key==="occurredAt")clean[key]=timestamp(value);
   else if(key==="items")clean[key]=parseItems(value);
   else if(key==="channel"){if(!(SALES_CHANNELS as readonly unknown[]).includes(value))throw new Error("Elegí salon, delivery, whatsapp, pedidos_ya, rappi o mp_qr.");clean[key]=value;}
   else clean[key]=saleText(value,key==="paymentMethod"?80:key==="reason"?1000:2000,key==="notes",key!=="paymentMethod");
  }catch(error){issues.push({key,message:error instanceof Error?error.message:"es inválido"});}
 }
 return {call:{name:call.name,arguments:clean},issues};
}
export function saleInput(actor:AgentActor,call:ToolCall){
 const a=call.arguments;const base={requestId:a.requestId,businessId:actor.businessId,userId:actor.userId,id:call.name==="sales.create"?null:a.saleId,expectedVersion:call.name==="sales.create"?null:a.expectedVersion};
 return call.name==="sales.void"?parseVoidSaleInput({...base,reason:a.reason}):parseSaveSaleInput({...base,branchId:a.branchId,occurredAt:a.occurredAt,channel:a.channel,paymentMethod:a.paymentMethod,customerId:a.customerId??null,notes:a.notes??null,items:a.items});
}
function checked(actor:AgentActor,call:ToolCall){
 if(!isSaleWrite(call.name)||!hasPermission(actor.role,"sales.create")||!actor.enabledModules.includes("sales"))throw new Error("sale_permission_denied");
 const v=validateSaleCall(call);if(v.issues.length||missingSaleArguments(v.call).length)throw new Error("sale_missing_fields");return v.call;
}
export async function prepareSaleTool(db:any,actor:AgentActor,input:ToolCall):Promise<ToolCall>{
 const call=checked(actor,input);const a:Record<string,unknown>={...call.arguments,requestId:randomUUID()};
 if(call.name!=="sales.create"){
  let query=db.from("sales").select("id,business_id,branch_id,status,sale_kind,version").eq("business_id",actor.businessId).eq("id",a.saleId);
  query=applyAdminBranchScope(query,actor.branchIds);
  const res=await query.maybeSingle();if(res.error||!res.data||res.data.business_id!==actor.businessId||res.data.status!=="active")throw new Error("sale_not_found");
  if(call.name==="sales.edit"&&res.data.sale_kind!=="detailed")throw new Error("sale_detail_required");
  a.expectedVersion=res.data.version;
 }
 if(call.name!=="sales.void"){
  if(actor.branchIds!==null&&!actor.branchIds.includes(String(a.branchId)))throw new Error("sale_branch_forbidden");
  const res=await db.from("branches").select("id").eq("business_id",actor.businessId).eq("id",a.branchId).maybeSingle();
  if(res.error||!res.data)throw new Error("sale_branch_forbidden");
 }
 const prepared={name:call.name,arguments:a};saleInput(actor,prepared);
 if(saleConfirmationText(prepared).length>3500)throw new Error("sale_preview_requires_ui");
 return prepared;
}
export async function executeSaleTool(db:SalesDatabase & {from?: (table:string)=>any},actor:AgentActor,input:ToolCall){
 const call=checked(actor,input); const value=saleInput(actor,call);
 if (call.name!=="sales.void" && actor.branchIds!==null && !actor.branchIds.includes(String(call.arguments.branchId))) throw new Error("sale_write_rejected");
 if (call.name!=="sales.create") {
  if (!db.from) throw new Error("sale_write_rejected");
  const existing=await applyAdminBranchScope(db.from("sales").select("id,business_id,branch_id").eq("business_id",actor.businessId).eq("id",value.id),actor.branchIds).maybeSingle();
  if(existing.error||!existing.data||existing.data.business_id!==actor.businessId)throw new Error("sale_write_rejected");
 }
 const result=await mutateSale(db,{businessId:actor.businessId,userId:actor.userId,source:"whatsapp"},call.name==="sales.void"?"void":"save",value);
 if(!result.ok)throw new Error(result.persisted==="unknown"?"sale_response_unknown":"sale_write_rejected");return result;
}
export function saleConfirmationText(call:ToolCall){
 const a=call.arguments;
 const detail=call.name==="sales.void"?`Anular venta ${a.saleId}, versión ${a.expectedVersion}. Motivo: ${a.reason}. Se conservará el historial.`:
 `${call.name==="sales.edit"?`Editar venta ${a.saleId}, versión ${a.expectedVersion}`:"Registrar venta"}. Sucursal: ${a.branchId}. Fecha/hora: ${a.occurredAt}. Canal: ${a.channel}. Medio: ${a.paymentMethod}.\n${parseItems(a.items).map(item=>`${item.description}${item.productId?` (producto ${item.productId})`:" (concepto)"}: ${item.quantity} × ${item.unitPrice}`).join("\n")}\nTotal: ${(saleTotalCents(parseItems(a.items))/100).toLocaleString("es-AR",{minimumFractionDigits:2,maximumFractionDigits:2})}; moneda no informada. Cliente: ${a.customerId??"sin cliente"}. Notas: ${a.notes??"sin notas"}. No se modifica stock físico.`;
 return `${detail}\nRespondé “Sí” para confirmar o “Cancelar” para descartar.`;
}
export function interpretSaleCall(input:string,tools:ToolDefinition[],pending?:PendingOperation|null):ToolCall|null{
 const normalized=input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
 if(pending&&isSaleWrite(pending.toolCall.name)){
  const key=pending.clarificationKey??missingSaleArguments(pending.toolCall)[0];if(!key)return pending.toolCall;
  let value:unknown=input.trim();
  if(key==="items"){try{value=JSON.parse(input);}catch{const parts=input.split(";").map(v=>v.trim());value=parts.length===3?[{productId:null,description:parts[0],quantity:parts[1],unitPrice:parts[2]}]:input;}}
  if(key==="channel"){const map:Record<string,string>={"salón":"salon","salon":"salon","delivery":"delivery","whatsapp":"whatsapp","pedidosya":"pedidos_ya","rappi":"rappi","mercado pago qr":"mp_qr"};value=map[input.trim().toLowerCase()]??input;}
  if(key==="notes"&&normalized==="sin notas")value=null;
  return {name:pending.toolCall.name,arguments:{...pending.toolCall.arguments,[key]:value}};
 }
 const structured=input.match(/^(?:venta|sales\.create|editar venta|sales\.edit|anular venta|sales\.void)\s*:\s*(\{[\s\S]*\})$/i);
 if(structured){const name=/^(anular|sales\.void)/i.test(input)?"sales.void":/^(editar|sales\.edit)/i.test(input)?"sales.edit":"sales.create";if(!tools.some(t=>t.name===name))return null;try{return {name,arguments:JSON.parse(structured[1])};}catch{return {name,arguments:{}};}}
 const name=/anula.*venta/.test(normalized)?"sales.void":/edita.*venta/.test(normalized)?"sales.edit":/(registra|carga|nueva|crea).*venta/.test(normalized)?"sales.create":null;
 if(!name||!tools.some(t=>t.name===name))return null;
 const saleId=input.match(/venta\s+([0-9a-f-]{36})/i)?.[1];return {name,arguments:saleId?{saleId}:{}};
}
