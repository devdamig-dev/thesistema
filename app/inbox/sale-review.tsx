"use client";
import { useRef,useState } from "react";
import { Button } from "@/components/ui/button";
import { approveInboxSaleAction } from "@/app/actions/sales";
import { localDateTime,localDateTimeToIso } from "@/app/ventas/reporting";
import { SALES_CHANNELS } from "@/lib/sales/types";
import { parseInboxSaleApproval,type InboxSaleApproval,type InboxSaleReview } from "@/lib/sales/inbox";
const field="w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink";
export function InboxSaleReviewDialog({review,onClose,onSaved}:{review:InboxSaleReview;onClose:()=>void;onSaved:()=>void}){
 const [branch,setBranch]=useState(review.branchId??"");const [date,setDate]=useState(()=>{try{return review.occurredAt?localDateTime(review.occurredAt,review.timezone):"";}catch{return "";}});
 const [channels,setChannels]=useState(review.channels);const [method,setMethod]=useState(review.paymentMethod);const [notes,setNotes]=useState(review.notes);
 const [error,setError]=useState("");const [pending,setPending]=useState(false);const [uncertain,setUncertain]=useState(false);
 const lock=useRef(false);const frozen=useRef<InboxSaleApproval|null>(null);
 async function submit(){
  if(lock.current)return;lock.current=true;setPending(true);setError("");
  try{
   if(!frozen.current)frozen.current=parseInboxSaleApproval({extractionId:review.extractionId,businessId:review.businessId,userId:review.userId,expectedFields:review.expectedFields,review:{kind:"summary",branchId:branch,occurredAt:review.occurredAt && localDateTime(review.occurredAt,review.timezone) === date ? review.occurredAt : localDateTimeToIso(date,review.timezone),paymentMethod:method.trim()||null,notes:notes.trim()||null,channels}});
   const result=await approveInboxSaleAction(frozen.current);
   if(result.ok){onSaved();return;}
   setError(result.error);
   if(result.persisted==="unknown"||uncertain)setUncertain(true);else frozen.current=null;
  }catch(err){if(frozen.current){setUncertain(true);setError("El resultado podría estar guardado. Reintentá exactamente este mismo resumen o verificá Ventas antes de registrar otro.");}else setError(err instanceof Error?err.message:"Revisá los datos.");}
  finally{lock.current=false;setPending(false);}
 }
 return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-labelledby="sale-review-title"><section className="max-h-[90vh] w-full max-w-xl space-y-4 overflow-y-auto rounded-2xl border border-line bg-bg-elevated p-6">
  <h2 id="sale-review-title" className="text-lg font-semibold">Revisar resumen de ventas</h2>
  <p className="text-sm text-ink-muted">Estos importes son un resumen por canal. No se conocen productos, cantidades ni cantidad de tickets. Se guardará el ingreso sin descontar stock. Moneda no informada.</p>
  <fieldset disabled={pending||uncertain} className="space-y-4">
   <label className="block text-sm">Sucursal<select aria-label="Sucursal del resumen" className={field} value={branch} disabled={review.branchId!==null} onChange={e=>setBranch(e.target.value)}><option value="">Seleccionar sucursal</option>{review.branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
   <label className="block text-sm">Fecha y hora ({review.timezone})<input aria-label="Fecha y hora del resumen" type="datetime-local" step="1" className={field} value={date} onChange={e=>setDate(e.target.value)}/></label>
   {channels.map((c,index)=><div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2"><select aria-label={`Canal ${index+1}`} className={field} value={c.channel} onChange={e=>setChannels(channels.map((x,i)=>i===index?{...x,channel:e.target.value}:x))}><option value="">Canal</option>{SALES_CHANNELS.map(channel=><option key={channel} value={channel}>{channel}</option>)}</select><input aria-label={`Importe ${index+1}`} inputMode="decimal" className={field} value={c.amount} onChange={e=>setChannels(channels.map((x,i)=>i===index?{...x,amount:e.target.value}:x))}/><Button variant="ghost" aria-label={`Quitar canal ${index+1}`} disabled={channels.length===1} onClick={()=>setChannels(channels.filter((_,i)=>i!==index))}>Quitar</Button></div>)}
   <Button variant="ghost" disabled={channels.length>=6} onClick={()=>setChannels([...channels,{channel:"",amount:""}])}>Agregar canal</Button>
   <label className="block text-sm">Medio de pago (opcional; sólo si corresponde al resumen)<input aria-label="Medio de pago del resumen" className={field} maxLength={80} value={method} onChange={e=>setMethod(e.target.value)}/></label>
   <label className="block text-sm">Notas<textarea aria-label="Notas del resumen" className={field} maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
  </fieldset>
  {error&&<p role="alert" className="text-sm text-danger-400">{error}</p>}
  {uncertain&&<p className="text-sm text-warn-400">Resultado sin confirmar. El reintento conserva exactamente los datos originales. No cierres esta revisión hasta comprobarlo.</p>}
  <div className="flex justify-end gap-2"><Button variant="ghost" disabled={pending||uncertain} onClick={onClose}>Cancelar</Button><Button disabled={pending} onClick={()=>void submit()}>{pending?"Guardando…":uncertain?"Reintentar mismo resumen":"Confirmar resumen"}</Button></div>
 </section></div>;
}
