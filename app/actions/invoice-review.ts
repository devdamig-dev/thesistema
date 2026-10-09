"use server";
import { revalidatePath } from "next/cache";
import { getCurrentUserContext } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDatabaseMode } from "@/lib/env";
import { canSeeModule, hasPermission } from "@/lib/permissions";
import { invoiceRpc, parseInvoiceOperation, UUID, type InvoiceHistory, type InvoiceMutationResult, type InvoiceWorkspace } from "@/lib/invoices/manual";
async function context() {
 if(!isDatabaseMode())throw new Error("La gestión real de facturas requiere database mode.");const ctx=await getCurrentUserContext();
 if(!ctx.isAuthenticated||!ctx.userId||!ctx.businessId||!hasPermission(ctx.role,"invoices.view")||!canSeeModule(ctx.role,"invoices_ocr",ctx.enabledModules))throw new Error("No hay una sesión autorizada para ver facturas.");
 const db=await createSupabaseServerClient() as any;if(!db)throw new Error("No se pudo conectar con Facturas.");const profile=await db.from("profiles").select("active").eq("id",ctx.userId).maybeSingle();if(profile.error||!profile.data?.active)throw new Error("La sesión no tiene un perfil activo.");return{ctx:{...ctx,userId:ctx.userId,businessId:ctx.businessId},db};
}
async function all(query:any):Promise<any[]>{const rows:any[]=[];let count:number|null=null;for(let offset=0;;offset+=500){const result=await query.range(offset,offset+499);if(result.error||!Array.isArray(result.data)||!Number.isSafeInteger(result.count)||count!==null&&count!==result.count)throw new Error("No se pudieron leer todos los datos de facturas.");count=result.count;rows.push(...result.data);if(rows.length===count)return rows;if(!result.data.length||rows.length>count!)throw new Error("La lectura de facturas quedó incompleta.");}}
async function revision(db:any,businessId:string):Promise<string>{const result=await db.rpc("get_invoice_review_revision",{p_business_id:businessId});if(result.error||typeof result.data!=="string")throw new Error("No se pudo verificar la versión de los datos.");return result.data;}
export async function getInvoiceWorkspaceAction():Promise<{ok:true;data:InvoiceWorkspace}|{ok:false;error:string}>{
 try{const{ctx,db}=await context();const before=await revision(db,ctx.businessId);const scope=(q:any,key="branch_id")=>ctx.assignedBranchIds===null?q:q.in(key,ctx.assignedBranchIds.length?ctx.assignedBranchIds:["00000000-0000-0000-0000-000000000000"]);
 const[branches,suppliers,ingredients,invoices]=await Promise.all([
 all(scope(db.from("branches").select("id,name",{count:"exact"}).eq("business_id",ctx.businessId).order("name").order("id"),"id")),
 all(db.from("suppliers").select("id,name",{count:"exact"}).eq("business_id",ctx.businessId).eq("active",true).order("name").order("id")),
 all(db.from("ingredients").select("id,name,unit",{count:"exact"}).eq("business_id",ctx.businessId).order("name").order("id")),
 all(scope(db.from("invoices").select("id,business_id,branch_id,supplier_id,number,type,invoice_date,due_date,tax_id,payment_method,subtotal::text,tax::text,total::text,status,source,ocr_text,processing_error,edit_version,reviewed_version,reviewed_by,reviewed_at,storage_path",{count:"exact"}).eq("business_id",ctx.businessId).order("created_at",{ascending:false}).order("id"))),
 ]);
 const items=await all(db.from("invoice_items").select("id,invoice_id,description,qty_numeric::text,unit,unit_price::text,total::text,matched_ingredient_id,suggested_ingredient_id,match_status,review_position,invoices!inner(business_id)",{count:"exact"}).eq("invoices.business_id",ctx.businessId).order("invoice_id").order("review_position",{nullsFirst:false}).order("id"));
 if(before!==await revision(db,ctx.businessId))throw new Error("Las facturas cambiaron durante la lectura. Volvé a actualizar.");const grouped=new Map<string,any[]>();for(const item of items){const rows=grouped.get(item.invoice_id)??[];rows.push(item);grouped.set(item.invoice_id,rows);}
 return{ok:true,data:{businessId:ctx.businessId,userId:ctx.userId,branches,suppliers,ingredients,invoices:invoices.map(row=>({...row,items:grouped.get(row.id)??[]})),canEdit:hasPermission(ctx.role,"invoices.upload"),canApprove:hasPermission(ctx.role,"invoices.approve")}};
 }catch(error){return{ok:false,error:error instanceof Error?error.message:"No pudimos cargar las facturas."};}
}
async function write(kind:"save"|"approve",input:unknown):Promise<InvoiceMutationResult>{
 try{const operation=parseInvoiceOperation(kind,input);const{ctx,db}=await context();if(ctx.businessId!==operation.input.businessId||ctx.userId!==operation.input.userId)return{ok:false,persisted:false,error:"Cambió la sesión o el negocio. Volvé a abrir la factura."};if(!hasPermission(ctx.role,kind==="save"?"invoices.upload":"invoices.approve"))return{ok:false,persisted:false,error:"No tenés permiso para esta operación."};
 const result=await invoiceRpc(kind==="save"?db:createSupabaseAdminClient() as any,operation);
 if(result.ok){try{for(const path of["/facturas","/compras","/stock","/productos","/auditoria","/reportes","/balances"])revalidatePath(path);}catch{/* Commit already confirmed. */}}return result;
 }catch(error){return{ok:false,persisted:false,error:error instanceof Error?error.message:"No se pudo verificar la operación."};}
}
export async function saveInvoiceReviewAction(input:unknown):Promise<InvoiceMutationResult>{return write("save",input);}
export async function approveReviewedInvoiceAction(input:unknown):Promise<InvoiceMutationResult>{return write("approve",input);}
export async function getInvoiceReviewHistoryAction(id:string):Promise<{ok:true;history:InvoiceHistory[]}|{ok:false;error:string}>{try{if(!UUID.test(id))throw new Error("Factura inválida.");const{ctx,db}=await context();const row=await db.from("invoices").select("id").eq("business_id",ctx.businessId).eq("id",id).maybeSingle();if(row.error||!row.data)throw new Error("Factura no disponible.");return{ok:true,history:await all(db.from("invoice_mutations").select("request_id,actor_role,created_at,before_snapshot,after_snapshot,result",{count:"exact"}).eq("business_id",ctx.businessId).eq("invoice_id",id).order("created_at").order("request_id"))};}catch(error){return{ok:false,error:error instanceof Error?error.message:"No se pudo leer el historial."};}}
