/** A monotonic DB receipt guards multi-request scans against inserts, edits,
 * voids and branch/date moves, including changes that keep row count unchanged.
 * The revision is changed in the same transaction as every sales mutation. */
export async function readSalesRevision(db:{rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>},businessId:string):Promise<string>{
 const result=await db.rpc("get_sales_revision",{p_business_id:businessId});
 if(result.error||typeof result.data!=="string"||!/^\d+$/.test(result.data))throw new Error("No se pudo verificar la versión del registro de ventas.");
 return result.data;
}
export async function withSalesRevision<T>(db:Parameters<typeof readSalesRevision>[0],businessId:string,read:()=>Promise<T>):Promise<T>{
 const before=await readSalesRevision(db,businessId);const value=await read();const after=await readSalesRevision(db,businessId);
 if(before!==after)throw new Error("Las ventas cambiaron durante la lectura. Volvé a cargar el informe.");
 return value;
}
