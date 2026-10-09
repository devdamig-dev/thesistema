"use server";
import { readSalesRevision } from "../../lib/sales/read";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDatabaseMode } from "@/lib/env";
import { hasPermission,canSeeModule } from "@/lib/permissions";
import { applyAdminBranchScope } from "@/lib/data/branch-scope";
import { readAllSales } from "@/app/ventas/reporting";
import { parseInboxSaleApproval } from "@/lib/sales/inbox";
import { mutateSale,callSaleRpc,type SalesDatabase } from "@/lib/sales/service";
import type { SaleResult,SalesWorkspaceResult,SaleRecord } from "@/lib/sales/types";
const NIL="00000000-0000-0000-0000-000000000000";
async function readRows(query:any):Promise<{data:any[]|null;error:unknown}>{
 try{return {data:await readAllSales((from,to)=>query.range(from,to)),error:null};}catch(error){return {data:null,error};}
}
export async function getSalesWorkspaceAction():Promise<SalesWorkspaceResult>{
 if(!isDatabaseMode())return {ok:false,error:"Las ventas reales sólo se guardan en database mode."};
 const ctx=await getCurrentUserContext();
 if(!ctx.isAuthenticated||!ctx.userId||!ctx.businessId||!hasPermission(ctx.role,"sales.view")||!canSeeModule(ctx.role,"sales",ctx.enabledModules))return {ok:false,error:"No se pudo resolver un negocio autorizado para consultar ventas."};
 const db=await createSupabaseServerClient() as any;
 if(!db)return {ok:false,error:"No pudimos conectar con los datos de ventas."};
 const scope=(q:any,key="branch_id")=>ctx.assignedBranchIds===null?q:q.in(key,ctx.assignedBranchIds.length?ctx.assignedBranchIds:[NIL]);
 try{
 const revision=await readSalesRevision(db,ctx.businessId);
 const [profile,business,branches,products,customers,sales]=await Promise.all([
  db.from("profiles").select("active").eq("id",ctx.userId).maybeSingle(),
  db.from("businesses").select("timezone").eq("id",ctx.businessId).maybeSingle(),
  readRows(scope(db.from("branches").select("id,name",{count:"exact"}).eq("business_id",ctx.businessId).order("name").order("id"),"id")),
  readRows(db.from("products").select("id,name,price",{count:"exact"}).eq("business_id",ctx.businessId).eq("active",true).order("name").order("id")),
  readRows(db.from("customers").select("id,name",{count:"exact"}).eq("business_id",ctx.businessId).eq("active",true).order("name").order("id")),
  readRows(applyAdminBranchScope(db.from("sales").select("*",{count:"exact"}).eq("business_id",ctx.businessId),ctx.assignedBranchIds).order("occurred_at",{ascending:false}).order("id")),
 ]);
 if(profile.error||!profile.data?.active||business.error||!business.data?.timezone||[branches,products,customers,sales].some(r=>r.error||!r.data))return {ok:false,error:"No pudimos leer los datos completos. Revisá permisos, sesión y migración de Ventas."};
 new Intl.DateTimeFormat("es-AR",{timeZone:business.data.timezone}).format(new Date());
 const items=await readRows(db.from("sale_items").select("id,sale_id,business_id,position,product_id,description,quantity::text,unit_price::text,total::text,recipe_snapshot,created_at",{count:"exact"}).eq("business_id",ctx.businessId).order("sale_id").order("position"));
 if(items.error||!items.data)return {ok:false,error:"No pudimos leer el detalle de ventas."};
 if(revision!==await readSalesRevision(db,ctx.businessId))return {ok:false,error:"Las ventas cambiaron durante la lectura. Volvé a cargar los registros."};
 const bySale=new Map<string,any[]>();for(const item of items.data){const list=bySale.get(item.sale_id)??[];list.push(item);bySale.set(item.sale_id,list);}
 return {ok:true,data:{businessId:ctx.businessId,userId:ctx.userId,timezone:business.data.timezone,branches:branches.data!,products:products.data!,customers:customers.data!,sales:sales.data!.map(row=>({...row,items:bySale.get(row.id)??[]})) as SaleRecord[],canManage:hasPermission(ctx.role,"sales.create")}};
 }catch{return {ok:false,error:"No pudimos cargar las ventas completas. Volvé a intentar."};}
}
async function write(operation:"save"|"void",input:unknown):Promise<SaleResult>{
 if(!isDatabaseMode())return {ok:false,persisted:false,error:"El modo demo no guarda ventas en la base de datos."};
 const ctx=await getCurrentUserContext();
 if(!ctx.isAuthenticated||!ctx.userId||!ctx.businessId||!hasPermission(ctx.role,"sales.create")||!canSeeModule(ctx.role,"sales",ctx.enabledModules))return {ok:false,persisted:false,error:"No tenés permiso para gestionar ventas en el negocio activo."};
 const db=await createSupabaseServerClient();if(!db)return {ok:false,persisted:false,error:"No pudimos conectar con la base de datos."};
 const result=await mutateSale(db as unknown as SalesDatabase,{businessId:ctx.businessId,userId:ctx.userId,source:"manual"},operation,input);
 if(result.ok){try{for(const path of ["/ventas","/","/clientes","/auditoria","/inbox","/balances","/gastos"])revalidatePath(path);}catch{/* Persistence is already confirmed. */}}
 return result;
}
export async function saveSaleAction(input:unknown):Promise<SaleResult>{return write("save",input);}
export async function voidSaleAction(input:unknown):Promise<SaleResult>{return write("void",input);}

export async function getInboxSaleReviewAction(extractionId:string):Promise<{ok:true;review:import("@/lib/sales/inbox").InboxSaleReview}|{ok:false;error:string}>{
 if(!isDatabaseMode())return {ok:false,error:"database_required"};
 const ctx=await getCurrentUserContext();const db=await createSupabaseServerClient() as any;
 if(!db||!ctx.isAuthenticated||!ctx.businessId||!ctx.userId||!hasPermission(ctx.role,"inbox.approve"))return {ok:false,error:"No tenés permiso para revisar esta venta."};
 const extraction=await db.from("ai_extractions").select("id,business_id,branch_id,message_id,type,fields,status").eq("id",extractionId).maybeSingle();
 if(extraction.error||!extraction.data)return {ok:false,error:"Extracción no disponible."};
 const e=extraction.data;if(e.type!=="sale")return {ok:false,error:"unsupported_sale_extraction"};
 if(!["pending","needs_review","failed"].includes(e.status))return {ok:false,error:"La extracción ya está cerrada. Revisá su registro en Ventas."};
 if(!hasPermission(ctx.role,"sales.create")||!canSeeModule(ctx.role,"sales",ctx.enabledModules))return {ok:false,error:"No tenés permiso para registrar ventas."};
 const [message,business,profile]=await Promise.all([db.from("whatsapp_messages").select("business_id,branch_id").eq("id",e.message_id).maybeSingle(),db.from("businesses").select("timezone").eq("id",ctx.businessId).maybeSingle(),db.from("profiles").select("active").eq("id",ctx.userId).maybeSingle()]);
 if(message.error||message.data?.business_id!==ctx.businessId||e.business_id&&e.business_id!==ctx.businessId||business.error||!business.data?.timezone||profile.error||!profile.data?.active)return {ok:false,error:"No se pudo verificar el contexto de la venta."};
 const branchId=e.branch_id??message.data.branch_id??null;
 if(e.branch_id&&message.data.branch_id&&e.branch_id!==message.data.branch_id||branchId&&ctx.assignedBranchIds!==null&&!ctx.assignedBranchIds.includes(branchId))return {ok:false,error:"Sucursal no autorizada."};
 let branchQuery=db.from("branches").select("id,name",{count:"exact"}).eq("business_id",ctx.businessId).order("id");if(ctx.assignedBranchIds!==null)branchQuery=branchQuery.in("id",ctx.assignedBranchIds.length?ctx.assignedBranchIds:[NIL]);
 const branches=await readRows(branchQuery);if(branches.error||!branches.data)return {ok:false,error:"No se pudieron leer las sucursales."};
 const fields=e.fields??{};const channels=Array.isArray(fields.channels)?fields.channels.map((c:any)=>({channel:typeof c.channel==="string"?c.channel:"",amount:c.amount===undefined?"":String(c.amount)})):fields.total_amount!==undefined?[{channel:"",amount:String(fields.total_amount)}]:[{channel:"",amount:""}];
 return {ok:true,review:{extractionId,businessId:ctx.businessId,userId:ctx.userId,timezone:business.data.timezone,branchId,branches:branches.data,expectedFields:fields,channels,occurredAt:typeof fields.occurred_at==="string"?fields.occurred_at:"",paymentMethod:typeof fields.payment_method==="string"?fields.payment_method:"",notes:typeof fields.notes==="string"?fields.notes:""}};
}
export async function approveInboxSaleAction(input:unknown):Promise<SaleResult>{
 let value;try{value=parseInboxSaleApproval(input);}catch(error){return {ok:false,persisted:false,error:error instanceof Error?error.message:"Datos inválidos."};}
 if(!isDatabaseMode())return {ok:false,persisted:false,error:"database_required"};
 const ctx=await getCurrentUserContext();
 if(!ctx.isAuthenticated||ctx.businessId!==value.businessId||ctx.userId!==value.userId||!hasPermission(ctx.role,"inbox.approve")||!hasPermission(ctx.role,"sales.create")||!canSeeModule(ctx.role,"sales",ctx.enabledModules))return {ok:false,persisted:false,error:"Cambió la sesión, el negocio o los permisos. No se confirmó este intento."};
 const db=await createSupabaseServerClient();if(!db)return {ok:false,persisted:false,error:"No se pudo conectar."};
 const result=await callSaleRpc(db as unknown as SalesDatabase,"approve_sale_extraction_atomic",{p_business_id:ctx.businessId,p_actor_id:ctx.userId,p_extraction_id:value.extractionId,p_expected_fields:value.expectedFields,p_review:value.review});
 if(result.ok){try{for(const path of ["/inbox","/ventas","/","/auditoria","/balances","/gastos"])revalidatePath(path);}catch{/* Confirmed transaction. */}}
 return result;
}

export async function getSaleHistoryAction(id:string):Promise<{ok:true;history:import("@/lib/sales/types").SaleMutation[]}|{ok:false;error:string}>{
 if(!isDatabaseMode())return {ok:false,error:"database_required"};
 const ctx=await getCurrentUserContext();const db=await createSupabaseServerClient() as any;
 if(!db||!ctx.isAuthenticated||!ctx.userId||!ctx.businessId||!hasPermission(ctx.role,"sales.view")||!canSeeModule(ctx.role,"sales",ctx.enabledModules))return {ok:false,error:"No tenés permiso para consultar el historial."};
 const [profile,sale]=await Promise.all([db.from("profiles").select("active").eq("id",ctx.userId).maybeSingle(),applyAdminBranchScope(db.from("sales").select("id").eq("business_id",ctx.businessId).eq("id",id),ctx.assignedBranchIds).maybeSingle()]);
 if(profile.error||!profile.data?.active||sale.error||!sale.data)return {ok:false,error:"La venta no está disponible."};
 const result=await readRows(db.from("sale_mutations").select("request_id,sale_id,actor_id,actor_role,source,operation,created_at,before_snapshot,after_snapshot,result",{count:"exact"}).eq("business_id",ctx.businessId).eq("sale_id",id).order("created_at").order("request_id"));
 return result.error||!result.data?{ok:false,error:"No pudimos leer el historial completo."}:{ok:true,history:result.data};
}
