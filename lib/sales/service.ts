import { parseSaveSaleInput, parseVoidSaleInput, UUID } from "./validation";
import type { SaleResult, SaveSaleInput, VoidSaleInput } from "./types";
export type SalesDatabase = { rpc: (name: string,args:Record<string,unknown>) => PromiseLike<{data:unknown;error:{code?:string}|null}> };
const ERRORS:Record<string,string>={sale_permission_denied:"No tenés permiso para gestionar ventas.",sale_branch_forbidden:"La sucursal no está disponible para tu usuario.",sale_module_disabled:"El módulo Ventas está deshabilitado.",sale_context_changed:"Cambió la sesión o el negocio activo. Recargá antes de continuar.",sale_conflict:"La venta cambió. Recargá y revisá los cambios antes de editarla.",sale_already_voided:"La venta ya está anulada.",sale_idempotency_conflict:"La referencia de este intento ya se usó con otros datos. Revisá el historial.",sale_not_found:"La venta no está disponible en este negocio.",sale_detail_required:"El registro histórico no tiene detalle editable. Podés anularlo conservando su historial.",sale_customer_forbidden:"El cliente no está disponible en este negocio.",sale_product_forbidden:"El producto no está activo o no pertenece al negocio.",sale_invalid_date:"Revisá la fecha y hora. No se permiten ventas futuras.",sale_extraction_changed:"La extracción cambió desde la revisión. Abrila nuevamente.",sale_extraction_closed:"La extracción ya está cerrada.",sale_extraction_fields_required:"Completá y revisá los datos de venta antes de aprobar.",sale_invalid_input:"Revisá los datos de la venta.",sale_invalid_total:"Revisá el importe total.",sale_invalid_quantity:"Revisá las cantidades de la venta."};
export function saleRpcResult(response: {data:unknown;error:unknown}):SaleResult {
 const data=response.data as {ok?:boolean;id?:unknown;version?:unknown;error?:string}|null;
 if(!response.error&&data?.ok===true&&typeof data.id==="string"&&UUID.test(data.id)&&Number.isSafeInteger(data.version)&&Number(data.version)>=1) return {ok:true,persisted:true,id:data.id,version:Number(data.version)};
 if(!response.error&&data?.ok===false) return {ok:false,persisted:false,error:ERRORS[data.error??""]??"No se guardó la venta. Revisá los datos y permisos."};
 return {ok:false,persisted:"unknown",error:"No se pudo confirmar el resultado. Conservá este intento y reintentá los mismos datos para evitar duplicados."};
}
export async function callSaleRpc(db:SalesDatabase,name:string,args:Record<string,unknown>):Promise<SaleResult>{
 try{return saleRpcResult(await db.rpc(name,args));}catch{return {ok:false,persisted:"unknown",error:"Se interrumpió la conexión. Reintentá este mismo intento para verificarlo sin duplicar la venta."};}
}
/** All transports use this parser and the same SQL transaction engine. */
export async function mutateSale(db:SalesDatabase,context:{businessId:string;userId:string;source:"manual"|"whatsapp"},operation:"save"|"void",input:unknown):Promise<SaleResult>{
 let parsed:SaveSaleInput|VoidSaleInput;
 try{parsed=operation==="save"?parseSaveSaleInput(input):parseVoidSaleInput(input);}catch(error){return {ok:false,persisted:false,error:error instanceof Error?error.message:"Datos inválidos."};}
 if(parsed.businessId!==context.businessId||parsed.userId!==context.userId) return {ok:false,persisted:false,error:ERRORS.sale_context_changed};
 return context.source==="manual"?callSaleRpc(db,operation==="save"?"save_sale_atomic":"void_sale_atomic",{p_business_id:context.businessId,p_input:parsed}):callSaleRpc(db,"mutate_sale_for_agent",{p_business_id:context.businessId,p_actor_id:context.userId,p_operation:operation,p_input:parsed});
}
